from __future__ import annotations

from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.service import (
    build_experimental_flow_payload,
    build_latest_experimental_flow_payload,
    build_replay_experimental_flow_payload,
    reset_experimental_flow_memory,
)


def setup_function() -> None:
    reset_experimental_flow_memory()


def test_build_experimental_flow_payload_validates_and_estimates_volume_delta() -> None:
    previous = snapshot("2026-04-24T15:30:00Z", 100)
    current = snapshot("2026-04-24T15:30:05Z", 140)

    payload = build_experimental_flow_payload(current, previous, mode="latest")

    validated = ExperimentalFlow.model_validate(payload)
    assert validated.schema_version == "1.0.0"
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["previousSnapshotTime"] == "2026-04-24T15:30:00Z"
    assert payload["summary"]["estimatedBuyContracts"] == 40
    assert payload["contractRows"][0]["volumeDelta"] == 40
    assert payload["contractRows"][0]["signedContracts"] == 40
    assert "estimatedDealerGammaPressure" not in payload["contractRows"][0]
    assert payload["diagnostics"] == [
        {
            "code": "estimated_flow_only",
            "message": "Flow is inferred from free quote snapshots and is not official customer or market-maker open/close flow.",
            "severity": "info",
        }
    ]


def test_build_experimental_flow_payload_hard_codes_spx_metadata_symbol() -> None:
    previous = {**snapshot("2026-04-24T15:30:00Z", 100), "symbol": "SPY"}
    current = {**snapshot("2026-04-24T15:30:05Z", 140), "symbol": "SPY"}

    payload = build_experimental_flow_payload(current, previous, mode="latest")

    assert payload["meta"]["symbol"] == "SPX"
    ExperimentalFlow.model_validate(payload)


def test_build_latest_experimental_flow_payload_waits_for_newer_previous_snapshot() -> None:
    first = build_latest_experimental_flow_payload(snapshot("2026-04-24T15:30:00Z", 100))

    ExperimentalFlow.model_validate(first)
    assert first["summary"]["confidence"] == "unknown"
    assert first["summary"]["estimatedBuyContracts"] == 0
    assert first["contractRows"] == []
    assert first["meta"]["previousSnapshotTime"] is None
    assert first["diagnostics"][0]["code"] == "estimated_flow_only"
    assert first["diagnostics"][1]["code"] == "missing_previous_snapshot"

    same_timestamp = build_latest_experimental_flow_payload(snapshot("2026-04-24T15:30:00Z", 120))

    ExperimentalFlow.model_validate(same_timestamp)
    assert same_timestamp["contractRows"] == []
    assert same_timestamp["summary"]["confidence"] == "unknown"
    assert same_timestamp["meta"]["previousSnapshotTime"] is None

    later = build_latest_experimental_flow_payload(snapshot("2026-04-24T15:30:05Z", 150))

    ExperimentalFlow.model_validate(later)
    assert later["meta"]["previousSnapshotTime"] == "2026-04-24T15:30:00Z"
    assert later["summary"]["estimatedBuyContracts"] == 50
    assert later["contractRows"][0]["volumeDelta"] == 50
    assert later["contractRows"][0]["aggressor"] == "buy"


def test_replay_payload_builds_validation_rows() -> None:
    snapshots = [
        snapshot("2026-04-24T15:30:00Z", 100, spot=5200, last=9.75),
        snapshot("2026-04-24T15:30:05Z", 140, spot=5200, last=9.75),
        snapshot("2026-04-24T15:35:05Z", 155, spot=5208, last=9.75),
    ]

    payload = build_replay_experimental_flow_payload(snapshots, horizon_minutes=5)

    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["mode"] == "replay"
    assert payload["replayValidation"]["horizonMinutes"] == 5
    assert payload["replayValidation"]["rows"][0]["classification"] == "hit"
    assert payload["replayValidation"]["hitRate"] == 1.0


def test_replay_payload_ignores_malformed_future_snapshot_time() -> None:
    snapshots = [
        snapshot("2026-04-24T15:30:00Z", 100, spot=5200, last=9.75),
        snapshot("2026-04-24T15:30:05Z", 140, spot=5200, last=9.75),
        snapshot("not-a-time", 155, spot=5212, last=9.75),
        snapshot("2026-04-24T15:35:05Z", 160, spot=5208, last=9.75),
    ]

    payload = build_replay_experimental_flow_payload(snapshots, horizon_minutes=5)

    ExperimentalFlow.model_validate(payload)
    assert payload["replayValidation"]["rows"][0]["classification"] == "hit"
    assert payload["replayValidation"]["hitRate"] == 1.0


def test_replay_payload_with_one_valid_and_one_malformed_timestamp_returns_empty_valid_payload() -> None:
    snapshots = [
        snapshot("2026-04-24T15:30:00Z", 100, spot=5200),
        snapshot("not-a-time", 140, spot=5208),
    ]

    payload = build_replay_experimental_flow_payload(snapshots, horizon_minutes=5)

    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["mode"] == "replay"
    assert payload["meta"]["currentSnapshotTime"] == "2026-04-24T15:30:00Z"
    assert payload["meta"]["previousSnapshotTime"] is None
    assert payload["contractRows"] == []
    assert payload["replayValidation"]["rows"] == []


def test_replay_payload_with_only_malformed_timestamps_returns_generated_empty_payload() -> None:
    payload = build_replay_experimental_flow_payload(
        [snapshot("not-a-time", 100, spot=5200)],
        horizon_minutes=5,
    )

    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["mode"] == "replay"
    assert payload["meta"]["currentSnapshotTime"] != "not-a-time"
    assert payload["meta"]["previousSnapshotTime"] is None
    assert payload["contractRows"] == []
    assert payload["replayValidation"]["rows"] == []


def snapshot(snapshot_time: str, volume: int, *, spot: float = 5200.25, last: float = 10.25) -> dict:
    return {
        "schema_version": "1.0.0",
        "session_id": "moomoo-spx-0dte-live",
        "mode": "live",
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "snapshot_time": snapshot_time,
        "spot": spot,
        "source_status": "connected",
        "freshness_ms": 0,
        "rows": [
            {
                "contract_id": "SPX-2026-04-24-C-5200",
                "right": "call",
                "strike": 5200,
                "bid": 9.8,
                "ask": 10.2,
                "mid": 10.0,
                "last": last,
                "bid_size": 12,
                "ask_size": 8,
                "volume": volume,
                "open_interest": 500,
                "custom_gamma": 0.017,
                "custom_vanna": 0.002,
                "ibkr_delta": 0.51,
                "ibkr_vega": 2.0,
                "ibkr_theta": -1.25,
            }
        ],
    }
