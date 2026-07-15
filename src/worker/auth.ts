import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { constantTimeEqual, hasTrustedOrigin } from "./security";

const COOKIE_NAME = "everqr_session";
const SESSION_SECONDS = 12 * 60 * 60;

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

interface VerifiedSession {
  id: string;
  csrfToken: string;
}

export async function verifySession(db: D1Database, secret: string, cookie: string | undefined): Promise<VerifiedSession | null> {
  if (!cookie) return null;
  const [id, csrfToken, signature, extra] = cookie.split(".");
  if (!id || !csrfToken || !signature || extra) return null;
  const expectedSignature = await sign(`${id}.${csrfToken}`, secret);
  if (!constantTimeEqual(signature, expectedSignature)) return null;

  const row = await db
    .prepare("SELECT csrf_hash, expires_at FROM sessions WHERE id_hash = ?1")
    .bind(await sha256(id))
    .first<{ csrf_hash: string; expires_at: string }>();
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  if (!constantTimeEqual(row.csrf_hash, await sha256(csrfToken))) return null;
  return { id, csrfToken };
}

export const requireAdmin = (): MiddlewareHandler<{ Bindings: Env }> => async (context, next) => {
  const session = await verifySession(context.env.DB, context.env.SESSION_SECRET, getCookie(context, COOKIE_NAME));
  if (!session) return context.json({ error: "Unauthorized" }, 401);
  await next();
};

async function loginBucket(context: { req: { header(name: string): string | undefined }; env: Env }): Promise<string> {
  return sha256(`${context.req.header("cf-connecting-ip") ?? "unknown"}:${context.env.SESSION_SECRET}`);
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (context) => {
  if (!hasTrustedOrigin(context.req.raw, context.env.APP_ORIGIN)) return context.json({ error: "Forbidden" }, 403);
  const bucket = await loginBucket(context);
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const attempts = await context.env.DB.prepare(
    "SELECT failures, window_started_at FROM login_attempts WHERE bucket_hash = ?1",
  )
    .bind(bucket)
    .first<{ failures: number; window_started_at: string }>();
  if (attempts && attempts.window_started_at >= windowStart && attempts.failures >= 5) {
    return context.json({ error: "Too many attempts" }, 429);
  }
  const body: { passphrase?: string } = await context.req.json<{ passphrase?: string }>().catch(() => ({}));
  if (!body.passphrase || !constantTimeEqual(body.passphrase, context.env.ADMIN_PASSPHRASE)) {
    const failures = attempts && attempts.window_started_at >= windowStart ? attempts.failures + 1 : 1;
    const startedAt = attempts && attempts.window_started_at >= windowStart ? attempts.window_started_at : now.toISOString();
    await context.env.DB.prepare(
      `INSERT INTO login_attempts (bucket_hash, window_started_at, failures) VALUES (?1, ?2, ?3)
       ON CONFLICT(bucket_hash) DO UPDATE SET window_started_at = excluded.window_started_at, failures = excluded.failures`,
    )
      .bind(bucket, startedAt, failures)
      .run();
    return context.json({ error: "Invalid credentials" }, 401);
  }

  await context.env.DB.prepare("DELETE FROM login_attempts WHERE bucket_hash = ?1").bind(bucket).run();

  const id = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await context.env.DB.prepare(
    "INSERT INTO sessions (id_hash, csrf_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(await sha256(id), await sha256(csrfToken), expiresAt.toISOString(), now.toISOString())
    .run();

  const signature = await sign(`${id}.${csrfToken}`, context.env.SESSION_SECRET);
  setCookie(context, COOKIE_NAME, `${id}.${csrfToken}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return context.json({ csrfToken });
});

authRoutes.get("/session", async (context) => {
  const session = await verifySession(context.env.DB, context.env.SESSION_SECRET, getCookie(context, COOKIE_NAME));
  return session
    ? context.json({ authenticated: true, csrfToken: session.csrfToken })
    : context.json({ authenticated: false }, 401);
});

authRoutes.post("/logout", async (context) => {
  if (!hasTrustedOrigin(context.req.raw, context.env.APP_ORIGIN)) return context.json({ error: "Forbidden" }, 403);
  const session = await verifySession(context.env.DB, context.env.SESSION_SECRET, getCookie(context, COOKIE_NAME));
  if (!session || !constantTimeEqual(context.req.header("x-csrf-token") ?? "", session.csrfToken)) {
    return context.json({ error: "Unauthorized" }, 401);
  }
  await context.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256(session.id)).run();
  deleteCookie(context, COOKIE_NAME, { path: "/", secure: true, sameSite: "Strict" });
  return context.body(null, 204);
});
