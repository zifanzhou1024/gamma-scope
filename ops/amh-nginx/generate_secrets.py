#!/usr/bin/env python3
from __future__ import annotations

import argparse
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path


DEFAULT_DOMAIN = "gamma.hiqjj.org"


@dataclass(frozen=True)
class SecretValues:
    postgres_password: str
    admin_token: str
    web_admin_password: str
    web_admin_session_secret: str


def generate_secret_values() -> SecretValues:
    return SecretValues(
        postgres_password=secrets.token_hex(24),
        admin_token=secrets.token_hex(32),
        web_admin_password=secrets.token_hex(24),
        web_admin_session_secret=secrets.token_urlsafe(48),
    )


def render_server_env(values: SecretValues, *, domain: str = DEFAULT_DOMAIN) -> str:
    origin = _https_origin(domain)
    return "\n".join(
        [
            f"GAMMASCOPE_PUBLIC_ORIGIN={origin}",
            "",
            "GAMMASCOPE_POSTGRES_DB=gammascope",
            "GAMMASCOPE_POSTGRES_USER=gammascope",
            f"GAMMASCOPE_POSTGRES_PASSWORD={values.postgres_password}",
            "",
            "GAMMASCOPE_PRIVATE_MODE_ENABLED=true",
            f"GAMMASCOPE_ADMIN_TOKEN={values.admin_token}",
            "",
            "GAMMASCOPE_WEB_ADMIN_USERNAME=admin",
            f"GAMMASCOPE_WEB_ADMIN_PASSWORD={values.web_admin_password}",
            f"GAMMASCOPE_WEB_ADMIN_SESSION_SECRET={values.web_admin_session_secret}",
            "",
            "GAMMASCOPE_API_HOST_PORT=8000",
            "GAMMASCOPE_WEB_HOST_PORT=3000",
            "GAMMASCOPE_REPLAY_CAPTURE_INTERVAL_SECONDS=5",
            "GAMMASCOPE_REPLAY_RETENTION_DAYS=20",
            "GAMMASCOPE_SAVED_VIEW_RETENTION_DAYS=90",
            "GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES=104857600",
            "",
        ]
    )


def render_collector_env(values: SecretValues, *, domain: str = DEFAULT_DOMAIN) -> str:
    origin = _https_origin(domain)
    return "\n".join(
        [
            f"GAMMASCOPE_SERVER_API={origin}",
            f"GAMMASCOPE_ADMIN_TOKEN={values.admin_token}",
            "GAMMASCOPE_MOOMOO_HOST=127.0.0.1",
            "GAMMASCOPE_MOOMOO_PORT=11111",
            "GAMMASCOPE_RUT_SPOT=2050",
            "GAMMASCOPE_NDX_SPOT=18300",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate GammaScope AMH deployment secrets.")
    parser.add_argument("--domain", default=DEFAULT_DOMAIN, help=f"Public HTTPS domain. Default: {DEFAULT_DOMAIN}")
    parser.add_argument("--server-output", type=Path, help="Path to write gammascope.production.env.")
    parser.add_argument("--collector-output", type=Path, help="Path to write gammascope.collector-client.env.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output files.")
    parser.add_argument("--print", dest="print_env", action="store_true", help="Print generated env files to stdout.")
    args = parser.parse_args(argv)

    values = generate_secret_values()
    server_env = render_server_env(values, domain=args.domain)
    collector_env = render_collector_env(values, domain=args.domain)

    try:
        if args.server_output is not None:
            _write_output(args.server_output, server_env, force=args.force)
            print(f"wrote server env: {args.server_output}")
        if args.collector_output is not None:
            _write_output(args.collector_output, collector_env, force=args.force)
            print(f"wrote collector env: {args.collector_output}")
    except FileExistsError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.print_env or (args.server_output is None and args.collector_output is None):
        print("# gammascope.production.env")
        print(server_env, end="")
        print("# gammascope.collector-client.env")
        print(collector_env, end="")

    if args.server_output is not None or args.collector_output is not None:
        print("web admin username: admin")
        print(f"web admin password: {values.web_admin_password}")
        print(f"collector admin token: {values.admin_token}")

    return 0


def _https_origin(domain: str) -> str:
    normalized = domain.strip().rstrip("/")
    if not normalized:
        raise ValueError("domain must be non-empty")
    if normalized.startswith(("http://", "https://")):
        return normalized
    return f"https://{normalized}"


def _write_output(path: Path, content: str, *, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"{path} already exists; pass --force to overwrite it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


if __name__ == "__main__":
    raise SystemExit(main())
