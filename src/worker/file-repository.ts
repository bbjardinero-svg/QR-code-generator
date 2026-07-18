export interface StoredFileRecord {
  id: string;
  r2Key: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  etag: string | null;
  state: "temporary" | "finalized";
  createdAt: string;
}

export interface CreateTemporaryFile {
  id: string;
  r2Key: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
}

interface StoredFileRow {
  id: string;
  r2_key: string;
  original_name: string;
  media_type: string;
  size_bytes: number;
  etag: string | null;
  state: "temporary" | "finalized";
  created_at: string;
}

function toStoredFile(row: StoredFileRow): StoredFileRecord {
  return {
    id: row.id,
    r2Key: row.r2_key,
    originalName: row.original_name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    etag: row.etag,
    state: row.state,
    createdAt: row.created_at,
  };
}

export class FileRepository {
  constructor(private readonly db: D1Database) {}

  async createTemporary(input: CreateTemporaryFile): Promise<StoredFileRecord> {
    await this.db
      .prepare(
        `INSERT INTO stored_files (id, r2_key, original_name, media_type, size_bytes, etag, state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'temporary', ?6)`,
      )
      .bind(input.id, input.r2Key, input.originalName, input.mediaType, input.sizeBytes, input.createdAt)
      .run();
    const created = await this.findById(input.id);
    if (!created) throw new Error("Temporary file record was not created");
    return created;
  }

  async findById(id: string): Promise<StoredFileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, r2_key, original_name, media_type, size_bytes, etag, state, created_at
         FROM stored_files WHERE id = ?1`,
      )
      .bind(id)
      .first<StoredFileRow>();
    return row ? toStoredFile(row) : null;
  }

  async finalize(id: string, r2Key: string, etag: string): Promise<StoredFileRecord | null> {
    const result = await this.db
      .prepare("UPDATE stored_files SET r2_key = ?2, etag = ?3, state = 'finalized' WHERE id = ?1 AND state = 'temporary'")
      .bind(id, r2Key, etag)
      .run();
    return result.meta.changes > 0 ? this.findById(id) : null;
  }

  async expiredTemporary(cutoff: string): Promise<StoredFileRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, r2_key, original_name, media_type, size_bytes, etag, state, created_at
         FROM stored_files WHERE state = 'temporary' AND created_at < ?1 ORDER BY created_at ASC`,
      )
      .bind(cutoff)
      .all<StoredFileRow>();
    return result.results.map(toStoredFile);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM stored_files WHERE id = ?1").bind(id).run();
    return result.meta.changes > 0;
  }
}
