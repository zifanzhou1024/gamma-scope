import React, { useState } from "react";

export interface AdminLoginPanelProps {
  isAuthenticated: boolean;
  isAvailable: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onLogin(username: string, password: string): void;
  onLogout(): void;
}

export function AdminLoginPanel({
  isAuthenticated,
  isAvailable,
  isSubmitting,
  errorMessage,
  onLogin,
  onLogout
}: AdminLoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (isAuthenticated) {
    return (
      <section className="adminPanel" aria-label="Admin session">
        <div className="adminPanelHeader">
          <span className="eyebrow">Admin</span>
          <strong>Authenticated</strong>
        </div>
        <button type="button" className="secondaryButton" disabled={isSubmitting} onClick={onLogout}>
          {isSubmitting ? "Logging out" : "Log out"}
        </button>
        {errorMessage ? <p className="importMessage importMessage-error" role="alert">{errorMessage}</p> : null}
      </section>
    );
  }

  if (!isAvailable) {
    return (
      <section className="adminPanel" aria-label="Admin session">
        <div className="adminPanelHeader">
          <span className="eyebrow">Admin</span>
          <strong>Unavailable</strong>
        </div>
        <p className="importMessage importMessage-warning" role="status">
          {errorMessage ?? "Admin login unavailable"}
        </p>
      </section>
    );
  }

  return (
    <section className="adminPanel" aria-label="Admin session">
      <form
        className="adminLoginForm"
        onSubmit={(event) => {
          event.preventDefault();
          onLogin(username, password);
        }}
      >
        <span className="eyebrow">Admin</span>
        <label>
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            disabled={isSubmitting}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={isSubmitting}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in" : "Log in"}
        </button>
        {errorMessage ? <p className="importMessage importMessage-error" role="alert">{errorMessage}</p> : null}
      </form>
    </section>
  );
}
