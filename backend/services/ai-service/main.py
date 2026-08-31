"""Katha ai-service — LangGraph graphs (writers' room, localization, moderation,
recs curation, support, recaps) + model gateway. Scaffold."""
from fastapi import FastAPI
app = FastAPI(title="Katha ai-service", version="0.1.0")

@app.get("/health")
def health(): return {"status": "ok", "service": "ai-service"}
