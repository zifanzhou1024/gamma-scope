from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from gammascope_collector.mock_source import build_mock_cycle


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Emit a mock GammaScope collector cycle as JSONL.")
    parser.add_argument("--spot", type=float, required=True)
    parser.add_argument("--expiry", required=True)
    parser.add_argument("--strikes", required=True, help="Comma-separated strike list, for example 5190,5200,5210")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    for event in build_mock_cycle(spot=args.spot, expiry=args.expiry, strikes=_parse_strikes(args.strikes)):
        print(json.dumps(event, separators=(",", ":"), sort_keys=True))


def _parse_strikes(value: str) -> list[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
