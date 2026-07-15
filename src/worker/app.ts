import { Hono } from "hono";
import { authRoutes } from "./auth";
import type { Env } from "./env";
import { securityHeaders } from "./security";

export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", securityHeaders());
  app.get("/api/health", (context) => context.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.notFound((context) => context.text("Not found", 404));

  return app;
};

export default createApp();
