from __future__ import annotations

import argparse
import json
import socket
import sys
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from gammascope_collector.events import health_event
from gammascope_collector.ibkr_config import IbkrHealthConfig, ibkr_health_config_from_env
from gammascope_collector.publisher import PublishSummary, publish_events


class ConnectionContext(Protocol):
    def __enter__(self) -> object:
        ...

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> object:
        ...


Connect = Callable[..., ConnectionContext]
Publish = Callable[..., PublishSummary | dict[str, object]]


def probe_ibkr_health(
    config: IbkrHealthConfig,
    *,
    connect: Connect | None = None,
    event_time: datetime | None = None,
) -> dict[str, object]:
    connector = connect or socket.create_connection
    address = (config.host, config.port)

    try:
        with connector(address, timeout=config.timeout_seconds):
            return health_event(
                collector_id=config.collector_id,
                status="connected",
                ibkr_account_mode=config.account_mode,
                message=f"IBKR endpoint {config.host}:{config.port} is reachable; TCP probe only.",
                event_time=event_time,
                received_time=event_time,
            )
    except (TimeoutError, OSError) as exc:
        return health_event(
            collector_id=config.collector_id,
            status="disconnected",
            ibkr_account_mode=config.account_mode,
            message=f"IBKR endpoint {config.host}:{config.port} is unreachable: {exc}",
            event_time=event_time,
            received_time=event_time,
        )


def main(
    argv: Sequence[str] | None = None,
    *,
    connect: Connect | None = None,
    publish: Publish | None = None,
) -> None:
    defaults = ibkr_health_config_from_env()
    parser = argparse.ArgumentParser(description="Probe local IBKR TWS / IB Gateway TCP reachability.")
    parser.add_argument("--host", default=defaults.host)
    parser.add_argument("--port", type=int, default=defaults.port)
    parser.add_argument("--client-id", type=int, default=defaults.client_id)
    parser.add_argument("--collector-id", default=defaults.collector_id)
    parser.add_argument("--account-mode", choices=["paper", "live", "unknown"], default=defaults.account_mode)
    parser.add_argument("--api", default=defaults.api_base)
    parser.add_argument("--timeout-seconds", type=float, default=defaults.timeout_seconds)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    config = _validated_config(
        defaults,
        host=args.host,
        port=args.port,
        client_id=args.client_id,
        collector_id=args.collector_id,
        account_mode=args.account_mode,
        api_base=args.api,
        timeout_seconds=args.timeout_seconds,
    )
    event = probe_ibkr_health(config, connect=connect)

    if args.publish:
        publisher = publish or publish_events
        summary = publisher([event], api_base=config.api_base)
        print(json.dumps(_summary_dict(summary), separators=(",", ":"), sort_keys=True))
        return

    print(json.dumps(event, separators=(",", ":"), sort_keys=True))


def _validated_config(config: IbkrHealthConfig, **overrides: object) -> IbkrHealthConfig:
    candidate = replace(config, **overrides)
    return ibkr_health_config_from_env(
        {
            "GAMMASCOPE_IBKR_HOST": candidate.host,
            "GAMMASCOPE_IBKR_PORT": str(candidate.port),
            "GAMMASCOPE_IBKR_CLIENT_ID": str(candidate.client_id),
            "GAMMASCOPE_COLLECTOR_ID": candidate.collector_id,
            "GAMMASCOPE_IBKR_ACCOUNT_MODE": candidate.account_mode,
            "GAMMASCOPE_API_BASE_URL": candidate.api_base,
            "GAMMASCOPE_IBKR_TIMEOUT_SECONDS": str(candidate.timeout_seconds),
        }
    )


def _summary_dict(summary: PublishSummary | dict[str, object]) -> dict[str, object]:
    if isinstance(summary, dict):
        return summary
    return summary.as_dict()


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
