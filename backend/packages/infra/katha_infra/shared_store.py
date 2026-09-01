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
from .models import (AuditLogRow, CoinTransactionRow, EntitlementRow, GrievanceRow,
                     KVRow, UserProfileRow, WalletRow)
from .persistent_ledger import PersistentLedger


class SharedStore:
    def __init__(self, db: Database | None = None) -> None:
        self.db = db or Database()

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
        # A fresh PersistentLedger rebuilds current state from the DB, applies the
        # pure admin_adjust rule, and appends the tail — so the write lands in the
        # one shared ledger and is idempotent by ref_id.
        pl = PersistentLedger(self.db)
        pl.admin_adjust(user_id, coins=coins, reference_type=f"admin_adjust:{reason_code}",
                        reference_id=ref_id, idempotency_key=ref_id, created_at=created_at)
        return self.wallet(user_id)

    # ---- feature-flag overrides (admin_kv) -------------------------------
    def flag_overrides(self) -> dict[str, bool]:
        return self.db.run(self._flag_overrides())

    async def _flag_overrides(self) -> dict[str, bool]:
        async with self.db.session_factory() as session:
            rows = (await session.execute(select(KVRow))).scalars().all()
        return {
            r.key.removeprefix("flag:"): r.value == "1"
            for r in rows if r.key.startswith("flag:")
        }

    def set_flag(self, key: str, enabled: bool) -> None:
        self.db.run(self._set_flag(key, enabled))

    async def _set_flag(self, key: str, enabled: bool) -> None:
        async with self.db.session_factory() as session:
            row = await session.get(KVRow, f"flag:{key}")
            if row is None:
                session.add(KVRow(key=f"flag:{key}", value="1" if enabled else "0"))
            else:
                row.value = "1" if enabled else "0"
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
        async with self.db.session_factory() as s:
            profiles = {p.user_id: p for p in (await s.execute(select(UserProfileRow))).scalars()}
            wallets = {w.user_id: w for w in (await s.execute(select(WalletRow))).scalars()}
            unlocked = dict((await s.execute(
                select(EntitlementRow.user_id, func.count()).group_by(EntitlementRow.user_id)
            )).all())
        rows = []
        for uid in set(profiles) | set(wallets):
            p, w = profiles.get(uid), wallets.get(uid)
            rows.append({
                "user_id": uid,
                "phone": p.phone if p else "",
                "kind": p.kind if p else "guest",
                "language": p.language if p else "hi",
                "last_seen": (p.last_seen if p else "") or "",
                "balance_bought": w.balance_bought if w else 0,
                "balance_bonus": w.balance_bonus if w else 0,
                "total": (w.balance_bought + w.balance_bonus) if w else 0,
                "unlocked": int(unlocked.get(uid, 0)),
            })
        if q:
            needle = q.lower()
            rows = [r for r in rows if needle in r["user_id"].lower() or needle in r["phone"]]
        if segment == "payers":
            rows = [r for r in rows if r["balance_bought"] > 0 or r["unlocked"] > 0]
        elif segment == "guests":
            rows = [r for r in rows if r["kind"] == "guest"]
        elif segment == "members":
            rows = [r for r in rows if r["kind"] != "guest"]
        if sort == "balance":
            rows.sort(key=lambda r: -r["total"])
        elif sort == "unlocked":
            rows.sort(key=lambda r: -r["unlocked"])
        else:  # recent: newest last_seen first, never-seen last
            rows.sort(key=lambda r: r["last_seen"], reverse=True)
        total = len(rows)
        return {"total": total, "users": rows[offset:offset + limit]}

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
        pl = PersistentLedger(self.db)
        pl.refund_clawback(user_id, coins=coins, reference_type="gateway_refund",
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

    async def _audit_append(self, ts, actor_id, actor_role, action, target,
                            detail, ip, user_agent) -> dict:
        import hashlib
        async with self.db.session_factory() as s:
            last = (await s.execute(select(AuditLogRow)
                    .order_by(AuditLogRow.id.desc()).limit(1))).scalars().first()
            prev_hash = last.hash if last else ""
            digest = hashlib.sha256(
                f"{prev_hash}|{ts}|{actor_id}|{action}|{target}|{detail}".encode()
            ).hexdigest()
            row = AuditLogRow(ts=ts, actor_id=actor_id, actor_role=actor_role,
                              action=action, target=target, detail=detail,
                              ip=ip, user_agent=user_agent,
                              prev_hash=prev_hash, hash=digest)
            s.add(row)
            await s.commit()
            await s.refresh(row)
        return {"id": row.id, "hash": digest}

    def audit_list(self, *, actor: str = "", q: str = "", limit: int = 100,
                   before_id: int | None = None) -> dict:
        return self.db.run(self._audit_list(actor, q, limit, before_id))

    async def _audit_list(self, actor, q, limit, before_id) -> dict:
        import hashlib
        async with self.db.session_factory() as s:
            stmt = select(AuditLogRow).order_by(AuditLogRow.id.desc())
            if actor:
                stmt = stmt.where(AuditLogRow.actor_id == actor)
            if before_id:
                stmt = stmt.where(AuditLogRow.id < before_id)
            rows = (await s.execute(stmt.limit(limit))).scalars().all()
            allrows = (await s.execute(select(AuditLogRow).order_by(AuditLogRow.id))).scalars().all()
        chain_ok, prev = True, ""
        for r in allrows:
            want = hashlib.sha256(
                f"{prev}|{r.ts}|{r.actor_id}|{r.action}|{r.target}|{r.detail}".encode()
            ).hexdigest()
            if r.prev_hash != prev or r.hash != want:
                chain_ok = False
                break
            prev = r.hash
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
        profile = self.db.run(self._profile(user_id))
        return {
            "user_id": user_id,
            "profile": profile,
            "wallet": self.wallet(user_id),
            "transactions": [t.__dict__ | {"type": t.type.value}
                             for t in self.transactions(user_id)],
            "entitlements": self.entitlements(user_id),
        }

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
        async with self.db.session_factory() as s:
            p = await s.get(UserProfileRow, user_id)
            if p is None:
                return False
            p.phone = ""            # PII scrubbed; the money ledger is retained
            p.kind = "erased"
            p.last_seen = ts
            await s.commit()
            return True
