# Katha backend image — serves either core-api or admin-api (pick via
# KATHA_ASGI_APP) under gunicorn + uvicorn workers. Build context is the repo
# root: `docker build -f backend/Dockerfile -t katha-backend .`
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# System deps for asyncpg/cryptography wheels are prebuilt; only need curl for
# container healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY backend/ /app/
COPY deploy/backend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The monorepo packages resolve on PYTHONPATH exactly as in dev.
ENV PYTHONPATH=/app/packages/ledger:/app/packages/domain:/app/packages/infra:/app/services/core-api:/app/services/admin-api \
    KATHA_ASGI_APP=app.main:app \
    KATHA_PORT=8799 \
    KATHA_WORKERS=4

# Run as an unprivileged user.
RUN useradd -m -u 10001 katha && chown -R katha /app
USER katha

EXPOSE 8799
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${KATHA_PORT}/health" || exit 1

ENTRYPOINT ["entrypoint.sh"]
