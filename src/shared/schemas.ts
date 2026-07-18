import { z } from "zod";
import { MAX_FILE_BYTES, QR_COLORS, RESERVED_SLUGS } from "./constants";

export const slugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens")
  .refine((value) => !RESERVED_SLUGS.has(value), "This short name is reserved");

export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Use an HTTPS address");

const baseQrSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(500).nullable().optional(),
  foregroundColor: z.enum(QR_COLORS),
});

export const createQrInputSchema = z.discriminatedUnion("contentType", [
  baseQrSchema.extend({
    contentType: z.literal("url"),
    destinationUrl: httpsUrlSchema,
  }),
  baseQrSchema.extend({
    contentType: z.literal("file"),
    storedFileId: z.string().uuid(),
  }),
]);

const allowedUploads = new Map<string, ReadonlySet<string>>([
  [".pdf", new Set(["application/pdf"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".pptx", new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])],
  [".csv", new Set(["text/csv", "text/plain"])],
  [".txt", new Set(["text/plain"])],
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".webp", new Set(["image/webp"])],
  [".mp3", new Set(["audio/mpeg"])],
  [".mp4", new Set(["video/mp4"])],
  [".zip", new Set(["application/zip", "application/x-zip-compressed"])],
]);

export const uploadRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(240),
    mediaType: z.string().trim().min(1).max(160),
    sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  })
  .superRefine(({ fileName, mediaType }, context) => {
    const dot = fileName.lastIndexOf(".");
    const extension = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
    if (!allowedUploads.get(extension)?.has(mediaType.toLowerCase())) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "File type is not allowed" });
    }
  });

export type CreateQrInput = z.infer<typeof createQrInputSchema>;
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
