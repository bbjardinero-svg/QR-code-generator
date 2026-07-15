export type QrContentType = "url" | "file";
export type QrStatus = "active" | "archived";

export interface QrRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  contentType: QrContentType;
  destinationUrl: string | null;
  storedFileId: string | null;
  foregroundColor: string;
  status: QrStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQrRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  contentType: QrContentType;
  destinationUrl: string | null;
  storedFileId: string | null;
  foregroundColor: string;
  now: string;
}

interface QrRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  content_type: QrContentType;
  destination_url: string | null;
  stored_file_id: string | null;
  foreground_color: string;
  status: QrStatus;
  created_at: string;
  updated_at: string;
}

const QR_COLUMNS = `id, slug, name, description, content_type, destination_url,
  stored_file_id, foreground_color, status, created_at, updated_at`;

function toQrRecord(row: QrRow): QrRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    contentType: row.content_type,
    destinationUrl: row.destination_url,
    storedFileId: row.stored_file_id,
    foregroundColor: row.foreground_color,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class QrRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateQrRecord): Promise<QrRecord> {
    await this.db
      .prepare(
        `INSERT INTO qr_codes (
          id, slug, name, description, content_type, destination_url,
          stored_file_id, foreground_color, status, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?9)`,
      )
      .bind(
        input.id,
        input.slug,
        input.name,
        input.description,
        input.contentType,
        input.destinationUrl,
        input.storedFileId,
        input.foregroundColor,
        input.now,
      )
      .run();

    const created = await this.findById(input.id);
    if (!created) throw new Error("QR record was not created");
    return created;
  }

  async findById(id: string): Promise<QrRecord | null> {
    const row = await this.db.prepare(`SELECT ${QR_COLUMNS} FROM qr_codes WHERE id = ?1`).bind(id).first<QrRow>();
    return row ? toQrRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<QrRecord | null> {
    const row = await this.db.prepare(`SELECT ${QR_COLUMNS} FROM qr_codes WHERE slug = ?1`).bind(slug).first<QrRow>();
    return row ? toQrRecord(row) : null;
  }

  async recordScan(qrCodeId: string, id: string, scannedAt: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO scan_events (id, qr_code_id, scanned_at) VALUES (?1, ?2, ?3)")
      .bind(id, qrCodeId, scannedAt)
      .run();
  }

  async dailyScans(qrCodeId: string, since: string): Promise<Array<{ date: string; scans: number }>> {
    const result = await this.db
      .prepare(
        `SELECT substr(scanned_at, 1, 10) AS date, COUNT(*) AS scans
         FROM scan_events
         WHERE qr_code_id = ?1 AND scanned_at >= ?2
         GROUP BY substr(scanned_at, 1, 10)
         ORDER BY date ASC`,
      )
      .bind(qrCodeId, since)
      .all<{ date: string; scans: number }>();
    return result.results;
  }
}
