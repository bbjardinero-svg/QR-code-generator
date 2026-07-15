import { TEMPORARY_UPLOAD_MAX_AGE_SECONDS } from "../shared/constants";
import type { Env } from "./env";
import { FileRepository } from "./file-repository";

export async function cleanupTemporaryUploads(env: Env, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TEMPORARY_UPLOAD_MAX_AGE_SECONDS * 1000).toISOString();
  const repository = new FileRepository(env.DB);
  const expired = await repository.expiredTemporary(cutoff);
  let removed = 0;
  for (const file of expired) {
    await env.FILES.delete(file.r2Key);
    if (await repository.remove(file.id)) removed += 1;
  }
  return removed;
}

export function scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): void {
  context.waitUntil(cleanupTemporaryUploads(env));
}
