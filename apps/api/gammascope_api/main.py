from fastapi import FastAPI

from gammascope_api.routes import replay, scenario, snapshot, status, views


app = FastAPI(title="GammaScope API", version="0.1.0")

app.include_router(status.router)
app.include_router(snapshot.router)
app.include_router(replay.router)
app.include_router(scenario.router)
app.include_router(views.router)
