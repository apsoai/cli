/**
 * Platform API Client
 *
 * HTTP client for making authenticated requests to the Apso platform.
 * Features:
 * - Automatic token refresh
 * - Request/response interceptors
 * - Retry with exponential backoff
 * - Timeout handling
 */

import {
  ApiError,
  ApiRequestOptions,
  TokenRefreshResponse,
} from "./types";
import { globalConfig, credentials } from "../config";

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30_000;

/**
 * Maximum retry attempts for failed requests
 */
const MAX_RETRIES = 3;

/**
 * Base delay for exponential backoff in milliseconds
 */
const BACKOFF_BASE_DELAY = 1000;

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /**
   * Check if error is due to authentication failure
   */
  isAuthError(): boolean {
    return this.statusCode === 401;
  }

  /**
   * Check if error is a rate limit error
   */
  isRateLimitError(): boolean {
    return this.statusCode === 429;
  }

  /**
   * Check if error is a server error (5xx)
   */
  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }
}

/**
 * Check if we're running in an environment with network access
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    const config = globalConfig.read();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.apiUrl}/health`, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Calculate backoff delay with jitter
 */
function getBackoffDelay(attempt: number): number {
  const delay = BACKOFF_BASE_DELAY * 2**attempt;
  const jitter = Math.random() * 0.3 * delay;
  return delay + jitter;
}

/**
 * Build URL with query parameters
 */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const url = new URL(path, baseUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(): Promise<boolean> {
  const creds = credentials.read();
  if (!creds) {
    return false;
  }

  try {
    const config = globalConfig.read();
    const response = await fetch(`${config.apiUrl}/auth/cli/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: creds.tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as TokenRefreshResponse;

    // Update stored credentials with new access token
    credentials.write({
      tokens: {
        ...creds.tokens,
        accessToken: data.accessToken,
        expiresAt: new Date(
          Date.now() + data.expiresIn * 1000
        ).toISOString(),
      },
      user: creds.user,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Make an authenticated request to the platform API
 * Note: Sequential retries are intentional for proper backoff behavior
 */
/* eslint-disable no-await-in-loop */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    params,
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    skipAuth = false,
  } = options;

  const config = globalConfig.read();
  const url = buildUrl(config.apiUrl, path, params);

  // Build request headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `apso-cli/${getCliVersion()}`,
    ...headers,
  };

  // Add authentication if not skipped
  if (!skipAuth) {
    const creds = credentials.read();
    if (!creds) {
      throw new ApiClientError(
        "Not authenticated. Run 'apso login' first.",
        401
      );
    }

    // Check if token needs refresh
    if (credentials.needsRefresh()) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        throw new ApiClientError(
          "Session expired. Please run 'apso login' again.",
          401
        );
      }
    }

    // Re-read credentials after potential refresh
    const freshCreds = credentials.read();
    if (freshCreds) {
      requestHeaders.Authorization = `Bearer ${freshCreds.tokens.accessToken}`;
    }
  }

  // Make request with retries
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle response
      if (response.ok) {
        // Handle empty responses
        const contentType = response.headers.get("content-type");
        if (
          contentType?.includes("application/json") &&
          response.status !== 204
        ) {
          return (await response.json()) as T;
        }
        return {} as T;
      }

      // Parse error response
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          statusCode: response.status,
          message: response.statusText,
        };
      }

      // Handle 401 - try refresh once
      if (response.status === 401 && attempt === 0 && !skipAuth) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          // Retry with new token
          continue;
        }
        throw new ApiClientError(
          "Session expired. Please run 'apso login' again.",
          401
        );
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitTime = retryAfter
          ? Number.parseInt(retryAfter, 10) * 1000
          : getBackoffDelay(attempt);
        await sleep(waitTime);
        continue;
      }

      // Handle server errors with retry
      if (response.status >= 500) {
        lastError = new ApiClientError(
          errorData.message || "Server error",
          response.status,
          errorData.details
        );
        await sleep(getBackoffDelay(attempt));
        continue;
      }

      // Client errors - don't retry
      throw new ApiClientError(
        errorData.message || "Request failed",
        response.status,
        errorData.details
      );
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      // Handle abort/timeout
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new ApiClientError("Request timeout", 408);
        continue;
      }

      // Network errors
      lastError = new ApiClientError(
        error instanceof Error ? error.message : "Network error",
        0
      );
      await sleep(getBackoffDelay(attempt));
    }
  }

  throw lastError || new ApiClientError("Request failed after retries", 500);
}
/* eslint-enable no-await-in-loop */

/**
 * Get CLI version for User-Agent header
 */
function getCliVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../../../package.json");
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Platform API client with typed methods
 */
export const api = {
  /**
   * Make a GET request
   */
  get<T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) {
    return apiRequest<T>(path, { ...options, method: "GET" });
  },

  /**
   * Make a POST request
   */
  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">
  ) {
    return apiRequest<T>(path, { ...options, method: "POST", body });
  },

  /**
   * Make a PUT request
   */
  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">
  ) {
    return apiRequest<T>(path, { ...options, method: "PUT", body });
  },

  /**
   * Make a PATCH request
   */
  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">
  ) {
    return apiRequest<T>(path, { ...options, method: "PATCH", body });
  },

  /**
   * Make a DELETE request
   */
  delete<T>(path: string, options?: Omit<ApiRequestOptions, "method">) {
    return apiRequest<T>(path, { ...options, method: "DELETE" });
  },
};
