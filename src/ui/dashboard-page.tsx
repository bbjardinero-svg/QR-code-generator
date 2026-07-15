import { useCallback, useEffect, useState } from "react";
import type { DashboardApi, QrDto, QrStatus, SummaryDto } from "./api";
import { AppShell } from "./components/app-shell";
import { QrList } from "./components/qr-list";
import { StatusMessage } from "./components/status-message";

interface DashboardPageProps {
  api: DashboardApi;
  onCreate: () => void;
  onOpenQr: (id: string) => void;
  onSignOut?: () => void;
}

const R2_REFERENCE_BYTES = 10_000_000_000;

function formatStorage(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} GB`;
}

export function DashboardPage({ api, onCreate, onOpenQr, onSignOut }: DashboardPageProps) {
  const [summary, setSummary] = useState<SummaryDto | null>(null);
  const [items, setItems] = useState<QrDto[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<QrStatus | undefined>();
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [nextSummary, nextItems] = await Promise.all([
        api.getSummary(),
        api.listQr({ search: search.trim() || undefined, status }),
      ]);
      setSummary(nextSummary);
      setItems(nextItems);
    } catch {
      setError(true);
    }
  }, [api, reloadKey, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = () => setReloadKey((value) => value + 1);

  return (
    <AppShell current="dashboard" onDashboard={() => undefined} onCreate={onCreate} onSignOut={onSignOut}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Management overview</p>
          <h1>Your QR registry</h1>
          <p>Stable public routes, current destinations, and scan activity in one place.</p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}>Create QR code</button>
      </header>

      {error ? (
        <StatusMessage
          title="Could not load your QR registry"
          message="Check your connection, then try again. No QR codes were changed."
          actionLabel="Try again"
          onAction={retry}
          role="alert"
        />
      ) : !summary || !items ? (
        <section className="dashboard-loading" aria-label="Loading dashboard" aria-live="polite">
          <div /><div /><div />
          <span>Loading your registry…</span>
        </section>
      ) : (
        <>
          <section className="ledger" aria-label="QR summary">
            <article><span>QR codes</span><strong>{summary.totalQrCodes}</strong><small>{summary.activeQrCodes} active · {summary.archivedQrCodes} archived</small></article>
            <article><span>Total scans</span><strong>{summary.totalScans.toLocaleString()}</strong><small>Across all durable routes</small></article>
            <article className="storage-card">
              <span>Private R2 storage</span><strong>{formatStorage(summary.storageBytes)}</strong>
              <div
                className="storage-meter"
                role="progressbar"
                aria-label="R2 storage"
                aria-valuemin={0}
                aria-valuemax={R2_REFERENCE_BYTES}
                aria-valuenow={summary.storageBytes}
              ><i style={{ width: `${Math.min(100, (summary.storageBytes / R2_REFERENCE_BYTES) * 100)}%` }} /></div>
              <small>{formatStorage(summary.storageBytes)} of 10 GB reference</small>
            </article>
          </section>

          <section className="registry-section" aria-labelledby="registry-title">
            <div className="registry-toolbar">
              <div>
                <p className="eyebrow">Durable routes</p>
                <h2 id="registry-title">Managed QR codes</h2>
              </div>
              <div className="filters">
                <label>
                  <span>Search QR codes</span>
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or short link" />
                </label>
                <label>
                  <span>Status</span>
                  <select value={status ?? ""} onChange={(event) => setStatus((event.target.value || undefined) as QrStatus | undefined)}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>
            </div>

            {items.length > 0 ? (
              <QrList items={items} onOpen={onOpenQr} />
            ) : search || status ? (
              <StatusMessage title="No matching QR codes" message="Clear the search or choose another status to see more of your registry." />
            ) : (
              <section className="empty-registry">
                <span className="empty-registry__route" aria-hidden="true">/r/first-code</span>
                <h2>No QR codes yet</h2>
                <p>Create a stable route for a public link or a file in your private R2 storage.</p>
                <button className="button button--primary" type="button" onClick={onCreate}>Create your first QR</button>
              </section>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
