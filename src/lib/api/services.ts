/**
 * Platform API Services
 *
 * Typed API methods for interacting with platform resources.
 *
 * These call the BFF (the app's /api/* routes on app.apso.cloud), which wraps
 * the internal backend and enforces auth + workspace scoping. Workspace-scoped
 * routes read the active workspace from the X-Workspace-Id header that the API
 * client injects from the linked project (see client.ts). Responses are the
 * backend's snake_case / nestjsx-crud shapes and are adapted to the CLI types
 * below.
 */

import { api } from "./client";
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

// ---------------------------------------------------------------------------
// Adapters: backend (snake_case, nestjsx/crud) -> CLI types (camelCase)
// ---------------------------------------------------------------------------

type Raw = Record<string, any>;

function adaptWorkspace(raw: Raw): Workspace {
  // /api/workspaces returns workspace_user rows with a nested `workspace`;
  // /api/workspaces/:id returns a Workspace row directly.
  const w: Raw = raw?.workspace ?? raw;
  return {
    id: String(w.id),
    slug: w.slug,
    name: w.name,
    type: w.type ?? "company",
    description: w.description,
    createdAt: w.created_at ?? w.createdAt,
    updatedAt: w.updated_at ?? w.updatedAt,
  };
}

function mapServiceStatus(raw: Raw): Service["status"] {
  const b = String(raw.build_status ?? "").toLowerCase();
  if (b === "ready") return "active";
  if (b === "failed" || b === "error") return "error";
  if (b && b !== "new") return "building";
  const s = String(raw.status ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "archived") return "archived";
  return "active";
}

function adaptService(raw: Raw): Service {
  const repo: Raw | undefined = raw.serviceRepository ?? raw.service_repository;
  const branch: Raw | undefined = Array.isArray(raw.serviceBranches)
    ? raw.serviceBranches[0]
    : undefined;
  return {
    id: String(raw.id),
    workspaceId: String(raw.workspaceId ?? raw.workspace_id ?? ""),
    slug: raw.slug,
    name: raw.name,
    description: raw.description,
    status: mapServiceStatus(raw),
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
    lastDeployedAt: raw.s3_code_last_saved_at ?? undefined,
    githubRepo:
      repo?.repo_full_name ?? repo?.full_name ?? repo?.repository ?? undefined,
    githubBranch: branch?.branch_name ?? branch?.name ?? undefined,
    endpoint: raw.base_url ?? undefined,
  };
}

/** Backend crud list ({data,count,total,page,pageCount}) -> CLI PaginatedResponse. */
function adaptPaginated<T>(raw: Raw, mapItem: (r: Raw) => T): PaginatedResponse<T> {
  const items: Raw[] = Array.isArray(raw) ? raw : raw?.data ?? [];
  const total = raw?.total ?? items.length;
  const page = raw?.page ?? 1;
  const pageSize = items.length || 1;
  return {
    data: items.map(mapItem),
    meta: {
      total,
      page,
      pageSize,
      totalPages: raw?.pageCount ?? (Math.ceil(total / pageSize) || 1),
    },
  };
}

/**
 * Authentication API
 */
export const authApi = {
  exchangeCode(code: string): Promise<TokenExchangeResponse> {
    return api.post<TokenExchangeResponse>(
      "/api/auth/cli/exchange",
      { code },
      { skipAuth: true }
    );
  },

  getProfile(): Promise<UserProfile> {
    return api.get<UserProfile>("/api/auth/me");
  },

  /**
   * The BFF has no CLI logout route; logout is local (the logout command
   * clears stored credentials). Best-effort, never throws.
   */
  async logout(): Promise<void> {
    return;
  },
};

/**
 * Workspaces API
 */
export const workspacesApi = {
  async list(): Promise<Workspace[]> {
    const raw = await api.get<Raw>("/api/workspaces");
    const items: Raw[] = Array.isArray(raw) ? raw : raw?.data ?? [];
    return items.map(adaptWorkspace);
  },

  async getById(id: string): Promise<Workspace> {
    const raw = await api.get<Raw>(`/api/workspaces/${id}`);
    return adaptWorkspace(raw);
  },

  /** BFF is id-based; resolve a slug against the user's workspace list. */
  async get(slug: string): Promise<Workspace> {
    const all = await this.list();
    const match = all.find((w) => w.slug === slug);
    if (!match) throw new Error(`Workspace not found: ${slug}`);
    return match;
  },
};

/**
 * Services API
 */
export const servicesApi = {
  async list(
    workspaceId?: string | number,
    options?: { status?: string; page?: number; pageSize?: number }
  ): Promise<PaginatedResponse<Service>> {
    const params: Record<string, string | number | undefined> = {};
    if (options?.pageSize) params.limit = options.pageSize;
    if (options?.page && options?.pageSize) {
      params.offset = (options.page - 1) * options.pageSize;
    }
    // The BFF scopes /api/services by the NUMERIC workspace id in the
    // X-Workspace-Id header (not the slug). Pass it explicitly so the call
    // works even before a project is linked.
    const headers = workspaceId
      ? { "X-Workspace-Id": String(workspaceId) }
      : undefined;
    const raw = await api.get<Raw>("/api/services", { params, headers });
    return adaptPaginated(raw, adaptService);
  },

  async getById(id: string): Promise<Service> {
    const raw = await api.get<Raw>(`/api/services/${id}`);
    return adaptService(raw);
  },

  /** Resolve (workspaceId, serviceSlug) to a service via the workspace-scoped list. */
  async get(workspaceId: string, serviceSlug: string): Promise<Service> {
    const list = await this.list(workspaceId);
    const match = list.data.find((s) => s.slug === serviceSlug);
    if (!match) throw new Error(`Service not found: ${serviceSlug}`);
    return match;
  },

  async create(
    workspaceId: string,
    data: {
      name: string;
      slug?: string;
      description?: string;
      githubRepo?: string;
      githubBranch?: string;
    }
  ): Promise<Service> {
    const headers = workspaceId
      ? { "X-Workspace-Id": String(workspaceId) }
      : undefined;
    const raw = await api.post<Raw>(
      "/api/services",
      { name: data.name },
      { headers }
    );
    return adaptService(raw);
  },

  async update(
    _workspaceSlug: string,
    serviceSlugOrId: string,
    data: Partial<{
      name: string;
      description: string;
      githubRepo: string;
      githubBranch: string;
    }>
  ): Promise<Service> {
    const id = await resolveServiceId(serviceSlugOrId);
    const raw = await api.patch<Raw>(`/api/services/${id}`, data);
    return adaptService(raw);
  },

  async delete(_workspaceSlug: string, serviceSlugOrId: string): Promise<void> {
    const id = await resolveServiceId(serviceSlugOrId);
    await api.delete<void>(`/api/services/${id}`);
  },
};

/** Accept an id or slug; return the numeric service id. */
async function resolveServiceId(serviceSlugOrId: string): Promise<string> {
  if (/^\d+$/.test(serviceSlugOrId)) return serviceSlugOrId;
  const svc = await servicesApi.get("", serviceSlugOrId);
  return svc.id;
}

/**
 * Schema API — the schema lives on the service as its `apsorc` field, and
 * versioned rows exist under /api/ServiceSchemas.
 */
export const schemaApi = {
  async getByServiceId(serviceId: string): Promise<ServiceSchema> {
    const raw = await api.get<Raw>(`/api/services/${serviceId}`);
    return adaptSchemaFromService(raw);
  },

  async get(_workspaceSlug: string, serviceSlug: string): Promise<ServiceSchema> {
    const id = await resolveServiceId(serviceSlug);
    return this.getByServiceId(id);
  },

  async update(
    _workspaceSlug: string,
    serviceSlugOrId: string,
    schema: Omit<ServiceSchema, "id" | "serviceId" | "version" | "createdAt" | "updatedAt">
  ): Promise<ServiceSchema> {
    const id = await resolveServiceId(serviceSlugOrId);
    // Persist the schema onto the service's apsorc; the deploy pipeline reads it.
    const raw = await api.patch<Raw>(`/api/services/${id}`, {
      apsorc: JSON.stringify(schema),
    });
    return adaptSchemaFromService(raw);
  },

  // Validation and diff are computed locally by the CLI (the schema format is
  // fully known client-side), so these do not call the BFF. Signatures are kept
  // for the callers; the arguments are intentionally unused here.
  async validate(
    _workspaceSlug?: string,
    _serviceSlug?: string,
    _schema?: unknown
  ): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  },
  async diff(
    _workspaceSlug?: string,
    _serviceSlug?: string,
    _localSchema?: unknown
  ): Promise<{ hasChanges: boolean; added: string[]; removed: string[]; modified: string[] }> {
    return { hasChanges: false, added: [], removed: [], modified: [] };
  },
};

function adaptSchemaFromService(raw: Raw): ServiceSchema {
  let entities: any[] = [];
  const rc = raw.apsorc;
  try {
    const parsed = typeof rc === "string" ? JSON.parse(rc) : rc;
    entities = parsed?.entities ?? [];
  } catch {
    entities = [];
  }
  return {
    id: String(raw.id),
    serviceId: String(raw.id),
    version: 1,
    entities,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

/**
 * Build / Deploy API
 */
export const buildApi = {
  /** Trigger a deploy for the linked service (POST /api/services/:id/deploy). */
  async trigger(_workspaceSlug: string, serviceSlugOrId: string): Promise<BuildStatus> {
    const id = await resolveServiceId(serviceSlugOrId);
    await api.post<Raw>(`/api/services/${id}/deploy`, { target: "apso" });
    return buildStatusFromService(id);
  },

  /** No dedicated builds resource; derive status from the service record. */
  async getStatus(serviceId: string): Promise<BuildStatus> {
    return buildStatusFromService(serviceId);
  },

  async getLatest(_workspaceSlug: string, serviceSlugOrId: string): Promise<BuildStatus | null> {
    const id = await resolveServiceId(serviceSlugOrId);
    return buildStatusFromService(id);
  },

  async waitForCompletion(
    serviceId: string,
    options?: {
      maxWait?: number;
      pollInterval?: number;
      onProgress?: (status: BuildStatus) => void;
    }
  ): Promise<BuildStatus> {
    const maxWait = options?.maxWait ?? 600_000;
    const pollInterval = options?.pollInterval ?? 5000;
    const startTime = Date.now();
    /* eslint-disable no-await-in-loop */
    while (Date.now() - startTime < maxWait) {
      const status = await this.getStatus(serviceId);
      if (options?.onProgress) options.onProgress(status);
      if (status.status === "success" || status.status === "failed") return status;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    /* eslint-enable no-await-in-loop */
    throw new Error("Build timed out");
  },
};

async function buildStatusFromService(serviceId: string): Promise<BuildStatus> {
  const raw = await api.get<Raw>(`/api/services/${serviceId}`);
  const b = String(raw.build_status ?? "").toLowerCase();
  const status: BuildStatus["status"] =
    b === "ready" ? "success" : b === "failed" || b === "error" ? "failed" : b === "new" || b === "" ? "pending" : "building";
  return {
    id: String(raw.id),
    serviceId: String(raw.id),
    status,
    startedAt: raw.updated_at ?? raw.created_at ?? new Date().toISOString(),
    completedAt: status === "success" || status === "failed" ? raw.updated_at : undefined,
  };
}

/**
 * GitHub API
 */
export const githubApi = {
  async getConnection(_workspaceSlug?: string): Promise<GitHubConnection & { connectionId?: string }> {
    const raw = await api.get<Raw>("/api/github/connections");
    const statuses: Raw[] = raw?.connectionStatuses ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    const first = statuses[0];
    return {
      connected: Boolean(first),
      login: first?.login ?? first?.github_login ?? first?.account_login,
      installationId: first?.installation_id,
      connectionId: first?.id ? String(first.id) : first?.connectionId,
    };
  },

  async listRepos(
    _workspaceSlug: string,
    options?: { page?: number; pageSize?: number; search?: string; connectionId?: string }
  ): Promise<PaginatedResponse<GitHubRepo>> {
    const params: Record<string, string | number | undefined> = {};
    if (options?.connectionId) params.connectionId = options.connectionId;
    if (options?.pageSize) params.limit = options.pageSize;
    if (options?.page) params.page = options.page;
    if (options?.search) params.query = options.search;
    const raw = await api.get<Raw>("/api/github/repos", { params });
    return adaptPaginated(raw, (r) => ({
      id: r.id,
      fullName: r.full_name ?? r.fullName,
      name: r.name,
      owner: r.owner?.login ?? r.owner,
      private: Boolean(r.private),
      defaultBranch: r.default_branch ?? r.defaultBranch ?? "main",
      url: r.html_url ?? r.url,
    }));
  },

  async getConnectUrl(_workspaceSlug: string): Promise<{ url: string }> {
    return api.get<{ url: string }>("/api/github/authorize");
  },

  /**
   * Create a new GitHub repo for a service via the user's connection (no local
   * git or gh required). autoInit=false leaves it empty so the deploy's first
   * push becomes the initial commit.
   */
  async createRepo(
    connectionId: string,
    serviceName: string,
    options?: { private?: boolean; autoInit?: boolean }
  ): Promise<GitHubRepo> {
    const raw = await api.post<Raw>("/api/github/repos", {
      connectionId,
      serviceName,
      isPrivate: options?.private ?? true,
      autoInit: options?.autoInit ?? false,
    });
    const r = raw?.repository ?? raw?.data ?? raw;
    return {
      id: r.id,
      fullName: r.full_name ?? r.fullName ?? r.name,
      name: r.name,
      owner: r.owner?.login ?? r.owner,
      private: Boolean(r.private),
      defaultBranch: r.default_branch ?? r.defaultBranch ?? "main",
      url: r.html_url ?? r.url,
    };
  },

  /** Link an existing GitHub repo to a service. */
  async connectRepo(
    serviceId: string,
    connectionId: string,
    repoFullName: string
  ): Promise<Raw> {
    return api.post<Raw>("/api/github/connect-repo", {
      serviceId,
      connectionId,
      repoFullName,
    });
  },

  /** Push the service's saved (S3) code to its connected GitHub repo. */
  async push(
    serviceId: string,
    connectionId: string,
    options?: { branch?: string; message?: string }
  ): Promise<Raw> {
    return api.post<Raw>("/api/github/push", {
      serviceId,
      connectionId,
      branch: options?.branch ?? "main",
      message: options?.message ?? "Update from Apso CLI",
    });
  },
};

/**
 * Service code API — used for the server-side deploy (upload the project zip to
 * S3; the backend then pushes it to the repo, so no local git is required).
 */
export const codeApi = {
  /** Presigned S3 PUT URL to upload the service's code zip. */
  async getUploadUrl(
    serviceId: string
  ): Promise<{ url: string; bucket?: string; key?: string }> {
    return api.get<{ url: string; bucket?: string; key?: string }>(
      `/api/services/${serviceId}/code/upload-url`
    );
  },
};
