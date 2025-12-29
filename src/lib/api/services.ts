/**
 * Platform API Services
 *
 * Typed API methods for interacting with platform resources.
 * 
 * NOTE: This file uses the 'api' object from the incoming branch which doesn't exist in HEAD.
 * This file is temporarily disabled until it can be adapted to use the ApiClient class.
 */

// // import { api } from "./client";
// NOTE: This file uses the 'api' object from the incoming branch which doesn't exist in HEAD.
// This file is temporarily disabled until it can be adapted to use the ApiClient class.

// Temporary placeholder API object with proper typing to prevent compilation errors
const api = {
  get: <T>(_path: string, _options?: any): Promise<T> => {
    throw new Error("api.get is not yet implemented with ApiClient");
  },
  post: <T>(_path: string, _body?: any, _options?: any): Promise<T> => {
    throw new Error("api.post is not yet implemented with ApiClient");
  },
  put: <T>(_path: string, _body?: any, _options?: any): Promise<T> => {
    throw new Error("api.put is not yet implemented with ApiClient");
  },
  patch: <T>(_path: string, _body?: any, _options?: any): Promise<T> => {
    throw new Error("api.patch is not yet implemented with ApiClient");
  },
  delete: <T>(_path: string, _options?: any): Promise<T> => {
    throw new Error("api.delete is not yet implemented with ApiClient");
  },
};

import {
  UserProfile,
  Workspace,
  Service,
  ServiceSchema,
  GitHubRepo,
  GitHubConnection,
  BuildStatus,
  PaginatedResponse,
  TokenExchangeResponse,
} from "./types";

/**
 * Authentication API
 */
export const authApi = {
  /**
   * Exchange OAuth authorization code for tokens
   */
  exchangeCode(code: string): Promise<TokenExchangeResponse> {
    return api.post<TokenExchangeResponse>(
      "/auth/cli/exchange",
      { code },
      { skipAuth: true }
    );
  },

  /**
   * Get current user profile
   */
  getProfile(): Promise<UserProfile> {
    return api.get<UserProfile>("/auth/me");
  },

  /**
   * Revoke current session
   */
  logout(): Promise<void> {
    return api.post<void>("/auth/cli/logout");
  },
};

/**
 * Workspaces API
 */
export const workspacesApi = {
  /**
   * List all workspaces the user has access to
   */
  list(): Promise<Workspace[]> {
    return api.get<Workspace[]>("/workspaces");
  },

  /**
   * Get a specific workspace by slug
   */
  get(slug: string): Promise<Workspace> {
    return api.get<Workspace>(`/workspaces/${slug}`);
  },

  /**
   * Get workspace by ID
   */
  getById(id: string): Promise<Workspace> {
    return api.get<Workspace>(`/workspaces/by-id/${id}`);
  },
};

/**
 * Services API
 */
export const servicesApi = {
  /**
   * List all services in a workspace
   */
  list(
    workspaceSlug: string,
    options?: { status?: string; page?: number; pageSize?: number }
  ): Promise<PaginatedResponse<Service>> {
    return api.get<PaginatedResponse<Service>>(
      `/workspaces/${workspaceSlug}/services`,
      { params: options }
    );
  },

  /**
   * Get a specific service by slug
   */
  get(workspaceSlug: string, serviceSlug: string): Promise<Service> {
    return api.get<Service>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}`
    );
  },

  /**
   * Get service by ID
   */
  getById(id: string): Promise<Service> {
    return api.get<Service>(`/services/${id}`);
  },

  /**
   * Create a new service
   */
  create(
    workspaceSlug: string,
    data: {
      name: string;
      slug?: string;
      description?: string;
      githubRepo?: string;
      githubBranch?: string;
    }
  ): Promise<Service> {
    return api.post<Service>(
      `/workspaces/${workspaceSlug}/services`,
      data
    );
  },

  /**
   * Update a service
   */
  update(
    workspaceSlug: string,
    serviceSlug: string,
    data: Partial<{
      name: string;
      description: string;
      githubRepo: string;
      githubBranch: string;
    }>
  ): Promise<Service> {
    return api.patch<Service>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}`,
      data
    );
  },

  /**
   * Delete a service
   */
  delete(workspaceSlug: string, serviceSlug: string): Promise<void> {
    return api.delete<void>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}`
    );
  },
};

/**
 * Schema API
 */
export const schemaApi = {
  /**
   * Get the current schema for a service
   */
  get(workspaceSlug: string, serviceSlug: string): Promise<ServiceSchema> {
    return api.get<ServiceSchema>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/schema`
    );
  },

  /**
   * Get schema by service ID
   */
  getByServiceId(serviceId: string): Promise<ServiceSchema> {
    return api.get<ServiceSchema>(`/services/${serviceId}/schema`);
  },

  /**
   * Update the schema for a service (push)
   */
  update(
    workspaceSlug: string,
    serviceSlug: string,
    schema: Omit<ServiceSchema, "id" | "serviceId" | "version" | "createdAt" | "updatedAt">
  ): Promise<ServiceSchema> {
    return api.put<ServiceSchema>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/schema`,
      schema
    );
  },

  /**
   * Validate a schema without saving
   */
  validate(
    workspaceSlug: string,
    serviceSlug: string,
    schema: Omit<ServiceSchema, "id" | "serviceId" | "version" | "createdAt" | "updatedAt">
  ): Promise<{ valid: boolean; errors: string[] }> {
    return api.post<{ valid: boolean; errors: string[] }>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/schema/validate`,
      schema
    );
  },

  /**
   * Get schema diff between local and remote
   */
  diff(
    workspaceSlug: string,
    serviceSlug: string,
    localSchema: Omit<ServiceSchema, "id" | "serviceId" | "version" | "createdAt" | "updatedAt">
  ): Promise<{
    hasChanges: boolean;
    added: string[];
    removed: string[];
    modified: string[];
  }> {
    return api.post<{
      hasChanges: boolean;
      added: string[];
      removed: string[];
      modified: string[];
    }>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/schema/diff`,
      localSchema
    );
  },
};

/**
 * Build API
 */
export const buildApi = {
  /**
   * Trigger a build for a service
   */
  trigger(workspaceSlug: string, serviceSlug: string): Promise<BuildStatus> {
    return api.post<BuildStatus>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/build`
    );
  },

  /**
   * Get build status
   */
  getStatus(buildId: string): Promise<BuildStatus> {
    return api.get<BuildStatus>(`/builds/${buildId}`);
  },

  /**
   * Get latest build for a service
   */
  getLatest(
    workspaceSlug: string,
    serviceSlug: string
  ): Promise<BuildStatus | null> {
    return api.get<BuildStatus | null>(
      `/workspaces/${workspaceSlug}/services/${serviceSlug}/build/latest`
    );
  },

  /**
   * Poll for build completion
   * Note: Sequential polling is intentional for proper status checking
   */
  async waitForCompletion(
    buildId: string,
    options?: {
      maxWait?: number;
      pollInterval?: number;
      onProgress?: (status: BuildStatus) => void;
    }
  ): Promise<BuildStatus> {
    const maxWait = options?.maxWait ?? 300_000; // 5 minutes default
    const pollInterval = options?.pollInterval ?? 3000; // 3 seconds
    const startTime = Date.now();

    /* eslint-disable no-await-in-loop */
    while (Date.now() - startTime < maxWait) {
      const status = await this.getStatus(buildId);

      if (options?.onProgress) {
        options.onProgress(status);
      }

      if (status.status === "success" || status.status === "failed") {
        return status;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, pollInterval);
      });
    }
    /* eslint-enable no-await-in-loop */

    throw new Error("Build timed out");
  },
};

/**
 * GitHub API
 */
export const githubApi = {
  /**
   * Get GitHub connection status for a workspace
   */
  getConnection(workspaceSlug: string): Promise<GitHubConnection> {
    return api.get<GitHubConnection>(
      `/workspaces/${workspaceSlug}/github/connection`
    );
  },

  /**
   * List available GitHub repositories
   */
  listRepos(
    workspaceSlug: string,
    options?: { page?: number; pageSize?: number; search?: string }
  ): Promise<PaginatedResponse<GitHubRepo>> {
    return api.get<PaginatedResponse<GitHubRepo>>(
      `/workspaces/${workspaceSlug}/github/repos`,
      { params: options }
    );
  },

  /**
   * Get OAuth URL for GitHub connection
   */
  getConnectUrl(workspaceSlug: string): Promise<{ url: string }> {
    return api.get<{ url: string }>(
      `/workspaces/${workspaceSlug}/github/connect-url`
    );
  },
};
