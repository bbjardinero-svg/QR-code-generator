import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { DetailApi, QrDto, ScanSeriesDto, StoredFileDto } from "./api";
import { AppShell } from "./components/app-shell";
import { ConfirmDialog } from "./components/confirm-dialog";
import { FileUpload } from "./components/file-upload";
import { QrPreview } from "./components/qr-preview";
import { ScanChart } from "./components/scan-chart";
import { StatusMessage } from "./components/status-message";

interface DetailPageProps {
  qrId: string;
  api: DetailApi;
  onBack: () => void;
  onDeleted: () => void;
  onCreate?: () => void;
  onSignOut?: () => void;
}

function formatFileSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))} KB` : `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}

export function DetailPage({ qrId, api, onBack, onDeleted, onCreate = () => undefined, onSignOut }: DetailPageProps) {
  const [qr, setQr] = useState<QrDto | null>(null);
  const [scans, setScans] = useState<ScanSeriesDto | null>(null);
  const [storedFile, setStoredFile] = useState<StoredFileDto | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [replacement, setReplacement] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextQr, nextScans] = await Promise.all([api.getQr(qrId), api.getScans(qrId, 30)]);
      setQr(nextQr);
      setScans(nextScans);
      setName(nextQr.name);
      setDescription(nextQr.description ?? "");
      setDestinationUrl(nextQr.destinationUrl ?? "");
      if (nextQr.storedFileId) setStoredFile(await api.getFile(nextQr.storedFileId));
    } catch {
      setError("This QR code could not be loaded. Check the connection and try again.");
    }
  }, [api, qrId]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!qr) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.updateQr(qr.id, {
        name: name.trim(),
        description: description.trim() || null,
        ...(qr.contentType === "url" ? { destinationUrl } : {}),
      });
      setQr({ ...qr, ...updated, publicUrl: qr.publicUrl, slug: qr.slug });
      setSuccess("Changes saved. The stable public address did not change.");
    } catch {
      setError("Changes were not saved. Check the fields and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!qr) return;
    setBusy(true);
    setError(null);
    try {
      const updated = qr.status === "active" ? await api.archiveQr(qr.id) : await api.restoreQr(qr.id);
      setQr({ ...qr, ...updated, publicUrl: qr.publicUrl });
      setSuccess(updated.status === "archived" ? "QR archived. Its public route is now unavailable." : "QR restored and available again.");
    } catch {
      setError("The QR status could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function replaceFile() {
    if (!qr || !replacement) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const finalized = await api.uploadFile(replacement, setUploadProgress);
      await api.replaceFile(qr.id, finalized.id);
      setStoredFile(finalized);
      setReplacement(null);
      setSuccess("Stored file replaced. The stable address and scan history were preserved.");
    } catch {
      setError("The replacement did not finish. The previous file is still active; retry when ready.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDelete() {
    if (!qr) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteQr(qr.id);
      onDeleted();
    } catch {
      setError("The QR code was not deleted. Its current state is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !qr) {
    return <AppShell current="dashboard" onDashboard={onBack} onCreate={onCreate} onSignOut={onSignOut}><StatusMessage title="QR code unavailable" message={error} actionLabel="Try again" onAction={() => void load()} role="alert" /></AppShell>;
  }
  if (!qr || !scans) {
    return <AppShell current="dashboard" onDashboard={onBack} onCreate={onCreate} onSignOut={onSignOut}><section className="detail-loading" aria-label="Loading QR details">Loading QR details…</section></AppShell>;
  }

  return (
    <AppShell current="dashboard" onDashboard={onBack} onCreate={onCreate} onSignOut={onSignOut}>
      <header className="detail-header">
        <button className="back-link" type="button" onClick={onBack}>← Back to registry</button>
        <div className="detail-header__title">
          <div><p className="eyebrow">{qr.contentType === "url" ? "Web link" : "Private R2 file"} · {qr.status}</p><h1>{qr.name}</h1></div>
          <div className="detail-header__actions">
            <button className="button button--secondary" type="button" onClick={() => void toggleArchive()} disabled={busy}>{qr.status === "active" ? "Archive QR" : "Restore QR"}</button>
            <button className="danger-link" type="button" onClick={() => setConfirmDelete(true)}>Delete permanently</button>
          </div>
        </div>
        <div className="route-banner"><span>Stable route</span><code>/r/{qr.slug}</code><small>Created {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(qr.createdAt))}</small></div>
      </header>

      {error ? <p className="form-error detail-flash" role="alert">{error}</p> : null}
      {success ? <p className="success-message detail-flash" role="status">{success}</p> : null}

      <div className="detail-grid">
        <section className="detail-card detail-card--form">
          <div className="card-heading"><p className="eyebrow">Current content</p><h2>Destination and label</h2><p>Edits here preserve the printed QR and all scan history.</p></div>
          <form onSubmit={save} className="detail-form">
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
            <label>Internal description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} /></label>
            {qr.contentType === "url" ? (
              <label>Destination web address<input type="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} required /></label>
            ) : storedFile ? (
              <div className="current-file">
                <span aria-hidden="true">PDF</span>
                <div><strong>{storedFile.originalName}</strong><small>{storedFile.mediaType} · {formatFileSize(storedFile.sizeBytes)}</small></div>
              </div>
            ) : null}
            <button className="button button--primary" type="submit" disabled={busy}>Save changes</button>
          </form>

          {qr.contentType === "file" ? (
            <section className="replacement-section" aria-labelledby="replacement-title">
              <div><h3 id="replacement-title">Replace stored file</h3><p>The old file stays active until the new one is uploaded and verified.</p></div>
              <FileUpload file={replacement} onFile={(next) => { setReplacement(next); setUploadProgress(null); }} inputLabel="Choose replacement file" progress={uploadProgress} disabled={busy} />
              <button className="button button--secondary" type="button" onClick={() => void replaceFile()} disabled={!replacement || busy}>Replace stored file</button>
            </section>
          ) : null}
        </section>

        <aside className="detail-card detail-card--preview">
          <p className="eyebrow">Print and share</p>
          <QrPreview value={qr.publicUrl} color={qr.foregroundColor} name={qr.name} qrId={qr.id} />
          <a className="preview-link" href={`/api/qr/${qr.id}/preview`} target="_blank" rel="noreferrer">Open non-counting preview ↗</a>
        </aside>

        <ScanChart total={scans.total} series={scans.series} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        name={qr.name}
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={permanentlyDelete}
      />
    </AppShell>
  );
}
