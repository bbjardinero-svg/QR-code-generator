# EverQR Direct R2 Upload Design

**Date:** July 16, 2026  
**Status:** Approved design, awaiting written-spec review

## Context

EverQR's link QR flow is live and verified, including public redirects and scan tracking. The initial file flow authorized browser-to-R2 uploads with S3-compatible credentials and a presigned PUT URL. Production testing showed that authorization records were created in D1, but the browser PUT did not create an R2 object. The current path also requires three R2 credential secrets, a bucket CORS policy, and exact request-signature behavior.

For the first version, EverQR has one administrator and a maximum file size of 100,000,000 bytes. Cloudflare Free accounts accept request bodies up to 100 MB, and an R2 binding can stream a request body directly into a private bucket without buffering the complete file in Worker memory.

## Decision

Add a same-origin authenticated upload endpoint and switch the web client to use it. The Worker will stream the request body directly to the existing private `everqr-files` R2 binding.

The existing presigned authorization and finalization endpoints will remain temporarily as a rollback path until the direct upload succeeds in production. They will not be used by the web client.

## Upload Flow

1. The signed-in administrator selects an allowed file of at most 100,000,000 bytes.
2. The browser sends the raw file body to `POST /api/uploads/direct` using `XMLHttpRequest`, preserving the existing upload-progress UI.
3. The request includes the current CSRF token plus encoded file name, declared byte size, and media type headers.
4. The Worker verifies the admin session, origin, CSRF token, extension, media type, and declared size before writing.
5. The Worker creates a temporary D1 file record whose R2 key is already in the final `files/<uuid>` namespace.
6. The request body is streamed directly to R2 with the expected HTTP and custom metadata.
7. The Worker verifies the returned R2 object's size and metadata, marks the D1 record finalized, and returns the stored-file DTO.
8. The existing QR creation endpoint associates the finalized file with the stable QR route.

## Failure Handling

- Invalid metadata or an absent body returns a 400 response without writing a file.
- Authentication, origin, and CSRF failures continue to use the existing 401 or 403 behavior.
- If the R2 write, metadata verification, or D1 finalization fails, the Worker deletes the partial R2 object and temporary D1 record before returning an error.
- The browser retains the QR name, slug, description, color, and chosen file so the administrator can retry.
- The scheduled temporary-record cleanup remains a defense for interrupted requests.

## Security and Limits

- The R2 bucket remains private; downloads continue through EverQR's counted public route.
- The new endpoint is same-origin and admin-only.
- The server independently validates the 100,000,000-byte limit and compares the stored object's actual size with the declared size.
- File extension and media-type allowlists remain unchanged.
- The new flow does not use `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, or the bucket CORS policy. Those settings remain temporarily for rollback and can be removed after production verification.
- The upload body is streamed and is not converted to an `ArrayBuffer`, `Blob`, or form-data structure inside the Worker.

## Scope

This change affects only the upload transport. It does not change the dashboard layout, QR creation steps, 100 MB limit, private storage model, stable route format, downloads, file replacement behavior, deletion behavior, or scan analytics.

## Verification

- Add a Worker regression test that sends a real request body to the new endpoint and verifies the finalized D1 record and R2 object.
- Test invalid size, media type, missing body, CSRF, and rollback behavior.
- Keep all existing unit and end-to-end tests passing.
- Run type checking, all tests, production build, and browser end-to-end checks.
- Deploy, upload the disposable text file, verify its public response body and headers, confirm one counted scan, and delete the disposable QR and R2 object.
- Confirm the existing Kaakbai QR remains active with its scan history intact.
