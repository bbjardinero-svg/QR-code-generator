# Durable QR Dashboard Design

Date: 2026-07-15  
Working product name: EverQR  
Status: Approved for implementation planning

## Objective

Build an open-source, single-user web application that creates durable QR codes for web links or files stored in Cloudflare R2, records scan counts, and allows destinations or stored files to change without reprinting the QR code.

The first deployment will use a temporary Cloudflare `workers.dev` address for development and testing. It is not intended for long-term printed distribution. Before permanent distribution, the owner should connect a domain they control so the encoded QR addresses remain portable across hosting providers.

## Users and scope

The first release has one administrator. Visitors do not create accounts; they only scan public QR codes and receive either a redirect to a web destination or a file streamed from private R2 storage.

Included:

- Private dashboard for one administrator
- QR creation from a public HTTPS link
- Authenticated file upload to private Cloudflare R2 storage
- File delivery for uploads up to 100 MB per file
- Stable redirect URL for every QR code
- Editable web destination or replaceable stored file without changing the QR image
- QR export as PNG and SVG
- Searchable QR list with status and scan totals
- QR detail view with daily scan history
- Archive and restore actions
- JSON and CSV data export
- Responsive layout and accessible interaction states

Excluded from the first release:

- Verified download tracking
- Multiple users, roles, or teams
- Subscriptions or billing
- Folders, bulk operations, passwords per QR, and advanced QR templates
- IP-based uniqueness, device fingerprinting, or visitor profiling

## Architecture

The application will use Cloudflare Workers with static assets for the user interface and server routes. Cloudflare D1 will store QR records, file metadata, and scan events. A private Cloudflare R2 bucket will store uploaded files in Standard storage.

Public QR codes encode an app-owned redirect URL:

`https://<temporary-worker>.workers.dev/r/<short-name>`

For a web-link QR, the public request performs these steps:

1. Find the active QR record by short name.
2. Record a scan event containing only the QR identifier and timestamp.
3. Return an HTTP redirect to the current external destination.

For a stored-file QR, the public request records the scan, retrieves the current R2 object through a Worker binding, and streams it to the visitor with the stored content type and safe response headers. The R2 bucket remains private; neither bucket listing nor direct `r2.dev` public access is enabled.

The redirect URL stays stable when the administrator edits the destination. A future custom domain can replace the temporary host, but QR codes generated with the temporary host will not update automatically. The interface must therefore display a persistent warning while the app uses `workers.dev`.

## Application components

### Public redirect handler

The handler owns `/r/:slug`. It validates the slug, retrieves an active QR record, records a scan, and either redirects to its web destination or streams its current R2 object. It returns a branded unavailable page for missing or archived records.

Scan recording should not prevent access to valid content. If the scan insert fails after the QR record is found, the handler still redirects or streams the file and records an operational error in Cloudflare logs.

### Private R2 file storage

The administrator can upload one file of up to 100 MB (100,000,000 bytes) for a stored-file QR. The browser first requests a short-lived, object-specific upload authorization from an authenticated Worker endpoint, then uploads directly to R2. This avoids proxying the file through the Worker's 100 MB request-body boundary. Permanent R2 credentials never reach the browser.

After upload, the browser calls a finalize endpoint. The Worker confirms the object exists, validates its expected size and metadata, creates the D1 file record, and attaches it to the QR record. Incomplete uploads are not published. A daily scheduled job deletes unfinalized objects under the temporary-upload prefix after 24 hours.

R2 CORS rules permit uploads only from the application's exact origin. Upload authorizations expire after 10 minutes and apply to one object key and one upload operation. The bucket uses Standard storage in the first release and has no automatic expiry or lifecycle deletion for finalized files.

Allowed content initially includes PDF, Microsoft Office Open XML documents, common web images, plain text, CSV, common audio/video formats, and ZIP archives. Executable and script formats are rejected. Extension, declared media type, and file signature are checked where practical; the app does not claim to provide malware scanning.

### Administrator authentication

The temporary release uses one administrator passphrase stored as a Cloudflare secret. The passphrase is never committed or stored in D1. A successful login produces a signed, secure, HTTP-only, same-site session cookie with a limited lifetime.

Login endpoints must be rate limited. All administrator pages and write APIs require a valid session. After a permanent domain is connected, email-based Cloudflare Access may replace the passphrase without changing the public redirect routes.

### Dashboard

The management-first dashboard shows:

- Total QR codes, active QR codes, and total scans
- R2 objects and total bytes stored, with a visible 10 GB free-tier reference threshold
- Search by name or short name
- Status filter for active and archived codes
- QR preview, name, content summary, creation date, last modification date, and scan total
- Primary action to create a QR code

Empty, loading, error, and successful-operation states must be explicit. The layout collapses to a single-column mobile view and retains keyboard access and visible focus states.

### QR creation flow

Creation uses three steps:

1. **Content:** select Web link or Upload file, then provide the required name and short name. A web link requires a public HTTPS destination. A stored file requires one allowed file up to 100 MB. An internal description is optional.
2. **Design:** a deliberately limited, high-contrast color choice with a live preview. The QR quiet zone and error-correction settings remain reliability-safe.
3. **Review:** show the final QR, redirect URL, web destination or stored-file summary, validation status, and temporary-address warning before saving.

Short names use lowercase letters, numbers, and hyphens. They must be unique and cannot be changed after creation. A new QR code is required if a different public short name is needed.

### QR detail and analytics

The detail page provides:

- PNG and SVG downloads
- Copy actions for the QR route and, for web-link QR codes, the destination URL
- Web-destination editing or stored-file replacement, plus internal-description editing
- Archive and restore controls
- Stored-file name, media type, size, and upload date
- Total scans
- Daily scan chart for a selected recent period

Destination edits and file replacements preserve the redirect URL and all scan history. Replacing a file uploads and validates the new object before switching the QR record; the old object is deleted only after the switch succeeds. Dashboard previews and application health checks must not use the counting public route.

Archiving disables public access but retains the stored object. Permanent deletion requires explicit confirmation and removes the QR record, its scan events, its stored-file metadata, and its R2 object. The interface clearly distinguishes reversible archive from permanent deletion.

### Data export

The administrator can export QR metadata, stored-file metadata, and aggregate scan counts in JSON or CSV. Exported data contains no secrets, session values, or file bodies. Raw scan-event export is not required in the first release.

## Data model

### `qr_codes`

- `id`: generated unique identifier
- `slug`: immutable, unique public short name
- `name`: administrator-facing name
- `description`: optional internal note
- `content_type`: `url` or `file`
- `destination_url`: current HTTPS destination for a web-link QR, otherwise null
- `stored_file_id`: current stored file for a file QR, otherwise null
- `foreground_color`: approved QR foreground color
- `status`: `active` or `archived`
- `created_at`: UTC timestamp
- `updated_at`: UTC timestamp

### `scan_events`

- `id`: generated unique identifier
- `qr_code_id`: foreign key to `qr_codes`
- `scanned_at`: UTC timestamp

### `stored_files`

- `id`: generated unique identifier
- `r2_key`: unique, non-guessable object key
- `original_name`: sanitized display and download name
- `media_type`: validated content type
- `size_bytes`: validated object size, no greater than 100,000,000 bytes
- `etag`: R2 object version integrity value
- `created_at`: UTC timestamp

Indexes will support slug lookup, file association, and scan aggregation by QR identifier and timestamp. No IP address, user agent, location, fingerprint, or other visitor identifier is stored.

## Scan-count semantics

One successful request to an active `/r/:slug` route equals one scan. Repeat scans from the same device count separately. Requests for missing or archived codes do not count. The first release does not claim unique visitors or verified file downloads.

Automated scanners and link-preview bots may occasionally increase counts. Because the design deliberately avoids visitor fingerprinting, totals should be described as redirect requests rather than guaranteed human scans in technical documentation. The user interface may use the simpler label “Scans” with an explanatory tooltip.

## Validation and error handling

- Accept only absolute `https://` destination URLs.
- Reject files over 100 MB and disallowed or inconsistent file types.
- Do not publish a stored-file QR until R2 upload finalization succeeds.
- Reject malformed, duplicate, reserved, or unsafe short names.
- Display a reminder that external web destinations remain under their respective owners' control.
- Missing codes return a clear not-found page.
- Archived codes return a clear unavailable page with no destination disclosure.
- Authentication failures return a generic response and do not reveal configuration details.
- Database failures in administrator operations show a recoverable error without claiming success.
- Scan-write failures do not prevent delivery of already-resolved valid content.
- QR generation failures keep entered form data and offer retry.
- Failed and interrupted uploads show retry controls and do not create usable QR records.
- Missing R2 objects show a clear unavailable page and create an operational error log.

The app validates URL form and protocol, but it does not fetch arbitrary web destinations during creation. This avoids server-side request forgery risk and avoids presenting an external site's availability as guaranteed.

## Security and privacy

- Store the administrator passphrase and session signing key as Cloudflare secrets.
- Use signed, expiring, HTTP-only, secure, same-site cookies.
- Apply CSRF protection to state-changing administrator requests.
- Validate all server inputs independently of client validation.
- Escape displayed names, descriptions, and URLs.
- Set restrictive security headers and a content security policy.
- Rate limit login attempts and public redirect abuse where practical without storing visitor identities.
- Keep the R2 bucket private and scope upload authorizations to one key, one operation, and a short lifetime.
- Sanitize file names used in response headers and force attachment delivery for content that should not render inline.
- Never log secrets, cookies, or full authentication request bodies.
- Retain only QR configuration and timestamp-only scan events.

## Testing and verification

Automated tests will cover:

- Authentication success, failure, expiry, logout, and route protection
- QR creation and validation
- Direct R2 upload authorization, CORS scope, expiry, size enforcement, and finalization
- Allowed and disallowed file formats
- Duplicate and reserved short names
- PNG and SVG generation
- Successful web redirect and scan increment
- Successful R2 file streaming and scan increment
- Content delivery continuation when scan recording fails
- Destination editing with stable redirect URL and preserved history
- Atomic file replacement with stable redirect URL and preserved history
- Archive retention and confirmed permanent R2 deletion
- Archive and restore behavior
- Missing-code and database-error responses
- Dashboard aggregation and data export
- CSRF and unsafe input rejection

Manual verification will cover:

- Desktop and mobile dashboard flows
- Keyboard navigation, focus states, labels, contrast, and error announcements
- Phone scanning of exported PNG and SVG files
- Representative public HTTPS web-link behavior
- Upload, preview, download, replacement, archive, and deletion of representative R2 files
- Failed and interrupted upload recovery
- Dashboard storage-total accuracy
- Temporary-address warning visibility
- Deployment smoke test against the Cloudflare temporary address

## Operations and longevity

The QR bitmap does not expire. Service longevity depends on continued control of the encoded hostname and preservation of redirect data.

Before permanent QR distribution, the owner should:

1. Obtain and renew a domain.
2. Connect a stable subdomain to the Cloudflare Worker.
3. Export and securely retain QR metadata.
4. Keep the source repository and deployment instructions current.
5. Maintain public availability of all external destinations.

For stored-file QR codes, the owner must also keep the R2 bucket and its object data intact. The dashboard should make storage usage and export status visible, but a metadata export alone is not a backup of R2 file contents.

The open-source code and export format must make it possible to move the redirect service to another provider while preserving the same custom-domain URLs.

Deployment requires an R2 bucket binding for server-side reads and a narrowly scoped R2 S3 API credential for generating short-lived direct-upload authorizations. Both credentials are configured as Cloudflare bindings or secrets and are never committed to source control.

## Implementation boundaries

The first implementation should favor small modules for authentication, QR records, R2 uploads and delivery, analytics queries, QR rendering, and the user interface. It should not introduce multi-user abstractions, resumable multipart uploads, malware-scanning infrastructure, or generalized analytics pipelines.

The working name “EverQR” is presentation-only. Renaming it before release does not alter URLs, data structures, or system behavior.
