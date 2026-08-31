# alembic — single migration history for the whole backend (SAD §12.1, ADR-002)

One Postgres cluster, schemas by domain (catalog, identity, ledger, engagement, admin,
ai, langgraph). Expand-then-contract migrations only; never destructive in the same release.
