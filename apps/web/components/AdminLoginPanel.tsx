import React, { useState } from "react";

export const ADMIN_LOGIN_POPOVER_ID = "admin-login-popover";

export interface AdminLoginPanelProps {
  isAuthenticated: boolean;
  isAvailable: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onLogin(username: string, password: string): void;
  onLogout(): void;
}

export function isAdminPopoverDismissKey(key: string): boolean {
  return key === "Escape";
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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <div className="adminUtility" aria-label="Admin session">
        <span className="adminUtilityStatus">Admin Authenticated</span>
        <button type="button" className="adminUtilityTrigger" disabled={isSubmitting} onClick={onLogout}>
          {isSubmitting ? "Logging out" : "Log out"}
        </button>
        {errorMessage ? <p className="importMessage importMessage-error" role="alert">{errorMessage}</p> : null}
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="adminUtility" aria-label="Admin session">
        <button type="button" className="adminUtilityTrigger" disabled>
          Admin unavailable
        </button>
        <p className="importMessage importMessage-warning" role="status">
          {errorMessage ?? "Admin login unavailable"}
        </p>
      </div>
    );
  }

  return (
    <div
      className="adminUtility"
      aria-label="Admin session"
      onKeyDown={(event) => {
        if (isAdminPopoverDismissKey(event.key)) {
          setIsPopoverOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="adminUtilityTrigger"
        aria-expanded={isPopoverOpen}
        aria-controls={ADMIN_LOGIN_POPOVER_ID}
        aria-haspopup="dialog"
        onClick={() => setIsPopoverOpen((currentValue) => !currentValue)}
      >
        Admin
      </button>
      {isPopoverOpen ? (
        <section id={ADMIN_LOGIN_POPOVER_ID} className="adminPopover" aria-label="Admin login">
          <form
            className="adminLoginForm"
            onSubmit={(event) => {
              event.preventDefault();
              onLogin(username, password);
            }}
          >
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
      ) : null}
    </div>
  );
}
