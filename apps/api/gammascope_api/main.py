from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from gammascope_api.routes import (
    admin,
    collector,
    experimental,
    experimental_flow,
    heatmap,
    replay,
    replay_imports,
    scenario,
    snapshot,
    status,
    stream,
    views,
)


app = FastAPI(title="GammaScope API", version="0.1.0")
app.add_exception_handler(
    RequestValidationError,
    replay_imports.replay_import_validation_exception_handler,
)

app.include_router(status.router)
app.include_router(admin.router)
app.include_router(collector.router)
app.include_router(snapshot.router)
app.include_router(experimental.router)
app.include_router(experimental_flow.router)
app.include_router(heatmap.router)
app.include_router(stream.router)
app.include_router(replay.router)
app.include_router(replay_imports.router)
app.include_router(scenario.router)
app.include_router(views.router)
