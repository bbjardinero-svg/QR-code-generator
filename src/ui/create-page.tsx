import { useMemo, useState } from "react";
import type { CreateApi, CreateQrPayload, QrContentType, StoredFileDto } from "./api";
import { AppShell } from "./components/app-shell";
import { FileUpload } from "./components/file-upload";
import { QrPreview } from "./components/qr-preview";

type Step = "content" | "design" | "review";
type QrColor = "#102f29" | "#000000" | "#1f8a70";

interface CreatePageProps {
  api: CreateApi;
  onCancel: () => void;
  onCreated: (id: string) => void;
  temporaryAddress?: boolean;
  onSignOut?: () => void;
}

const COLORS: Array<{ value: QrColor; name: string; description: string }> = [
  { value: "#102f29", name: "Forest", description: "EverQR default" },
  { value: "#000000", name: "Black", description: "Maximum contrast" },
  { value: "#1f8a70", name: "Evergreen", description: "Approved accent" },
];

function Steps({ current }: { current: Step }) {
  const order: Step[] = ["content", "design", "review"];
  const currentIndex = order.indexOf(current);
  return (
    <ol className="creator-steps" aria-label="QR creation progress">
      {order.map((step, index) => (
        <li className={index === currentIndex ? "is-current" : index < currentIndex ? "is-complete" : ""} key={step} aria-current={index === currentIndex ? "step" : undefined}>
          <span>{index + 1}</span>{step}
        </li>
      ))}
    </ol>
  );
}

export function CreatePage({ api, onCancel, onCreated, temporaryAddress = window.location.hostname.endsWith(".workers.dev"), onSignOut }: CreatePageProps) {
  const [step, setStep] = useState<Step>("content");
  const [contentType, setContentType] = useState<QrContentType>("url");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [storedFile, setStoredFile] = useState<StoredFileDto | null>(null);
  const [foregroundColor, setForegroundColor] = useState<QrColor>("#102f29");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const publicUrl = useMemo(() => `${window.location.origin}/r/${slug || "your-short-link"}`, [slug]);

  function continueFromContent() {
    setError(null);
    if (!name.trim()) return setError("Give this QR code a name.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3) {
      return setError("Use at least three lowercase letters, numbers, or hyphens for the short link.");
    }
    if (contentType === "url") {
      try {
        if (new URL(destinationUrl).protocol !== "https:") throw new Error();
      } catch {
        return setError("Enter a complete HTTPS web address.");
      }
    } else if (!file) {
      return setError("Choose one file to continue.");
    }
    setStep("design");
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      let payload: CreateQrPayload;
      if (contentType === "file") {
        if (!file) throw new Error("Missing file");
        const finalized = storedFile ?? await api.uploadFile(file, setUploadProgress);
        setStoredFile(finalized);
        payload = {
          name: name.trim(),
          slug,
          description: description.trim() || null,
          foregroundColor,
          contentType: "file",
          storedFileId: finalized.id,
        };
      } else {
        payload = {
          name: name.trim(),
          slug,
          description: description.trim() || null,
          foregroundColor,
          contentType: "url",
          destinationUrl,
        };
      }
      const created = await api.createQr(payload);
      onCreated(created.id);
    } catch {
      setError(contentType === "file"
        ? "The upload did not finish. Your details are still here—check the connection and retry creation."
        : "The QR code could not be created. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell current="create" onDashboard={onCancel} onCreate={() => undefined} onSignOut={onSignOut}>
      <header className="creator-header">
        <button className="back-link" type="button" onClick={onCancel}>← Back to registry</button>
        <div><p className="eyebrow">New durable route</p><h1>Create a QR code</h1></div>
        <Steps current={step} />
      </header>

      <div className="creator-layout">
        <section className="creator-form">
          {step === "content" ? (
            <>
              <div className="section-heading"><span>01</span><div><h2>What should this QR open?</h2><p>Choose a public HTTPS link or one file stored privately in R2.</p></div></div>
              <fieldset className="type-choice">
                <legend>Content type</legend>
                <label className={contentType === "url" ? "is-selected" : ""}>
                  <input type="radio" name="content-type" value="url" checked={contentType === "url"} onChange={() => { setContentType("url"); setError(null); }} />
                  <span aria-hidden="true">↗</span><strong>Web link</strong><small>Redirect to an HTTPS page</small>
                </label>
                <label className={contentType === "file" ? "is-selected" : ""}>
                  <input type="radio" name="content-type" value="file" checked={contentType === "file"} onChange={() => { setContentType("file"); setError(null); }} />
                  <span aria-hidden="true">▤</span><strong>Stored file</strong><small>Stream a private R2 object</small>
                </label>
              </fieldset>
              <div className="form-grid">
                <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Innovation catalogue" /></label>
                <label>Short link<div className="slug-input"><span>/r/</span><input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={80} placeholder="innovation-catalogue" /></div></label>
                <label className="form-grid__wide">Internal description <small>Optional; only visible to you</small><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} /></label>
              </div>
              {contentType === "url" ? (
                <label className="standalone-field">HTTPS web address<input type="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://example.org/resource" /></label>
              ) : (
                <FileUpload file={file} onFile={(next) => { setFile(next); setStoredFile(null); setUploadProgress(null); }} />
              )}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="creator-actions"><button className="button button--primary" type="button" onClick={continueFromContent}>Continue to design</button></div>
            </>
          ) : null}

          {step === "design" ? (
            <>
              <div className="section-heading"><span>02</span><div><h2>Choose a print-safe color</h2><p>These dark, high-contrast colors keep the QR reliable on white backgrounds.</p></div></div>
              <fieldset className="color-choice">
                <legend>QR color</legend>
                {COLORS.map((color) => (
                  <label className={foregroundColor === color.value ? "is-selected" : ""} key={color.value}>
                    <input
                      type="radio"
                      name="qr-color"
                      aria-label={`${color.name} QR color`}
                      checked={foregroundColor === color.value}
                      onChange={() => setForegroundColor(color.value)}
                    />
                    <i style={{ background: color.value }} /><strong>{color.name}</strong><small>{color.description}</small><code>{color.value}</code>
                  </label>
                ))}
              </fieldset>
              <div className="creator-actions creator-actions--split">
                <button className="button button--secondary" type="button" onClick={() => setStep("content")}>Back to content</button>
                <button className="button button--primary" type="button" onClick={() => setStep("review")}>Continue to review</button>
              </div>
            </>
          ) : null}

          {step === "review" ? (
            <>
              <div className="section-heading"><span>03</span><div><h2>Review the durable route</h2><p>The short link stays fixed; you can change its destination later.</p></div></div>
              {temporaryAddress ? <div className="address-warning" role="alert"><strong>Temporary workers.dev address</strong><p>Use this deployment for testing. Connect a domain you control before printing QR codes for long-term distribution.</p></div> : null}
              <dl className="review-list">
                <div><dt>Name</dt><dd>{name}</dd></div>
                <div><dt>Content</dt><dd>{contentType === "url" ? destinationUrl : file?.name}</dd></div>
                <div><dt>Type</dt><dd>{contentType === "url" ? "Web redirect" : "Private R2 file"}</dd></div>
                <div><dt>Color</dt><dd><i style={{ background: foregroundColor }} />{foregroundColor}</dd></div>
              </dl>
              {uploadProgress != null ? <FileUpload file={file} onFile={() => undefined} progress={uploadProgress} disabled /> : null}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="creator-actions creator-actions--split">
                <button className="button button--secondary" type="button" onClick={() => setStep("design")} disabled={busy}>Back to design</button>
                <button className="button button--primary" type="button" onClick={() => void create()} disabled={busy}>
                  {busy ? (contentType === "file" ? "Uploading and creating…" : "Creating…") : error ? "Retry creation" : "Create QR code"}
                </button>
              </div>
            </>
          ) : null}
        </section>
        <aside className="creator-preview">
          <p className="eyebrow">Live preview</p>
          <QrPreview value={publicUrl} color={foregroundColor} name={name || "New QR code"} />
          <p className="preview-note"><strong>The durable part:</strong> this address is encoded in the QR. Update the content later without changing the printed code.</p>
        </aside>
      </div>
    </AppShell>
  );
}
