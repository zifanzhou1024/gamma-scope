from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "ops" / "amh-nginx" / "generate_secrets.py"


def test_render_env_files_share_domain_and_admin_token() -> None:
    module = _load_generate_secrets_module()
    values = module.SecretValues(
        postgres_password="postgres-secret",
        admin_token="admin-secret",
        web_admin_password="web-secret",
        web_admin_session_secret="session-secret",
    )

    server_env = module.render_server_env(values, domain="gamma.hiqjj.org")
    collector_env = module.render_collector_env(values, domain="gamma.hiqjj.org")

    assert "GAMMASCOPE_PUBLIC_ORIGIN=https://gamma.hiqjj.org" in server_env
    assert "GAMMASCOPE_SERVER_API=https://gamma.hiqjj.org" in collector_env
    assert "GAMMASCOPE_ADMIN_TOKEN=admin-secret" in server_env
    assert "GAMMASCOPE_ADMIN_TOKEN=admin-secret" in collector_env
    assert "GAMMASCOPE_WEB_ADMIN_PASSWORD=web-secret" in server_env
    assert "GAMMASCOPE_WEB_ADMIN_SESSION_SECRET=session-secret" in server_env


def test_cli_writes_env_files_and_refuses_overwrite(tmp_path: Path) -> None:
    server_env = tmp_path / "gammascope.production.env"
    collector_env = tmp_path / "gammascope.collector-client.env"

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--server-output",
            str(server_env),
            "--collector-output",
            str(collector_env),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "wrote server env" in result.stdout
    assert "wrote collector env" in result.stdout

    server_text = server_env.read_text(encoding="utf-8")
    collector_text = collector_env.read_text(encoding="utf-8")
    admin_token = _env_value(server_text, "GAMMASCOPE_ADMIN_TOKEN")

    assert _env_value(server_text, "GAMMASCOPE_PUBLIC_ORIGIN") == "https://gamma.hiqjj.org"
    assert _env_value(collector_text, "GAMMASCOPE_SERVER_API") == "https://gamma.hiqjj.org"
    assert _env_value(collector_text, "GAMMASCOPE_ADMIN_TOKEN") == admin_token

    overwrite_result = subprocess.run(
        [sys.executable, str(SCRIPT), "--server-output", str(server_env)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert overwrite_result.returncode == 2
    assert "already exists" in overwrite_result.stderr


def _load_generate_secrets_module():
    spec = importlib.util.spec_from_file_location("generate_secrets", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _env_value(env_text: str, name: str) -> str:
    prefix = f"{name}="
    for line in env_text.splitlines():
        if line.startswith(prefix):
            return line.removeprefix(prefix)
    raise AssertionError(f"{name} not found")
