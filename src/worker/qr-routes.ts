import { Hono, type Context } from "hono";
import { z } from "zod";
import { QR_COLORS } from "../shared/constants";
import { createQrInputSchema, httpsUrlSchema } from "../shared/schemas";
import { requireAdmin, requireCsrf } from "./auth";
import type { Env } from "./env";
import { QrRepository, type QrRecord, type QrStatus, type QrWithScans } from "./qr-repository";
import { renderQrPng, renderQrSvg } from "./qr-renderer";

const updateQrInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    destinationUrl: httpsUrlSchema.optional(),
    foregroundColor: z.enum(QR_COLORS).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one change");

function publicUrl(requestUrl: string, slug: string): string {
  return `${new URL(requestUrl).origin}/r/${slug}`;
}

function toDto(record: QrRecord | QrWithScans, requestUrl: string) {
  return {
    ...record,
    publicUrl: publicUrl(requestUrl, record.slug),
    scans: "scans" in record ? record.scans : 0,
  };
}

function validationError(issues: z.ZodIssue[]) {
  return { error: "Invalid request", issues: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function requireQr(repository: QrRepository, id: string) {
  return repository.findWithScansById(id);
}

export const qrRoutes = new Hono<{ Bindings: Env }>();

qrRoutes.use("*", requireAdmin());

qrRoutes.get("/qr", async (context) => {
  const search = context.req.query("search")?.trim().slice(0, 120);
  const requestedStatus = context.req.query("status");
  const status: QrStatus | undefined = requestedStatus === "active" || requestedStatus === "archived" ? requestedStatus : undefined;
  const items = await new QrRepository(context.env.DB).list({ search: search || undefined, status });
  return context.json({ items: items.map((item) => toDto(item, context.req.url)) });
});

qrRoutes.post("/qr", requireCsrf(), async (context) => {
  const parsed = createQrInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json(validationError(parsed.error.issues), 400);
  const repository = new QrRepository(context.env.DB);
  if (await repository.findBySlug(parsed.data.slug)) return context.json({ error: "This short name is already in use" }, 409);

  if (parsed.data.contentType === "file") {
    const file = await context.env.DB.prepare("SELECT state FROM stored_files WHERE id = ?1").bind(parsed.data.storedFileId).first<{ state: string }>();
    if (!file || file.state !== "finalized") return context.json({ error: "The selected file is not ready" }, 409);
  }

  const now = new Date().toISOString();
  const created = await repository.create({
    id: crypto.randomUUID(),
    slug: parsed.data.slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    contentType: parsed.data.contentType,
    destinationUrl: parsed.data.contentType === "url" ? parsed.data.destinationUrl : null,
    storedFileId: parsed.data.contentType === "file" ? parsed.data.storedFileId : null,
    foregroundColor: parsed.data.foregroundColor,
    now,
  });
  return context.json({ qr: toDto(created, context.req.url) }, 201);
});

qrRoutes.get("/qr/:id", async (context) => {
  const qr = await requireQr(new QrRepository(context.env.DB), context.req.param("id"));
  return qr ? context.json({ qr: toDto(qr, context.req.url) }) : context.json({ error: "QR code not found" }, 404);
});

qrRoutes.patch("/qr/:id", requireCsrf(), async (context) => {
  const parsed = updateQrInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json(validationError(parsed.error.issues), 400);
  const repository = new QrRepository(context.env.DB);
  const existing = await repository.findById(context.req.param("id"));
  if (!existing) return context.json({ error: "QR code not found" }, 404);
  if (parsed.data.destinationUrl && existing.contentType !== "url") {
    return context.json({ error: "File QR destinations are changed by replacing the file" }, 400);
  }
  await repository.update(existing.id, { ...parsed.data, now: new Date().toISOString() });
  const updated = await repository.findWithScansById(existing.id);
  return context.json({ qr: toDto(updated!, context.req.url) });
});

async function changeStatus(context: Context<{ Bindings: Env }>, status: QrStatus) {
  const repository = new QrRepository(context.env.DB);
  const updated = await repository.setStatus(context.req.param("id") ?? "", status, new Date().toISOString());
  if (!updated) return context.json({ error: "QR code not found" }, 404);
  const withScans = await repository.findWithScansById(updated.id);
  return context.json({ qr: toDto(withScans!, context.req.url) });
}

qrRoutes.post("/qr/:id/archive", requireCsrf(), (context) => changeStatus(context, "archived"));
qrRoutes.post("/qr/:id/restore", requireCsrf(), (context) => changeStatus(context, "active"));

qrRoutes.delete("/qr/:id", requireCsrf(), async (context) => {
  const removed = await new QrRepository(context.env.DB).remove(context.req.param("id"));
  return removed ? context.body(null, 204) : context.json({ error: "QR code not found" }, 404);
});

qrRoutes.get("/qr/:id/png", async (context) => {
  const qr = await requireQr(new QrRepository(context.env.DB), context.req.param("id"));
  if (!qr) return context.json({ error: "QR code not found" }, 404);
  const png = await renderQrPng(publicUrl(context.req.url, qr.slug), qr.foregroundColor);
  const body = new Uint8Array(png.byteLength);
  body.set(png);
  return new Response(body.buffer, {
    headers: {
      "content-type": "image/png",
      "content-disposition": `attachment; filename="${qr.slug}.png"`,
      "cache-control": "private, no-store",
    },
  });
});

qrRoutes.get("/qr/:id/svg", async (context) => {
  const qr = await requireQr(new QrRepository(context.env.DB), context.req.param("id"));
  if (!qr) return context.json({ error: "QR code not found" }, 404);
  const svg = await renderQrSvg(publicUrl(context.req.url, qr.slug), qr.foregroundColor);
  return context.body(svg, 200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-disposition": `attachment; filename="${qr.slug}.svg"`,
    "cache-control": "private, no-store",
  });
});

qrRoutes.get("/qr/:id/scans", async (context) => {
  const repository = new QrRepository(context.env.DB);
  const qr = await repository.findWithScansById(context.req.param("id"));
  if (!qr) return context.json({ error: "QR code not found" }, 404);
  const requestedDays = Number(context.req.query("days") ?? 30);
  const days = Number.isInteger(requestedDays) ? Math.min(3650, Math.max(1, requestedDays)) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return context.json({ total: qr.scans, series: await repository.dailyScans(qr.id, since) });
});

qrRoutes.get("/summary", async (context) => context.json(await new QrRepository(context.env.DB).summary()));

async function exportRecords(context: Context<{ Bindings: Env }>, format: "json" | "csv") {
  const items = (await new QrRepository(context.env.DB).list()).map((item) => toDto(item, context.req.url));
  if (format === "json") {
    return context.json(items, 200, { "content-disposition": 'attachment; filename="everqr-export.json"' });
  }
  const fields = ["id", "name", "slug", "contentType", "status", "destinationUrl", "publicUrl", "scans", "createdAt"] as const;
  const rows = [fields.map(csvCell).join(","), ...items.map((item) => fields.map((field) => csvCell(item[field])).join(","))];
  return context.body(`${rows.join("\r\n")}\r\n`, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="everqr-export.csv"',
  });
}

qrRoutes.get("/export.json", (context) => exportRecords(context, "json"));
qrRoutes.get("/export.csv", (context) => exportRecords(context, "csv"));
