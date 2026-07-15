import { Hono } from "hono";
import type { Env } from "./env";

export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (context) => context.json({ ok: true }));
  app.notFound((context) => context.text("Not found", 404));

  return app;
};

export default createApp();
