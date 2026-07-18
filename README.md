# EverQR

EverQR is a private, single-administrator QR registry for Cloudflare. It creates stable QR addresses for web links and files, keeps files in a private R2 bucket, and records aggregate scan counts without storing visitor IP addresses.

The QR image always encodes EverQR's public route (`/r/<short-name>`), not the current destination. You can therefore change a web destination or replace a file later without reprinting the QR code. The public hostname is still part of the encoded address, so add a custom domain before distributing long-lived production codes.

## What the first version includes

- A passphrase-protected dashboard for one administrator
- Web-link and file QR codes
- Private R2 file delivery with byte-range support
- A 100,000,000-byte (100 MB) limit per uploaded file
- PNG and SVG QR downloads
- Scan totals and a recent scan chart
- Archive, restore, destination editing, file replacement, and typed deletion
- JSON and CSV metadata exports
- No raw IP address, device fingerprint, or visitor profile storage

Supported file types are PDF, JPEG, PNG, WebP, plain text, CSV, Microsoft Word, and PowerPoint. The R2 bucket must remain private; files are served only through the Worker route.

## Architecture

- **Cloudflare Worker:** API, authentication, redirects, private file streaming, and scan recording
- **Cloudflare D1:** QR records, scan events, sessions, login throttling, and file metadata
- **Cloudflare R2:** private file objects
- **React and Vite:** administrator dashboard

Metadata export is not a full backup: the CSV and JSON files do not contain the R2 file objects.

## Local setup

Requirements: Node.js 20 or newer and pnpm. Cloudflare sign-in is not required for link-only local development or the automated test suite.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm build
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev --local --env-file .dev.vars
```

Open [http://localhost:8787](http://localhost:8787) and sign in with the passphrase in `.dev.vars`. Change the sample passphrase and session secret if the local server is available to anyone else.

Wrangler preserves local D1 and R2 data under `.wrangler/state`. Removing that directory resets local state. The sample R2 API credentials are placeholders: link QR codes work fully locally, while direct browser-to-R2 file uploads require real, bucket-scoped R2 S3 credentials. The Worker file lifecycle and delivery paths are covered with local R2 bindings in the integration tests.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Run all four release checks with:

```sh
pnpm check
```

The end-to-end test starts a local Worker on port 8787 and verifies that editing a web destination preserves the public QR route.

## Production deployment checklist

These commands create or change Cloudflare resources. Run them only when the account owner is present and has approved deployment.

1. Authenticate Wrangler:

   ```sh
   pnpm exec wrangler login
   ```

2. Create the production D1 database and update `wrangler.jsonc` with the returned database ID:

   ```sh
   pnpm exec wrangler d1 create everqr
   ```

3. Create the private R2 bucket. Do not enable an `r2.dev` public URL:

   ```sh
   pnpm exec wrangler r2 bucket create everqr-files --storage-class Standard
   ```

4. In Cloudflare, create an R2 API token limited to object read/write access for this bucket only. Record its Access Key ID and Secret Access Key. Do not commit either value.

5. Add production secrets one at a time:

   ```sh
   pnpm exec wrangler secret put ADMIN_PASSPHRASE
   pnpm exec wrangler secret put SESSION_SECRET
   pnpm exec wrangler secret put R2_ACCOUNT_ID
   pnpm exec wrangler secret put R2_ACCESS_KEY_ID
   pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
   ```

   Use a long, unique administrator passphrase and a randomly generated session secret. Confirm that `R2_BUCKET_NAME` in `wrangler.jsonc` matches the production bucket.

6. Copy `r2-cors.example.json` to an untracked working file and replace the placeholder with the exact deployed origin. Then apply it:

   ```sh
   pnpm exec wrangler r2 bucket cors set everqr-files --file r2-cors.json
   ```

   Do not use a wildcard origin. If the hostname changes, update both R2 CORS and `APP_ORIGIN`.

7. Apply D1 migrations, build, inspect a dry run, and deploy only after the owner approves:

   ```sh
   pnpm exec wrangler d1 migrations apply DB --remote
   pnpm build
   pnpm exec wrangler deploy --dry-run
   pnpm exec wrangler deploy
   ```

8. Test login, create a disposable link QR, scan it without being signed in, upload a small disposable file, and confirm scan counts. Delete the disposable records afterward.

The first deployment may use a temporary `workers.dev` hostname. Do not distribute permanent QR codes from it. A later custom-domain change cannot rewrite addresses already printed inside QR images.

## Export, backup, and recovery

The dashboard provides **Export CSV** and **Export JSON** for QR metadata. Use those for review and portability, not as the only backup.

Export D1 periodically:

```sh
mkdir -p backups
pnpm exec wrangler d1 export DB --remote --output backups/everqr-YYYY-MM-DD.sql
```

Back up R2 objects separately with an S3-compatible backup tool or retain the original source files. Protect backup copies because file names and destinations may be sensitive.

For recovery:

1. Restore R2 objects with their original object keys.
2. Restore the matching D1 export to the replacement database.
3. Apply any newer migrations.
4. Restore the same public hostname and Worker route.
5. Test representative link and file scans before resuming use.
6. Rotate credentials if the incident may have exposed them.

## Operations notes

- A daily scheduled cleanup removes abandoned temporary uploads older than 24 hours.
- Archiving hides a QR from normal active use but keeps its public route and history.
- Deleting a QR is permanent. An R2 object is deleted only when no other QR record references it.
- Scan recording runs independently of delivery, so a temporary analytics failure should not block a redirect or file response.
- Keep the Worker, D1 database, R2 bucket, domain, and backup routine under an account you control for the intended lifetime of the QR codes.
