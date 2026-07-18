import { Hono, type Context } from "hono";
import { requireAdmin } from "./auth";
import type { Env } from "./env";
import { FileRepository, type StoredFileRecord } from "./file-repository";
import { QrRepository, type QrRecord } from "./qr-repository";
import { archivedQrPage, missingQrPage, unavailableFilePage } from "./status-pages";

type ByteRange = { offset: number; length: number; end: number };

function parseRange(value: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    const length = Math.min(suffix, size);
    return { offset: size - length, length, end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return "invalid";
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1, end };
}

function safeFileName(name: string): string {
  const sanitized = name
    .split(/[\r\n]/, 1)[0]
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/["\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return sanitized || "everqr-file";
}

function quotedEtag(etag: string): string {
  return etag.startsWith('"') ? etag : `"${etag}"`;
}

function scheduleScan(context: Context<{ Bindings: Env }>, qrCodeId: string): void {
  const insertion = new QrRepository(context.env.DB)
    .recordScan(qrCodeId, crypto.randomUUID(), new Date().toISOString())
    .catch((error) => console.error("Unable to record QR scan", { qrCodeId, error }));
  context.executionCtx.waitUntil(insertion);
}

async function fileResponse(
  context: Context<{ Bindings: Env }>,
  qr: QrRecord,
  file: StoredFileRecord,
  countScan: boolean,
): Promise<Response> {
  const range = parseRange(context.req.header("range"), file.sizeBytes);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${file.sizeBytes}`, "accept-ranges": "bytes" },
    });
  }
  const object = await context.env.FILES.get(file.r2Key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) {
    console.error("Finalized QR file is missing from R2", { qrCodeId: qr.id, storedFileId: file.id });
    return unavailableFilePage();
  }
  if (countScan) scheduleScan(context, qr.id);

  const inline = file.mediaType === "application/pdf" || file.mediaType.startsWith("image/");
  const headers = new Headers({
    "content-type": file.mediaType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeFileName(file.originalName)}"`,
    "content-length": String(range?.length ?? object.size),
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    etag: quotedEtag(file.etag ?? object.etag),
  });
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.end}/${file.sizeBytes}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function deliver(
  context: Context<{ Bindings: Env }>,
  qr: QrRecord | null,
  options: { countScan: boolean; revealArchived: boolean },
): Promise<Response> {
  if (!qr) return missingQrPage();
  if (qr.status === "archived" && !options.revealArchived) return archivedQrPage();
  if (qr.contentType === "url" && qr.destinationUrl) {
    if (options.countScan) scheduleScan(context, qr.id);
    return new Response(null, {
      status: 302,
      headers: { location: qr.destinationUrl, "cache-control": "no-store" },
    });
  }
  if (!qr.storedFileId) return unavailableFilePage();
  const file = await new FileRepository(context.env.DB).findById(qr.storedFileId);
  if (!file || file.state !== "finalized") return unavailableFilePage();
  return fileResponse(context, qr, file, options.countScan);
}

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/r/:slug", async (context) => {
  const qr = await new QrRepository(context.env.DB).findBySlug(context.req.param("slug"));
  return deliver(context, qr, { countScan: true, revealArchived: false });
});

publicRoutes.get("/api/qr/:id/preview", requireAdmin(), async (context) => {
  const qr = await new QrRepository(context.env.DB).findById(context.req.param("id"));
  return deliver(context, qr, { countScan: false, revealArchived: true });
});
