import json

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.cli import main
from gammascope_collector.mock_source import build_mock_cycle


def test_mock_cycle_emits_contract_valid_spx_events() -> None:
    events = build_mock_cycle(spot=5200.25, expiry="2026-04-23", strikes=[5190, 5200, 5210])

    for event in events:
        CollectorEvents.model_validate(event)

    assert events[0]["status"] == "connected"
    assert events[0]["collector_id"] == "local-dev"

    underlying_ticks = [event for event in events if event.get("symbol") == "SPX" and "spot" in event]
    contract_events = [event for event in events if "ibkr_con_id" in event]
    option_ticks = [event for event in events if "ibkr_iv" in event]

    assert len(underlying_ticks) == 1
    assert underlying_ticks[0]["spot"] == 5200.25
    assert len(contract_events) == 6
    assert len(option_ticks) == 6
    assert {event["right"] for event in contract_events} == {"call", "put"}
    assert {event["quote_status"] for event in option_ticks} == {"valid"}


def test_mock_cycle_uses_supplied_session_id() -> None:
    events = build_mock_cycle(
        spot=5200.25,
        expiry="2026-04-23",
        strikes=[5200],
        session_id="live-spx-custom",
    )

    session_events = [event for event in events if "session_id" in event]
    assert {event["session_id"] for event in session_events} == {"live-spx-custom"}


def test_cli_emits_jsonl_cycle(capsys) -> None:
    main(["--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5190,5200,5210"])

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 14

    for line in lines:
        event = json.loads(line)
        CollectorEvents.model_validate(event)


def test_cli_accepts_pnpm_forwarded_separator(capsys) -> None:
    main(["--", "--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5200"])

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 6


def test_cli_normalizes_sys_argv_separator(capsys, monkeypatch) -> None:
    monkeypatch.setattr(
        "sys.argv",
        ["gammascope_collector.cli", "--", "--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5200"],
    )

    main()

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 6
