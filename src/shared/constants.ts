export const MAX_FILE_BYTES = 100_000_000;
export const UPLOAD_AUTHORIZATION_SECONDS = 10 * 60;
export const TEMPORARY_UPLOAD_MAX_AGE_SECONDS = 24 * 60 * 60;

export const QR_COLORS = ["#102f29", "#000000", "#1f8a70"] as const;

export const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "login",
  "logout",
  "create",
  "settings",
  "health",
  "files",
]);
