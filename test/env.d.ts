import type { Env as WorkerEnv } from "../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
    }
  }
}

export {};
