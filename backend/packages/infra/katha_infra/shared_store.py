"""Cross-service reads/writes over the ONE shared ledger DB.

core-api writes the ledger (via PersistentLedger) and user profiles; admin-api
reads them FRESH per request through this store, so a purchase in the app or web
is immediately visible in the back office. It is the seam that makes the surfaces
one system instead of three. All money still flows through the pure katha_ledger.
"""
from __future__ import annotations

from sqlalchemy import func, select

from katha_ledger import Transaction, TxType

from .db import Database
from .models import (AuditLogRow, CoinTransactionRow, DeviceRow, EntitlementRow,
                     EventRow, GrievanceRow, KVRow, UserProfileRow, WalletRow)
from .persistent_ledger import PersistentLedger


class SharedStore:
    def __init__(self, db: Database | None = None) -> None:
        self.db = db or Database()
        self._ledger: PersistentLedger | None = None

    @property
    def ledger(self) -> PersistentLedger:
        """The admin side's handle on the one shared ledger. Built once: every
        mutation folds in other writers' rows under the write lock, so it is
        always current without reloading the whole log per call."""
        if self._ledger is None:
            self._ledger = PersistentLedger(self.db)
        return self._ledger

    # ---- profiles (written by core-api) ---------------------------------
    def upsert_profile(self, user_id: str, *, phone: str = "", kind: str = "guest",
                       language: str = "hi", created_at: str = "") -> None:
        self.db.run(self._upsert_profile(user_id, phone, kind, language, created_at))

    async def _upsert_profile(self, user_id, phone, kind, language, created_at) -> None:
        async with self.db.session_factory() as s:
            row = await s.get(UserProfileRow, user_id)
            if row is None:
                s.add(UserProfileRow(user_id=user_id, phone=phone, kind=kind,
                                     language=language, created_at=created_at))
            else:
                # Only fill in stronger identity (guest -> phone/apple), never downgrade.
                if phone:
                    row.phone = phone
                if kind != "guest":
                    row.kind = kind
                if language:
                    row.language = language
            await s.commit()

    # ---- reads (used by admin-api) --------------------------------------
    def list_users(self) -> list[dict]:
        return self.db.run(self._list_users())

    async def _list_users(self) -> list[dict]:
        async with self.db.session_factory() as s:
            wallets = {w.user_id: w for w in (await s.execute(select(WalletRow))).scalars()}
            profiles = {p.user_id: p for p in (await s.execute(select(UserProfileRow))).scalars()}
            unlocked = dict((await s.execute(
                select(EntitlementRow.user_id, func.count()).group_by(EntitlementRow.user_id)
            )).all())
        ids = sorted(set(wallets) | set(profiles))
        out = []
        for uid in ids:
            w = wallets.get(uid)
            p = profiles.get(uid)
            out.append({
                "user_id": uid,
                "phone": p.phone if p else "",
                "kind": p.kind if p else "guest",
                "language": p.language if p else "hi",
                "balance_bought": w.balance_bought if w else 0,
                "balance_bonus": w.balance_bonus if w else 0,
                "total": (w.balance_bought + w.balance_bonus) if w else 0,
                "unlocked": int(unlocked.get(uid, 0)),
            })
        return out

    def wallet(self, user_id: str) -> dict:
        return self.db.run(self._wallet(user_id))

    async def _wallet(self, user_id: str) -> dict:
        async with self.db.session_factory() as s:
            w = await s.get(WalletRow, user_id)
        return {"user_id": user_id,
                "balance_bought": w.balance_bought if w else 0,
                "balance_bonus": w.balance_bonus if w else 0,
                "total": (w.balance_bought + w.balance_bonus) if w else 0}

    def transactions(self, user_id: str) -> list[Transaction]:
        return self.db.run(self._transactions(user_id))

    async def _transactions(self, user_id: str) -> list[Transaction]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(
                select(CoinTransactionRow).where(CoinTransactionRow.user_id == user_id)
            )).scalars().all()
        return [Transaction(id=r.id, user_id=r.user_id, type=TxType(r.type),
                            amount_bought=r.amount_bought, amount_bonus=r.amount_bonus,
                            reference_type=r.reference_type, reference_id=r.reference_id,
                            idempotency_key=r.idempotency_key, created_at=r.created_at)
                for r in rows]

    # ---- admin write (goes to the SAME ledger core-api reads) -----------
    def admin_adjust(self, user_id: str, *, coins: int, reason_code: str,
                     ref_id: str, created_at: str) -> dict:
        # The pure admin_adjust rule runs inside the ledger's locked transaction,
        # so the write lands in the one shared ledger and is idempotent by ref_id.
        self.ledger.admin_adjust(user_id, coins=coins, reference_type=f"admin_adjust:{reason_code}",
                        reference_id=ref_id, idempotency_key=ref_id, created_at=created_at)
        return self.wallet(user_id)

    # ---- feature-flag overrides (admin_kv) -------------------------------
    def flag_overrides(self) -> dict[str, bool]:
        return self.db.run(self._flag_overrides())

    async def _flag_overrides(self) -> dict:
        import json as _json
        async with self.db.session_factory() as session:
            rows = (await session.execute(select(KVRow))).scalars().all()
        out: dict = {}
        for r in rows:
            if not r.key.startswith("flag:"):
                continue
            key = r.key.removeprefix("flag:")
            if r.value in ("0", "1"):
                out[key] = r.value == "1"
            else:
                try:  # {"enabled": bool, "pct": 0-100} — a ramp (#056)
                    out[key] = _json.loads(r.value)
                except ValueError:
                    continue
        return out

    def set_flag(self, key: str, enabled: bool, pct: int = 100) -> None:
        self.db.run(self._set_flag(key, enabled, pct))

    async def _set_flag(self, key: str, enabled: bool, pct: int) -> None:
        import json as _json
        value = ("1" if enabled else "0") if pct >= 100 else _json.dumps(
            {"enabled": enabled, "pct": max(0, int(pct))})
        async with self.db.session_factory() as session:
            row = await session.get(KVRow, f"flag:{key}")
            if row is None:
                session.add(KVRow(key=f"flag:{key}", value=value))
            else:
                row.value = value
            await session.commit()

    # ---- live overview counters -----------------------------------------
    def overview_stats(self) -> dict:
        return self.db.run(self._overview_stats())

    async def _overview_stats(self) -> dict:
        async with self.db.session_factory() as session:
            users = (await session.execute(
                select(func.count()).select_from(UserProfileRow))).scalar() or 0
            bought, bonus = (await session.execute(
                select(func.coalesce(func.sum(WalletRow.balance_bought), 0),
                       func.coalesce(func.sum(WalletRow.balance_bonus), 0)))).one()
            unlocks = (await session.execute(
                select(func.count()).select_from(CoinTransactionRow)
                .where(CoinTransactionRow.type == "unlock"))).scalar() or 0
            purchased = (await session.execute(
                select(func.coalesce(func.sum(CoinTransactionRow.amount_bought), 0))
                .where(CoinTransactionRow.type == "purchase"))).scalar() or 0
        return {
            "users": int(users),
            "coins_outstanding_bought": int(bought),
            "coins_outstanding_bonus": int(bonus),
            "episodes_unlocked": int(unlocks),
            "coins_purchased": int(purchased),
        }

    # ---- searchable, pageable user directory (admin review #017/#018/#019) --
    def search_users(self, *, q: str = "", limit: int = 50, offset: int = 0,
                     sort: str = "recent", segment: str = "") -> dict:
        return self.db.run(self._search_users(q, limit, offset, sort, segment))

    async def _search_users(self, q, limit, offset, sort, segment) -> dict:
        """One SQL query filters, sorts and pages (admin review #104); risk
        flags (#022) derive from the ledger for the returned page."""
        ids = select(UserProfileRow.user_id).union(
            select(WalletRow.user_id)).subquery()
        ent = (select(EntitlementRow.user_id, func.count().label("n"))
               .group_by(EntitlementRow.user_id).subquery())
        ref = (select(CoinTransactionRow.user_id, func.count().label("n"))
               .where(CoinTransactionRow.type == "refund_clawback")
               .group_by(CoinTransactionRow.user_id).subquery())
        total_coins = (func.coalesce(WalletRow.balance_bought, 0)
                       + func.coalesce(WalletRow.balance_bonus, 0))
        base = (select(ids.c.user_id,
                       func.coalesce(UserProfileRow.phone, "").label("phone"),
                       func.coalesce(UserProfileRow.kind, "guest").label("kind"),
                       func.coalesce(UserProfileRow.language, "hi").label("language"),
                       func.coalesce(UserProfileRow.last_seen, "").label("last_seen"),
                       func.coalesce(WalletRow.balance_bought, 0).label("bought"),
                       func.coalesce(WalletRow.balance_bonus, 0).label("bonus"),
                       func.coalesce(ent.c.n, 0).label("unlocked"),
                       func.coalesce(ref.c.n, 0).label("refunds"))
                .join_from(ids, UserProfileRow,
                           UserProfileRow.user_id == ids.c.user_id, isouter=True)
                .join(WalletRow, WalletRow.user_id == ids.c.user_id, isouter=True)
                .join(ent, ent.c.user_id == ids.c.user_id, isouter=True)
                .join(ref, ref.c.user_id == ids.c.user_id, isouter=True))
        if q:
            needle = f"%{q.lower()}%"
            base = base.where(func.lower(ids.c.user_id).like(needle)
                              | func.coalesce(UserProfileRow.phone, "").like(needle))
        if segment == "payers":
            base = base.where((func.coalesce(WalletRow.balance_bought, 0) > 0)
                              | (func.coalesce(ent.c.n, 0) > 0))
        elif segment == "guests":
            base = base.where(func.coalesce(UserProfileRow.kind, "guest") == "guest")
        elif segment == "members":
            base = base.where(func.coalesce(UserProfileRow.kind, "guest") != "guest")
        if sort == "balance":
            base = base.order_by(total_coins.desc(), ids.c.user_id)
        elif sort == "unlocked":
            base = base.order_by(func.coalesce(ent.c.n, 0).desc(), ids.c.user_id)
        else:
            base = base.order_by(func.coalesce(UserProfileRow.last_seen, "").desc(),
                                 ids.c.user_id)
        async with self.db.session_factory() as s:
            total = (await s.execute(
                select(func.count()).select_from(base.subquery()))).scalar() or 0
            rows = (await s.execute(base.limit(limit).offset(offset))).all()
        out = []
        for r in rows:
            flags = []
            if r.refunds >= 2:
                flags.append("repeat refunds")
            if r.bought + r.bonus < 0:
                flags.append("negative balance")
            if r.kind == "erased":
                flags.append("erased (DPDP)")
            out.append({"user_id": r.user_id, "phone": r.phone, "kind": r.kind,
                        "language": r.language, "last_seen": r.last_seen,
                        "balance_bought": int(r.bought), "balance_bonus": int(r.bonus),
                        "total": int(r.bought + r.bonus),
                        "unlocked": int(r.unlocked), "refunds": int(r.refunds),
                        "flags": flags})
        return {"total": int(total), "users": out}

    def touch_last_seen(self, user_id: str, ts: str) -> None:
        self.db.run(self._touch_last_seen(user_id, ts))

    async def _touch_last_seen(self, user_id: str, ts: str) -> None:
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
            if p is not None:
                p.last_seen = ts
                await s.commit()

    def entitlements(self, user_id: str) -> list[dict]:
        return self.db.run(self._entitlements(user_id))

    async def _entitlements(self, user_id: str) -> list[dict]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(EntitlementRow)
                    .where(EntitlementRow.user_id == user_id))).scalars().all()
        return [{"episode_id": e.episode_id, "source": e.source, "created_at": e.created_at}
                for e in rows]

    def find_transaction(self, user_id: str, tx_id: str):
        return self.db.run(self._find_tx(user_id, tx_id))

    async def _find_tx(self, user_id: str, tx_id: str):
        async with self.db.session_factory() as s:
            r = await s.get(CoinTransactionRow, tx_id)
        if r is None or r.user_id != user_id:
            return None
        return {"id": r.id, "type": r.type, "amount_bought": r.amount_bought,
                "amount_bonus": r.amount_bonus, "reference_id": r.reference_id}

    def refund(self, user_id: str, *, coins: int, reference_id: str,
               ref_key: str, created_at: str) -> dict:
        self.ledger.refund_clawback(user_id, coins=coins, reference_type="gateway_refund",
                           reference_id=reference_id, idempotency_key=ref_key,
                           created_at=created_at)
        return self.wallet(user_id)

    # ---- generic shared KV (flags already use it; ratings/status/packs too) --
    def kv_get(self, key: str) -> str | None:
        return self.db.run(self._kv_get(key))

    async def _kv_get(self, key: str) -> str | None:
        async with self.db.session_factory() as s:
            row = await s.get(KVRow, key)
        return row.value if row else None

    def kv_set(self, key: str, value: str) -> None:
        self.db.run(self._kv_set(key, value))

    async def _kv_set(self, key: str, value: str) -> None:
        async with self.db.session_factory() as s:
            row = await s.get(KVRow, key)
            if row is None:
                s.add(KVRow(key=key, value=value))
            else:
                row.value = value
            await s.commit()

    def kv_incr(self, key: str, by: int = 1) -> int:
        """Atomically add `by` to an integer-valued key and return the new value.

        A single in-place UPDATE ... RETURNING (row-locked by the DB), so
        concurrent callers each get a distinct value — the counter behind
        statutory sequences (and the daily adjustment cap) must never be
        read-modify-write."""
        return self.db.run(self._kv_incr(key, by))

    async def _kv_incr(self, key: str, by: int = 1) -> int:
        from sqlalchemy import Integer, String, cast, update
        from sqlalchemy.exc import IntegrityError
        stmt = (update(KVRow).where(KVRow.key == key)
                .values(value=cast(cast(KVRow.value, Integer) + by, String))
                .returning(KVRow.value))
        async with self.db.session_factory() as s:
            val = (await s.execute(stmt)).scalar_one_or_none()
            if val is None:
                try:
                    s.add(KVRow(key=key, value=str(by)))
                    await s.commit()
                    return 1
                except IntegrityError:
                    # Lost the first-insert race — the row exists now; increment it.
                    await s.rollback()
                    val = (await s.execute(stmt)).scalar_one_or_none()
            await s.commit()
            return int(val)

    def kv_prefix(self, prefix: str) -> dict[str, str]:
        return self.db.run(self._kv_prefix(prefix))

    async def _kv_prefix(self, prefix: str) -> dict[str, str]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(KVRow))).scalars().all()
        return {r.key[len(prefix):]: r.value for r in rows if r.key.startswith(prefix)}

    # ---- persisted, hash-chained audit (admin review #066/#068/#069) --------
    def audit_append(self, *, ts: str, actor_id: str, actor_role: str, action: str,
                     target: str, detail: str, ip: str = "", user_agent: str = "") -> dict:
        return self.db.run(self._audit_append(ts, actor_id, actor_role, action,
                                              target, detail, ip, user_agent))

    # Postgres advisory key for the audit chain head ("AUDIT"). Every append
    # reads the last hash and writes the next link; without serialization two
    # concurrent admin actions take the same prev_hash and the chain reads as
    # tampered forever. SQLite gets the same guarantee from BEGIN IMMEDIATE.
    _AUDIT_LOCK_KEY = 0x4155444954
    _AUDIT_HEAD_KEY = "audit:head"

    @staticmethod
    def _audit_mac(payload: str) -> str:
        """Keyed digest over a link. With KATHA_AUDIT_HMAC_KEY set (managed envs)
        an attacker who can write the table still cannot recompute a valid chain;
        without it (dev) it degrades to a plain SHA-256 integrity check."""
        import hashlib
        import hmac
        import os
        key = os.environ.get("KATHA_AUDIT_HMAC_KEY", "")
        if key:
            return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hashlib.sha256(payload.encode()).hexdigest()

    @classmethod
    def _audit_digest(cls, prev_hash: str, **fields) -> str:
        """Every column is in the hash (role, IP and user agent included) with an
        unambiguous encoding, so no field can be rewritten undetected."""
        import json as _json
        payload = _json.dumps([prev_hash, fields], separators=(",", ":"), sort_keys=True)
        return cls._audit_mac(payload)

    @classmethod
    def _audit_head_mac(cls, row_id: int, digest: str, count: int) -> str:
        return cls._audit_mac(f"head|{row_id}|{digest}|{count}")

    async def _audit_append(self, ts, actor_id, actor_role, action, target,
                            detail, ip, user_agent) -> dict:
        import json as _json
        from sqlalchemy import func, insert, text, update
        tbl = AuditLogRow.__table__
        kv = KVRow.__table__
        async with self.db.engine.connect() as conn:
            if self.db.url.startswith("sqlite"):
                await conn.exec_driver_sql("BEGIN IMMEDIATE")
            else:
                await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"),
                                   {"k": self._AUDIT_LOCK_KEY})
            prev_hash = (await conn.scalar(
                select(tbl.c.hash).order_by(tbl.c.id.desc()).limit(1))) or ""
            fields = dict(ts=ts, actor_id=actor_id, actor_role=actor_role, action=action,
                          target=target, detail=detail, ip=ip, user_agent=user_agent)
            digest = self._audit_digest(prev_hash, **fields)
            res = await conn.execute(insert(tbl).values(**fields, prev_hash=prev_hash, hash=digest))
            row_id = res.inserted_primary_key[0]
            # Anchor the head in the same transaction: deleting the newest rows
            # would otherwise leave a perfectly valid, shorter chain.
            count = await conn.scalar(select(func.count(tbl.c.id)))
            head = _json.dumps({"id": row_id, "hash": digest, "count": count,
                                "mac": self._audit_head_mac(row_id, digest, count)})
            upd = await conn.execute(update(kv).where(kv.c.key == self._AUDIT_HEAD_KEY)
                                     .values(value=head))
            if upd.rowcount == 0:
                await conn.execute(insert(kv).values(key=self._AUDIT_HEAD_KEY, value=head))
            await conn.commit()
        return {"id": row_id, "hash": digest}

    def audit_list(self, *, actor: str = "", q: str = "", limit: int = 100,
                   before_id: int | None = None) -> dict:
        return self.db.run(self._audit_list(actor, q, limit, before_id))

    async def _audit_list(self, actor, q, limit, before_id) -> dict:
        async with self.db.session_factory() as s:
            stmt = select(AuditLogRow).order_by(AuditLogRow.id.desc())
            if actor:
                stmt = stmt.where(AuditLogRow.actor_id == actor)
            if before_id:
                stmt = stmt.where(AuditLogRow.id < before_id)
            rows = (await s.execute(stmt.limit(limit))).scalars().all()
            allrows = (await s.execute(select(AuditLogRow).order_by(AuditLogRow.id))).scalars().all()
            head_raw = await s.get(KVRow, self._AUDIT_HEAD_KEY)
        chain_ok, prev = True, ""
        for r in allrows:
            want = self._audit_digest(
                prev, ts=r.ts, actor_id=r.actor_id, actor_role=r.actor_role, action=r.action,
                target=r.target, detail=r.detail, ip=r.ip, user_agent=r.user_agent)
            if r.prev_hash != prev or r.hash != want:
                chain_ok = False
                break
            prev = r.hash
        if chain_ok and allrows:
            # The anchored head must name exactly the last row and the row count.
            import json as _json
            try:
                head = _json.loads(head_raw.value) if head_raw else {}
            except ValueError:
                head = {}
            last = allrows[-1]
            if (head.get("id") != last.id or head.get("hash") != last.hash
                    or head.get("count") != len(allrows)
                    or head.get("mac") != self._audit_head_mac(last.id, last.hash, len(allrows))):
                chain_ok = False
        out = [{"id": r.id, "ts": r.ts, "actor": r.actor_id, "actor_role": r.actor_role,
                "action": r.action, "entity": r.target, "change": r.detail,
                "ip": r.ip, "user_agent": r.user_agent, "hash": r.hash[:12]}
               for r in rows]
        if q:
            needle = q.lower()
            out = [r for r in out
                   if needle in r["action"].lower() or needle in r["entity"].lower()
                   or needle in r["change"].lower()]
        return {"rows": out, "chain_ok": chain_ok, "total": len(allrows)}

    def audit_get(self, row_id: int) -> dict | None:
        return self.db.run(self._audit_get(row_id))

    async def _audit_get(self, row_id) -> dict | None:
        async with self.db.session_factory() as s:
            r = await s.get(AuditLogRow, row_id)
        return self._audit_dict(r) if r else None

    def audit_for_target(self, target: str, limit: int = 500) -> list[dict]:
        """Admin actions aimed at one entity (a user id, a slug), newest first —
        an indexed lookup, so the timeline never depends on a window."""
        return self.db.run(self._audit_for_target(target, limit))

    async def _audit_for_target(self, target, limit) -> list[dict]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(AuditLogRow).where(AuditLogRow.target == target)
                                    .order_by(AuditLogRow.id.desc()).limit(limit))).scalars().all()
        return [self._audit_dict(r) for r in rows]

    @staticmethod
    def _audit_dict(r) -> dict:
        return {"id": r.id, "ts": r.ts, "actor": r.actor_id, "actor_role": r.actor_role,
                "action": r.action, "entity": r.target, "change": r.detail,
                "ip": r.ip, "user_agent": r.user_agent, "hash": r.hash[:12]}

    # ---- grievances (IT Rules: ack 24 h, resolve 15 d — admin review #073) --
    def grievance_create(self, *, gid: str, user_id: str, contact: str, channel: str,
                         subject: str, body: str, created_at: str) -> dict:
        return self.db.run(self._grievance_create(gid, user_id, contact, channel,
                                                  subject, body, created_at))

    async def _grievance_create(self, gid, user_id, contact, channel, subject,
                                body, created_at) -> dict:
        async with self.db.session_factory() as s:
            s.add(GrievanceRow(id=gid, user_id=user_id, contact=contact,
                               channel=channel, subject=subject, body=body,
                               created_at=created_at))
            await s.commit()
        return {"id": gid, "status": "new", "created_at": created_at}

    def grievance_list(self, status: str = "") -> list[dict]:
        return self.db.run(self._grievance_list(status))

    async def _grievance_list(self, status) -> list[dict]:
        async with self.db.session_factory() as s:
            stmt = select(GrievanceRow).order_by(GrievanceRow.created_at.desc())
            if status:
                stmt = stmt.where(GrievanceRow.status == status)
            rows = (await s.execute(stmt)).scalars().all()
        import json as _json
        return [{"id": g.id, "user_id": g.user_id, "contact": g.contact,
                 "channel": g.channel, "subject": g.subject, "body": g.body,
                 "status": g.status, "assignee": g.assignee,
                 "created_at": g.created_at, "ack_at": g.ack_at,
                 "resolved_at": g.resolved_at, "notes": _json.loads(g.notes or "[]")}
                for g in rows]

    def grievance_update(self, gid: str, **fields) -> dict | None:
        return self.db.run(self._grievance_update(gid, fields))

    async def _grievance_update(self, gid, fields) -> dict | None:
        import json as _json
        async with self.db.session_factory() as s:
            g = await s.get(GrievanceRow, gid)
            if g is None:
                return None
            note = fields.pop("add_note", None)
            for k, v in fields.items():
                setattr(g, k, v)
            if note:
                notes = _json.loads(g.notes or "[]")
                notes.append(note)
                g.notes = _json.dumps(notes)
            await s.commit()
            return {"id": g.id, "status": g.status}

    # ---- DPDP tools (admin review #032) -------------------------------------
    def export_user(self, user_id: str) -> dict:
        """DPDP data-access export: EVERY table that holds this person's data —
        profile, money, entitlements, grievances, devices, invoices, events."""
        profile = self.db.run(self._profile(user_id))
        return {
            "user_id": user_id,
            "profile": profile,
            "wallet": self.wallet(user_id),
            "transactions": [t.__dict__ | {"type": t.type.value}
                             for t in self.transactions(user_id)],
            "entitlements": self.entitlements(user_id),
            "grievances": [g for g in self.grievance_list() if g.get("user_id") == user_id],
            "devices": self.devices(user_id),
            "invoices": self.invoices_for(user_id),
            "events": self.db.run(self._events_for(user_id)),
        }

    async def _events_for(self, user_id: str, limit: int = 5000) -> list[dict]:
        from .models import EventRow
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(EventRow).where(EventRow.user_id == user_id)
                                    .order_by(EventRow.id.desc()).limit(limit))).scalars().all()
        return [{"ts": r.ts, "name": r.name, "ref": r.ref, "value": r.value,
                 "channel": r.channel} for r in rows]

    async def _profile(self, user_id: str) -> dict:
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
        if p is None:
            return {}
        return {"phone": p.phone, "kind": p.kind, "language": p.language,
                "created_at": p.created_at, "last_seen": p.last_seen}

    def erase_user(self, user_id: str, ts: str) -> bool:
        return self.db.run(self._erase_user(user_id, ts))

    async def _erase_user(self, user_id: str, ts: str) -> bool:
        from sqlalchemy import delete, or_, update

        from .models import DeviceRow, GrievanceRow, InvoiceRow, OutboxRow, PushTokenRow
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
            if p is None:
                return False
            phone = p.phone
            p.phone = ""            # PII scrubbed; the money ledger is retained
            p.kind = "erased"
            p.last_seen = ts
            # Every outstanding JWT dies now: an erased account must not keep
            # authenticating on a 30-day token.
            p.token_version = (p.token_version or 0) + 1
            # device identifiers and push tokens are PII-adjacent: gone too
            await s.execute(delete(PushTokenRow)
                            .where(PushTokenRow.user_id == user_id))
            await s.execute(delete(DeviceRow).where(DeviceRow.user_id == user_id))
            # Grievances: the statutory record (id, subject, dates, status) stays;
            # the contact and free-text body are the person's data and go.
            await s.execute(update(GrievanceRow).where(GrievanceRow.user_id == user_id)
                            .values(contact="", body="[erased at the user's request]"))
            # Outbox copies addressed to this person (invoice emails carry the
            # invoice ids; OTP/pushes carry the phone or a device token).
            inv_ids = (await s.execute(select(InvoiceRow.id)
                                       .where(InvoiceRow.user_id == user_id))).scalars().all()
            conds = [OutboxRow.recipient == phone] if phone else []
            conds += [OutboxRow.subject.contains(i) for i in inv_ids]
            conds += [OutboxRow.body.contains(i) for i in inv_ids]
            if conds:
                await s.execute(update(OutboxRow).where(or_(*conds))
                                .values(recipient="", body="[erased at the user's request]"))
            await s.commit()
            return True

    # ---- product events (admin review #011) ---------------------------------
    def event_append(self, *, ts: str, user_id: str, name: str, ref: str = "",
                     value: int = 0, channel: str = "") -> None:
        self.db.run(self._event_append(ts, user_id, name, ref, value, channel))

    def event_counts(self, name: str, since_day: str) -> dict[str, int]:
        """Per-ref counts of one event since a UTC date — feeds trending."""
        return self.db.run(self._event_counts(name, since_day))

    async def _event_counts(self, name, since_day) -> dict[str, int]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(
                select(EventRow.ref, func.count())
                .where(EventRow.name == name, EventRow.day >= since_day)
                .group_by(EventRow.ref))).all()
        return {ref: n for ref, n in rows}

    async def _event_append(self, ts, user_id, name, ref, value, channel) -> None:
        async with self.db.session_factory() as s:
            s.add(EventRow(ts=ts, day=ts[:10], user_id=user_id, name=name,
                           ref=ref, value=int(value), channel=channel))
            await s.commit()

    # ---- devices (admin review #021) ----------------------------------------
    def device_touch(self, user_id: str, *, ua: str, ip: str, ts: str) -> None:
        import hashlib
        ua_hash = hashlib.sha256(ua.encode()).hexdigest()[:16]
        self.db.run(self._device_touch(user_id, ua_hash, ua[:200], ip, ts))

    async def _device_touch(self, user_id, ua_hash, ua, ip, ts) -> None:
        async with self.db.session_factory() as s:
            row = (await s.execute(select(DeviceRow)
                   .where(DeviceRow.user_id == user_id,
                          DeviceRow.ua_hash == ua_hash))).scalars().first()
            if row is None:
                s.add(DeviceRow(user_id=user_id, ua_hash=ua_hash, ua=ua, ip=ip,
                                first_seen=ts, last_seen=ts))
            else:
                row.last_seen, row.ip = ts, ip
            await s.commit()

    def devices(self, user_id: str) -> list[dict]:
        return self.db.run(self._devices(user_id))

    async def _devices(self, user_id: str) -> list[dict]:
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(DeviceRow)
                    .where(DeviceRow.user_id == user_id)
                    .order_by(DeviceRow.last_seen.desc()))).scalars().all()
        return [{"ua": r.ua, "ip": r.ip, "first_seen": r.first_seen,
                 "last_seen": r.last_seen} for r in rows]

    # ---- token versions: "sign out all devices" (#021) ----------------------
    def token_version(self, user_id: str) -> int:
        return self.db.run(self._token_version(user_id))

    async def _token_version(self, user_id: str) -> int:
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
        return int(getattr(p, "token_version", 0) or 0) if p else 0

    def bump_token_version(self, user_id: str) -> int:
        return self.db.run(self._bump_token_version(user_id))

    async def _bump_token_version(self, user_id: str) -> int:
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
            if p is None:
                return 0
            p.token_version = int(p.token_version or 0) + 1
            await s.commit()
            return p.token_version

    # ---- the analytics rollup (admin review #009-#015) ----------------------
    def analytics(self, *, now: str, days: int = 30) -> dict:
        return self.db.run(self._analytics(now, days))

    async def _analytics(self, now: str, days: int) -> dict:
        from datetime import date, timedelta
        today = date.fromisoformat(now[:10])
        span = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
        first_day = span[0]

        async with self.db.session_factory() as s:
            ev = (await s.execute(
                select(EventRow.day, EventRow.name,
                       func.count(), func.count(func.distinct(EventRow.user_id)),
                       func.coalesce(func.sum(EventRow.value), 0))
                .where(EventRow.day >= first_day)
                .group_by(EventRow.day, EventRow.name))).all()
            dau_rows = (await s.execute(
                select(EventRow.day, func.count(func.distinct(EventRow.user_id)))
                .where(EventRow.day >= first_day).group_by(EventRow.day))).all()
            led = (await s.execute(
                select(func.substr(CoinTransactionRow.created_at, 1, 10),
                       CoinTransactionRow.type, CoinTransactionRow.reference_type,
                       func.coalesce(func.sum(CoinTransactionRow.amount_bought), 0),
                       func.coalesce(func.sum(CoinTransactionRow.amount_bonus), 0),
                       func.count())
                .group_by(func.substr(CoinTransactionRow.created_at, 1, 10),
                          CoinTransactionRow.type,
                          CoinTransactionRow.reference_type))).all()
            new_users = dict((await s.execute(
                select(func.substr(UserProfileRow.created_at, 1, 10), func.count())
                .where(UserProfileRow.created_at != "")
                .group_by(func.substr(UserProfileRow.created_at, 1, 10)))).all())
            # funnel + windowed distinct users
            fun = {}
            for name in ("paywall_view", "purchase", "unlock"):
                fun[name] = {d: set() for d in ("7d", "30d", "1d")}
            frows = (await s.execute(
                select(EventRow.day, EventRow.name, EventRow.user_id).distinct()
                .where(EventRow.day >= first_day,
                       EventRow.name.in_(["paywall_view", "purchase", "unlock"])))).all()
            for day, name, uid in frows:
                if day == now[:10]:
                    fun[name]["1d"].add(uid)
                if day in span[-7:]:
                    fun[name]["7d"].add(uid)
                fun[name]["30d"].add(uid)
            # breakage: coins held by wallets not seen in 90 days
            horizon = (today - timedelta(days=90)).isoformat()
            dormant = (await s.execute(
                select(func.coalesce(func.sum(WalletRow.balance_bought +
                                              WalletRow.balance_bonus), 0))
                .select_from(WalletRow)
                .join(UserProfileRow, UserProfileRow.user_id == WalletRow.user_id,
                      isouter=True)
                .where(func.coalesce(UserProfileRow.last_seen, "") < horizon)
            )).scalar() or 0

        daily: dict[str, dict] = {d: {
            "dau": 0, "paywall_views": 0, "purchases": 0, "unlocks": 0,
            "checkins": 0, "watch_minutes": 0, "coins_purchased": 0,
            "coins_iap": 0, "coins_web": 0, "coins_refunded": 0,
            "coins_spent": 0, "new_users": int(new_users.get(d, 0)),
        } for d in span}
        for day, n in dau_rows:
            if day in daily:
                daily[day]["dau"] = int(n)
        for day, name, cnt, _uniq, val in ev:
            if day not in daily:
                continue
            b = daily[day]
            if name == "paywall_view":
                b["paywall_views"] = int(cnt)
            elif name == "purchase":
                b["purchases"] = int(cnt)
            elif name == "unlock":
                b["unlocks"] = int(cnt)
            elif name == "checkin":
                b["checkins"] = int(cnt)
            elif name == "play_progress":
                b["watch_minutes"] = int(val) // 60000
        outstanding_delta: dict[str, int] = {}
        for day, typ, ref_type, bought, bonus, _cnt in led:
            delta = int(bought) + int(bonus)
            outstanding_delta[day] = outstanding_delta.get(day, 0) + delta
            if day not in daily:
                continue
            b = daily[day]
            if typ == "purchase":
                b["coins_purchased"] += int(bought)
                if ref_type == "web_order":
                    b["coins_web"] += int(bought)
                else:
                    b["coins_iap"] += int(bought)
            elif typ == "refund_clawback":
                b["coins_refunded"] += abs(delta)
            elif typ == "unlock":
                b["coins_spent"] += abs(delta)
        # outstanding trend: cumulative net coins including days before the span
        pre = sum(v for d, v in outstanding_delta.items() if d < first_day)
        outstanding = []
        running = pre
        for d in span:
            running += outstanding_delta.get(d, 0)
            outstanding.append(running)
        return {
            "days": span,
            "daily": [daily[d] for d in span],
            "outstanding_trend": outstanding,
            "breakage_dormant_coins": int(dormant),
            "funnel": {w: {"paywall_view": len(fun["paywall_view"][w]),
                           "purchase": len(fun["purchase"][w] & fun["paywall_view"][w]),
                           "unlock": len(fun["unlock"][w] & fun["purchase"][w]
                                         & fun["paywall_view"][w])}
                       for w in ("1d", "7d", "30d")},
        }

    # ---- push tokens ---------------------------------------------------------
    def push_register(self, user_id: str, *, token: str, platform: str,
                      now: str) -> None:
        self.db.run(self._push_register(user_id, token, platform, now))

    async def _push_register(self, user_id, token, platform, now) -> None:
        from .models import PushTokenRow
        async with self.db.session_factory() as s:
            row = (await s.execute(select(PushTokenRow)
                   .where(PushTokenRow.user_id == user_id,
                          PushTokenRow.token == token))).scalars().first()
            if row is None:
                s.add(PushTokenRow(user_id=user_id, token=token,
                                   platform=platform, registered_at=now,
                                   last_seen=now))
            else:
                row.last_seen = now
            await s.commit()

    def push_tokens(self, user_id: str | None = None) -> list[dict]:
        return self.db.run(self._push_tokens(user_id))

    async def _push_tokens(self, user_id) -> list[dict]:
        from .models import PushTokenRow
        async with self.db.session_factory() as s:
            stmt = select(PushTokenRow)
            if user_id:
                stmt = stmt.where(PushTokenRow.user_id == user_id)
            rows = (await s.execute(stmt)).scalars().all()
        return [{"user_id": r.user_id, "token": r.token, "platform": r.platform,
                 "registered_at": r.registered_at} for r in rows]

    # ---- outbox (comms ledger) ----------------------------------------------
    def outbox_append(self, *, kind: str, recipient: str, subject: str,
                      body: str, now: str) -> int:
        return self.db.run(self._outbox_append(kind, recipient, subject, body, now))

    async def _outbox_append(self, kind, recipient, subject, body, now) -> int:
        from .models import OutboxRow
        async with self.db.session_factory() as s:
            row = OutboxRow(kind=kind, recipient=recipient, subject=subject,
                            body=body, status="queued", created_at=now)
            s.add(row)
            await s.commit()
            await s.refresh(row)
            return row.id

    def outbox_mark(self, row_id: int, status: str, detail: str = "") -> None:
        self.db.run(self._outbox_mark(row_id, status, detail))

    async def _outbox_mark(self, row_id, status, detail) -> None:
        from .models import OutboxRow
        async with self.db.session_factory() as s:
            row = await s.get(OutboxRow, row_id)
            if row is not None:
                row.status, row.detail = status, detail
                await s.commit()

    def outbox_get(self, row_id: int) -> dict | None:
        return self.db.run(self._outbox_get(row_id))

    async def _outbox_get(self, row_id) -> dict | None:
        from .models import OutboxRow
        async with self.db.session_factory() as s:
            r = await s.get(OutboxRow, row_id)
        if r is None:
            return None
        return {"id": r.id, "kind": r.kind, "recipient": r.recipient,
                "subject": r.subject, "body": r.body, "status": r.status,
                "detail": r.detail, "created_at": r.created_at}

    def outbox_list(self, *, kind: str = "", limit: int = 100) -> list[dict]:
        return self.db.run(self._outbox_list(kind, limit))

    async def _outbox_list(self, kind, limit) -> list[dict]:
        from .models import OutboxRow
        async with self.db.session_factory() as s:
            stmt = select(OutboxRow).order_by(OutboxRow.id.desc()).limit(limit)
            if kind:
                stmt = stmt.where(OutboxRow.kind == kind)
            rows = (await s.execute(stmt)).scalars().all()
        return [{"id": r.id, "kind": r.kind, "recipient": r.recipient,
                 "subject": r.subject, "body": r.body, "status": r.status,
                 "detail": r.detail, "created_at": r.created_at} for r in rows]

    # ---- invoices ------------------------------------------------------------
    def next_invoice_number(self, at: str) -> str:
        """Sequential per financial-year prefix, via the KV counter.

        The increment is a single atomic UPDATE (`kv_incr`), never a
        read-modify-write: invoice numbers are a statutory GST sequence, so two
        concurrent purchases must never mint the same one."""
        # Indian financial year (1 April – 31 March) of the IST date: a sale at
        # 2027-02-10 belongs to FY 2026-27 → "2627"; the statutory sequence
        # resets on 1 April, not 1 January.
        from katha_domain.timeutil import fy_code
        fy = fy_code(at)
        n = self.kv_incr(f"invoiceseq:{fy}")
        return f"KATHA-INV-{fy}-{n:06d}"

    def invoice_create(self, **fields) -> None:
        self.db.run(self._invoice_create(fields))

    async def _invoice_create(self, fields) -> None:
        from .models import InvoiceRow
        async with self.db.session_factory() as s:
            s.add(InvoiceRow(**fields))
            await s.commit()

    def invoices_for(self, user_id: str) -> list[dict]:
        return self.db.run(self._invoices_for(user_id))

    async def _invoices_for(self, user_id) -> list[dict]:
        from .models import InvoiceRow
        async with self.db.session_factory() as s:
            rows = (await s.execute(
                select(InvoiceRow).where(InvoiceRow.user_id == user_id)
                .order_by(InvoiceRow.created_at.desc()))).scalars().all()
        return [{"id": r.id, "order_ref": r.order_ref, "sku": r.sku,
                 "coins": r.coins, "bonus_coins": r.bonus_coins,
                 "total_minor": r.total_minor, "taxable_minor": r.taxable_minor,
                 "gst_minor": r.gst_minor, "gst_rate_pct": r.gst_rate_pct,
                 "seller_gstin": r.seller_gstin, "created_at": r.created_at}
                for r in rows]

    def invoices_all(self, limit: int | None = None, fy: str = "") -> list[dict]:
        """The whole register (or one financial-year prefix, e.g. "2627"),
        newest first. Uncapped by default: this is what gets filed, and a
        silent cap would drop the oldest invoices from the return."""
        return self.db.run(self._invoices_all(limit, fy))

    def invoice_totals(self, fy: str = "") -> dict:
        return self.db.run(self._invoice_totals(fy))

    async def _invoice_totals(self, fy) -> dict:
        from sqlalchemy import func
        from .models import InvoiceRow
        stmt = select(func.count(InvoiceRow.id),
                      func.coalesce(func.sum(InvoiceRow.total_minor), 0),
                      func.coalesce(func.sum(InvoiceRow.gst_minor), 0))
        if fy:
            stmt = stmt.where(InvoiceRow.id.like(f"KATHA-INV-{fy}-%"))
        async with self.db.session_factory() as s:
            count, gross, gst = (await s.execute(stmt)).one()
        return {"count": int(count), "gross_minor": int(gross), "gst_minor": int(gst)}

    async def _invoices_all(self, limit, fy) -> list[dict]:
        from .models import InvoiceRow
        async with self.db.session_factory() as s:
            stmt = select(InvoiceRow).order_by(InvoiceRow.created_at.desc())
            if fy:
                stmt = stmt.where(InvoiceRow.id.like(f"KATHA-INV-{fy}-%"))
            if limit:
                stmt = stmt.limit(limit)
            rows = (await s.execute(stmt)).scalars().all()
        return [{"id": r.id, "user_id": r.user_id, "sku": r.sku,
                 "coins": r.coins, "bonus_coins": r.bonus_coins,
                 "total_minor": r.total_minor, "taxable_minor": r.taxable_minor,
                 "gst_minor": r.gst_minor, "gst_rate_pct": r.gst_rate_pct,
                 "seller_gstin": r.seller_gstin,
                 "created_at": r.created_at} for r in rows]

    def invoice_by_order(self, order_ref: str) -> dict | None:
        return self.db.run(self._invoice_by_order(order_ref))

    async def _invoice_by_order(self, order_ref) -> dict | None:
        from .models import InvoiceRow
        async with self.db.session_factory() as s:
            r = (await s.execute(select(InvoiceRow)
                 .where(InvoiceRow.order_ref == order_ref))).scalars().first()
        if r is None:
            return None
        return {"id": r.id, "order_ref": r.order_ref}

    # ---- dual-approval queue (shared across workers, survives restarts) ------
    def approval_create(self, *, id: str, requested_by: str, user_id: str, coins: int,
                        reason_code: str, note: str, created_at: str) -> dict:
        return self.db.run(self._approval_create(id, requested_by, user_id, coins,
                                                 reason_code, note, created_at))

    async def _approval_create(self, id, requested_by, user_id, coins, reason_code,
                               note, created_at) -> dict:
        from .models import ApprovalRow
        async with self.db.session_factory() as s:
            s.add(ApprovalRow(id=id, status="pending", requested_by=requested_by,
                              approved_by="", user_id=user_id, coins=coins,
                              reason_code=reason_code, note=note,
                              created_at=created_at, decided_at=""))
            await s.commit()
        return (await self._approval_get(id)) or {}

    def approval_get(self, id: str) -> dict | None:
        return self.db.run(self._approval_get(id))

    async def _approval_get(self, id) -> dict | None:
        from .models import ApprovalRow
        async with self.db.session_factory() as s:
            r = await s.get(ApprovalRow, id)
        return self._approval_dict(r) if r else None

    def approvals_all(self) -> list[dict]:
        return self.db.run(self._approvals_all())

    async def _approvals_all(self) -> list[dict]:
        from .models import ApprovalRow
        async with self.db.session_factory() as s:
            rows = (await s.execute(select(ApprovalRow)
                    .order_by(ApprovalRow.created_at.desc()))).scalars().all()
        return [self._approval_dict(r) for r in rows]

    def approval_transition(self, id: str, *, to: str, by: str, at: str) -> bool:
        """pending → to, exactly once: a conditional UPDATE, so two approvers
        racing (or the same click twice) can apply the money at most once."""
        return self.db.run(self._approval_transition(id, to, by, at))

    async def _approval_transition(self, id, to, by, at) -> bool:
        from sqlalchemy import update
        from .models import ApprovalRow
        async with self.db.session_factory() as s:
            res = await s.execute(
                update(ApprovalRow)
                .where(ApprovalRow.id == id, ApprovalRow.status == "pending")
                .values(status=to, approved_by=by, decided_at=at))
            await s.commit()
        return res.rowcount == 1

    @staticmethod
    def _approval_dict(r) -> dict:
        return {"id": r.id, "status": r.status, "requested_by": r.requested_by,
                "approved_by": r.approved_by or None, "user_id": r.user_id,
                "coins": r.coins, "reason_code": r.reason_code, "note": r.note,
                "created_at": r.created_at, "decided_at": r.decided_at}
