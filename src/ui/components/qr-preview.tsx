import QRCode from "qrcode";
import { useEffect, useState } from "react";

interface QrPreviewProps {
  value: string;
  color: string;
  name: string;
  qrId?: string;
}

export function QrPreview({ value, color, name, qrId }: QrPreviewProps) {
  const [image, setImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toString(value || "https://example.invalid", {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      color: { dark: color, light: "#ffffff" },
    }).then((svg) => {
      if (active) setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => { active = false; };
  }, [color, value]);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
    } finally {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <section className="qr-preview" aria-label={`QR preview for ${name}`}>
      <div className="qr-preview__frame">
        {image ? <img src={image} alt={`QR code preview for ${name}`} /> : <span aria-label="Generating QR preview" />}
      </div>
      <div className="stable-address">
        <span>Stable public address</span>
        <code>{value}</code>
      </div>
      <button className="button button--secondary" type="button" onClick={copy}>Copy stable address</button>
      {copied ? <p className="copy-feedback" role="status">Address copied</p> : null}
      {qrId ? (
        <div className="download-pair">
          <a className="button button--secondary" href={`/api/qr/${qrId}/png`} download>Download PNG</a>
          <a className="button button--secondary" href={`/api/qr/${qrId}/svg`} download>Download SVG</a>
        </div>
      ) : null}
    </section>
  );
}
