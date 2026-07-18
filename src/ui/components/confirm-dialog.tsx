import { useEffect, useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({ open, name, busy = false, onCancel, onConfirm }: ConfirmDialogProps) {
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!open) setConfirmation("");
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    if (open) window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <p className="eyebrow">Permanent action</p>
        <h2 id="delete-dialog-title">Delete {name}?</h2>
        <p>This removes the QR, its scan history, and its unshared stored file. The printed QR will stop working.</p>
        <label htmlFor="delete-confirmation">Type {name} to confirm</label>
        <input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
        <div className="dialog-actions">
          <button className="button button--secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="button button--danger"
            type="button"
            disabled={confirmation !== name || busy}
            onClick={() => void onConfirm()}
          >{busy ? "Deleting…" : "Confirm permanent deletion"}</button>
        </div>
      </section>
    </div>
  );
}
