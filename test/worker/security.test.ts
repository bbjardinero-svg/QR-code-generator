import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("request security", () => {
  it("adds restrictive browser security headers", async () => {
    const response = await SELF.fetch("https://example.test/api/health");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("rejects cross-origin login requests", async () => {
    const response = await SELF.fetch("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });

    expect(response.status).toBe(403);
  });
});
