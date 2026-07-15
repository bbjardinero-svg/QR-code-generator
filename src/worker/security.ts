import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

export const securityHeaders = (): MiddlewareHandler<{ Bindings: Env }> => async (context, next) => {
  await next();
  context.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header("X-Frame-Options", "DENY");
};

export function hasTrustedOrigin(request: Request, appOrigin: string): boolean {
  return request.headers.get("origin") === appOrigin;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
