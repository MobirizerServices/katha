"""Infra adapters for Katha (db, persistence).

The coin ledger stays pure (`katha_ledger`); everything here is an adapter that
gives it durability without changing a single money rule.
"""
from .db import DEFAULT_DB_URL, Database, db_url
from .models import (
    Base,
    CoinTransactionRow,
    EntitlementRow,
    UserProfileRow,
    WalletRow,
)
from .persistent_ledger import PersistentLedger
from .prodguard import InsecureConfigError, enforce as enforce_production_config
from .repository import LedgerRepository
from .shared_store import SharedStore

__all__ = [
    "Database",
    "db_url",
    "DEFAULT_DB_URL",
    "enforce_production_config",
    "InsecureConfigError",
    "Base",
    "CoinTransactionRow",
    "WalletRow",
    "EntitlementRow",
    "UserProfileRow",
    "LedgerRepository",
    "PersistentLedger",
    "SharedStore",
]
