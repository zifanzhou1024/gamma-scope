import type { AnalyticsSnapshot } from "../src/generated/analytics-snapshot";
import type { CollectorEvents } from "../src/generated/collector-events";
import type { SavedView } from "../src/generated/saved-view";
import type { ScenarioRequest } from "../src/generated/scenario";

type _SnapshotSchemaVersion = AnalyticsSnapshot["schema_version"];
type _CollectorEvent = CollectorEvents;
type _ScenarioShift = ScenarioRequest["vol_shift_points"];
type _SavedViewMode = SavedView["mode"];
