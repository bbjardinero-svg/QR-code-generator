import { AwsClient } from "aws4fetch";
import { Hono } from "hono";
import { z } from "zod";
import { UPLOAD_AUTHORIZATION_SECONDS } from "../shared/constants";
import { uploadRequestSchema } from "../shared/schemas";
import { requireAdmin, requireCsrf } from "./auth";
import type { Env } from "./env";
import { FileRepository, type StoredFileRecord } from "./file-repository";
import { QrRepository } from "./qr-repository";

const replaceFileSchema = z.object({ storedFileId: z.string().uuid() }).strict();

function fileDto(record: StoredFileRecord) {
  return {
    id: record.id,
    originalName: record.originalName,
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes,
    etag: record.etag,
    createdAt: record.createdAt,
  };
}

function uploadMetadata(record: StoredFileRecord): Record<string, string> {
  return {
    "upload-id": record.id,
    "size-bytes": String(record.sizeBytes),
    "original-name": encodeURIComponent(record.originalName),
  };
}

function metadataMatches(object: R2Object, record: StoredFileRecord): boolean {
  const metadata = object.customMetadata ?? {};
  return (
    object.size === record.sizeBytes &&
    object.httpMetadata?.contentType?.toLowerCase() === record.mediaType.toLowerCase() &&
    metadata["upload-id"] === record.id &&
    metadata["size-bytes"] === String(record.sizeBytes) &&
    metadata["original-name"] === encodeURIComponent(record.originalName)
  );
}

async function presignUpload(env: Env, record: StoredFileRecord): Promise<{ uploadUrl: string; uploadHeaders: Record<string, string> }> {
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME)}/${record.r2Key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_AUTHORIZATION_SECONDS));
  const metadata = uploadMetadata(record);
  const signingHeaders = {
    "content-length": String(record.sizeBytes),
    "content-type": record.mediaType,
    "x-amz-meta-upload-id": metadata["upload-id"],
    "x-amz-meta-size-bytes": metadata["size-bytes"],
    "x-amz-meta-original-name": metadata["original-name"],
  };
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
    retries: 0,
  });
  const signed = await client.sign(url, {
    method: "PUT",
    headers: signingHeaders,
    aws: { signQuery: true, allHeaders: true, service: "s3", region: "auto" },
  });
  const uploadHeaders = { ...signingHeaders };
  delete (uploadHeaders as Partial<typeof signingHeaders>)["content-length"];
  return { uploadUrl: signed.url, uploadHeaders };
}

export const uploadRoutes = new Hono<{ Bindings: Env }>();

uploadRoutes.use("*", requireAdmin());

uploadRoutes.get("/files/:id", async (context) => {
  const file = await new FileRepository(context.env.DB).findById(context.req.param("id"));
  if (!file || file.state !== "finalized") return context.json({ error: "File not found" }, 404);
  return context.json(fileDto(file));
});

uploadRoutes.post("/uploads/authorize", requireCsrf(), async (context) => {
  const parsed = uploadRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: "Invalid file", issues: parsed.error.flatten().fieldErrors }, 400);

  const now = new Date();
  const record = await new FileRepository(context.env.DB).createTemporary({
    id: crypto.randomUUID(),
    r2Key: `temporary/${crypto.randomUUID()}`,
    originalName: parsed.data.fileName,
    mediaType: parsed.data.mediaType.toLowerCase(),
    sizeBytes: parsed.data.sizeBytes,
    createdAt: now.toISOString(),
  });
  try {
    const signed = await presignUpload(context.env, record);
    return context.json(
      {
        uploadId: record.id,
        objectKey: record.r2Key,
        ...signed,
        expiresAt: new Date(now.getTime() + UPLOAD_AUTHORIZATION_SECONDS * 1000).toISOString(),
      },
      201,
    );
  } catch (error) {
    await new FileRepository(context.env.DB).remove(record.id);
    console.error("Unable to authorize R2 upload", error);
    return context.json({ error: "Unable to authorize upload" }, 503);
  }
});

uploadRoutes.post("/uploads/:id/finalize", requireCsrf(), async (context) => {
  const repository = new FileRepository(context.env.DB);
  const record = await repository.findById(context.req.param("id"));
  if (!record) return context.json({ error: "Upload not found" }, 404);
  if (record.state === "finalized") return context.json(fileDto(record));

  const head = await context.env.FILES.head(record.r2Key);
  if (!head || !metadataMatches(head, record)) {
    return context.json({ error: "Uploaded object does not match the authorization" }, 409);
  }
  const source = await context.env.FILES.get(record.r2Key);
  if (!source) return context.json({ error: "Uploaded object is unavailable" }, 409);

  const finalKey = `files/${crypto.randomUUID()}`;
  const copied = await context.env.FILES.put(finalKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
  let finalized: StoredFileRecord | null = null;
  try {
    finalized = await repository.finalize(record.id, finalKey, copied.etag);
  } catch (error) {
    await context.env.FILES.delete(finalKey);
    throw error;
  }
  if (!finalized) {
    await context.env.FILES.delete(finalKey);
    return context.json({ error: "Upload state changed; retry finalization" }, 409);
  }
  await context.env.FILES.delete(record.r2Key);
  return context.json(fileDto(finalized));
});

uploadRoutes.post("/qr/:id/replace-file", requireCsrf(), async (context) => {
  const parsed = replaceFileSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: "Invalid replacement file" }, 400);

  const qrRepository = new QrRepository(context.env.DB);
  const qr = await qrRepository.findById(context.req.param("id"));
  if (!qr) return context.json({ error: "QR code not found" }, 404);
  if (qr.contentType !== "file" || !qr.storedFileId) return context.json({ error: "This is not a file QR code" }, 409);

  const fileRepository = new FileRepository(context.env.DB);
  const replacement = await fileRepository.findById(parsed.data.storedFileId);
  if (!replacement || replacement.state !== "finalized") return context.json({ error: "Replacement file is not ready" }, 409);
  if (replacement.id === qr.storedFileId) {
    const unchanged = await qrRepository.findWithScansById(qr.id);
    return context.json({ qr: unchanged, file: fileDto(replacement) });
  }

  const previous = await fileRepository.findById(qr.storedFileId);
  const switched = await context.env.DB.prepare("UPDATE qr_codes SET stored_file_id = ?2, updated_at = ?3 WHERE id = ?1")
    .bind(qr.id, replacement.id, new Date().toISOString())
    .run();
  if (switched.meta.changes === 0) return context.json({ error: "QR code was not updated" }, 409);

  if (previous) {
    const references = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM qr_codes WHERE stored_file_id = ?1")
      .bind(previous.id)
      .first<{ count: number }>();
    if (Number(references?.count ?? 0) === 0) {
      await context.env.FILES.delete(previous.r2Key);
      await fileRepository.remove(previous.id);
    }
  }

  return context.json({
    qr: await qrRepository.findWithScansById(qr.id),
    file: fileDto(replacement),
  });
});
