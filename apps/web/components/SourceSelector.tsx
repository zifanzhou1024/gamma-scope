import React from "react";
import type { DataSourcePreference } from "../lib/sourcePreference";
import { DATA_SOURCE_OPTIONS, formatDataSourcePreference } from "../lib/sourcePreference";

interface SourceSelectorProps {
  value: DataSourcePreference;
  onChange: (value: DataSourcePreference) => void;
}

export function SourceSelector({ value, onChange }: SourceSelectorProps) {
  return (
    <label className="sourceSelector">
      <span>Data source</span>
      <select
        aria-label="Data source"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as DataSourcePreference)}
      >
        {DATA_SOURCE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {formatDataSourcePreference(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
