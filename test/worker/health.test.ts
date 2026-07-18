import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("reports Worker and binding readiness", async () => {
    const response = await SELF.fetch("https://example.test/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(env.DB).toBeDefined();
    expect(env.FILES).toBeDefined();
  });
});
