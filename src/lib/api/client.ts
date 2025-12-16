import { getApiBaseUrl, readCredentials, writeCredentials, isAuthenticated } from "../config/index";
import { refreshAccessToken } from "../auth/oauth";

export interface APIError {
  message: string;
  code?: string;
  statusCode?: number;
}

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * API Client for making authenticated requests to the Apso platform
 */
export class APIClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getApiBaseUrl();
    this.loadCredentials();
  }

  /**
   * Load credentials from disk
   */
  private loadCredentials(): void {
    const creds = readCredentials();
    if (creds) {
      this.accessToken = creds.accessToken;
    }
  }

  /**
   * Ensure we have a valid access token, refreshing if necessary
   */
  private async ensureValidToken(): Promise<string> {
    const creds = readCredentials();
    if (!creds) {
      throw new APIError(
        "Not authenticated. Please run 'apso login' first.",
        401,
        "UNAUTHENTICATED"
      );
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = new Date(creds.expiresAt);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt <= fiveMinutesFromNow) {
      // Token expired or about to expire, refresh it
      try {
        const refreshed = await refreshAccessToken(creds.refreshToken);
        writeCredentials({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          user: refreshed.user,
        });
        this.accessToken = refreshed.accessToken;
        return refreshed.accessToken;
      } catch (error) {
        throw new APIError(
          "Token refresh failed. Please run 'apso login' again.",
          401,
          "TOKEN_REFRESH_FAILED"
        );
      }
    }

    this.accessToken = creds.accessToken;
    return creds.accessToken;
  }

  /**
   * Make an authenticated request
   */
  async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.ensureValidToken();

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token might be invalid, try refreshing once more
        try {
          const creds = readCredentials();
          if (creds) {
            const refreshed = await refreshAccessToken(creds.refreshToken);
            writeCredentials({
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
              user: refreshed.user,
            });
            this.accessToken = refreshed.accessToken;

            // Retry the request with new token
            const retryResponse = await fetch(url, {
              ...options,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${refreshed.accessToken}`,
                ...options.headers,
              },
            });

            if (!retryResponse.ok) {
              const errorText = await retryResponse.text();
              throw new APIError(
                `API request failed: ${errorText}`,
                retryResponse.status
              );
            }

            return retryResponse.json();
          }
        } catch (refreshError) {
          throw new APIError(
            "Authentication failed. Please run 'apso login' again.",
            401,
            "AUTH_FAILED"
          );
        }
      }

      const errorText = await response.text();
      throw new APIError(
        `API request failed: ${errorText}`,
        response.status
      );
    }

    // Handle empty responses
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return response.json();
    }

    return response.text() as any;
  }

  /**
   * GET request
   */
  async get<T = any>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  /**
   * POST request
   */
  async post<T = any>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T = any>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return isAuthenticated();
  }
}

// Export singleton instance
export const apiClient = new APIClient();
