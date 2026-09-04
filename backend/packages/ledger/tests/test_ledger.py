"""Money-correctness tests for the Katha coin ledger (PDD §8, §12.7).

Every test asserts an invariant the business depends on: idempotency, bonus-first
spend, atomic bundle unlock, refund clawback, and ledger↔wallet reconciliation.
"""
import pytest

from katha_ledger import (
    BalanceNegative,
    IdempotencyConflict,
    InsufficientCoins,
    Ledger,
    TxType,
)

TS = "2026-09-14T14:03:22+05:30"  # fixed clock — deterministic, never wall-clock


def fresh():
    return Ledger()


# ---- credits -------------------------------------------------------------
def test_purchase_credits_bought_pool():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="iap",
             reference_id="txn1", idempotency_key="iap:txn1", created_at=TS)
    w = L.balance("u1")
    assert w.balance_bought == 1300
    assert w.balance_bonus == 0
    assert w.total == 1300


def test_bonus_checkin_referral_credit_bonus_pool():
    L = fresh()
    L.credit("u1", TxType.BONUS, coins=130, reference_type="web_order",
             reference_id="wo1", idempotency_key="bonus:wo1", created_at=TS)
    L.credit("u1", TxType.CHECKIN, coins=5, reference_type="day",
             reference_id="2026-09-14", idempotency_key="checkin:u1:2026-09-14", created_at=TS)
    L.credit("u1", TxType.REFERRAL, coins=50, reference_type="referral",
             reference_id="r1", idempotency_key="ref:r1", created_at=TS)
    w = L.balance("u1")
    assert w.balance_bought == 0
    assert w.balance_bonus == 185


def test_web_purchase_plus_bonus_matches_mockup_math():
    # Popular pack on web: 1300 bought + 130 web bonus = 1430 (matches web-app mockup).
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="web_order",
             reference_id="wo9", idempotency_key="web:wo9", created_at=TS)
    L.credit("u1", TxType.BONUS, coins=130, reference_type="web_order",
             reference_id="wo9", idempotency_key="webbonus:wo9", created_at=TS)
    assert L.balance("u1").total == 1430


# ---- idempotency ---------------------------------------------------------
def test_duplicate_purchase_key_is_idempotent():
    L = fresh()
    a = L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="iap",
                 reference_id="txn1", idempotency_key="iap:txn1", created_at=TS)
    b = L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="iap",
                 reference_id="txn1", idempotency_key="iap:txn1", created_at=TS)
    assert a is b                        # same object, nothing re-appended
    assert L.balance("u1").total == 1300  # credited once, not twice
    assert len(L.transactions("u1")) == 1


def test_duplicate_unlock_key_does_not_double_charge():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=100, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    key = "unlock:u1:ep11"
    r1 = L.unlock("u1", ["ep11"], price_per_episode=30, reference_type="episode",
                  reference_id="ep11", idempotency_key=key, created_at=TS)
    r2 = L.unlock("u1", ["ep11"], price_per_episode=30, reference_type="episode",
                  reference_id="ep11", idempotency_key=key, created_at=TS)
    assert r1.transaction is r2.transaction
    assert L.balance("u1").total == 70   # charged 30 once


# ---- bonus-first spend ---------------------------------------------------
def test_unlock_spends_bonus_before_bought():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=100, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    L.credit("u1", TxType.BONUS, coins=20, reference_type="promo",
             reference_id="p", idempotency_key="bonus:p", created_at=TS)
    res = L.unlock("u1", ["ep11"], price_per_episode=30, reference_type="episode",
                   reference_id="ep11", idempotency_key="unlock:1", created_at=TS)
    assert res.spent_bonus == 20         # bonus drained first
    assert res.spent_bought == 10        # remainder from bought
    w = L.balance("u1")
    assert w.balance_bonus == 0
    assert w.balance_bought == 90


# ---- bundle unlock -------------------------------------------------------
def test_bundle_unlock_is_atomic_and_entitles_all():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=2000, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    eps = [f"ep{n}" for n in range(11, 61)]  # 50 remaining episodes
    res = L.unlock("u1", eps, price_per_episode=30, reference_type="bundle",
                   reference_id="srs1", idempotency_key="bundle:u1:srs1",
                   created_at=TS, source="bundle")
    assert len(res.entitlements) == 50
    assert L.balance("u1").total == 2000 - 1500   # 50 * 30
    assert all(L.is_entitled("u1", e) for e in eps)


def test_bundle_skips_already_owned_episodes():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=200, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    L.unlock("u1", ["ep11"], price_per_episode=30, reference_type="episode",
             reference_id="ep11", idempotency_key="unlock:single", created_at=TS)
    # Bundle of ep11..ep13 should only charge for the two NOT already owned.
    res = L.unlock("u1", ["ep11", "ep12", "ep13"], price_per_episode=30,
                   reference_type="bundle", reference_id="b", idempotency_key="unlock:bundle",
                   created_at=TS)
    assert res.spent_bonus + res.spent_bought == 60   # only ep12, ep13
    assert L.balance("u1").total == 200 - 30 - 60


# ---- insufficient funds --------------------------------------------------
def test_unlock_blocks_when_insufficient():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=20, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    with pytest.raises(InsufficientCoins) as ei:
        L.unlock("u1", ["ep11"], price_per_episode=30, reference_type="episode",
                 reference_id="ep11", idempotency_key="u", created_at=TS)
    assert ei.value.needed == 30
    assert ei.value.available == 20
    assert not L.is_entitled("u1", "ep11")   # no entitlement on failure
    assert L.balance("u1").total == 20        # nothing debited


# ---- refund clawback -----------------------------------------------------
def test_refund_clawback_can_go_negative_and_blocks_unlocks():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=100, reference_type="iap",
             reference_id="t", idempotency_key="iap:t", created_at=TS)
    L.unlock("u1", ["ep11", "ep12", "ep13"], price_per_episode=30, reference_type="bundle",
             reference_id="b", idempotency_key="u1", created_at=TS)  # spend 90, leaves 10
    L.refund_clawback("u1", coins=100, reference_type="iap", reference_id="t",
                      idempotency_key="refund:t", created_at=TS)      # -> -90
    assert L.balance("u1").balance_bought == -90
    with pytest.raises(BalanceNegative):
        L.unlock("u1", ["ep14"], price_per_episode=30, reference_type="episode",
                 reference_id="ep14", idempotency_key="u2", created_at=TS)
    # Already-granted entitlements are NOT revoked (viewer-friendly, PDD §10 tactic).
    assert L.is_entitled("u1", "ep11")


# ---- free grant ----------------------------------------------------------
def test_free_episodes_need_no_coins():
    L = fresh()
    for n in range(1, 11):
        L.grant_free("u1", f"ep{n}", created_at=TS)
    assert all(L.is_entitled("u1", f"ep{n}") for n in range(1, 11))
    assert L.balance("u1").total == 0


# ---- admin adjust --------------------------------------------------------
def test_admin_adjust_signed_both_directions():
    L = fresh()
    L.admin_adjust("u1", coins=100, reference_type="ticket", reference_id="T-1",
                   idempotency_key="adj:1", created_at=TS)
    L.admin_adjust("u1", coins=-40, reference_type="ticket", reference_id="T-2",
                   idempotency_key="adj:2", created_at=TS)
    assert L.balance("u1").total == 60


# ---- reconciliation ------------------------------------------------------
def test_reconcile_matches_projection_after_many_ops():
    L = fresh()
    L.credit("u1", TxType.PURCHASE, coins=1300, reference_type="iap",
             reference_id="t1", idempotency_key="k1", created_at=TS)
    L.credit("u1", TxType.BONUS, coins=130, reference_type="promo",
             reference_id="p", idempotency_key="k2", created_at=TS)
    L.unlock("u1", ["ep11", "ep12"], price_per_episode=30, reference_type="bundle",
             reference_id="b", idempotency_key="k3", created_at=TS)
    L.refund_clawback("u1", coins=100, reference_type="iap", reference_id="t1",
                      idempotency_key="k4", created_at=TS)
    rebuilt = L.reconcile("u1")          # raises on drift
    assert rebuilt.total == L.balance("u1").total


def test_reconcile_isolates_users():
    L = fresh()
    L.credit("a", TxType.PURCHASE, coins=600, reference_type="iap",
             reference_id="t", idempotency_key="ka", created_at=TS)
    L.credit("b", TxType.PURCHASE, coins=999, reference_type="iap",
             reference_id="t", idempotency_key="kb", created_at=TS)
    assert L.reconcile("a").total == 600
    assert L.reconcile("b").total == 999


# ---- idempotency keys identify ONE operation ------------------------------
def test_replay_under_a_used_key_by_another_user_is_a_conflict_not_a_noop():
    L = fresh()
    L.credit("victim", TxType.CHECKIN, coins=5, reference_type="day",
             reference_id="2026-09-03", idempotency_key="checkin:victim:2026-09-03",
             created_at=TS)
    L.credit("attacker", TxType.PURCHASE, coins=600, reference_type="iap",
             reference_id="p", idempotency_key="buy", created_at=TS)
    with pytest.raises(IdempotencyConflict):
        L.unlock("attacker", ["s:e11"], price_per_episode=30, reference_type="episode",
                 reference_id="s:e11", idempotency_key="checkin:victim:2026-09-03",
                 created_at=TS)
    with pytest.raises(IdempotencyConflict):
        L.credit("attacker", TxType.CHECKIN, coins=5, reference_type="day",
                 reference_id="2026-09-03", idempotency_key="checkin:victim:2026-09-03",
                 created_at=TS)
    assert L.balance("attacker").total == 600            # nothing spent or granted
    assert L.balance("victim").total == 5


def test_same_user_reusing_a_key_for_a_different_operation_is_a_conflict():
    L = fresh()
    L.credit("u", TxType.PURCHASE, coins=600, reference_type="iap",
             reference_id="p", idempotency_key="buy", created_at=TS)
    L.unlock("u", ["s:e11"], price_per_episode=30, reference_type="episode",
             reference_id="s:e11", idempotency_key="k", created_at=TS)
    # exact replay: original result, nothing appended
    again = L.unlock("u", ["s:e11"], price_per_episode=30, reference_type="episode",
                     reference_id="s:e11", idempotency_key="k", created_at=TS)
    assert again.spent_bonus + again.spent_bought == 30
    assert L.balance("u").total == 570
    # same key, different episode: conflict, and e12 stays locked
    with pytest.raises(IdempotencyConflict):
        L.unlock("u", ["s:e12"], price_per_episode=30, reference_type="episode",
                 reference_id="s:e12", idempotency_key="k", created_at=TS)
    assert not L.is_entitled("u", "s:e12")
    # a credit replay with a different amount is a conflict too
    with pytest.raises(IdempotencyConflict):
        L.credit("u", TxType.PURCHASE, coins=999, reference_type="iap",
                 reference_id="p", idempotency_key="buy", created_at=TS)
    assert L.balance("u").total == 570


# ---- an unlock never charges zero or negative ---------------------------------
@pytest.mark.parametrize("price,total", [(0, None), (-100, None), (30, 0), (30, -5)])
def test_non_positive_unlock_cost_is_refused(price, total):
    from katha_ledger import LedgerError
    L = fresh()
    L.credit("u", TxType.PURCHASE, coins=100, reference_type="iap",
             reference_id="p", idempotency_key="buy", created_at=TS)
    with pytest.raises(LedgerError):
        L.unlock("u", ["s:e11"], price_per_episode=price, reference_type="episode",
                 reference_id="s:e11", idempotency_key="k", created_at=TS,
                 total_cost=total)
    assert L.balance("u").total == 100
    assert not L.is_entitled("u", "s:e11")
    assert len(L.transactions("u")) == 1
