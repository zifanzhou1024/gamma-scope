import React from "react";
import type { SavedView } from "../lib/clientSavedViewsSource";

interface SavedViewsPanelProps {
  savedViews: SavedView[];
  viewName: string;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  onViewNameChange: (value: string) => void;
  onSaveView: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function SavedViewsPanel({
  savedViews,
  viewName,
  isLoading,
  isSaving,
  errorMessage,
  onViewNameChange,
  onSaveView
}: SavedViewsPanelProps) {
  const recentViews = savedViews.slice(-3).reverse();

  return (
    <section className="savedViewsPanel" aria-label="Saved views">
      <form className="savedViewsForm" onSubmit={onSaveView}>
        <label>
          <span>View name</span>
          <input
            type="text"
            value={viewName}
            onChange={(event) => onViewNameChange(event.target.value)}
            placeholder="SPX live review"
          />
        </label>
        <button type="submit" disabled={isSaving}>{isSaving ? "Saving" : "Save current view"}</button>
      </form>
      <div className="savedViewsList" aria-label="Recent saved views">
        <span className="eyebrow">Saved views</span>
        {isLoading ? (
          <p>Loading saved views.</p>
        ) : recentViews.length > 0 ? (
          <ul>
            {recentViews.map((view) => (
              <li key={view.view_id}>
                <strong>{view.name}</strong>
                <span>{view.mode} · {view.strike_window.levels_each_side} strikes</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No saved views yet.</p>
        )}
      </div>
      {errorMessage ? <p className="panelError">{errorMessage}</p> : null}
    </section>
  );
}
