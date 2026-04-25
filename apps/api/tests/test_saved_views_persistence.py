from __future__ import annotations

from uuid import uuid4

import pytest

from gammascope_api.saved_views.repository import PostgresSavedViewRepository


TEST_DATABASE_URL = "postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope"


@pytest.fixture()
def saved_view_repository() -> tuple[PostgresSavedViewRepository, list[str]]:
    repo = PostgresSavedViewRepository(TEST_DATABASE_URL)
    try:
        repo.ensure_schema()
    except Exception as exc:
        pytest.skip(f"Postgres saved view persistence is unavailable: {exc}")

    view_ids: list[str] = []
    yield repo, view_ids

    for view_id in view_ids:
        repo.delete_view(view_id)


def test_repository_upserts_saved_view_and_lists_newest_first(
    saved_view_repository: tuple[PostgresSavedViewRepository, list[str]],
) -> None:
    repo, view_ids = saved_view_repository
    older_id = f"pytest-view-older-{uuid4()}"
    newer_id = f"pytest-view-newer-{uuid4()}"
    view_ids.extend([older_id, newer_id])

    repo.save_view(_view(older_id, "Older view", "2026-04-23T16:00:00Z"))
    repo.save_view(_view(newer_id, "Newer view", "2026-04-24T16:00:00Z"))

    views = [view for view in repo.list_views() if view["view_id"] in view_ids]

    assert [view["view_id"] for view in views] == [newer_id, older_id]


def test_repository_updates_existing_view_id_without_duplication(
    saved_view_repository: tuple[PostgresSavedViewRepository, list[str]],
) -> None:
    repo, view_ids = saved_view_repository
    view_id = f"pytest-view-update-{uuid4()}"
    view_ids.append(view_id)

    repo.save_view(_view(view_id, "Original name", "2026-04-23T16:00:00Z"))
    updated = repo.save_view(_view(view_id, "Updated name", "2026-04-24T16:00:00Z", mode="scenario"))
    matches = [view for view in repo.list_views() if view["view_id"] == view_id]

    assert updated["name"] == "Updated name"
    assert updated["mode"] == "scenario"
    assert updated["created_at"] == "2026-04-24T16:00:00Z"
    assert len(matches) == 1
    assert matches[0]["name"] == "Updated name"


def _view(view_id: str, name: str, created_at: str, *, mode: str = "replay") -> dict[str, object]:
    return {
        "view_id": view_id,
        "owner_scope": "public_demo",
        "name": name,
        "mode": mode,
        "strike_window": {"levels_each_side": 20},
        "visible_charts": ["iv_smile", "gamma_by_strike"],
        "created_at": created_at,
    }
