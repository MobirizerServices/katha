#!/usr/bin/env sh
# Backend container entrypoint: optionally run migrations, then serve the chosen
# ASGI app under gunicorn with uvicorn workers.
set -eu

# Run Alembic migrations before serving when asked (one service in the stack
# sets KATHA_RUN_MIGRATIONS=1 so migrations run exactly once per release).
if [ "${KATHA_RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] alembic upgrade head"
  alembic upgrade head
fi

# The app sits behind nginx. Without this, uvicorn trusts X-Forwarded-For only
# from 127.0.0.1, so every request looks like it came from the proxy: one OTP
# per-IP bucket for the whole user base, an all-or-nothing admin allowlist,
# proxy IPs in the audit log. nginx sends the REAL client address as a single
# hop (see deploy/nginx/nginx.conf), so trusting the proxy network is safe.
exec gunicorn \
  --worker-class uvicorn.workers.UvicornWorker \
  --forwarded-allow-ips "${KATHA_FORWARDED_ALLOW_IPS:-*}" \
  --bind "0.0.0.0:${KATHA_PORT:-8799}" \
  --workers "${KATHA_WORKERS:-4}" \
  --timeout "${KATHA_TIMEOUT:-60}" \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  "${KATHA_ASGI_APP:-app.main:app}"
