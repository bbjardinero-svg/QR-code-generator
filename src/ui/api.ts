export type QrStatus = "active" | "archived";
export type QrContentType = "url" | "file";

export interface QrDto {
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
  publicUrl: string;
  scans: number;
}

export interface SummaryDto {
  totalQrCodes: number;
  activeQrCodes: number;
  archivedQrCodes: number;
  totalScans: number;
  storageBytes: number;
}

export interface StoredFileDto {
  id: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  etag: string;
  createdAt: string;
}

export interface ScanSeriesDto {
  total: number;
  series: Array<{ date: string; scans: number }>;
}

export type CreateQrPayload = {
  name: string;
  slug: string;
  description?: string | null;
  foregroundColor: "#102f29" | "#000000" | "#1f8a70";
} & (
  | { contentType: "url"; destinationUrl: string }
  | { contentType: "file"; storedFileId: string }
);

export interface CreateApi {
  createQr(input: CreateQrPayload): Promise<QrDto>;
  uploadFile(file: File, onProgress: (percent: number) => void): Promise<StoredFileDto>;
}

export interface DetailApi {
  getQr(id: string): Promise<QrDto>;
  getFile(id: string): Promise<StoredFileDto>;
  getScans(id: string, days?: number): Promise<ScanSeriesDto>;
  updateQr(id: string, input: { name?: string; description?: string | null; destinationUrl?: string; foregroundColor?: string }): Promise<QrDto>;
  uploadFile(file: File, onProgress: (percent: number) => void): Promise<StoredFileDto>;
  replaceFile(id: string, storedFileId: string): Promise<void>;
  archiveQr(id: string): Promise<QrDto>;
  restoreQr(id: string): Promise<QrDto>;
  deleteQr(id: string): Promise<void>;
}

export interface DashboardApi {
  getSummary(): Promise<SummaryDto>;
  listQr(filters: { search?: string; status?: QrStatus }): Promise<QrDto[]>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ApiClient implements DashboardApi, DetailApi {
  private csrfToken: string | null = null;

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Request failed";
      throw new ApiError(message, response.status, body);
    }
    return body as T;
  }

  async session(): Promise<boolean> {
    try {
      const session = await this.request<{ authenticated: true; csrfToken: string }>("/api/auth/session");
      this.csrfToken = session.csrfToken;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return false;
      throw error;
    }
  }

  async login(passphrase: string): Promise<void> {
    const result = await this.request<{ csrfToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    });
    this.csrfToken = result.csrfToken;
  }

  async logout(): Promise<void> {
    await this.request<null>("/api/auth/logout", { method: "POST" });
    this.csrfToken = null;
  }

  async getSummary(): Promise<SummaryDto> {
    return this.request<SummaryDto>("/api/summary");
  }

  async listQr(filters: { search?: string; status?: QrStatus }): Promise<QrDto[]> {
    const query = new URLSearchParams();
    if (filters.search) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
    const result = await this.request<{ items: QrDto[] }>(`/api/qr${query.size ? `?${query}` : ""}`);
    return result.items;
  }

  async createQr(input: CreateQrPayload): Promise<QrDto> {
    const result = await this.request<{ qr: QrDto }>("/api/qr", { method: "POST", body: JSON.stringify(input) });
    return result.qr;
  }

  async getQr(id: string): Promise<QrDto> {
    const result = await this.request<{ qr: QrDto }>(`/api/qr/${encodeURIComponent(id)}`);
    return result.qr;
  }

  async getFile(id: string): Promise<StoredFileDto> {
    return this.request<StoredFileDto>(`/api/files/${encodeURIComponent(id)}`);
  }

  async getScans(id: string, days = 30): Promise<ScanSeriesDto> {
    return this.request<ScanSeriesDto>(`/api/qr/${encodeURIComponent(id)}/scans?days=${days}`);
  }

  async updateQr(
    id: string,
    input: { name?: string; description?: string | null; destinationUrl?: string; foregroundColor?: string },
  ): Promise<QrDto> {
    const result = await this.request<{ qr: QrDto }>(`/api/qr/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return result.qr;
  }

  async archiveQr(id: string): Promise<QrDto> {
    const result = await this.request<{ qr: QrDto }>(`/api/qr/${encodeURIComponent(id)}/archive`, { method: "POST" });
    return result.qr;
  }

  async restoreQr(id: string): Promise<QrDto> {
    const result = await this.request<{ qr: QrDto }>(`/api/qr/${encodeURIComponent(id)}/restore`, { method: "POST" });
    return result.qr;
  }

  async replaceFile(id: string, storedFileId: string): Promise<void> {
    await this.request(`/api/qr/${encodeURIComponent(id)}/replace-file`, {
      method: "POST",
      body: JSON.stringify({ storedFileId }),
    });
  }

  async deleteQr(id: string): Promise<void> {
    await this.request<null>(`/api/qr/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async uploadFile(file: File, onProgress: (percent: number) => void): Promise<StoredFileDto> {
    return new Promise<StoredFileDto>((resolve, reject) => {
      const upload = new XMLHttpRequest();
      upload.open("POST", "/api/uploads/direct");
      upload.setRequestHeader("content-type", file.type);
      upload.setRequestHeader("x-everqr-file-name", encodeURIComponent(file.name));
      upload.setRequestHeader("x-everqr-file-size", String(file.size));
      if (this.csrfToken) upload.setRequestHeader("x-csrf-token", this.csrfToken);
      upload.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
      upload.addEventListener("load", () => {
        const body = (() => {
          try {
            return JSON.parse(upload.responseText) as StoredFileDto | { error?: string };
          } catch {
            return null;
          }
        })();
        if (upload.status >= 200 && upload.status < 300 && body) {
          onProgress(100);
          resolve(body as StoredFileDto);
        } else {
          const message = body && "error" in body && body.error ? body.error : "Direct R2 upload failed";
          reject(new ApiError(message, upload.status, body));
        }
      });
      upload.addEventListener("error", () => reject(new ApiError("Direct R2 upload failed", 0)));
      upload.addEventListener("abort", () => reject(new ApiError("Direct R2 upload was cancelled", 0)));
      upload.send(file);
    });
  }
}

export const apiClient = new ApiClient();
