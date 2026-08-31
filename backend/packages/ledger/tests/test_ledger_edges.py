"""Edge and error-path coverage for the coin ledger (guards, no-ops, drift)."""
import pytest

from katha_ledger import BalanceNegative, InsufficientCoins, Ledger, LedgerError, TxType

TS = "2026-09-14T14:03:22+05:30"


def test_credit_rejects_non_credit_type():
    L = Ledger()
    with pytest.raises(LedgerError):
        L.credit("u", TxType.UNLOCK, coins=10, reference_type="x", reference_id="1",
                 idempotency_key="k", created_at=TS)


def test_credit_rejects_non_positive_amount():
    L = Ledger()
    with pytest.raises(LedgerError):
        L.credit("u", TxType.PURCHASE, coins=0, reference_type="x", reference_id="1",
                 idempotency_key="k", created_at=TS)


def test_unlock_all_already_owned_is_noop():
    L = Ledger()
    L.credit("u", TxType.PURCHASE, coins=100, reference_type="iap", reference_id="t",
             idempotency_key="p", created_at=TS)
    L.unlock("u", ["ep11"], price_per_episode=30, reference_type="episode",
             reference_id="ep11", idempotency_key="u1", created_at=TS)
    before = L.balance("u").total
    # Re-unlocking only already-owned episodes charges nothing (cost == 0 branch).
    res = L.unlock("u", ["ep11"], price_per_episode=30, reference_type="episode",
                   reference_id="ep11", idempotency_key="u2", created_at=TS)
    assert res.transaction.net == 0
    assert len(res.entitlements) == 1
    assert L.balance("u").total == before


def test_refund_clawback_rejects_non_positive():
    L = Ledger()
    with pytest.raises(LedgerError):
        L.refund_clawback("u", coins=0, reference_type="iap", reference_id="t",
                          idempotency_key="r", created_at=TS)


def test_reconcile_raises_on_drift():
    L = Ledger()
    L.credit("u", TxType.PURCHASE, coins=100, reference_type="iap", reference_id="t",
             idempotency_key="p", created_at=TS)
    # Corrupt the projection so it diverges from the append-only log.
    L._wallets["u"].balance_bought = 999
    with pytest.raises(LedgerError):
        L.reconcile("u")


def test_negative_balance_blocks_unlock_even_with_zero_cost_check():
    L = Ledger()
    L.credit("u", TxType.PURCHASE, coins=30, reference_type="iap", reference_id="t",
             idempotency_key="p", created_at=TS)
    L.refund_clawback("u", coins=100, reference_type="iap", reference_id="t",
                      idempotency_key="r", created_at=TS)  # -> -70
    with pytest.raises(BalanceNegative):
        L.unlock("u", ["ep11"], price_per_episode=30, reference_type="episode",
                 reference_id="ep11", idempotency_key="u", created_at=TS)


def test_insufficient_reports_needed_and_available():
    L = Ledger()
    with pytest.raises(InsufficientCoins) as ei:
        L.unlock("u", ["ep11"], price_per_episode=30, reference_type="episode",
                 reference_id="ep11", idempotency_key="u", created_at=TS)
    assert ei.value.needed == 30 and ei.value.available == 0
