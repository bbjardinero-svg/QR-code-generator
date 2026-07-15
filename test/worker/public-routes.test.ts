import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../src/worker/app";
import { QrRepository } from "../../src/worker/qr-repository";

interface AdminSession {
  cookie: string;
}

let admin: AdminSession;

async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://example.test${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function scansFor(qrCodeId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM scan_events WHERE qr_code_id = ?1")
    .bind(qrCodeId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function createUrlQr(slug: string, destinationUrl: string, status: "active" | "archived" = "active") {
  const repository = new QrRepository(env.DB);
  const qr = await repository.create({
    id: crypto.randomUUID(),
    slug,
    name: slug,
    description: null,
    contentType: "url",
    destinationUrl,
    storedFileId: null,
    foregroundColor: "#102f29",
    now: new Date().toISOString(),
  });
  if (status === "archived") await repository.setStatus(qr.id, status, new Date().toISOString());
  return qr;
}

async function createFileQr(options: {
  slug: string;
  bytes?: Uint8Array;
  mediaType?: string;
  originalName?: string;
  missingObject?: boolean;
}) {
  const fileId = crypto.randomUUID();
  const key = `files/${crypto.randomUUID()}`;
  const bytes = options.bytes ?? new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
  const mediaType = options.mediaType ?? "application/pdf";
  const originalName = options.originalName ?? "field-guide.pdf";
  if (!options.missingObject) {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: mediaType } });
  }
  await env.DB.prepare(
    `INSERT INTO stored_files (id, r2_key, original_name, media_type, size_bytes, etag, state, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'etag', 'finalized', ?6)`,
  )
    .bind(fileId, key, originalName, mediaType, bytes.byteLength, new Date().toISOString())
    .run();
  return new QrRepository(env.DB).create({
    id: crypto.randomUUID(),
    slug: options.slug,
    name: options.slug,
    description: null,
    contentType: "file",
    destinationUrl: null,
    storedFileId: fileId,
    foregroundColor: "#102f29",
    now: new Date().toISOString(),
  });
}

beforeAll(async () => {
  const login = await SELF.fetch("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ passphrase: "test-passphrase" }),
  });
  admin = { cookie: login.headers.get("set-cookie")?.split(";")[0] ?? "" };
});

describe("public QR delivery", () => {
  it("redirects web QR scans and counts every request without visitor metadata", async () => {
    const qr = await createUrlQr("public-website", "https://example.org/current");

    const first = await publicFetch("/r/public-website", { redirect: "manual" });
    const second = await publicFetch("/r/public-website", { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("https://example.org/current");
    expect(second.status).toBe(302);
    expect(await scansFor(qr.id)).toBe(2);

    const columns = await env.DB.prepare("PRAGMA table_info(scan_events)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual(["id", "qr_code_id", "scanned_at"]);
  });

  it("serves a private PDF inline with safe headers and counts the scan", async () => {
    const qr = await createFileQr({
      slug: "public-pdf",
      originalName: "report\"\r\nX-Evil: yes.pdf",
    });

    const response = await publicFetch("/r/public-pdf");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="[^"]+"$/);
    expect(response.headers.get("content-disposition")).not.toContain("X-Evil");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]));
    expect(await scansFor(qr.id)).toBe(1);
  });

  it("supports valid byte-range requests", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const qr = await createFileQr({ slug: "range-file", bytes, mediaType: "video/mp4", originalName: "clip.mp4" });

    const response = await publicFetch("/r/range-file", { headers: { range: "bytes=2-5" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
    expect(await scansFor(qr.id)).toBe(1);
  });

  it("renders branded accessible pages for missing, archived, and unavailable objects", async () => {
    await createUrlQr("archived-guide", "https://private.example/secret", "archived");
    const missingObjectQr = await createFileQr({ slug: "missing-object", missingObject: true });

    const missing = await publicFetch("/r/not-found");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toMatch(/<main[\s>].*EverQR.*not available/is);

    const archived = await publicFetch("/r/archived-guide");
    expect(archived.status).toBe(410);
    const archivedHtml = await archived.text();
    expect(archivedHtml).toContain("archived");
    expect(archivedHtml).not.toContain("private.example");

    const unavailable = await publicFetch("/r/missing-object");
    expect(unavailable.status).toBe(503);
    const unavailableHtml = await unavailable.text();
    expect(unavailableHtml).toContain("temporarily unavailable");
    expect(unavailableHtml).not.toContain("files/");
    expect(await scansFor(missingObjectQr.id)).toBe(0);
  });

  it("provides an authenticated non-counting preview", async () => {
    const qr = await createUrlQr("preview-only", "https://example.org/preview");

    const anonymous = await publicFetch(`/api/qr/${qr.id}/preview`, { redirect: "manual" });
    expect(anonymous.status).toBe(401);

    const preview = await publicFetch(`/api/qr/${qr.id}/preview`, {
      redirect: "manual",
      headers: { cookie: admin.cookie },
    });
    expect(preview.status).toBe(302);
    expect(preview.headers.get("location")).toBe("https://example.org/preview");
    expect(await scansFor(qr.id)).toBe(0);
  });

  it("still delivers content when background scan insertion fails", async () => {
    await createUrlQr("analytics-independent", "https://example.org/available");
    await env.DB.prepare("DROP TABLE scan_events").run();

    const response = await publicFetch("/r/analytics-independent", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.org/available");
  });
});
