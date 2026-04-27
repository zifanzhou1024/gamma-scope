from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from gammascope_collector.mock_source import build_mock_cycle

COLLECTOR_EVENT_PATH = "/api/spx/0dte/collector/events"
COLLECTOR_EVENTS_BULK_PATH = "/api/spx/0dte/collector/events/bulk"

PostJson = Callable[[str, dict[str, object]], dict[str, Any]]
PostJsonBatch = Callable[[str, list[dict[str, object]]], dict[str, Any]]


class PublishError(RuntimeError):
    pass


@dataclass(frozen=True)
class PublishSummary:
    endpoint: str
    accepted_count: int
    event_types: list[str]

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def collector_event_endpoint(api_base: str) -> str:
    return f"{api_base.rstrip('/')}{COLLECTOR_EVENT_PATH}"


def collector_events_bulk_endpoint(api_base: str) -> str:
    return f"{api_base.rstrip('/')}{COLLECTOR_EVENTS_BULK_PATH}"


def publish_events(
    events: Iterable[dict[str, object]],
    *,
    api_base: str,
    post_json: PostJson | None = None,
) -> PublishSummary:
    endpoint = collector_event_endpoint(api_base)
    sender = post_json or _post_json
    event_types: list[str] = []

    for event in events:
        response = sender(endpoint, event)
        if response.get("accepted") is not True:
            raise PublishError(f"Collector event rejected by {endpoint}: {response}")
        event_types.append(str(response.get("event_type", "unknown")))

    return PublishSummary(endpoint=endpoint, accepted_count=len(event_types), event_types=event_types)


def publish_events_bulk(
    events: Iterable[dict[str, object]],
    *,
    api_base: str,
    post_json: PostJsonBatch | None = None,
) -> PublishSummary:
    endpoint = collector_events_bulk_endpoint(api_base)
    batch = list(events)
    sender = post_json or _post_json_batch
    response = sender(endpoint, batch)
    if response.get("accepted") is not True:
        raise PublishError(f"Collector event batch rejected by {endpoint}: {response}")
    event_types = [str(event_type) for event_type in response.get("event_types", [])]
    accepted_count = int(response.get("accepted_count", len(event_types)))
    return PublishSummary(endpoint=endpoint, accepted_count=accepted_count, event_types=event_types)


def main(argv: Sequence[str] | None = None, *, post_json: PostJson | None = None) -> None:
    parser = argparse.ArgumentParser(description="Publish a mock GammaScope collector cycle to FastAPI.")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--spot", type=float, required=True)
    parser.add_argument("--expiry", required=True)
    parser.add_argument("--strikes", required=True, help="Comma-separated strike list, for example 5190,5200,5210")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    events = build_mock_cycle(spot=args.spot, expiry=args.expiry, strikes=_parse_strikes(args.strikes))
    summary = publish_events(events, api_base=args.api, post_json=post_json)
    print(json.dumps(summary.as_dict(), separators=(",", ":"), sort_keys=True))


def _post_json(endpoint: str, event: dict[str, object]) -> dict[str, Any]:
    body = json.dumps(event).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise PublishError(f"HTTP {exc.code} from {endpoint}: {detail}") from exc
    except URLError as exc:
        raise PublishError(f"Could not reach collector ingestion endpoint {endpoint}: {exc.reason}") from exc


def _post_json_batch(endpoint: str, events: list[dict[str, object]]) -> dict[str, Any]:
    body = json.dumps(events).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise PublishError(f"HTTP {exc.code} from {endpoint}: {detail}") from exc
    except URLError as exc:
        raise PublishError(f"Could not reach collector bulk ingestion endpoint {endpoint}: {exc.reason}") from exc


def _parse_strikes(value: str) -> list[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
