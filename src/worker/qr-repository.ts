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

export interface UpdateQrRecord {
  name?: string;
  description?: string | null;
  destinationUrl?: string;
  foregroundColor?: string;
  now: string;
}

export interface QrWithScans extends QrRecord {
  scans: number;
}

export interface QrSummary {
  totalQrCodes: number;
  activeQrCodes: number;
  archivedQrCodes: number;
  totalScans: number;
  storageBytes: number;
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

const QR_COLUMNS_QUALIFIED = `q.id, q.slug, q.name, q.description, q.content_type, q.destination_url,
  q.stored_file_id, q.foreground_color, q.status, q.created_at, q.updated_at`;

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

  async findWithScansById(id: string): Promise<QrWithScans | null> {
    const row = await this.db
      .prepare(
        `SELECT ${QR_COLUMNS_QUALIFIED}, COUNT(s.id) AS scan_count
         FROM qr_codes q
         LEFT JOIN scan_events s ON s.qr_code_id = q.id
         WHERE q.id = ?1
         GROUP BY q.id`,
      )
      .bind(id)
      .first<QrRow & { scan_count: number }>();
    return row ? { ...toQrRecord(row), scans: Number(row.scan_count) } : null;
  }

  async list(options: { search?: string; status?: QrStatus } = {}): Promise<QrWithScans[]> {
    const clauses: string[] = [];
    const values: string[] = [];
    if (options.status) {
      values.push(options.status);
      clauses.push(`q.status = ?${values.length}`);
    }
    if (options.search) {
      values.push(`%${options.search.toLowerCase()}%`);
      clauses.push(`(lower(q.name) LIKE ?${values.length} OR lower(q.slug) LIKE ?${values.length})`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = this.db.prepare(
      `SELECT ${QR_COLUMNS_QUALIFIED}, COUNT(s.id) AS scan_count
       FROM qr_codes q
       LEFT JOIN scan_events s ON s.qr_code_id = q.id
       ${where}
       GROUP BY q.id
       ORDER BY q.updated_at DESC`,
    );
    const result = await (values.length > 0 ? statement.bind(...values) : statement).all<QrRow & { scan_count: number }>();
    return result.results.map((row) => ({ ...toQrRecord(row), scans: Number(row.scan_count) }));
  }

  async update(id: string, input: UpdateQrRecord): Promise<QrRecord | null> {
    const current = await this.findById(id);
    if (!current) return null;
    if (input.destinationUrl !== undefined && current.contentType !== "url") {
      throw new Error("Only URL QR codes have a destination URL");
    }
    await this.db
      .prepare(
        `UPDATE qr_codes
         SET name = ?2, description = ?3, destination_url = ?4, foreground_color = ?5, updated_at = ?6
         WHERE id = ?1`,
      )
      .bind(
        id,
        input.name ?? current.name,
        input.description === undefined ? current.description : input.description,
        input.destinationUrl ?? current.destinationUrl,
        input.foregroundColor ?? current.foregroundColor,
        input.now,
      )
      .run();
    return this.findById(id);
  }

  async setStatus(id: string, status: QrStatus, now: string): Promise<QrRecord | null> {
    const result = await this.db
      .prepare("UPDATE qr_codes SET status = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(id, status, now)
      .run();
    return result.meta.changes > 0 ? this.findById(id) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM qr_codes WHERE id = ?1").bind(id).run();
    return result.meta.changes > 0;
  }

  async summary(): Promise<QrSummary> {
    const row = await this.db
      .prepare(
        `SELECT
           COUNT(DISTINCT q.id) AS total_qr_codes,
           COUNT(DISTINCT CASE WHEN q.status = 'active' THEN q.id END) AS active_qr_codes,
           COUNT(DISTINCT CASE WHEN q.status = 'archived' THEN q.id END) AS archived_qr_codes,
           COUNT(DISTINCT s.id) AS total_scans,
           COALESCE((SELECT SUM(size_bytes) FROM stored_files WHERE state = 'finalized'), 0) AS storage_bytes
         FROM qr_codes q
         LEFT JOIN scan_events s ON s.qr_code_id = q.id`,
      )
      .first<{
        total_qr_codes: number;
        active_qr_codes: number;
        archived_qr_codes: number;
        total_scans: number;
        storage_bytes: number;
      }>();
    return {
      totalQrCodes: Number(row?.total_qr_codes ?? 0),
      activeQrCodes: Number(row?.active_qr_codes ?? 0),
      archivedQrCodes: Number(row?.archived_qr_codes ?? 0),
      totalScans: Number(row?.total_scans ?? 0),
      storageBytes: Number(row?.storage_bytes ?? 0),
    };
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
