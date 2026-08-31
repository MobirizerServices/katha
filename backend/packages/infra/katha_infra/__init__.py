"""Infra adapters for Katha (db, persistence).

The coin ledger stays pure (`katha_ledger`); everything here is an adapter that
gives it durability without changing a single money rule.
"""
from .db import DEFAULT_DB_URL, Database, db_url
from .models import Base, CoinTransactionRow, EntitlementRow, WalletRow
from .persistent_ledger import PersistentLedger
from .repository import LedgerRepository

__all__ = [
    "Database",
    "db_url",
    "DEFAULT_DB_URL",
    "Base",
    "CoinTransactionRow",
    "WalletRow",
    "EntitlementRow",
    "LedgerRepository",
    "PersistentLedger",
]
