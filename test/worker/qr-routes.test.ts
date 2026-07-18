import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { QrRepository } from "../../src/worker/qr-repository";

interface AdminSession {
  cookie: string;
  csrfToken: string;
}

interface QrDto {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  destinationUrl: string | null;
  publicUrl: string;
  scans: number;
}

let admin: AdminSession;

async function login(): Promise<AdminSession> {
  const response = await SELF.fetch("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ passphrase: "test-passphrase" }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const { csrfToken } = await response.json<{ csrfToken: string }>();
  return { cookie, csrfToken };
}

function adminHeaders(includeCsrf = false): HeadersInit {
  return {
    cookie: admin.cookie,
    origin: "https://example.test",
    ...(includeCsrf ? { "x-csrf-token": admin.csrfToken } : {}),
  };
}

async function createQr(overrides: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch("https://example.test/api/qr", {
    method: "POST",
    headers: { ...adminHeaders(true), "content-type": "application/json" },
    body: JSON.stringify({
      name: "Innovation catalogue",
      slug: "innovation-catalogue",
      description: "A public catalogue",
      contentType: "url",
      destinationUrl: "https://example.org/catalogue",
      foregroundColor: "#102f29",
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  admin = await login();
});

describe("QR management routes", () => {
  it("protects QR data and requires CSRF on mutations", async () => {
    const anonymous = await SELF.fetch("https://example.test/api/qr");
    expect(anonymous.status).toBe(401);

    const noCsrf = await SELF.fetch("https://example.test/api/qr", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noCsrf.status).toBe(403);
  });

  it("creates, lists, and resolves a URL QR with a stable public URL", async () => {
    const created = await createQr();
    expect(created.status).toBe(201);
    const { qr } = await created.json<{ qr: QrDto }>();
    expect(qr).toMatchObject({
      slug: "innovation-catalogue",
      name: "Innovation catalogue",
      status: "active",
      destinationUrl: "https://example.org/catalogue",
      publicUrl: "https://example.test/r/innovation-catalogue",
      scans: 0,
    });

    const list = await SELF.fetch("https://example.test/api/qr?search=innovation&status=active", {
      headers: adminHeaders(),
    });
    expect(list.status).toBe(200);
    const listed = await list.json<{ items: QrDto[] }>();
    expect(listed.items.map((item) => item.id)).toContain(qr.id);

    const detail = await SELF.fetch(`https://example.test/api/qr/${qr.id}`, { headers: adminHeaders() });
    expect(detail.status).toBe(200);
    expect((await detail.json<{ qr: QrDto }>()).qr.publicUrl).toBe(qr.publicUrl);
  });

  it("rejects duplicate slugs and keeps the slug immutable when updating content", async () => {
    expect((await createQr({ name: "Duplicate" })).status).toBe(409);

    const original = await createQr({
      slug: "field-guide",
      name: "Field guide",
      destinationUrl: "https://example.org/old",
    });
    const { qr } = await original.json<{ qr: QrDto }>();

    const immutable = await SELF.fetch(`https://example.test/api/qr/${qr.id}`, {
      method: "PATCH",
      headers: { ...adminHeaders(true), "content-type": "application/json" },
      body: JSON.stringify({ slug: "new-field-guide" }),
    });
    expect(immutable.status).toBe(400);

    const updated = await SELF.fetch(`https://example.test/api/qr/${qr.id}`, {
      method: "PATCH",
      headers: { ...adminHeaders(true), "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated field guide", destinationUrl: "https://example.org/new" }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json<{ qr: QrDto }>()).qr).toMatchObject({
      slug: "field-guide",
      name: "Updated field guide",
      destinationUrl: "https://example.org/new",
      publicUrl: "https://example.test/r/field-guide",
    });
  });

  it("archives and restores a QR without changing its public URL", async () => {
    const created = await createQr({ slug: "annual-report", name: "Annual report" });
    const { qr } = await created.json<{ qr: QrDto }>();

    const archived = await SELF.fetch(`https://example.test/api/qr/${qr.id}/archive`, {
      method: "POST",
      headers: adminHeaders(true),
    });
    expect(archived.status).toBe(200);
    expect((await archived.json<{ qr: QrDto }>()).qr).toMatchObject({
      status: "archived",
      publicUrl: qr.publicUrl,
    });

    const restored = await SELF.fetch(`https://example.test/api/qr/${qr.id}/restore`, {
      method: "POST",
      headers: adminHeaders(true),
    });
    expect(restored.status).toBe(200);
    expect((await restored.json<{ qr: QrDto }>()).qr.status).toBe("active");
  });

  it("returns scan totals, daily series, summary data, and reliable QR downloads", async () => {
    const created = await createQr({ slug: "scan-series", name: "Scan series", foregroundColor: "#1f8a70" });
    const { qr } = await created.json<{ qr: QrDto }>();
    const repository = new QrRepository(env.DB);
    await repository.recordScan(qr.id, crypto.randomUUID(), "2026-07-14T08:00:00.000Z");
    await repository.recordScan(qr.id, crypto.randomUUID(), "2026-07-15T08:00:00.000Z");

    const scans = await SELF.fetch(`https://example.test/api/qr/${qr.id}/scans?days=30`, {
      headers: adminHeaders(),
    });
    expect(scans.status).toBe(200);
    expect(await scans.json()).toMatchObject({ total: 2, series: expect.arrayContaining([{ date: "2026-07-15", scans: 1 }]) });

    const summary = await SELF.fetch("https://example.test/api/summary", { headers: adminHeaders() });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ totalQrCodes: expect.any(Number), totalScans: expect.any(Number), storageBytes: 0 });

    const png = await SELF.fetch(`https://example.test/api/qr/${qr.id}/png`, { headers: adminHeaders() });
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toContain("image/png");
    expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const svg = await SELF.fetch(`https://example.test/api/qr/${qr.id}/svg`, { headers: adminHeaders() });
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toContain("image/svg+xml");
    expect(await svg.text()).toContain("#1f8a70");
  });

  it("exports JSON and formula-safe CSV", async () => {
    const created = await createQr({ slug: "formula-safe", name: "=HYPERLINK(\"bad\")" });
    const { qr } = await created.json<{ qr: QrDto }>();

    const json = await SELF.fetch("https://example.test/api/export.json", { headers: adminHeaders() });
    expect(json.status).toBe(200);
    expect(json.headers.get("content-disposition")).toContain("everqr-export.json");
    const jsonItems = await json.json<QrDto[]>();
    expect(jsonItems.some((item) => item.id === qr.id)).toBe(true);

    const csv = await SELF.fetch("https://example.test/api/export.csv", { headers: adminHeaders() });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("everqr-export.csv");
    expect(await csv.text()).toContain("'=HYPERLINK(\"\"bad\"\")");
  });
});
