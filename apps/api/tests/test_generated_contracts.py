import json
from pathlib import Path

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.contracts.generated.collector_events import CollectorHealth
from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.contracts.generated.scenario import ScenarioRequest
from gammascope_api.contracts.generated.saved_view import SavedView


def test_seed_snapshot_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "analytics-snapshot.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    snapshot = AnalyticsSnapshot.model_validate(payload)

    assert snapshot.schema_version == "1.0.0"
    assert snapshot.symbol == "SPX"
    assert len(snapshot.rows) == 34
    assert snapshot.rows[0].open_interest is not None


def test_seed_experimental_analytics_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "experimental-analytics.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    experimental = ExperimentalAnalytics.model_validate(payload)

    assert experimental.schema_version == "1.0.0"
    assert experimental.meta.symbol == "SPX"
    assert experimental.forwardSummary.status.value == "ok"


def test_seed_health_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "collector-health.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    health = CollectorHealth.model_validate(payload)

    assert health.source == "ibkr"
    assert health.status.value == "connected"


def test_seed_scenario_request_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "scenario-request.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    scenario_request = ScenarioRequest.model_validate(payload)

    assert scenario_request.root.session_id == "seed-spx-2026-04-23"
    assert scenario_request.root.vol_shift_points == 1.5


def test_seed_saved_view_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "saved-view.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    saved_view = SavedView.model_validate(payload)

    assert saved_view.owner_scope.value == "public_demo"
    assert saved_view.mode.value == "replay"
