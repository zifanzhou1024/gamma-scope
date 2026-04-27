export const DATA_SOURCE_STORAGE_KEY = "gammascope:data-source";
export const DATA_SOURCE_OPTIONS = ["moomoo", "ibkr"] as const;
export const DEFAULT_DATA_SOURCE = "moomoo" satisfies DataSourcePreference;

export type DataSourcePreference = (typeof DATA_SOURCE_OPTIONS)[number];

export function isDataSourcePreference(value: unknown): value is DataSourcePreference {
  return typeof value === "string" && DATA_SOURCE_OPTIONS.includes(value as DataSourcePreference);
}

export function loadDataSourcePreference(storage: Pick<Storage, "getItem"> | null | undefined): DataSourcePreference {
  const value = storage?.getItem(DATA_SOURCE_STORAGE_KEY);
  return isDataSourcePreference(value) ? value : DEFAULT_DATA_SOURCE;
}

export function saveDataSourcePreference(
  value: DataSourcePreference,
  storage: Pick<Storage, "setItem"> | null | undefined
): void {
  storage?.setItem(DATA_SOURCE_STORAGE_KEY, value);
}

export function formatDataSourcePreference(value: DataSourcePreference): string {
  return value === "moomoo" ? "Moomoo" : "IBKR";
}
