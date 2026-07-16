# EverQR Direct R2 Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web client's failing presigned S3 upload with an authenticated same-origin request that streams files of up to 100,000,000 bytes through the Worker into private R2 storage.

**Architecture:** Add `POST /api/uploads/direct` beside the existing rollback endpoints. The route validates headers with the existing upload schema, streams `Request.body` into the `FILES` binding, verifies the returned object, finalizes the D1 record, and rolls back both stores on failure. `ApiClient.uploadFile` sends the raw `File` with `XMLHttpRequest` so the current progress UI remains unchanged.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare Workers, R2, D1, React 19, XMLHttpRequest, Vitest Workers pool, Playwright.

## Global Constraints

- Maximum file size remains exactly `100_000_000` bytes.
- The R2 bucket remains private; public delivery continues through `/r/:slug`.
- Uploads remain admin-only, same-origin, and CSRF-protected.
- Stream the request body; do not call `arrayBuffer()`, `blob()`, or `formData()` in the Worker.
- Preserve the existing QR wizard, progress UI, replacement flow, stable routes, deletion behavior, and scan analytics.
- Keep the presigned authorization/finalization endpoints temporarily for rollback, but do not call them from the web client.
- Do not add dependencies.

---

### Task 1: Stream authenticated uploads into the R2 binding

**Files:**
- Modify: `src/worker/upload-routes.ts:24-142`
- Modify: `test/worker/uploads.test.ts:42-186`

**Interfaces:**
- Consumes: `uploadRequestSchema`, `FileRepository.createTemporary`, `FileRepository.finalize`, `Env.FILES.put`, `requireAdmin`, and `requireCsrf`.
- Produces: `POST /api/uploads/direct`, returning `StoredFileDto` with HTTP 201.

- [ ] **Step 1: Add a failing direct-upload test helper and success test**

```ts
async function directUpload(
  fileName: string,
  mediaType: string,
  bytes: Uint8Array,
  declaredSize = bytes.byteLength,
): Promise<{ response: Response; file?: StoredFileDto }> {
  const response = await SELF.fetch("https://example.test/api/uploads/direct", {
    method: "POST",
    headers: {
      ...headers(false),
      "content-type": mediaType,
      "x-everqr-file-name": encodeURIComponent(fileName),
      "x-everqr-file-size": String(declaredSize),
    },
    body: bytes,
  });
  return { response, file: response.ok ? await response.json<StoredFileDto>() : undefined };
}

it("streams a validated upload through the Worker and finalizes it", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const uploaded = await directUpload("direct.pdf", "application/pdf", bytes);
  expect(uploaded.response.status).toBe(201);
  expect(uploaded.file).toMatchObject({ originalName: "direct.pdf", sizeBytes: 4, etag: expect.any(String) });

  const record = await new FileRepository(env.DB).findById(uploaded.file!.id);
  expect(record).toMatchObject({ state: "finalized", mediaType: "application/pdf", sizeBytes: 4 });
  expect(record!.r2Key).toMatch(/^files\/[0-9a-f-]+$/);
  const object = await env.FILES.head(record!.r2Key);
  expect(object).toMatchObject({ size: 4, httpMetadata: { contentType: "application/pdf" } });
});
```

- [ ] **Step 2: Run the focused test and verify the missing route fails**

Run: `pnpm test test/worker/uploads.test.ts`

Expected: FAIL because `POST /api/uploads/direct` returns 404.

- [ ] **Step 3: Implement header decoding and streamed R2 storage**

Import `type Context` from `hono`, then add above the route declarations:

```ts
function directUploadInput(context: Context<{ Bindings: Env }>) {
  let fileName = "";
  try {
    fileName = decodeURIComponent(context.req.header("x-everqr-file-name") ?? "");
  } catch {
    fileName = "";
  }
  return {
    fileName,
    mediaType: (context.req.header("content-type") ?? "").split(";", 1)[0].trim().toLowerCase(),
    sizeBytes: Number(context.req.header("x-everqr-file-size")),
  };
}
```

Add before `/uploads/authorize`:

```ts
uploadRoutes.post("/uploads/direct", requireCsrf(), async (context) => {
  const parsed = uploadRequestSchema.safeParse(directUploadInput(context));
  if (!parsed.success || !context.req.raw.body) {
    return context.json({ error: "Invalid file", issues: parsed.success ? undefined : parsed.error.flatten().fieldErrors }, 400);
  }

  const repository = new FileRepository(context.env.DB);
  const record = await repository.createTemporary({
    id: crypto.randomUUID(),
    r2Key: `files/${crypto.randomUUID()}`,
    originalName: parsed.data.fileName,
    mediaType: parsed.data.mediaType.toLowerCase(),
    sizeBytes: parsed.data.sizeBytes,
    createdAt: new Date().toISOString(),
  });

  try {
    const stored = await context.env.FILES.put(record.r2Key, context.req.raw.body, {
      httpMetadata: { contentType: record.mediaType },
      customMetadata: uploadMetadata(record),
    });
    if (!metadataMatches(stored, record)) {
      await context.env.FILES.delete(record.r2Key);
      await repository.remove(record.id);
      return context.json({ error: "Stored object does not match the upload" }, 409);
    }
    const finalized = await repository.finalize(record.id, record.r2Key, stored.etag);
    if (!finalized) {
      await context.env.FILES.delete(record.r2Key);
      await repository.remove(record.id);
      return context.json({ error: "Upload state changed; retry upload" }, 409);
    }
    return context.json(fileDto(finalized), 201);
  } catch (error) {
    await context.env.FILES.delete(record.r2Key).catch(() => undefined);
    await repository.remove(record.id).catch(() => undefined);
    console.error("Unable to store direct R2 upload", error);
    return context.json({ error: "Unable to store upload" }, 503);
  }
});
```

- [ ] **Step 4: Add validation and rollback regression tests**

```ts
it("rejects invalid direct uploads and removes size-mismatched objects", async () => {
  expect((await directUpload("too-large.pdf", "application/pdf", new Uint8Array([1]), 100_000_001)).response.status).toBe(400);
  expect((await directUpload("malware.exe", "application/octet-stream", new Uint8Array([1]))).response.status).toBe(400);

  const mismatched = await directUpload("mismatch.pdf", "application/pdf", new Uint8Array([1, 2, 3]), 4);
  expect(mismatched.response.status).toBe(409);
  const rows = await env.DB.prepare("SELECT id, r2_key FROM stored_files WHERE original_name = ?1").bind("mismatch.pdf").all();
  expect(rows.results).toHaveLength(0);
});

it("protects direct uploads with the existing admin and CSRF checks", async () => {
  const response = await SELF.fetch("https://example.test/api/uploads/direct", {
    method: "POST",
    headers: {
      cookie: admin.cookie,
      origin: "https://attacker.example",
      "x-csrf-token": admin.csrfToken,
      "content-type": "text/plain",
      "x-everqr-file-name": "safe.txt",
      "x-everqr-file-size": "4",
    },
    body: "safe",
  });
  expect(response.status).toBe(403);
});
```

- [ ] **Step 5: Run worker tests, type checking, and commit**

Run: `pnpm test test/worker/uploads.test.ts`

Expected: all upload lifecycle tests pass.

Run: `pnpm typecheck`

Expected: exit 0 with no TypeScript errors.

Commit:

```bash
git add src/worker/upload-routes.ts test/worker/uploads.test.ts
git commit -m "fix: stream file uploads through Worker R2 binding"
```

### Task 2: Switch the web client and cover the complete file QR flow

**Files:**
- Modify: `src/ui/api.ts:186-219`
- Modify: `test/e2e/qr-flow.spec.ts:1-end`

**Interfaces:**
- Consumes: `POST /api/uploads/direct` and the existing `StoredFileDto`.
- Produces: `ApiClient.uploadFile(file, onProgress)` with the same public TypeScript signature and progress callbacks.

- [ ] **Step 1: Add a failing Playwright file-QR test**

```ts
test("uploads a private file, delivers it through the stable route, and records a scan", async ({ page }) => {
  const slug = `r2-delivery-${Date.now()}`;
  const contents = "EverQR local R2 delivery check";

  await page.goto("/");
  await page.getByLabel("Admin passphrase").fill("local-test-passphrase");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await page.getByRole("button", { name: "Create QR code" }).click();
  await page.getByRole("radio", { name: /stored file/i }).check();
  await page.getByLabel("Name", { exact: true }).fill("R2 delivery check");
  await page.getByLabel("Short link").fill(slug);
  await page.getByLabel("Choose file").setInputFiles({ name: "delivery.txt", mimeType: "text/plain", buffer: Buffer.from(contents) });
  await page.getByRole("button", { name: "Continue to design" }).click();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("button", { name: "Create QR code", exact: true }).click();

  await expect(page).toHaveURL(/\/qr\/[0-9a-f-]+$/);
  const delivery = await page.request.get(`/r/${slug}`);
  expect(delivery.status()).toBe(200);
  expect(delivery.headers()["content-type"]).toContain("text/plain");
  expect(await delivery.text()).toBe(contents);
  await page.reload();
  await expect(page.getByText("1 all-time scans")).toBeVisible();
});
```

- [ ] **Step 2: Run the file E2E test and verify the old presigned client fails**

Run: `pnpm test:e2e --grep "uploads a private file"`

Expected: FAIL because the browser client still calls `/api/uploads/authorize` and the external presigned R2 endpoint.

- [ ] **Step 3: Replace the two-stage client upload with one same-origin XHR**

Replace `ApiClient.uploadFile` with:

```ts
async uploadFile(file: File, onProgress: (percent: number) => void): Promise<StoredFileDto> {
  return new Promise<StoredFileDto>((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open("POST", "/api/uploads/direct");
    upload.setRequestHeader("content-type", file.type);
    upload.setRequestHeader("x-everqr-file-name", encodeURIComponent(file.name));
    upload.setRequestHeader("x-everqr-file-size", String(file.size));
    if (this.csrfToken) upload.setRequestHeader("x-csrf-token", this.csrfToken);
    upload.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    upload.addEventListener("load", () => {
      const body = (() => {
        try { return JSON.parse(upload.responseText) as StoredFileDto | { error?: string }; }
        catch { return null; }
      })();
      if (upload.status >= 200 && upload.status < 300 && body) {
        onProgress(100);
        resolve(body as StoredFileDto);
      } else {
        const message = body && "error" in body && body.error ? body.error : "Direct R2 upload failed";
        reject(new ApiError(message, upload.status, body));
      }
    });
    upload.addEventListener("error", () => reject(new ApiError("Direct R2 upload failed", 0)));
    upload.addEventListener("abort", () => reject(new ApiError("Direct R2 upload was cancelled", 0)));
    upload.send(file);
  });
}
```

- [ ] **Step 4: Run focused UI and browser tests, then commit**

Run: `pnpm test test/ui/create-page.test.tsx`

Expected: all CreatePage tests pass without changing the public `CreateApi` contract.

Run: `pnpm test:e2e --grep "uploads a private file"`

Expected: the file QR is created, delivered, and reports one scan.

Commit:

```bash
git add src/ui/api.ts test/e2e/qr-flow.spec.ts
git commit -m "fix: upload private files through EverQR Worker"
```

### Task 3: Verify, deploy, and close the production loop

**Files:**
- Modify: `wrangler.jsonc:13-32` only if the production bindings differ from the verified account resources.
- No application code changes unless a failing check produces a new TDD cycle.

**Interfaces:**
- Consumes: the completed Worker endpoint and client flow.
- Produces: a verified production deployment and updated draft PR branch.

- [ ] **Step 1: Run the complete local release gate**

Run: `pnpm check`

Expected: type checking passes, all Vitest files pass, Vite builds, and both Playwright QR flows pass.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 2: Commit the verified production binding configuration**

```bash
git add wrangler.jsonc
git commit -m "chore: configure Cloudflare production deployment"
```

- [ ] **Step 3: Deploy the release**

Run: `WRANGLER_LOG_PATH=.wrangler/wrangler-deploy.log pnpm exec wrangler deploy`

Expected: deployment succeeds with D1 `everqr`, R2 `everqr-files`, and `APP_ORIGIN=https://everqr.bbjardinero-svg.workers.dev`.

- [ ] **Step 4: Verify the live disposable file QR**

Use the existing signed-in form to upload `EverQR-R2-test.txt` under slug `everqr-r2-check-20260716`. Confirm the detail page appears, then request `https://everqr.bbjardinero-svg.workers.dev/r/everqr-r2-check-20260716` once.

Expected: HTTP 200, `content-type: text/plain`, attachment filename `EverQR-R2-test.txt`, exact 123-byte body, and one all-time scan on the detail page.

- [ ] **Step 5: Delete only the disposable QR and verify Kaakbai**

Delete `everqr-r2-check-20260716` through its detail page and type the exact confirmation requested by the UI.

Expected: its D1 QR/file records and final R2 object are removed. `https://everqr.bbjardinero-svg.workers.dev/r/kaakbai` still returns HTTP 302 to `https://kaakbai.aimagineers.io/`, and the Kaakbai detail page retains its prior scan history.

- [ ] **Step 6: Push the implementation branch and verify the draft PR**

Run: `git push origin everqr-implementation`

Expected: the branch updates successfully and draft PR `#1` points to the final commit.
