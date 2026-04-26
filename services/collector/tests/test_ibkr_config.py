import pytest

from gammascope_collector.ibkr_config import IbkrHealthConfig, ibkr_health_config_from_env


def test_ibkr_health_config_defaults() -> None:
    config = ibkr_health_config_from_env({})

    assert config == IbkrHealthConfig(
        host="127.0.0.1",
        port=7497,
        client_id=7,
        collector_id="local-ibkr",
        account_mode="paper",
        api_base="http://127.0.0.1:8000",
        timeout_seconds=2.0,
    )


def test_ibkr_health_config_parses_env_overrides() -> None:
    config = ibkr_health_config_from_env(
        {
            "GAMMASCOPE_IBKR_HOST": " localhost ",
            "GAMMASCOPE_IBKR_PORT": "4002",
            "GAMMASCOPE_IBKR_CLIENT_ID": "11",
            "GAMMASCOPE_COLLECTOR_ID": " probe-a ",
            "GAMMASCOPE_IBKR_ACCOUNT_MODE": "live",
            "GAMMASCOPE_API_BASE_URL": "http://testserver",
            "GAMMASCOPE_IBKR_TIMEOUT_SECONDS": "0.25",
        }
    )

    assert config == IbkrHealthConfig(
        host="localhost",
        port=4002,
        client_id=11,
        collector_id="probe-a",
        account_mode="live",
        api_base="http://testserver",
        timeout_seconds=0.25,
    )


@pytest.mark.parametrize(
    ("name", "value", "expected"),
    [
        ("GAMMASCOPE_IBKR_PORT", "0", "port"),
        ("GAMMASCOPE_IBKR_PORT", "65536", "port"),
        ("GAMMASCOPE_IBKR_PORT", "abc", "GAMMASCOPE_IBKR_PORT"),
        ("GAMMASCOPE_IBKR_CLIENT_ID", "-1", "client_id"),
        ("GAMMASCOPE_IBKR_CLIENT_ID", "abc", "GAMMASCOPE_IBKR_CLIENT_ID"),
        ("GAMMASCOPE_IBKR_TIMEOUT_SECONDS", "0", "timeout_seconds"),
        ("GAMMASCOPE_IBKR_TIMEOUT_SECONDS", "nan", "timeout_seconds"),
        ("GAMMASCOPE_IBKR_TIMEOUT_SECONDS", "inf", "timeout_seconds"),
        ("GAMMASCOPE_IBKR_TIMEOUT_SECONDS", "abc", "GAMMASCOPE_IBKR_TIMEOUT_SECONDS"),
        ("GAMMASCOPE_IBKR_ACCOUNT_MODE", "demo", "account_mode"),
        ("GAMMASCOPE_IBKR_HOST", "   ", "host"),
        ("GAMMASCOPE_COLLECTOR_ID", "   ", "collector_id"),
        ("GAMMASCOPE_API_BASE_URL", "   ", "api_base"),
    ],
)
def test_ibkr_health_config_rejects_invalid_values(name: str, value: str, expected: str) -> None:
    with pytest.raises(ValueError, match=expected):
        ibkr_health_config_from_env({name: value})
