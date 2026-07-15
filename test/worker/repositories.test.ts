import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { QrRepository } from "../../src/worker/qr-repository";

describe("QrRepository", () => {
  it("creates and resolves a web-link QR by immutable slug", async () => {
    const repository = new QrRepository(env.DB);
    const qr = await repository.create({
      id: "qr-1",
      slug: "innovation-catalogue",
      name: "Innovation catalogue",
      description: null,
      contentType: "url",
      destinationUrl: "https://example.org/catalogue",
      storedFileId: null,
      foregroundColor: "#102f29",
      now: "2026-07-15T03:00:00.000Z",
    });

    expect(await repository.findBySlug("innovation-catalogue")).toEqual(qr);
  });

  it("records only timestamped scan events and aggregates them by day", async () => {
    const repository = new QrRepository(env.DB);
    await repository.create({
      id: "qr-2",
      slug: "digital-booklet",
      name: "Digital booklet",
      description: null,
      contentType: "url",
      destinationUrl: "https://example.org/booklet",
      storedFileId: null,
      foregroundColor: "#102f29",
      now: "2026-07-15T03:00:00.000Z",
    });

    await repository.recordScan("qr-2", "scan-1", "2026-07-15T04:00:00.000Z");
    await repository.recordScan("qr-2", "scan-2", "2026-07-15T05:00:00.000Z");

    expect(await repository.dailyScans("qr-2", "2026-06-16T00:00:00.000Z")).toEqual([
      { date: "2026-07-15", scans: 2 },
    ]);
  });
});
