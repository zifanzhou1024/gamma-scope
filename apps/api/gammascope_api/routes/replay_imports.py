from __future__ import annotations

from dataclasses import asdict, is_dataclass
from pathlib import Path
import shutil
import tempfile
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.responses import JSONResponse, Response

from gammascope_api.auth import require_admin_token
from gammascope_api.replay.archive import sha256_file
from gammascope_api.replay.config import replay_import_max_bytes
from gammascope_api.replay.dependencies import get_replay_parquet_importer
from gammascope_api.replay.importer import ReplayParquetImporter


REQUIRED_FILENAMES = {"snapshots": "snapshots.parquet", "quotes": "quotes.parquet"}
_UPLOAD_CHUNK_BYTES = 1024 * 1024

router = APIRouter()


@router.post("/api/replay/imports")
async def create_replay_import(
    request: Request,
    snapshots: Annotated[UploadFile, File()],
    quotes: Annotated[UploadFile, File()],
    importer: Annotated[ReplayParquetImporter, Depends(get_replay_parquet_importer)],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    require_admin_token(x_gammascope_admin_token)
    await _validate_file_fields(request)
    _validate_filenames(snapshots=snapshots, quotes=quotes)

    saved_paths: list[Path] = []
    try:
        max_bytes = replay_import_max_bytes()
        snapshots_path, snapshots_sha256, _snapshots_size = await _save_upload_to_temp(
            snapshots,
            max_bytes=max_bytes,
        )
        saved_paths.append(snapshots_path)
        quotes_path, quotes_sha256, _quotes_size = await _save_upload_to_temp(
            quotes,
            max_bytes=max_bytes,
        )
        saved_paths.append(quotes_path)
        if snapshots_sha256 == quotes_sha256:
            raise HTTPException(status_code=400, detail="snapshots and quotes uploads must be different files")

        result = importer.create_import(snapshots_path=snapshots_path, quotes_path=quotes_path)
        return _result_payload(result)
    finally:
        _cleanup_temp_uploads(saved_paths)


@router.get("/api/replay/imports/{import_id}")
def get_replay_import(
    import_id: str,
    importer: Annotated[ReplayParquetImporter, Depends(get_replay_parquet_importer)],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    require_admin_token(x_gammascope_admin_token)
    try:
        result = importer.get_import(import_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Replay import not found") from exc
    return _result_payload(result)


@router.post("/api/replay/imports/{import_id}/confirm", response_model=None)
def confirm_replay_import(
    import_id: str,
    importer: Annotated[ReplayParquetImporter, Depends(get_replay_parquet_importer)],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> Any:
    require_admin_token(x_gammascope_admin_token)
    try:
        result = importer.confirm_import(import_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Replay import not found") from exc
    return _transition_response(result, action="confirm")


@router.delete("/api/replay/imports/{import_id}", response_model=None)
def cancel_replay_import(
    import_id: str,
    importer: Annotated[ReplayParquetImporter, Depends(get_replay_parquet_importer)],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> Any:
    require_admin_token(x_gammascope_admin_token)
    try:
        result = importer.cancel_import(import_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Replay import not found") from exc
    return _transition_response(result, action="cancel")


async def replay_import_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> Response:
    if request.url.path == "/api/replay/imports" and request.method == "POST":
        for error in exc.errors():
            location = error.get("loc", ())
            if tuple(location) in {("body", "snapshots"), ("body", "quotes")}:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Upload requires file fields snapshots and quotes"},
                )
    return await request_validation_exception_handler(request, exc)


async def _save_upload_to_temp(upload: UploadFile, *, max_bytes: int) -> tuple[Path, str, int]:
    path = temporary_upload_path(upload.filename)
    size = await copy_upload_with_limit(upload, path=path, max_bytes=max_bytes)
    return path, sha256_file(path), size


def temporary_upload_path(filename: str | None) -> Path:
    upload_dir = Path(tempfile.mkdtemp(prefix="gammascope-replay-import-"))
    return upload_dir / Path(filename or "upload.parquet").name


async def copy_upload_with_limit(upload: UploadFile, *, path: Path, max_bytes: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with path.open("wb") as handle:
            while chunk := await upload.read(_UPLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="Replay import upload is too large")
                handle.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    return size


async def _validate_file_fields(request: Request) -> None:
    form = await request.form()
    fields = list(form.multi_items())
    seen_file_fields: set[str] = set()
    if len(fields) != len(REQUIRED_FILENAMES):
        raise HTTPException(status_code=400, detail="Upload requires exactly snapshots and quotes file fields")
    for key, value in fields:
        if (
            key not in REQUIRED_FILENAMES
            or key in seen_file_fields
            or not isinstance(value, (UploadFile, StarletteUploadFile))
        ):
            raise HTTPException(status_code=400, detail="Upload requires exactly snapshots and quotes file fields")
        seen_file_fields.add(key)
    if seen_file_fields != set(REQUIRED_FILENAMES):
        raise HTTPException(status_code=400, detail="Upload requires exactly snapshots and quotes file fields")


def _validate_filenames(*, snapshots: UploadFile, quotes: UploadFile) -> None:
    received = {"snapshots": snapshots.filename, "quotes": quotes.filename}
    if received != REQUIRED_FILENAMES:
        raise HTTPException(
            status_code=400,
            detail="Upload filenames must be snapshots.parquet and quotes.parquet",
        )


def _transition_response(result: Any, *, action: str) -> Response | dict[str, Any]:
    payload = _result_payload(result)
    if any(str(error).startswith(f"Cannot {action} import") for error in payload["errors"]):
        return JSONResponse(status_code=409, content=payload)
    return payload


def _result_payload(result: Any) -> dict[str, Any]:
    if is_dataclass(result):
        payload = asdict(result)
    else:
        payload = dict(result)
    return {
        "import_id": payload["import_id"],
        "status": payload["status"],
        "summary": payload.get("summary", {}),
        "warnings": payload.get("warnings", []),
        "errors": payload.get("errors", []),
        "session_id": payload.get("session_id"),
        "replay_url": payload.get("replay_url"),
    }


def _cleanup_temp_uploads(paths: list[Path]) -> None:
    for path in paths:
        shutil.rmtree(path.parent, ignore_errors=True)
