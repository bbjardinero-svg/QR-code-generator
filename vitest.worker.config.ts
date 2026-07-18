import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          ADMIN_PASSPHRASE: "test-passphrase",
          SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
          APP_ORIGIN: "https://example.test",
          R2_ACCOUNT_ID: "test-account",
          R2_BUCKET_NAME: "everqr-files-test",
          R2_ACCESS_KEY_ID: "test-access-key",
          R2_SECRET_ACCESS_KEY: "test-secret-key",
        },
      },
    })),
  ],
  test: {
    name: "worker",
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
