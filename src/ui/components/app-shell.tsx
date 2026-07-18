import type { ReactNode } from "react";

type Section = "dashboard" | "create";

interface AppShellProps {
  current: Section;
  children: ReactNode;
  onDashboard: () => void;
  onCreate: () => void;
  onSignOut?: () => void;
}

function Brand() {
  return (
    <div className="brand" aria-label="EverQR">
      <span className="brand__mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>EverQR</span>
    </div>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function AppShell({ current, children, onDashboard, onCreate, onSignOut }: AppShellProps) {
  return (
    <div className="app-frame">
      <aside className="side-rail">
        <Brand />
        <p className="side-rail__eyebrow">Durable link registry</p>
        <nav aria-label="Primary" className="primary-nav">
          <button className={current === "dashboard" ? "is-current" : ""} type="button" onClick={onDashboard}>
            <GridIcon />
            Dashboard
          </button>
          <button className={current === "create" ? "is-current" : ""} type="button" onClick={onCreate}>
            <PlusIcon />
            Create QR
          </button>
        </nav>
        <div className="side-rail__footer">
          <p><span className="pulse-dot" /> Private admin</p>
          {onSignOut ? <button className="text-button" type="button" onClick={onSignOut}>Sign out</button> : null}
        </div>
      </aside>
      <div className="mobile-header">
        <Brand />
        <nav aria-label="Compact navigation">
          <button className={current === "dashboard" ? "is-current" : ""} type="button" onClick={onDashboard}>Registry</button>
          <button className={current === "create" ? "is-current" : ""} type="button" onClick={onCreate}>Create</button>
        </nav>
      </div>
      <main className="app-main">{children}</main>
    </div>
  );
}
