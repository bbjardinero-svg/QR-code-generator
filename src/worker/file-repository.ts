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

export class FileRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<StoredFileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, r2_key, original_name, media_type, size_bytes, etag, state, created_at
         FROM stored_files WHERE id = ?1`,
      )
      .bind(id)
      .first<{
        id: string;
        r2_key: string;
        original_name: string;
        media_type: string;
        size_bytes: number;
        etag: string | null;
        state: "temporary" | "finalized";
        created_at: string;
      }>();
    return row
      ? {
          id: row.id,
          r2Key: row.r2_key,
          originalName: row.original_name,
          mediaType: row.media_type,
          sizeBytes: row.size_bytes,
          etag: row.etag,
          state: row.state,
          createdAt: row.created_at,
        }
      : null;
  }
}
