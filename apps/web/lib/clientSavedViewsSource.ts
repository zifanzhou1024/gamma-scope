import type { SavedView } from "@gammascope/contracts/saved-view";
import type { AnalyticsSnapshot } from "./contracts";

const SAVED_VIEWS_PATH = "/api/views";
const DEFAULT_VISIBLE_CHARTS: SavedView["visible_charts"] = ["iv_smile", "gamma_by_strike", "vanna_by_strike"];

type SavedViewsFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientSavedViewsOptions = {
  fetcher?: SavedViewsFetcher;
};

type SaveClientSavedViewOptions = {
  fetcher?: SavedViewsFetcher;
};

export interface SavedViewDraftOptions {
  name: string;
  viewId: string;
  createdAt: string;
  ownerScope?: SavedView["owner_scope"];
  levelsEachSide?: number;
}

export function createSavedViewDraft(snapshot: AnalyticsSnapshot, options: SavedViewDraftOptions): SavedView {
  return {
    view_id: options.viewId,
    owner_scope: options.ownerScope ?? "public_demo",
    name: options.name.trim(),
    mode: snapshot.mode,
    strike_window: {
      levels_each_side: options.levelsEachSide ?? 20
    },
    visible_charts: [...DEFAULT_VISIBLE_CHARTS] as SavedView["visible_charts"],
    created_at: options.createdAt
  };
}

export function isSavedViewArray(payload: unknown): payload is SavedView[] {
  return Array.isArray(payload) && payload.every(isSavedView);
}

export async function loadClientSavedViews(options: LoadClientSavedViewsOptions = {}): Promise<SavedView[]> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(SAVED_VIEWS_PATH, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return isSavedViewArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

export async function saveClientSavedView(
  view: SavedView,
  options: SaveClientSavedViewOptions = {}
): Promise<SavedView | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(SAVED_VIEWS_PATH, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(view)
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isSavedView(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isSavedView(payload: unknown): payload is SavedView {
  if (!isRecord(payload) || !isNonEmptyString(payload.view_id) || !isNonEmptyString(payload.name)) {
    return false;
  }

  if (!isOneOf(payload.owner_scope, ["public_demo", "admin"]) || !isOneOf(payload.mode, ["live", "replay", "scenario"])) {
    return false;
  }

  if (!isRecord(payload.strike_window) || !isValidLevelsEachSide(payload.strike_window.levels_each_side)) {
    return false;
  }

  return (
    Array.isArray(payload.visible_charts) &&
    payload.visible_charts.length > 0 &&
    new Set(payload.visible_charts).size === payload.visible_charts.length &&
    payload.visible_charts.every((chart) => isOneOf(chart, DEFAULT_VISIBLE_CHARTS)) &&
    isNonEmptyString(payload.created_at) &&
    Number.isFinite(Date.parse(payload.created_at))
  );
}

function isValidLevelsEachSide(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { SavedView };
