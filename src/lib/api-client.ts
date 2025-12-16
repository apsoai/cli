import axios, { AxiosInstance, AxiosError } from 'axios';
import { configManager } from './config';

export interface ApiError {
  code?: string;
  message: string;
  details?: any;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Default to production API, but allow override via environment or config
    this.baseUrl =
      baseUrl ||
      process.env.APSO_API_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      'https://api.apso.cloud';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30_000, // 30 seconds
    });

    // Add request interceptor to inject auth token
    this.client.interceptors.request.use((config) => {
      const token = configManager.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data as any;

          // Handle authentication errors
          if (status === 401) {
            const errorCode = data?.error?.code || 'AUTH_REQUIRED';
            const errorMessage =
              data?.error?.message || 'Authentication required';
            throw new ApiClientError(status, errorCode, errorMessage, data);
          }

          // Handle other errors
          const errorCode = data?.error?.code;
          const errorMessage =
            data?.error?.message || error.message || 'Request failed';
          throw new ApiClientError(status, errorCode, errorMessage, data);
        }

        // Network errors
        if (error.request) {
          throw new ApiClientError(
            0,
            'NETWORK_ERROR',
            'Network error: Could not reach the server',
            error.message
          );
        }

        // Other errors
        throw new ApiClientError(
          500,
          'UNKNOWN_ERROR',
          error.message || 'An unknown error occurred'
        );
      }
    );
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Make a GET request
   */
  async get<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * Make a POST request
   */
  async post<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * Make a PUT request
   */
  async put<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * Make a PATCH request
   */
  async patch<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  /**
   * Make a DELETE request
   */
  async delete<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

