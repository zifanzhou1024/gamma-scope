import React from "react";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatStatusLabel } from "../../lib/dashboardMetrics";

type ExperimentalPanelStatus = ExperimentalAnalytics["forwardSummary"]["status"];
type ExperimentalDiagnostic = ExperimentalAnalytics["forwardSummary"]["diagnostics"][number];

interface ExperimentalPanelProps {
  title: string;
  description?: string;
  status?: ExperimentalPanelStatus;
  diagnostics?: ExperimentalDiagnostic[];
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function ExperimentalPanel({
  title,
  description,
  status,
  diagnostics = [],
  ariaLabel,
  className = "",
  children
}: ExperimentalPanelProps) {
  const classNames = ["experimentalPanel", className].filter(Boolean).join(" ");

  return (
    <section className={classNames} aria-label={ariaLabel ?? title}>
      <header className="experimentalPanelHeader">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {status ? <span className={`experimentalStatus experimentalStatus-${status}`}>{formatStatusLabel(status)}</span> : null}
      </header>
      <div className="experimentalPanelBody">{children}</div>
      {diagnostics.length > 0 ? (
        <ul className="experimentalDiagnostics" aria-label={`${title} diagnostics`}>
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.message}`} className={`experimentalDiagnostic-${diagnostic.severity}`}>
              <strong>{formatStatusLabel(diagnostic.severity)}</strong>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
