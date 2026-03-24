/**
 * Centralized API client for widget communication
 */

export interface ApiClientConfig {
  apiHost: string;
  tenantId?: string;
  getToken: () => Promise<string>;
  onTokenRefresh?: (newToken: string) => void;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  async request<T>(
    path: string,
    options: RequestInit & { skipRetry?: boolean } = {}
  ): Promise<T> {
    const { skipRetry, ...init } = options;
    const token = await this.config.getToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    if (this.config.tenantId) {
      headers["X-Tenant-ID"] = this.config.tenantId;
    }

    const response = await fetch(`${this.config.apiHost}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      mode: "cors",
    });

    // Handle 401 with token refresh
    if (response.status === 401 && !skipRetry && this.config.onTokenRefresh) {
      const newToken = await this.refreshToken();
      if (newToken) {
        return this.request<T>(path, { ...options, skipRetry: true });
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: response.statusText,
      }));
      throw new Error(error.error || `Request failed: ${response.statusText}`);
    }

    return response.json();
  }

  async post<T>(path: string, data: any, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "GET",
    });
  }

  private async refreshToken(): Promise<string | null> {
    // This would call the session endpoint to get a fresh token
    // Implementation depends on your auth flow
    return null;
  }
}
