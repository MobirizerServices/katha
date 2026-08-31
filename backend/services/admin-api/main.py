"""Katha admin-api — back-office API (RBAC + audit, Google Workspace OIDC). Scaffold."""
from fastapi import FastAPI
app = FastAPI(title="Katha admin-api", version="0.1.0")

@app.get("/health")
def health(): return {"status": "ok", "service": "admin-api"}
