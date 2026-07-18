import { describe, expect, it } from "vitest";
import { createQrInputSchema, uploadRequestSchema } from "../../src/shared/schemas";

describe("QR input validation", () => {
  it("accepts a safe HTTPS web-link QR", () => {
    const result = createQrInputSchema.safeParse({
      name: "Innovation catalogue",
      slug: "innovation-catalogue",
      contentType: "url",
      destinationUrl: "https://example.org/catalogue",
      foregroundColor: "#102f29",
    });

    expect(result.success).toBe(true);
  });

  it("rejects reserved slugs and non-HTTPS destinations", () => {
    expect(
      createQrInputSchema.safeParse({
        name: "Admin",
        slug: "admin",
        contentType: "url",
        destinationUrl: "http://example.org",
        foregroundColor: "#102f29",
      }).success,
    ).toBe(false);
  });

  it("enforces the exact 100,000,000-byte upload ceiling", () => {
    expect(
      uploadRequestSchema.safeParse({
        fileName: "catalogue.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100_000_000,
      }).success,
    ).toBe(true);
    expect(
      uploadRequestSchema.safeParse({
        fileName: "catalogue.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100_000_001,
      }).success,
    ).toBe(false);
  });
});
