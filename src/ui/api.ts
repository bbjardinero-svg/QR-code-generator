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

export class ApiClient implements DashboardApi {
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
}

export const apiClient = new ApiClient();
