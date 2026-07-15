# Durable QR Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally verify a single-user Cloudflare application that creates durable QR codes for web links or private R2 files, records scans, and manages content from a responsive dashboard.

**Architecture:** One TypeScript Cloudflare Worker serves a React single-page application, protected JSON APIs, public QR routes, and private R2 file streams. D1 stores QR, file, session, and scan metadata; a private R2 bucket stores files; browser uploads use 10-minute object-specific signed PUT URLs and finalize through the Worker.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, R2, Hono, React, Vite, Zod, `qrcode`, `aws4fetch`, Vitest with Cloudflare Workers pool, React Testing Library, and Playwright.

## Global Constraints

- One administrator only; no user registration, teams, billing, or roles.
- Temporary `workers.dev` addresses are for testing only and must display a permanent-domain warning.
- Maximum stored file size is exactly 100,000,000 bytes.
- The R2 bucket remains private; never enable public `r2.dev` bucket access.
- Upload authorizations expire after 10 minutes and permit one PUT to one object key.
- Store no visitor IP, user agent, location, fingerprint, or unique-visitor identifier.
- A scan is one successful request to an active `/r/:slug` route; repeat requests count separately.
- Scan-write failures must not block delivery of otherwise valid content.
- Finalized files have no automatic expiry; unfinalized temporary uploads are removed after 24 hours.
- Short names are immutable lowercase letters, numbers, and hyphens.
- Stored-file replacement must switch atomically before deleting the previous object.
- Use Standard R2 storage for the first release.
- No resumable multipart uploads or malware-scanning claims in the first release.

---

## Planned file structure

```text
durable-qr-dashboard/
├── migrations/0001_initial.sql          # D1 schema and indexes
├── public/                               # Static icons and manifest
├── src/
│   ├── worker/
│   │   ├── app.ts                       # Hono composition and route mounting
│   │   ├── env.ts                       # Cloudflare binding types
│   │   ├── auth.ts                      # Passphrase login and signed sessions
│   │   ├── security.ts                  # CSRF, headers, rate-limit helpers
│   │   ├── qr-repository.ts             # D1 QR and analytics queries
│   │   ├── file-repository.ts           # D1 stored-file queries
│   │   ├── qr-routes.ts                 # Protected CRUD and export APIs
│   │   ├── upload-routes.ts             # Signed upload and finalize APIs
│   │   ├── public-routes.ts             # Scan recording, redirect, file stream
│   │   └── scheduled.ts                 # Temporary-object cleanup
│   ├── shared/
│   │   ├── schemas.ts                   # Zod inputs and shared DTO types
│   │   └── constants.ts                 # Limits, allowed types, reserved slugs
│   └── ui/
│       ├── main.tsx                     # React entry
│       ├── app.tsx                      # Client router and auth boundary
│       ├── api.ts                       # Typed fetch client
│       ├── styles.css                   # Tokens, responsive and focus styles
│       ├── dashboard-page.tsx           # Overview, filters, QR list
│       ├── create-page.tsx              # Three-step QR creator
│       ├── detail-page.tsx              # QR details, chart and management
│       ├── login-page.tsx               # Single-admin login
│       └── components/                   # Focused reusable UI components
├── test/
│   ├── worker/                           # Worker integration tests
│   ├── ui/                               # React component tests
│   └── e2e/qr-flow.spec.ts               # Browser happy path and accessibility
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── wrangler.jsonc
└── README.md
```

### Task 1: Project foundation and D1 schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`
- Create: `src/worker/env.ts`, `src/worker/app.ts`, `src/shared/constants.ts`
- Create: `migrations/0001_initial.sql`
- Test: `test/worker/health.test.ts`

**Interfaces:**
- Produces: `Env` with `DB: D1Database`, `FILES: R2Bucket`, `ASSETS: Fetcher`, `ADMIN_PASSPHRASE`, `SESSION_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `APP_ORIGIN`.
- Produces: `createApp(): Hono<{ Bindings: Env }>` and `GET /api/health -> { ok: true }`.

- [ ] **Step 1: Write the failing Worker health test**

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("reports Worker and binding readiness", async () => {
    const response = await SELF.fetch("https://example.test/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(env.DB).toBeDefined();
    expect(env.FILES).toBeDefined();
  });
});
```

- [ ] **Step 2: Install the pinned project toolchain and verify the test fails**

Run: `pnpm add hono react react-dom zod qrcode aws4fetch && pnpm add -D typescript vite @vitejs/plugin-react wrangler vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types @types/react @types/react-dom @types/qrcode @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom playwright`

Run: `pnpm vitest run test/worker/health.test.ts`

Expected: FAIL because the Worker entry and bindings do not exist.

- [ ] **Step 3: Add the Worker composition and configuration**

```ts
// src/worker/env.ts
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_PASSPHRASE: string;
  SESSION_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  APP_ORIGIN: string;
}
```

```ts
// src/worker/app.ts
import { Hono } from "hono";
import type { Env } from "./env";

export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
};

export default createApp();
```

Create `wrangler.jsonc` with `main: "src/worker/app.ts"`, a D1 binding named `DB`, an R2 binding named `FILES`, static assets from `dist`, `compatibility_date: "2026-07-15"`, and a daily cleanup trigger. Create `migrations/0001_initial.sql` with `qr_codes`, `stored_files`, `scan_events`, `sessions`, and `login_attempts`; add unique `qr_codes.slug`, scan aggregation, temporary-file age, and session-expiry indexes. Enforce `content_type IN ('url','file')`, `status IN ('active','archived')`, and the URL/file foreign-key shape with SQL checks.

- [ ] **Step 4: Run foundation checks**

Run: `pnpm vitest run test/worker/health.test.ts && pnpm exec tsc --noEmit`

Expected: health PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts vitest.config.ts wrangler.jsonc migrations src/worker/env.ts src/worker/app.ts src/shared/constants.ts test/worker/health.test.ts
git commit -m "chore: scaffold Cloudflare QR application"
```

### Task 2: Validation and D1 repositories

**Files:**
- Create: `src/shared/schemas.ts`
- Create: `src/worker/qr-repository.ts`, `src/worker/file-repository.ts`
- Test: `test/worker/repositories.test.ts`, `test/worker/schemas.test.ts`

**Interfaces:**
- Produces: `createQrInputSchema`, `updateQrInputSchema`, `uploadRequestSchema`.
- Produces: `QrRepository` methods `create`, `findBySlug`, `findById`, `list`, `updateUrl`, `replaceFile`, `setStatus`, `remove`, `recordScan`, `dailyScans`, and `summary`.
- Produces: `FileRepository` methods `create`, `findById`, `markFinalized`, `listStaleTemporary`, and `remove`.

- [ ] **Step 1: Write failing schema and repository tests**

```ts
it("accepts only immutable safe slugs", () => {
  expect(createQrInputSchema.safeParse({ name: "Booklet", slug: "booklet-2026", contentType: "url", destinationUrl: "https://example.org" }).success).toBe(true);
  expect(createQrInputSchema.safeParse({ name: "Bad", slug: "Admin", contentType: "url", destinationUrl: "http://example.org" }).success).toBe(false);
});

it("records timestamp-only scan events", async () => {
  const qr = await repository.create(validUrlQr);
  await repository.recordScan(qr.id, "2026-07-15T03:00:00.000Z");
  expect(await repository.dailyScans(qr.id, 30)).toEqual([{ date: "2026-07-15", scans: 1 }]);
});
```

- [ ] **Step 2: Run the tests and confirm missing-module failures**

Run: `pnpm vitest run test/worker/schemas.test.ts test/worker/repositories.test.ts`

Expected: FAIL because schemas and repositories are undefined.

- [ ] **Step 3: Implement exact shared validation rules and parameterized D1 queries**

```ts
export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80).refine((value) => !RESERVED_SLUGS.has(value));
export const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:");
export const MAX_FILE_BYTES = 100_000_000;
```

Repository queries must select explicit columns, use bound parameters, return typed DTOs, and wrap file replacement plus QR switching in one D1 batch. `recordScan` accepts only QR ID and UTC timestamp.

- [ ] **Step 4: Run repository tests and migration validation**

Run: `pnpm vitest run test/worker/schemas.test.ts test/worker/repositories.test.ts`

Expected: all schema and repository tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/worker/qr-repository.ts src/worker/file-repository.ts test/worker
git commit -m "feat: add QR data model and validation"
```

### Task 3: Single-admin authentication and request security

**Files:**
- Create: `src/worker/auth.ts`, `src/worker/security.ts`
- Modify: `src/worker/app.ts`
- Test: `test/worker/auth.test.ts`, `test/worker/security.test.ts`

**Interfaces:**
- Produces: `requireAdmin`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`.
- Produces: `issueSession(db, secret)`, `verifySession(db, secret, cookie)`, `requireCsrf(c)`, and `securityHeaders()`.

- [ ] **Step 1: Write failing login, expiry, rate-limit, CSRF, and header tests**

```ts
it("creates an opaque secure session without exposing the passphrase", async () => {
  const response = await SELF.fetch("https://example.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: "test-passphrase" }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toMatch(/HttpOnly;.*Secure;.*SameSite=Strict/);
  expect(await response.text()).not.toContain("test-passphrase");
});
```

- [ ] **Step 2: Run authentication tests to verify failure**

Run: `pnpm vitest run test/worker/auth.test.ts test/worker/security.test.ts`

Expected: FAIL with auth routes not found.

- [ ] **Step 3: Implement Web Crypto sessions and protection**

Use constant-time comparison for the configured passphrase and 32-byte random session IDs signed with HMAC-SHA-256. Store only SHA-256 hashes of session IDs in D1. Use a 12-hour expiry, rotation on login, logout deletion, Strict secure cookies, and an origin-bound CSRF token. Permit five failed logins per 15-minute hashed network bucket, without retaining raw IP values. Apply CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, frame denial, and restrictive permissions policy.

- [ ] **Step 4: Run authentication and security tests**

Run: `pnpm vitest run test/worker/auth.test.ts test/worker/security.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth.ts src/worker/security.ts src/worker/app.ts test/worker/auth.test.ts test/worker/security.test.ts
git commit -m "feat: secure the single-admin dashboard"
```

### Task 4: QR CRUD, rendering, export, and analytics APIs

**Files:**
- Create: `src/worker/qr-routes.ts`, `src/worker/qr-renderer.ts`
- Modify: `src/worker/app.ts`
- Test: `test/worker/qr-routes.test.ts`, `test/worker/qr-renderer.test.ts`

**Interfaces:**
- Produces: authenticated `/api/qr`, `/api/qr/:id`, `/api/qr/:id/png`, `/api/qr/:id/svg`, `/api/qr/:id/scans`, `/api/summary`, and `/api/export.:format` routes.
- Produces: `renderQrPng(url, color): Promise<Uint8Array>` and `renderQrSvg(url, color): Promise<string>`.

- [ ] **Step 1: Write failing CRUD and QR reliability tests**

Test unauthenticated rejection, URL QR creation, duplicate slug `409`, immutable slug, archive/restore, JSON/CSV export, PNG signature bytes, SVG quiet zone, high error correction, and rejection of low-contrast colors.

- [ ] **Step 2: Run tests and verify route failures**

Run: `pnpm vitest run test/worker/qr-routes.test.ts test/worker/qr-renderer.test.ts`

Expected: FAIL with protected routes missing.

- [ ] **Step 3: Implement APIs with stable public URLs**

Build public QR URLs from the request origin and immutable slug. Configure `qrcode` with error correction `M`, margin `4`, width `1024` for PNG, and equivalent SVG settings. Allow only the approved dark palette `#102f29`, `#000000`, and `#1f8a70`. Escape CSV cells beginning with `=`, `+`, `-`, or `@` to prevent spreadsheet formula injection.

- [ ] **Step 4: Run QR API tests**

Run: `pnpm vitest run test/worker/qr-routes.test.ts test/worker/qr-renderer.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/qr-routes.ts src/worker/qr-renderer.ts src/worker/app.ts test/worker
git commit -m "feat: add QR management APIs"
```

### Task 5: Private R2 direct uploads, finalization, replacement, and cleanup

**Files:**
- Create: `src/worker/upload-routes.ts`, `src/worker/scheduled.ts`
- Modify: `src/worker/app.ts`, `src/shared/constants.ts`
- Test: `test/worker/uploads.test.ts`, `test/worker/cleanup.test.ts`

**Interfaces:**
- Produces: `POST /api/uploads/authorize -> { uploadId, objectKey, uploadUrl, expiresAt }`.
- Produces: `POST /api/uploads/:id/finalize -> StoredFileDto` and `POST /api/qr/:id/replace-file`.
- Produces: `cleanupTemporaryUploads(env, now): Promise<number>`.

- [ ] **Step 1: Write failing upload security and lifecycle tests**

Test 100,000,000-byte acceptance, 100,000,001-byte rejection, ten-minute expiry, one-key PUT scope, exact-origin CORS, MIME/extension mismatch rejection, executable rejection, finalize-before-publish, replacement rollback, and 24-hour temporary cleanup.

- [ ] **Step 2: Run upload tests and confirm failures**

Run: `pnpm vitest run test/worker/uploads.test.ts test/worker/cleanup.test.ts`

Expected: FAIL because upload routes do not exist.

- [ ] **Step 3: Implement signed direct uploads and atomic finalization**

Use `AwsClient` from `aws4fetch` with R2 S3 credentials held only in Worker secrets. Generate `PUT https://<account>.r2.cloudflarestorage.com/<bucket>/<temporary-key>` signatures with 600-second expiry, signed content length/type metadata, and UUID keys under `temporary/`. On finalize, use the R2 binding `head` result to verify size, ETag, and metadata before moving/copying to a non-guessable `files/` key and creating D1 records. Delete the old R2 object only after a replacement transaction succeeds.

- [ ] **Step 4: Run upload and cleanup tests**

Run: `pnpm vitest run test/worker/uploads.test.ts test/worker/cleanup.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/upload-routes.ts src/worker/scheduled.ts src/worker/app.ts src/shared/constants.ts test/worker
git commit -m "feat: add private R2 file lifecycle"
```

### Task 6: Public scan, redirect, and file-delivery routes

**Files:**
- Create: `src/worker/public-routes.ts`, `src/worker/status-pages.ts`
- Modify: `src/worker/app.ts`
- Test: `test/worker/public-routes.test.ts`

**Interfaces:**
- Produces: public `GET /r/:slug` and non-counting authenticated `GET /api/qr/:id/preview`.

- [ ] **Step 1: Write failing public-route tests**

Test web `302`, streamed PDF headers, byte-range file requests, repeat scan counting, no visitor metadata columns, archived/missing pages, missing R2 object behavior, and successful delivery when `recordScan` throws.

- [ ] **Step 2: Run the route tests to verify failure**

Run: `pnpm vitest run test/worker/public-routes.test.ts`

Expected: FAIL with `/r/:slug` missing.

- [ ] **Step 3: Implement content delivery without analytics blocking**

Start scan insertion with `c.executionCtx.waitUntil(...)`; resolve content first and do not await the scan write before returning. For R2 objects, stream `object.body`, support valid byte ranges, use the stored ETag, set `nosniff`, sanitize `Content-Disposition`, render PDF/images inline, and force other allowed types to attachment. Render accessible branded HTML for missing, archived, and storage-error states without revealing destinations or object keys.

- [ ] **Step 4: Run public-route tests**

Run: `pnpm vitest run test/worker/public-routes.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/public-routes.ts src/worker/status-pages.ts src/worker/app.ts test/worker/public-routes.test.ts
git commit -m "feat: deliver QR content and record scans"
```

### Task 7: Dashboard shell and management list

**Files:**
- Create: `src/ui/main.tsx`, `src/ui/app.tsx`, `src/ui/api.ts`, `src/ui/styles.css`
- Create: `src/ui/login-page.tsx`, `src/ui/dashboard-page.tsx`
- Create: `src/ui/components/app-shell.tsx`, `src/ui/components/qr-list.tsx`, `src/ui/components/status-message.tsx`
- Test: `test/ui/login-page.test.tsx`, `test/ui/dashboard-page.test.tsx`

**Interfaces:**
- Produces: authenticated React shell with Dashboard, Create QR, and Sign out navigation.
- Consumes: session, summary, and list APIs from Tasks 3 and 4.

- [ ] **Step 1: Write failing accessible UI tests**

Test labeled login, visible invalid-login error, keyboard navigation, loading skeleton, empty dashboard, API-error retry, search, status filter, storage meter, and responsive navigation semantics.

- [ ] **Step 2: Run UI tests and verify component failures**

Run: `pnpm vitest run test/ui/login-page.test.tsx test/ui/dashboard-page.test.tsx`

Expected: FAIL because React pages do not exist.

- [ ] **Step 3: Implement the approved management-first visual system**

Use the approved deep green `#123c35`, action green `#1f8a70`, lime accent `#d9f99d`, warm white surfaces, system-first readable typography, 44px minimum targets, visible `:focus-visible` rings, semantic landmarks, and a single-column mobile layout below 760px. Do not copy the reference site's branding or excessive navigation. Keep dashboard summary cards to QR totals, scans, and R2 storage.

- [ ] **Step 4: Run UI tests and production build**

Run: `pnpm vitest run test/ui/login-page.test.tsx test/ui/dashboard-page.test.tsx && pnpm vite build`

Expected: tests PASS and `dist/` builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/ui test/ui vite.config.ts
git commit -m "feat: build QR management dashboard"
```

### Task 8: Three-step creator and QR detail experience

**Files:**
- Create: `src/ui/create-page.tsx`, `src/ui/detail-page.tsx`
- Create: `src/ui/components/file-upload.tsx`, `src/ui/components/qr-preview.tsx`, `src/ui/components/scan-chart.tsx`, `src/ui/components/confirm-dialog.tsx`
- Modify: `src/ui/app.tsx`, `src/ui/api.ts`
- Test: `test/ui/create-page.test.tsx`, `test/ui/detail-page.test.tsx`

**Interfaces:**
- Consumes: QR CRUD, signed upload, finalization, file replacement, archive, delete, scan-series, PNG, and SVG APIs.
- Produces: approved Content → Design → Review flow and detail-management page.

- [ ] **Step 1: Write failing creator and detail tests**

Test web/file type choice, drag-and-drop and file picker parity, 100 MB validation, disallowed formats, progress, retry without lost metadata, high-contrast palette, review warning, copy feedback, PNG/SVG actions, destination edit, file replacement, archive/restore, and typed permanent-delete confirmation.

- [ ] **Step 2: Run component tests to verify failure**

Run: `pnpm vitest run test/ui/create-page.test.tsx test/ui/detail-page.test.tsx`

Expected: FAIL because pages are missing.

- [ ] **Step 3: Implement resilient creation and management flows**

Use `XMLHttpRequest` only for the direct PUT so upload progress is observable; use the typed fetch client elsewhere. Keep form state until finalization succeeds. Require the user to type the QR name before permanent deletion. Render the daily scan chart as an accessible SVG with a textual summary and no charting dependency.

- [ ] **Step 4: Run creator/detail tests and all unit tests**

Run: `pnpm vitest run`

Expected: all Worker and UI tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui test/ui
git commit -m "feat: add QR creation and detail workflows"
```

### Task 9: End-to-end verification, operations documentation, and local handoff

**Files:**
- Create: `test/e2e/qr-flow.spec.ts`, `playwright.config.ts`, `public/manifest.webmanifest`
- Create: `README.md`, `.dev.vars.example`, `.gitignore`
- Modify: `package.json`, `wrangler.jsonc`

**Interfaces:**
- Produces: repeatable local setup, test, migration, secret, R2 CORS, temporary deployment, export, and recovery instructions.

- [ ] **Step 1: Write the failing end-to-end smoke test**

```ts
test("creates a web QR and preserves its route after editing", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Administrator passphrase").fill("local-test-passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Create QR" }).click();
  await page.getByRole("button", { name: "Web link" }).click();
  await page.getByLabel("QR name").fill("Innovation catalogue");
  await page.getByLabel("Short name").fill("innovation-catalogue");
  await page.getByLabel("Public destination").fill("https://example.org/catalogue");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save QR code" }).click();
  await expect(page.getByText(/workers\.dev.*innovation-catalogue/)).toBeVisible();
});
```

- [ ] **Step 2: Run end-to-end test and verify the initial failure**

Run: `pnpm playwright test test/e2e/qr-flow.spec.ts`

Expected: FAIL until the local Worker and seeded test bindings are wired into Playwright webServer.

- [ ] **Step 3: Add local operations and deployment documentation**

Document exact commands for `wrangler d1 migrations apply --local`, local R2 persistence, `.dev.vars`, test passphrase, production D1/R2 creation, bucket CORS restricted to the deployed origin, R2 API token scope, `wrangler secret put`, temporary `workers.dev` deployment, CSV/JSON export, and the warning not to distribute permanent codes before adding a custom domain. Do not include real secrets or account identifiers.

- [ ] **Step 4: Run the complete release gate**

Run: `pnpm exec tsc --noEmit && pnpm vitest run && pnpm vite build && pnpm playwright test`

Expected: TypeScript exits 0, all unit/integration tests PASS, production build succeeds, and end-to-end tests PASS.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional documentation or generated-lock changes remain.

- [ ] **Step 5: Commit the verified local release**

```bash
git add README.md .dev.vars.example .gitignore package.json pnpm-lock.yaml playwright.config.ts public test/e2e wrangler.jsonc
git commit -m "test: verify durable QR dashboard release"
```

## Manual deployment checkpoint

Deployment is intentionally outside unattended implementation. When local verification passes, the owner must create/sign in to a Cloudflare account, authorize Wrangler, create the production D1 database and private R2 bucket, configure secrets and exact-origin CORS, and approve the first deployment. No permanent QR codes should be distributed from the temporary `workers.dev` hostname.
