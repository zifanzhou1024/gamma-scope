from __future__ import annotations

from copy import deepcopy
import json

from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.experimental import service as experimental_service
from gammascope_api.experimental.service import build_experimental_payload


PANEL_KEYS = [
    "forwardSummary",
    "ivSmiles",
    "smileDiagnostics",
    "probabilities",
    "terminalDistribution",
    "skewTail",
    "moveNeeded",
    "decayPressure",
    "richCheap",
    "quoteQuality",
    "historyPreview",
]


def test_build_experimental_payload_validates_against_generated_contract() -> None:
    payload = build_experimental_payload(load_json_fixture("analytics-snapshot.seed.json"), "latest")

    model = ExperimentalAnalytics.model_validate(payload)

    assert model.schema_version == "1.0.0"
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["symbol"] == "SPX"
    assert payload["sourceSnapshot"]["rowCount"] == 34
    assert payload["sourceSnapshot"]["strikeCount"] == 17
    assert all(payload[key]["status"] in {"ok", "preview", "insufficient_data", "error"} for key in PANEL_KEYS)


def test_build_experimental_payload_populates_summary_fields_from_seed_snapshot() -> None:
    payload = build_experimental_payload(load_json_fixture("analytics-snapshot.seed.json"), "replay")

    assert payload["meta"]["mode"] == "replay"
    assert payload["forwardSummary"]["parityForward"] is not None
    assert payload["forwardSummary"]["atmStraddle"] is not None
    assert payload["forwardSummary"]["expectedMovePercent"] is not None
    assert payload["smileDiagnostics"]["ivValley"]["strike"] is not None
    assert payload["smileDiagnostics"]["atmForwardIv"] is not None
    assert payload["smileDiagnostics"]["methodDisagreement"] is not None


def test_build_experimental_payload_degrades_malformed_rows_without_raising() -> None:
    snapshot = {
        "snapshot_id": "malformed-snapshot",
        "symbol": "SPX",
        "timestamp": "not-a-time",
        "expiration": "not-a-date",
        "spot": "not-a-number",
        "time_to_expiry_years": "also-bad",
        "rows": [None, 42, {"right": "call", "strike": object(), "bid": None, "ask": None, "mid": None}],
    }

    payload = build_experimental_payload(snapshot, "latest")

    ExperimentalAnalytics.model_validate(payload)
    assert payload["sourceSnapshot"]["spot"] == 0.0
    assert payload["forwardSummary"]["status"] == "insufficient_data"
    assert payload["ivSmiles"]["status"] == "insufficient_data"
    assert payload["moveNeeded"]["rows"] == []


def test_build_experimental_payload_degrades_panel_builder_errors(monkeypatch) -> None:
    snapshot = deepcopy(load_json_fixture("analytics-snapshot.seed.json"))

    def raise_panel_error(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("panel exploded")

    monkeypatch.setattr(experimental_service, "quote_quality_panel", raise_panel_error)

    payload = build_experimental_payload(snapshot, "latest")

    ExperimentalAnalytics.model_validate(payload)
    assert payload["quoteQuality"]["status"] == "insufficient_data"
    assert payload["quoteQuality"]["score"] == 0.0
    assert payload["quoteQuality"]["flags"] == []
    assert payload["quoteQuality"]["diagnostics"][0]["code"] == "panel_unavailable"


def test_build_experimental_payload_scrubs_nonfinite_computed_values() -> None:
    snapshot = {
        "session_id": "extreme-session",
        "symbol": "SPX",
        "snapshot_time": "2026-04-23T15:50:00Z",
        "expiry": "2026-04-23",
        "spot": 5000,
        "rows": [
            {"right": "call", "strike": 1e308, "bid": 1e308, "ask": 1e308, "mid": 1e308},
            {"right": "put", "strike": 1e308, "bid": 0.5, "ask": 0.6, "mid": 0.55},
        ],
    }

    payload = build_experimental_payload(snapshot, "latest")

    ExperimentalAnalytics.model_validate(payload)
    json.dumps(payload, allow_nan=False)
    assert payload["forwardSummary"]["parityForward"] is None
    assert payload["forwardSummary"]["expectedRange"] is None
