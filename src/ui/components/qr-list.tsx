import type { QrDto } from "../api";

interface QrListProps {
  items: QrDto[];
  onOpen: (id: string) => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function QrList({ items, onOpen }: QrListProps) {
  return (
    <div className="qr-registry" aria-label="QR code registry">
      {items.map((qr) => (
        <article className="qr-row" key={qr.id}>
          <div className="qr-row__spine" aria-label="Stable public address">
            <span>Stable link</span>
          </div>
          <img className="qr-row__code" src={`/api/qr/${qr.id}/svg`} alt={`QR code for ${qr.name}`} loading="lazy" />
          <div className="qr-row__identity">
            <div className="inline-meta">
              <span className={`status-chip status-chip--${qr.status}`}>{qr.status}</span>
              <span>{qr.contentType === "url" ? "Web link" : "Stored file"}</span>
            </div>
            <h3>{qr.name}</h3>
            <a href={qr.publicUrl} target="_blank" rel="noreferrer">/r/{qr.slug}</a>
            <p>{qr.description || `Updated ${formatDate(qr.updatedAt)}`}</p>
          </div>
          <div className="qr-row__scans">
            <strong>{qr.scans.toLocaleString()}</strong>
            <span>scans</span>
          </div>
          <div className="qr-row__actions">
            <button className="button button--secondary" type="button" onClick={() => onOpen(qr.id)}>Manage</button>
            <a className="icon-link" href={`/api/qr/${qr.id}/png`} download aria-label={`Download ${qr.name} as PNG`}>PNG</a>
            <a className="icon-link" href={`/api/qr/${qr.id}/svg`} download aria-label={`Download ${qr.name} as SVG`}>SVG</a>
          </div>
        </article>
      ))}
    </div>
  );
}
