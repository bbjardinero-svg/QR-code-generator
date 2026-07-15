import { Hono } from "hono";
import { authRoutes } from "./auth";
import type { Env } from "./env";
import { qrRoutes } from "./qr-routes";
import { scheduled } from "./scheduled";
import { securityHeaders } from "./security";
import { uploadRoutes } from "./upload-routes";

export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", securityHeaders());
  app.get("/api/health", (context) => context.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api", qrRoutes);
  app.route("/api", uploadRoutes);
  app.notFound((context) => context.text("Not found", 404));

  return app;
};

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled,
};
