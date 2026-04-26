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


def test_repository_cleanup_old_saved_views(
    saved_view_repository: tuple[PostgresSavedViewRepository, list[str]],
) -> None:
    repo, view_ids = saved_view_repository
    cleanup_prefix = f"pytest-cleanup-view-{uuid4()}"
    old_id = f"{cleanup_prefix}-old"
    new_id = f"{cleanup_prefix}-new"
    unrelated_old_id = f"pytest-unrelated-view-old-{uuid4()}"
    view_ids.extend([old_id, new_id, unrelated_old_id])

    repo.save_view(_view(old_id, "Old view", "2026-01-01T16:00:00Z"))
    repo.save_view(_view(new_id, "New view", "2026-04-24T16:00:00Z"))
    repo.save_view(_view(unrelated_old_id, "Unrelated old view", "2026-01-01T16:30:00Z"))

    dry_run = repo.cleanup_before("2026-04-01T00:00:00Z", dry_run=True, view_id_prefix=cleanup_prefix)
    assert dry_run == 1
    assert {view["view_id"] for view in repo.list_views()} >= {old_id, new_id, unrelated_old_id}

    deleted = repo.cleanup_before("2026-04-01T00:00:00Z", dry_run=False, view_id_prefix=cleanup_prefix)

    remaining_ids = {view["view_id"] for view in repo.list_views()}
    assert deleted == 1
    assert old_id not in remaining_ids
    assert new_id in remaining_ids
    assert unrelated_old_id in remaining_ids


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
