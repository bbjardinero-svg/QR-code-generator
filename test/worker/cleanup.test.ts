import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanupTemporaryUploads } from "../../src/worker/scheduled";

async function insertTemporary(id: string, key: string, createdAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO stored_files (id, r2_key, original_name, media_type, size_bytes, etag, state, created_at)
     VALUES (?1, ?2, 'pending.pdf', 'application/pdf', 4, NULL, 'temporary', ?3)`,
  )
    .bind(id, key, createdAt)
    .run();
  await env.FILES.put(key, new Uint8Array([1, 2, 3, 4]));
}

describe("temporary upload cleanup", () => {
  it("deletes temporary D1 and R2 entries older than 24 hours but keeps recent and finalized files", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    await insertTemporary("old-upload", "temporary/old-upload", "2026-07-14T11:59:59.000Z");
    await insertTemporary("recent-upload", "temporary/recent-upload", "2026-07-14T12:00:01.000Z");
    await env.DB.prepare(
      `INSERT INTO stored_files (id, r2_key, original_name, media_type, size_bytes, etag, state, created_at)
       VALUES ('final-file', 'files/final-file', 'final.pdf', 'application/pdf', 4, 'etag', 'finalized', '2026-07-13T00:00:00.000Z')`,
    ).run();
    await env.FILES.put("files/final-file", new Uint8Array([1, 2, 3, 4]));

    expect(await cleanupTemporaryUploads(env, now)).toBe(1);
    expect(await env.FILES.head("temporary/old-upload")).toBeNull();
    expect(await env.FILES.head("temporary/recent-upload")).not.toBeNull();
    expect(await env.FILES.head("files/final-file")).not.toBeNull();

    const oldRow = await env.DB.prepare("SELECT id FROM stored_files WHERE id = 'old-upload'").first();
    const recentRow = await env.DB.prepare("SELECT id FROM stored_files WHERE id = 'recent-upload'").first();
    expect(oldRow).toBeNull();
    expect(recentRow).not.toBeNull();
  });

  it("also removes expired authorizations whose object was never uploaded", async () => {
    await env.DB.prepare(
      `INSERT INTO stored_files (id, r2_key, original_name, media_type, size_bytes, etag, state, created_at)
       VALUES ('interrupted', 'temporary/interrupted', 'interrupted.pdf', 'application/pdf', 4, NULL, 'temporary', '2026-07-13T00:00:00.000Z')`,
    ).run();

    expect(await cleanupTemporaryUploads(env, new Date("2026-07-15T12:00:00.000Z"))).toBe(1);
    expect(await env.DB.prepare("SELECT id FROM stored_files WHERE id = 'interrupted'").first()).toBeNull();
  });
});
