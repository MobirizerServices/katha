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
from .models import CoinTransactionRow, EntitlementRow, UserProfileRow, WalletRow
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
