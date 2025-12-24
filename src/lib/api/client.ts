import {
  getApiBaseUrl,
  readCredentials,
  isAuthenticated,
} from "../config/index";
import { refreshAccessToken } from "../auth/oauth";
import { Readable } from "stream";

export interface WorkspaceSummary {
  id: number;
  slug: string;
  name: string;
}

export interface ServiceEnvironment {
  id: string;
  slug?: string;
  name: string;
}

export interface ServiceSummary {
  id: number;
  slug: string;
  name: string;
  environments?: ServiceEnvironment[];
}

export class ApiClient {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = getApiBaseUrl();
  }

  private getCurrentUserId(): number {
    const creds = readCredentials();
    if (!creds) {
      throw new Error(
        "Credentials are missing. Please run 'apso login' to authenticate."
      );
    }

    const id = Number(creds.user.id);
    if (Number.isNaN(id)) {
      throw new TypeError(
        "Authenticated user ID is not a number. Please contact support."
      );
    }

    return id;
  }

  private async getAccessToken(): Promise<string> {
    if (!isAuthenticated()) {
      throw new Error(
        "You are not logged in. Please run 'apso login' and try again."
      );
    }

    const creds = readCredentials();
    if (!creds) {
      throw new Error(
        "Credentials are missing. Please run 'apso login' to authenticate."
      );
    }

    const expiresAt = new Date(creds.expiresAt);
    const now = new Date();

    // If token is expired or about to expire in the next minute, try to refresh.
    if (expiresAt.getTime() - now.getTime() < 60 * 1000) {
      const refreshed = await refreshAccessToken(creds.refreshToken);
      // Persisting refreshed credentials is handled in the login flow;
      // for now we simply use the new access token.
      return refreshed.accessToken;
    }

    return creds.accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.apiBaseUrl}${path}`;

    const headers: HeadersInit = {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();

      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`[DEBUG] API Error Response (${response.status}):`, text);
      }

      if (response.status === 401) {
        throw new Error(
          "Authentication failed (401). Please run 'apso login' again and retry."
        );
      }

      if (response.status === 404) {
        throw new Error(
          `API endpoint not found (404): ${url}\n` +
            `Please verify that the backend API is running and the endpoint exists.`
        );
      }

      throw new Error(
        `API request failed (${response.status}): ${text || response.statusText}`
      );
    }

    const json = await response.json();
    
    if (process.env.DEBUG || process.env.APSO_DEBUG) {
      console.log(`[DEBUG] API Response:`, JSON.stringify(json, null, 2).slice(0, 500));
    }

    return json as T;
  }

  /**
   * Low-level helper used by a few advanced CLI commands that need to hit
   * backend endpoints which don't yet have first-class wrappers here.
   * Prefer adding dedicated typed methods instead of using this where possible.
   */
  async rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, init);
  }

  /**
   * Upload a file using multipart/form-data
   * Handles form-data package streams properly for Node.js
   */
  async uploadFile<T>(
    path: string,
    formData: any,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.apiBaseUrl}${path}`;

    // Get headers from formData (form-data package provides getHeaders with boundary)
    const formHeaders = formData.getHeaders ? formData.getHeaders() : {};

    // Convert form-data stream to buffer
    // form-data is a Readable stream, we need to consume it
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      
      // Ensure form-data is treated as a readable stream
      const stream = formData as Readable;
      
      stream.on('data', (chunk: Buffer | string) => {
        // form-data emits both strings (boundaries) and Buffers
        // We only want Buffer chunks
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (typeof chunk === 'string') {
          // Convert string to Buffer (boundary markers, etc.)
          chunks.push(Buffer.from(chunk, 'utf8'));
        }
      });
      
      stream.on('end', () => {
        if (chunks.length === 0) {
          reject(new Error('FormData stream ended with no data'));
          return;
        }
        const result = Buffer.concat(chunks as unknown as Uint8Array[]);
        resolve(result);
      });
      
      stream.on('error', (err: Error) => {
        reject(err);
      });
      
      // Start reading the stream
      stream.resume();
    });

    const headers: HeadersInit = {
      ...formHeaders,
      ...init.headers,
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...init,
      method: init.method || "POST",
      body: body as any, // Buffer is compatible with fetch body but TypeScript needs help
      headers,
    });

    if (!response.ok) {
      const text = await response.text();

      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`[DEBUG] Upload Error Response (${response.status}):`, text);
      }

      if (response.status === 401) {
        throw new Error(
          "Authentication failed (401). Please run 'apso login' again and retry."
        );
      }

      if (response.status === 404) {
        throw new Error(
          `API endpoint not found (404): ${url}\n` +
            `Please verify that the backend API is running and the endpoint exists.`
        );
      }

      throw new Error(
        `API request failed (${response.status}): ${text || response.statusText}`
      );
    }

    const json = await response.json();

    if (process.env.DEBUG || process.env.APSO_DEBUG) {
      console.log(`[DEBUG] Upload Response:`, JSON.stringify(json, null, 2).slice(0, 500));
    }

    return json as T;
  }

  /**
   * List workspaces for the currently authenticated user, mirroring the
   * frontend's getWorkspacesByUserId helper.
   */
  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const userId = this.getCurrentUserId();

    const url =
      `/WorkspaceUsers?filter=userId||$eq||${encodeURIComponent(
        String(userId)
      )}` +
      `&filter=status||$eq||Active&join=workspace&limit=100`;

    const response = await this.request<{
      data: Array<{
        id: number;
        workspace: { id: number; name: string; slug: string };
      }>;
    }>(url);

    const items = Array.isArray(response.data) ? response.data : [];

    const seenWorkspaceIds = new Set<number>();

    return items
      .filter(
        (item) => item.workspace && !seenWorkspaceIds.has(item.workspace.id)
      )
      .map((item) => {
        seenWorkspaceIds.add(item.workspace.id);
        return {
          id: item.workspace.id,
          name: item.workspace.name,
          slug: item.workspace.slug,
        };
      });
  }

  async listServices(workspaceId: string): Promise<ServiceSummary[]> {
    const numericId = Number(workspaceId);
    if (Number.isNaN(numericId)) {
      throw new TypeError(`Invalid workspace ID: ${workspaceId}`);
    }

    const pageSize = 100;
    let offset = 0;
    let allServices: ServiceSummary[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `/WorkspaceServices?s=${encodeURIComponent(
        JSON.stringify({ workspaceId: numericId })
      )}&limit=${pageSize}&offset=${offset}`;

      const response = await this.request<{
        data: Array<{ id: number; name: string; slug: string }>;
        total?: number;
      }>(url);

      const items = Array.isArray(response.data) ? response.data : [];
      const services = items.map((svc) => ({
        id: svc.id,
        name: svc.name,
        slug: svc.slug,
      }));

      allServices = [...allServices, ...services];

      // Check if we've fetched all services
      if (items.length < pageSize || (response.total !== undefined && allServices.length >= response.total)) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }

    return allServices;
  }

  /**
   * Create a new workspace with sensible defaults. This mirrors the backend's
   * Workspace entity defaults and keeps the payload minimal.
   */
  async createWorkspace(name: string): Promise<WorkspaceSummary> {
    const slug = this.slugify(`${name}`);

    const body = {
      name,
      slug,
      workspaceType: "Other",
      status: "Active",
    };

    const created = await this.request<{
      id: number;
      name: string;
      slug: string;
    }>("/Workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
    };
  }

  
  async getLatestSchema(serviceId: string): Promise<any> {
    const serviceIdNum = Number.parseInt(serviceId, 10);
    if (Number.isNaN(serviceIdNum)) {
      throw new TypeError(`Invalid service ID format: ${serviceId}`);
    }

    console.log(`[DEBUG] Verifying authentication by checking user info...`);
    try {
      const creds = readCredentials();
      if (creds?.user) {
        console.log(
          `[DEBUG] Authenticated as user ID: ${creds.user.id}, email: ${creds.user.email}`
        );
      }
    } catch (error) {
      console.log(`[DEBUG] Could not read credentials:`, error);
    }

    // Fetch the base WorkspaceService once so we can re-use its apsorc field as a fallback
    let workspaceService: {
      id: number;
      name: string;
      workspaceId: number;
      apsorc?: any;
    } | null = null;

    try {
      workspaceService = await this.request<{
        id: number;
        name: string;
        workspaceId: number;
        apsorc?: any;
      }>(`/WorkspaceServices/${serviceIdNum}`);
      console.log(
        `[DEBUG] ✓ Can access service: ${workspaceService.name} (workspaceId: ${workspaceService.workspaceId})`
      );
    } catch (error: any) {
      console.error(`[DEBUG] ✗ Cannot access service: ${error.message}`);
      throw new Error(
        `Cannot access service ${serviceIdNum}. You may not have permission to view this service.\n` +
          `Original error: ${error.message}`
      );
    }

    let debugResponse: any = null;
    let allSchemas: any[] = [];
    
    const queryFormats = [
      `/WorkspaceServices/${serviceIdNum}?join=serviceSchemas&limit=100`,
      `/ServiceSchemas?filter=workspaceServiceId||$eq||${serviceIdNum}&join=workspaceService&limit=10`,
      `/ServiceSchemas?filter=workspaceServiceId||$eq||${serviceIdNum}&limit=10`,
      `/ServiceSchemas?s=${encodeURIComponent(JSON.stringify({ workspaceServiceId: serviceIdNum }))}&limit=10`,
    ];

    for (const query of queryFormats) {
      try {
        console.log(`[DEBUG] Trying query format: ${query}`);
        const response = await this.request<any>(query);
        
        if (query.includes('/WorkspaceServices/')) {
          const service = response;
          if (service.serviceSchemas && Array.isArray(service.serviceSchemas)) {
            allSchemas = service.serviceSchemas;
            debugResponse = { data: allSchemas };
            console.log(`[DEBUG] ✓ Found schemas via WorkspaceService relationship: ${allSchemas.length} schemas`);
            break;
          } else {
            console.log(`[DEBUG] WorkspaceService response doesn't have serviceSchemas array`);
            console.log(`[DEBUG] Response keys:`, Object.keys(service || {}));
          }
        } else {
          debugResponse = response;
          allSchemas = response.data || [];
          if (allSchemas.length > 0) {
            console.log(`[DEBUG] ✓ Query format worked! Found ${allSchemas.length} schemas`);
            break;
          } else {
            console.log(`[DEBUG] Query returned empty results`);
          }
        }
      } catch (error: any) {
        console.log(`[DEBUG] Query format failed: ${error.message}`);
        continue;
      }
    }

    console.log(`[DEBUG] Final result: Found ${allSchemas.length} schemas for service ${serviceIdNum}:`);
    if (allSchemas.length > 0) {
      allSchemas.forEach((s) => {
        console.log(`  - Schema ${s.id}: status=${s.status}, active=${s.active}, version=${s.version}, hasApsorc=${Boolean(s.apsorc)}, workspaceServiceId=${s.workspaceServiceId}`);
      });
    } else {
      console.log(`[DEBUG] No schemas found. Full response:`, JSON.stringify(debugResponse, null, 2));
    }

    let response = await this.request<{
      data: Array<{
        id: number;
        apsorc: any;
        status: string;
        active: boolean;
        version: string;
        created_at: string;
      }>;
      count: number;
      total: number;
    }>(
      `/ServiceSchemas?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&filter=active||$eq||true&limit=1`
    );

    if (!response.data || response.data.length === 0) {
      response = await this.request<{
        data: Array<{
          id: number;
          apsorc: any;
          status: string;
          active: boolean;
          version: string;
          created_at: string;
        }>;
        count: number;
        total: number;
      }>(
        `/ServiceSchemas?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&limit=1`
      );
    }

    if (!response.data || response.data.length === 0) {
      response = await this.request<{
        data: Array<{
          id: number;
          apsorc: any;
          status: string;
          active: boolean;
          version: string;
          created_at: string;
        }>;
        count: number;
        total: number;
      }>(
        `/ServiceSchemas?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&filter=status||$eq||Deploy&limit=1`
      );
    }

    if (!response.data || response.data.length === 0) {
      response = await this.request<{
        data: Array<{
          id: number;
          apsorc: any;
          status: string;
          active: boolean;
          version: string;
          created_at: string;
        }>;
        count: number;
        total: number;
      }>(
        `/ServiceSchemas?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&filter=status||$eq||Build&limit=1`
      );
    }

    if (!response.data || response.data.length === 0) {
      response = await this.request<{
        data: Array<{
          id: number;
          apsorc: any;
          status: string;
          active: boolean;
          version: string;
          created_at: string;
        }>;
        count: number;
        total: number;
      }>(
        `/ServiceSchemas?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&filter=status||$eq||Draft&limit=1`
      );
    }

    if (!response.data || response.data.length === 0) {
      console.log(
        `[DEBUG] No ServiceSchema records found via direct queries. Falling back to ServiceSchemaChat (chat history).`
      );

      const chatResponse = await this.request<{
        data: Array<{
          id: number;
          schema: any;
          created_at: string;
          workspaceServiceId: number;
        }>;
        count: number;
        total: number;
      }>(
        `/ServiceSchemaChats?sort=created_at,DESC&filter=workspaceServiceId||$eq||${serviceIdNum}&limit=1`
      );

      const chatSchemas = chatResponse.data || [];

      if (chatSchemas.length === 0) {
        if (debugResponse && debugResponse.data && debugResponse.data.length > 0) {
          const statuses = debugResponse.data
            .map(
              (s: {
                id: number;
                status: string;
                active: boolean;
                version: string;
              }) =>
                `id=${s.id}, status=${s.status}, active=${s.active}, version=${s.version}`
            )
            .join("; ");
          throw new Error(
            `No schema found matching criteria for service ${serviceId}.\n` +
              `Found ${debugResponse.data.length} ServiceSchema record(s) with: ${statuses}\n` +
              `And no ServiceSchemaChat records were found either.\n` +
              `Please ensure a schema is created on the platform.`
          );
        }

        throw new Error(
          `No schema found for service ${serviceId}.\n` +
            `Please create a schema on the platform first.`
        );
      }

      const chatSchema = chatSchemas[0];
      if (!chatSchema.schema) {
        throw new Error(
          `ServiceSchemaChat ${chatSchema.id} has no schema data.\n` +
            `This chat history may be incomplete.`
        );
      }

      console.log(
        `[DEBUG] Using schema from ServiceSchemaChat ${chatSchema.id} as fallback.`
      );


      if (typeof chatSchema.schema === "string") {
        try {
          return JSON.parse(chatSchema.schema);
        } catch (error) {
          throw new Error(
            `ServiceSchemaChat ${chatSchema.id} schema is not valid JSON: ${(error as Error).message}`
          );
        }
      }

      return chatSchema.schema;
    }

    const schema = response.data[0];
    if (!schema.apsorc) {
      throw new Error(
        `ServiceSchema ${schema.id} has no apsorc data.\n` +
          `This schema may be incomplete.`
      );
    }

    if (typeof schema.apsorc === "string") {
      try {
        return JSON.parse(schema.apsorc);
      } catch (error) {
        throw new Error(
          `ServiceSchema ${schema.id} apsorc is not valid JSON: ${(error as Error).message}`
        );
      }
    }

    return schema.apsorc;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^\da-z]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  /**
   * Push schema to the platform
   * Creates or updates a ServiceSchema record for the given service
   * Deactivates all other active schemas for this service to ensure only one is active
   */
  async pushSchema(
    serviceId: string,
    schema: any
  ): Promise<{ id?: number; version?: string; hash?: string }> {
    const serviceIdNum = Number.parseInt(serviceId, 10);
    if (Number.isNaN(serviceIdNum)) {
      throw new TypeError(`Invalid service ID format: ${serviceId}`);
    }

    // First, find all active schemas for this service
    let existingActiveSchemas: any[] = [];
    try {
      const response = await this.request<{
        data: Array<{
          id: number;
          apsorc: any;
          status: string;
          active: boolean;
          version: string;
          workspaceServiceId: number;
        }>;
        count: number;
      }>(
        `/ServiceSchemas?filter=workspaceServiceId||$eq||${serviceIdNum}&filter=active||$eq||true`
      );

      if (response.data && response.data.length > 0) {
        existingActiveSchemas = response.data;
      }
    } catch (error) {
      // If query fails, we'll continue anyway
      const err = error as Error;
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`[DEBUG] Could not find existing schemas: ${err.message}`);
      }
    }

    // Find the most recent active schema (if any) to update, otherwise create new
    const existingSchema = existingActiveSchemas.length > 0
      ? existingActiveSchemas.sort((a, b) => {
          // Sort by created_at descending to get the most recent
          const aDate = new Date(a.created_at || 0).getTime();
          const bDate = new Date(b.created_at || 0).getTime();
          return bDate - aDate;
        })[0]
      : null;

    // Prepare schema payload
    const schemaPayload = {
      apsorc: schema,
      workspaceServiceId: serviceIdNum,
      status: "Draft", // Default to Draft, can be changed later
      active: true,
      version: `v${Date.now()}`, // Generate a version string
    };

    let result: any;

    if (existingSchema) {
      // Update existing schema
      try {
        result = await this.request<{
          id: number;
          apsorc: any;
          version: string;
          status: string;
          active: boolean;
        }>(`/ServiceSchemas/${existingSchema.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...schemaPayload,
            version: existingSchema.version, // Keep existing version
          }),
        });
      } catch (error) {
        const err = error as Error;
        throw new Error(
          `Failed to update schema on platform: ${err.message}\n` +
            `Schema ID: ${existingSchema.id}`
        );
      }
    } else {
      // Create new schema
      try {
        result = await this.request<{
          id: number;
          apsorc: any;
          version: string;
          status: string;
          active: boolean;
        }>(`/ServiceSchemas`, {
          method: "POST",
          body: JSON.stringify(schemaPayload),
        });
      } catch (error) {
        const err = error as Error;
        throw new Error(
          `Failed to create schema on platform: ${err.message}\n` +
            `Service ID: ${serviceIdNum}`
        );
      }
    }

    // IMPORTANT: Deactivate ALL other active schemas for this service
    // This ensures only the schema we just pushed is active
    // We need to fetch again in case a new schema was created (not updated)
    let allActiveSchemas: any[] = [];
    try {
      const allActiveResponse = await this.request<{
        data: Array<{
          id: number;
          active: boolean;
        }>;
      }>(
        `/ServiceSchemas?filter=workspaceServiceId||$eq||${serviceIdNum}&filter=active||$eq||true`
      );

      if (allActiveResponse.data && allActiveResponse.data.length > 0) {
        allActiveSchemas = allActiveResponse.data;
      }
    } catch (error) {
      // If query fails, log but continue
      const err = error as Error;
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`[DEBUG] Could not fetch all active schemas for deactivation: ${err.message}`);
      }
    }

    // Deactivate all schemas except the one we just created/updated
    const schemasToDeactivate = allActiveSchemas.filter(
      (s) => s.id !== result.id
    );

    if (schemasToDeactivate.length > 0) {
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(
          `[DEBUG] Deactivating ${schemasToDeactivate.length} other active schema(s)`
        );
      }

      // Deactivate other schemas in parallel
      await Promise.all(
        schemasToDeactivate.map(async (schemaToDeactivate) => {
          try {
            await this.request(`/ServiceSchemas/${schemaToDeactivate.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                active: false,
              }),
            });
            if (process.env.DEBUG || process.env.APSO_DEBUG) {
              console.log(
                `[DEBUG] ✓ Deactivated schema ${schemaToDeactivate.id}`
              );
            }
          } catch (error) {
            // Log but don't fail the entire push if deactivation fails
            const err = error as Error;
            console.warn(
              `Warning: Failed to deactivate schema ${schemaToDeactivate.id}: ${err.message}`
            );
          }
        })
      );
    } else if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`[DEBUG] No other active schemas to deactivate`);
      }

    return {
      id: result.id,
      version: result.version,
      // Hash would be calculated client-side if needed
      hash: undefined,
    };
  }
}

export function createApiClient(): ApiClient {
  return new ApiClient();
}


