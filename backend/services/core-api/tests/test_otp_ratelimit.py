"""OTP provider store + the rate limiter's disabled/in-memory paths."""
import time

from katha_infra import otp
from katha_infra.ratelimit import RateLimiter


def test_ratelimiter_disabled_without_redis():
    rl = RateLimiter(url="")           # explicit: no Redis
    assert rl.enabled is False
    assert rl.hit("k", 1, 60) == (True, 0)   # no-op when disabled


def test_otp_disabled_by_default(monkeypatch):
    monkeypatch.delenv("KATHA_OTP_PROVIDER", raising=False)
    assert otp.enabled() is False


def test_console_otp_roundtrip(monkeypatch):
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "console")
    monkeypatch.delenv("KATHA_REDIS_URL", raising=False)
    otp._mem.clear()
    phone = "+919812345678"
    otp.generate_and_send(phone)
    code = otp._mem[phone][0]           # peek the code the console "sent"
    assert otp.verify(phone, "0000" if code != "0000" else "1111") is False   # wrong
    assert otp.verify(phone, code) is True                                     # right
    assert otp.verify(phone, code) is False    # single-use: consumed


def test_otp_attempt_cap(monkeypatch):
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "console")
    monkeypatch.delenv("KATHA_REDIS_URL", raising=False)
    otp._mem.clear()
    phone = "+910000000000"
    otp.generate_and_send(phone)
    code = otp._mem[phone][0]
    wrong = "9999" if code != "9999" else "1234"
    for _ in range(5):
        assert otp.verify(phone, wrong) is False
    # capped out — even the correct code no longer works
    assert otp.verify(phone, code) is False


def test_otp_expiry(monkeypatch):
    monkeypatch.setenv("KATHA_OTP_PROVIDER", "console")
    monkeypatch.delenv("KATHA_REDIS_URL", raising=False)
    otp._mem.clear()
    phone = "+911111111111"
    otp.generate_and_send(phone)
    code, _, attempts = otp._mem[phone]
    otp._mem[phone] = (code, time.time() - 1, attempts)   # force-expire
    assert otp.verify(phone, code) is False
