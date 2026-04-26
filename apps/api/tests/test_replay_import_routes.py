from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from gammascope_api.main import app
from gammascope_api.replay.dependencies import get_replay_parquet_importer
from gammascope_api.replay.importer import ImportResult

from replay_parquet_fixtures import write_replay_parquet_pair


ADMIN_TOKEN = "route-test-admin-token"


@pytest.fixture()
def importer_override(monkeypatch: pytest.MonkeyPatch) -> "_FakeImporter":
    importer = _FakeImporter()
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.delenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", raising=False)
    app.dependency_overrides[get_replay_parquet_importer] = lambda: importer
    yield importer
    app.dependency_overrides.pop(get_replay_parquet_importer, None)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_upload_requires_admin_token(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post("/api/replay/imports", files=_upload_files(tmp_path))

    assert response.status_code == 403
    assert importer_override.create_calls == []


def test_upload_rejects_wrong_admin_token(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers={"X-GammaScope-Admin-Token": "wrong"},
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 403
    assert importer_override.create_calls == []


def test_upload_requires_exactly_snapshots_and_quotes_file_fields(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    missing_response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path, include_quotes=False),
    )
    extra_response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            *_upload_files(tmp_path),
            ("other", ("other.parquet", b"other bytes", "application/octet-stream")),
        ],
    )

    assert missing_response.status_code == 400
    assert extra_response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_duplicate_file_fields_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            ("snapshots", ("snapshots.parquet", snapshots_path.read_bytes(), "application/octet-stream")),
            ("snapshots", ("snapshots.parquet", snapshots_path.read_bytes(), "application/octet-stream")),
            ("quotes", ("quotes.parquet", quotes_path.read_bytes(), "application/octet-stream")),
        ],
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_extra_text_fields_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
        data={"notes": "do not accept sidecar fields"},
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_wrong_filenames_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path, snapshots_filename="snapshot-upload.parquet"),
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_duplicate_same_file_checksums_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    same_bytes = b"not really parquet, but same upload bytes"

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=[
            ("snapshots", ("snapshots.parquet", same_bytes, "application/octet-stream")),
            ("quotes", ("quotes.parquet", same_bytes, "application/octet-stream")),
        ],
    )

    assert response.status_code == 400
    assert importer_override.create_calls == []


def test_upload_rejects_oversize_file_before_import_record(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", "8")

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 413
    assert importer_override.create_calls == []


def test_successful_upload_returns_import_result_shape(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    importer_override.create_result = _result(status="awaiting_confirmation", import_id="import-ready")

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code in {200, 202}
    assert response.json() == {
        "import_id": "import-ready",
        "status": "awaiting_confirmation",
        "summary": {"snapshot_count": 3},
        "warnings": [],
        "errors": [],
        "session_id": "session-ready",
        "replay_url": None,
    }
    assert len(importer_override.create_calls) == 1
    assert importer_override.create_calls[0]["snapshots_path"].name == "snapshots.parquet"
    assert importer_override.create_calls[0]["quotes_path"].name == "quotes.parquet"


def test_schema_validation_failure_after_import_record_returns_failed_result(
    client: TestClient,
    importer_override: "_FakeImporter",
    tmp_path: Path,
) -> None:
    importer_override.create_result = _result(
        import_id="import-failed",
        status="failed",
        errors=["missing required parquet column: snapshot_id"],
        session_id=None,
    )

    response = client.post(
        "/api/replay/imports",
        headers=_admin_headers(),
        files=_upload_files(tmp_path),
    )

    assert response.status_code == 200
    assert response.json()["import_id"] == "import-failed"
    assert response.json()["status"] == "failed"
    assert response.json()["errors"] == ["missing required parquet column: snapshot_id"]
    assert len(importer_override.create_calls) == 1


def test_get_import_returns_current_result_shape(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.imports["import-ready"] = _result(status="awaiting_confirmation", import_id="import-ready")

    response = client.get("/api/replay/imports/import-ready", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["import_id"] == "import-ready"
    assert response.json()["status"] == "awaiting_confirmation"
    assert response.json()["summary"] == {"snapshot_count": 3}


def test_get_missing_import_returns_404(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    response = client.get("/api/replay/imports/missing-import", headers=_admin_headers())

    assert response.status_code == 404


def test_confirm_awaiting_import_returns_completed(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-ready"] = _result(
        status="completed",
        import_id="import-ready",
        replay_url="/replay?session_id=session-ready",
    )

    response = client.post("/api/replay/imports/import-ready/confirm", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["replay_url"] == "/replay?session_id=session-ready"


def test_confirm_completed_import_returns_completed(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-completed"] = _result(
        status="completed",
        import_id="import-completed",
        replay_url="/replay?session_id=session-ready",
    )

    response = client.post("/api/replay/imports/import-completed/confirm", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_confirm_invalid_state_returns_409(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.confirm_results["import-failed"] = _result(
        status="failed",
        import_id="import-failed",
        errors=["Cannot confirm import from status failed"],
        session_id=None,
    )

    response = client.post("/api/replay/imports/import-failed/confirm", headers=_admin_headers())

    assert response.status_code == 409
    assert response.json()["status"] == "failed"


def test_cancel_unpublished_import_returns_cancelled(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.cancel_results["import-ready"] = _result(
        status="cancelled",
        import_id="import-ready",
        session_id=None,
    )

    response = client.delete("/api/replay/imports/import-ready", headers=_admin_headers())

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_cancel_completed_import_returns_409(
    client: TestClient,
    importer_override: "_FakeImporter",
) -> None:
    importer_override.cancel_results["import-completed"] = _result(
        status="completed",
        import_id="import-completed",
        errors=["Cannot cancel import from status completed"],
        replay_url="/replay?session_id=session-ready",
    )

    response = client.delete("/api/replay/imports/import-completed", headers=_admin_headers())

    assert response.status_code == 409
    assert response.json()["status"] == "completed"


class _FakeImporter:
    def __init__(self) -> None:
        self.create_result = _result(status="awaiting_confirmation")
        self.imports: dict[str, ImportResult] = {}
        self.confirm_results: dict[str, ImportResult] = {}
        self.cancel_results: dict[str, ImportResult] = {}
        self.create_calls: list[dict[str, Path]] = []

    def create_import(self, *, snapshots_path: Path, quotes_path: Path) -> ImportResult:
        assert snapshots_path.exists()
        assert quotes_path.exists()
        self.create_calls.append(
            {
                "snapshots_path": Path(snapshots_path),
                "quotes_path": Path(quotes_path),
            }
        )
        self.imports[self.create_result.import_id] = self.create_result
        return self.create_result

    def get_import(self, import_id: str) -> ImportResult:
        if import_id not in self.imports:
            raise KeyError(import_id)
        return self.imports[import_id]

    def confirm_import(self, import_id: str) -> ImportResult:
        if import_id not in self.confirm_results:
            raise KeyError(import_id)
        return self.confirm_results[import_id]

    def cancel_import(self, import_id: str) -> ImportResult:
        if import_id not in self.cancel_results:
            raise KeyError(import_id)
        return self.cancel_results[import_id]


def _upload_files(
    tmp_path: Path,
    *,
    snapshots_filename: str = "snapshots.parquet",
    quotes_filename: str = "quotes.parquet",
    include_quotes: bool = True,
) -> list[tuple[str, tuple[str, bytes, str]]]:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)
    files = [
        ("snapshots", (snapshots_filename, snapshots_path.read_bytes(), "application/octet-stream")),
    ]
    if include_quotes:
        files.append(("quotes", (quotes_filename, quotes_path.read_bytes(), "application/octet-stream")))
    return files


def _result(
    *,
    import_id: str = "import-route-test",
    status: str,
    summary: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    errors: list[str] | None = None,
    session_id: str | None = "session-ready",
    replay_url: str | None = None,
) -> ImportResult:
    return ImportResult(
        import_id=import_id,
        status=status,
        summary={"snapshot_count": 3} if summary is None else summary,
        warnings=[] if warnings is None else warnings,
        errors=[] if errors is None else errors,
        session_id=session_id,
        replay_url=replay_url,
    )


def _admin_headers() -> dict[str, str]:
    return {"X-GammaScope-Admin-Token": ADMIN_TOKEN}
