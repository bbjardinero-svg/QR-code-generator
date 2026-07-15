import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { FileRepository } from "../../src/worker/file-repository";
import { QrRepository } from "../../src/worker/qr-repository";

interface AdminSession {
  cookie: string;
  csrfToken: string;
}

interface UploadAuthorization {
  uploadId: string;
  objectKey: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

interface StoredFileDto {
  id: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  etag: string;
  createdAt: string;
}

let admin: AdminSession;

async function login(): Promise<AdminSession> {
  const response = await SELF.fetch("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ passphrase: "test-passphrase" }),
  });
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrfToken: (await response.json<{ csrfToken: string }>()).csrfToken,
  };
}

function headers(json = true): HeadersInit {
  return {
    cookie: admin.cookie,
    origin: "https://example.test",
    "x-csrf-token": admin.csrfToken,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function authorize(
  fileName: string,
  mediaType: string,
  sizeBytes: number,
): Promise<{ response: Response; authorization?: UploadAuthorization }> {
  const response = await SELF.fetch("https://example.test/api/uploads/authorize", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fileName, mediaType, sizeBytes }),
  });
  return {
    response,
    authorization: response.ok ? await response.json<UploadAuthorization>() : undefined,
  };
}

async function putAuthorizedObject(authorization: UploadAuthorization, bytes: Uint8Array): Promise<void> {
  await env.FILES.put(authorization.objectKey, bytes, {
    httpMetadata: { contentType: authorization.uploadHeaders["content-type"] },
    customMetadata: {
      "upload-id": authorization.uploadHeaders["x-amz-meta-upload-id"],
      "size-bytes": authorization.uploadHeaders["x-amz-meta-size-bytes"],
      "original-name": authorization.uploadHeaders["x-amz-meta-original-name"],
    },
  });
}

async function finalize(uploadId: string): Promise<{ response: Response; file?: StoredFileDto }> {
  const response = await SELF.fetch(`https://example.test/api/uploads/${uploadId}/finalize`, {
    method: "POST",
    headers: headers(false),
  });
  return { response, file: response.ok ? await response.json<StoredFileDto>() : undefined };
}

beforeAll(async () => {
  admin = await login();
});

describe("private R2 upload lifecycle", () => {
  it("issues a ten-minute, one-key PUT authorization at the exact 100 MB limit", async () => {
    const { response, authorization } = await authorize("catalogue.pdf", "application/pdf", 100_000_000);
    expect(response.status).toBe(201);
    expect(authorization).toBeDefined();

    const url = new URL(authorization!.uploadUrl);
    expect(url.origin).toBe("https://test-account.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/everqr-files-test/${authorization!.objectKey}`);
    expect(authorization!.objectKey).toMatch(/^temporary\/[0-9a-f-]+$/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-meta-size-bytes");
    expect(authorization!.uploadHeaders).toMatchObject({
      "content-type": "application/pdf",
      "x-amz-meta-size-bytes": "100000000",
      "x-amz-meta-upload-id": authorization!.uploadId,
    });
    expect(new Date(authorization!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(authorization!.uploadUrl).not.toContain("test-secret-key");
  });

  it("rejects oversized, executable, mismatched, and cross-origin authorization requests", async () => {
    expect((await authorize("too-large.pdf", "application/pdf", 100_000_001)).response.status).toBe(400);
    expect((await authorize("malware.exe", "application/octet-stream", 10)).response.status).toBe(400);
    expect((await authorize("mismatch.pdf", "image/png", 10)).response.status).toBe(400);

    const crossOrigin = await SELF.fetch("https://example.test/api/uploads/authorize", {
      method: "POST",
      headers: {
        cookie: admin.cookie,
        origin: "https://attacker.example",
        "x-csrf-token": admin.csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fileName: "safe.pdf", mediaType: "application/pdf", sizeBytes: 10 }),
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("refuses to publish or finalize an upload until its R2 object matches", async () => {
    const { authorization } = await authorize("booklet.pdf", "application/pdf", 4);
    expect(authorization).toBeDefined();

    const prematureQr = await SELF.fetch("https://example.test/api/qr", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: "Booklet",
        slug: "private-booklet",
        contentType: "file",
        storedFileId: authorization!.uploadId,
        foregroundColor: "#102f29",
      }),
    });
    expect(prematureQr.status).toBe(409);
    expect((await finalize(authorization!.uploadId)).response.status).toBe(409);

    await putAuthorizedObject(authorization!, new Uint8Array([1, 2, 3]));
    expect((await finalize(authorization!.uploadId)).response.status).toBe(409);
  });

  it("finalizes a verified object and makes it eligible for a file QR", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const { authorization } = await authorize("verified.pdf", "application/pdf", bytes.byteLength);
    await putAuthorizedObject(authorization!, bytes);

    const finalized = await finalize(authorization!.uploadId);
    expect(finalized.response.status).toBe(200);
    expect(finalized.file).toMatchObject({
      id: authorization!.uploadId,
      originalName: "verified.pdf",
      mediaType: "application/pdf",
      sizeBytes: 4,
      etag: expect.any(String),
    });
    expect(await env.FILES.head(authorization!.objectKey)).toBeNull();

    const record = await new FileRepository(env.DB).findById(authorization!.uploadId);
    expect(record?.state).toBe("finalized");
    expect(record?.r2Key).toMatch(/^files\/[0-9a-f-]+$/);
    expect(await env.FILES.head(record!.r2Key)).not.toBeNull();

    const qrResponse = await SELF.fetch("https://example.test/api/qr", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: "Verified booklet",
        slug: "verified-booklet",
        contentType: "file",
        storedFileId: finalized.file!.id,
        foregroundColor: "#102f29",
      }),
    });
    expect(qrResponse.status).toBe(201);
  });

  it("replaces a file only after the new object is finalized and preserves the QR slug and scans", async () => {
    const oldBytes = new Uint8Array([1, 2, 3, 4]);
    const oldAuthorization = (await authorize("old.pdf", "application/pdf", oldBytes.byteLength)).authorization!;
    await putAuthorizedObject(oldAuthorization, oldBytes);
    const oldFile = (await finalize(oldAuthorization.uploadId)).file!;

    const repository = new QrRepository(env.DB);
    const qr = await repository.create({
      id: crypto.randomUUID(),
      slug: "replaceable-file",
      name: "Replaceable file",
      description: null,
      contentType: "file",
      destinationUrl: null,
      storedFileId: oldFile.id,
      foregroundColor: "#102f29",
      now: new Date().toISOString(),
    });
    await repository.recordScan(qr.id, crypto.randomUUID(), new Date().toISOString());
    const oldRecord = await new FileRepository(env.DB).findById(oldFile.id);

    const newBytes = new Uint8Array([5, 6, 7, 8, 9]);
    const newAuthorization = (await authorize("new.pdf", "application/pdf", newBytes.byteLength)).authorization!;
    await putAuthorizedObject(newAuthorization, newBytes);

    const beforeFinalize = await SELF.fetch(`https://example.test/api/qr/${qr.id}/replace-file`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ storedFileId: newAuthorization.uploadId }),
    });
    expect(beforeFinalize.status).toBe(409);
    expect((await repository.findById(qr.id))?.storedFileId).toBe(oldFile.id);

    const newFile = (await finalize(newAuthorization.uploadId)).file!;
    const replaced = await SELF.fetch(`https://example.test/api/qr/${qr.id}/replace-file`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ storedFileId: newFile.id }),
    });
    expect(replaced.status).toBe(200);

    const after = await repository.findWithScansById(qr.id);
    expect(after).toMatchObject({ slug: "replaceable-file", storedFileId: newFile.id, scans: 1 });
    expect(await env.FILES.head(oldRecord!.r2Key)).toBeNull();
    expect(await new FileRepository(env.DB).findById(oldFile.id)).toBeNull();
  });

  it("keeps a finalized replacement available when the target QR does not exist", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const authorization = (await authorize("rollback.pdf", "application/pdf", bytes.byteLength)).authorization!;
    await putAuthorizedObject(authorization, bytes);
    const file = (await finalize(authorization.uploadId)).file!;
    const record = await new FileRepository(env.DB).findById(file.id);

    const response = await SELF.fetch("https://example.test/api/qr/missing-id/replace-file", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ storedFileId: file.id }),
    });
    expect(response.status).toBe(404);
    expect(await new FileRepository(env.DB).findById(file.id)).not.toBeNull();
    expect(await env.FILES.head(record!.r2Key)).not.toBeNull();
  });
});
