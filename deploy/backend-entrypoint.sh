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

exec gunicorn \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind "0.0.0.0:${KATHA_PORT:-8799}" \
  --workers "${KATHA_WORKERS:-4}" \
  --timeout "${KATHA_TIMEOUT:-60}" \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  "${KATHA_ASGI_APP:-app.main:app}"
