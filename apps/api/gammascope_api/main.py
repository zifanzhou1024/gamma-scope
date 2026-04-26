from fastapi import FastAPI

from gammascope_api.auth import admin_token_configured, hosted_replay_mode_enabled, private_mode_enabled
from gammascope_api.routes import admin, collector, replay, scenario, snapshot, status, stream, views


app = FastAPI(title="GammaScope API", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "gammascope-api",
        "version": app.version,
        "hosted_replay_mode": hosted_replay_mode_enabled(),
        "private_mode": private_mode_enabled(),
        "admin_token_configured": bool(admin_token_configured()),
    }


app.include_router(status.router)
app.include_router(admin.router)
app.include_router(collector.router)
app.include_router(snapshot.router)
app.include_router(stream.router)
app.include_router(replay.router)
app.include_router(scenario.router)
app.include_router(views.router)
