PRAGMA foreign_keys = ON;

CREATE TABLE stored_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 100000000),
  etag TEXT,
  state TEXT NOT NULL CHECK (state IN ('temporary', 'finalized')),
  created_at TEXT NOT NULL
);

CREATE TABLE qr_codes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('url', 'file')),
  destination_url TEXT,
  stored_file_id TEXT REFERENCES stored_files(id) ON DELETE RESTRICT,
  foreground_color TEXT NOT NULL DEFAULT '#102f29',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (content_type = 'url' AND destination_url IS NOT NULL AND stored_file_id IS NULL)
    OR
    (content_type = 'file' AND destination_url IS NULL AND stored_file_id IS NOT NULL)
  )
);

CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  qr_code_id TEXT NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  bucket_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0)
);

CREATE INDEX idx_scan_events_qr_date ON scan_events(qr_code_id, scanned_at);
CREATE INDEX idx_stored_files_state_created ON stored_files(state, created_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
