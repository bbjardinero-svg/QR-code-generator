# Durable QR Dashboard Design

Date: 2026-07-15  
Working product name: EverQR  
Status: Approved for implementation planning

## Objective

Build an open-source, single-user web application that creates durable QR codes for public HTTPS links, records scan counts, and allows destinations to change without reprinting the QR code.

The first deployment will use a temporary Cloudflare `workers.dev` address for development and testing. It is not intended for long-term printed distribution. Before permanent distribution, the owner should connect a domain they control so the encoded QR addresses remain portable across hosting providers.

## Users and scope

The first release has one administrator. Visitors do not create accounts; they only scan public QR codes and are redirected to external destinations.

Included:

- Private dashboard for one administrator
- QR creation from a public HTTPS link
- Stable redirect URL for every QR code
- Editable destination without changing the QR image
- QR export as PNG and SVG
- Searchable QR list with status and scan totals
- QR detail view with daily scan history
- Archive and restore actions
- JSON and CSV data export
- Responsive layout and accessible interaction states

Excluded from the first release:

- File uploads or app-managed file storage
- Verified download tracking
- Multiple users, roles, or teams
- Subscriptions or billing
- Folders, bulk operations, passwords per QR, and advanced QR templates
- IP-based uniqueness, device fingerprinting, or visitor profiling

## Architecture

The application will use Cloudflare Workers with static assets for the user interface and server routes. Cloudflare D1 will store QR records and scan events.

Public QR codes encode an app-owned redirect URL:

`https://<temporary-worker>.workers.dev/r/<short-name>`

The redirect request performs these steps:

1. Find the active QR record by short name.
2. Record a scan event containing only the QR identifier and timestamp.
3. Return an HTTP redirect to the current external destination.

The redirect URL stays stable when the administrator edits the destination. A future custom domain can replace the temporary host, but QR codes generated with the temporary host will not update automatically. The interface must therefore display a persistent warning while the app uses `workers.dev`.

## Application components

### Public redirect handler

The handler owns `/r/:slug`. It validates the slug, retrieves an active QR record, records a scan, and redirects to its destination. It returns a branded unavailable page for missing or archived records.

Scan recording should not prevent access to a valid destination. If the scan insert fails after the QR record is found, the handler still redirects and records an operational error in Cloudflare logs.

### Administrator authentication

The temporary release uses one administrator passphrase stored as a Cloudflare secret. The passphrase is never committed or stored in D1. A successful login produces a signed, secure, HTTP-only, same-site session cookie with a limited lifetime.

Login endpoints must be rate limited. All administrator pages and write APIs require a valid session. After a permanent domain is connected, email-based Cloudflare Access may replace the passphrase without changing the public redirect routes.

### Dashboard

The management-first dashboard shows:

- Total QR codes, active QR codes, and total scans
- Search by name or short name
- Status filter for active and archived codes
- QR preview, name, destination, creation date, last modification date, and scan total
- Primary action to create a QR code

Empty, loading, error, and successful-operation states must be explicit. The layout collapses to a single-column mobile view and retains keyboard access and visible focus states.

### QR creation flow

Creation uses three steps:

1. **Content:** required name, public HTTPS destination, and short name; optional internal description.
2. **Design:** a deliberately limited, high-contrast color choice with a live preview. The QR quiet zone and error-correction settings remain reliability-safe.
3. **Review:** show the final QR, redirect URL, destination, validation status, and temporary-address warning before saving.

Short names use lowercase letters, numbers, and hyphens. They must be unique and cannot be changed after creation. A new QR code is required if a different public short name is needed.

### QR detail and analytics

The detail page provides:

- PNG and SVG downloads
- Copy actions for redirect and destination URLs
- Destination and internal-description editing
- Archive and restore controls
- Total scans
- Daily scan chart for a selected recent period

Destination edits preserve the redirect URL and all scan history. Dashboard previews and application health checks must not use the counting redirect route.

### Data export

The administrator can export QR metadata and aggregate scan counts in JSON or CSV. Exported data contains no secrets or session values. Raw scan-event export is not required in the first release.

## Data model

### `qr_codes`

- `id`: generated unique identifier
- `slug`: immutable, unique public short name
- `name`: administrator-facing name
- `description`: optional internal note
- `destination_url`: current HTTPS destination
- `foreground_color`: approved QR foreground color
- `status`: `active` or `archived`
- `created_at`: UTC timestamp
- `updated_at`: UTC timestamp

### `scan_events`

- `id`: generated unique identifier
- `qr_code_id`: foreign key to `qr_codes`
- `scanned_at`: UTC timestamp

Indexes will support slug lookup and scan aggregation by QR identifier and timestamp. No IP address, user agent, location, fingerprint, or other visitor identifier is stored.

## Scan-count semantics

One successful request to an active `/r/:slug` route equals one scan. Repeat scans from the same device count separately. Requests for missing or archived codes do not count. The first release does not claim unique visitors or verified file downloads.

Automated scanners and link-preview bots may occasionally increase counts. Because the design deliberately avoids visitor fingerprinting, totals should be described as redirect requests rather than guaranteed human scans in technical documentation. The user interface may use the simpler label “Scans” with an explanatory tooltip.

## Validation and error handling

- Accept only absolute `https://` destination URLs.
- Reject malformed, duplicate, reserved, or unsafe short names.
- Display a reminder that external file permissions and availability remain the administrator's responsibility.
- Missing codes return a clear not-found page.
- Archived codes return a clear unavailable page with no destination disclosure.
- Authentication failures return a generic response and do not reveal configuration details.
- Database failures in administrator operations show a recoverable error without claiming success.
- Scan-write failures do not prevent a redirect to an already-resolved valid destination.
- QR generation failures keep entered form data and offer retry.

The app validates URL form and protocol, but it does not fetch arbitrary destinations during creation. This avoids server-side request forgery risk and avoids presenting an external site's availability as guaranteed.

## Security and privacy

- Store the administrator passphrase and session signing key as Cloudflare secrets.
- Use signed, expiring, HTTP-only, secure, same-site cookies.
- Apply CSRF protection to state-changing administrator requests.
- Validate all server inputs independently of client validation.
- Escape displayed names, descriptions, and URLs.
- Set restrictive security headers and a content security policy.
- Rate limit login attempts and public redirect abuse where practical without storing visitor identities.
- Never log secrets, cookies, or full authentication request bodies.
- Retain only QR configuration and timestamp-only scan events.

## Testing and verification

Automated tests will cover:

- Authentication success, failure, expiry, logout, and route protection
- QR creation and validation
- Duplicate and reserved short names
- PNG and SVG generation
- Successful redirect and scan increment
- Redirect continuation when scan recording fails
- Destination editing with stable redirect URL and preserved history
- Archive and restore behavior
- Missing-code and database-error responses
- Dashboard aggregation and data export
- CSRF and unsafe input rejection

Manual verification will cover:

- Desktop and mobile dashboard flows
- Keyboard navigation, focus states, labels, contrast, and error announcements
- Phone scanning of exported PNG and SVG files
- Google Drive “Anyone with the link — Viewer” destination behavior
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

The open-source code and export format must make it possible to move the redirect service to another provider while preserving the same custom-domain URLs.

## Implementation boundaries

The first implementation should favor small modules for authentication, QR records, redirects, analytics queries, QR rendering, and the user interface. It should not introduce multi-user abstractions, file-storage infrastructure, or generalized analytics pipelines.

The working name “EverQR” is presentation-only. Renaming it before release does not alter URLs, data structures, or system behavior.
