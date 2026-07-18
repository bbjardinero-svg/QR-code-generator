import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("single-admin authentication", () => {
  it("creates a secure signed session without exposing the passphrase", async () => {
    const response = await SELF.fetch("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/everqr_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
    const body = await response.text();
    expect(body).not.toContain("test-passphrase");
    expect(JSON.parse(body).csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects an incorrect passphrase generically", async () => {
    const response = await SELF.fetch("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ passphrase: "wrong" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid credentials" });
  });

  it("throttles repeated failed login attempts without storing the raw address", async () => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await SELF.fetch("https://example.test/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
          "cf-connecting-ip": "192.0.2.55",
        },
        body: JSON.stringify({ passphrase: "wrong" }),
      });
    }

    expect(response?.status).toBe(429);
    expect(await response?.json()).toEqual({ error: "Too many attempts" });
  });

  it("resolves and deletes an authenticated session", async () => {
    const login = await SELF.fetch("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ passphrase: "test-passphrase" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const csrfToken = (await login.json<{ csrfToken: string }>()).csrfToken;

    const session = await SELF.fetch("https://example.test/api/auth/session", { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: true, csrfToken });

    const logout = await SELF.fetch("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "https://example.test", "x-csrf-token": csrfToken },
    });
    expect(logout.status).toBe(204);

    const after = await SELF.fetch("https://example.test/api/auth/session", { headers: { cookie } });
    expect(after.status).toBe(401);
  });
});
