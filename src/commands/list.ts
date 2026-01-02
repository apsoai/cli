import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { createApiClient, WorkspaceSummary, ServiceSummary } from "../lib/api/client";
import { readProjectLink } from "../lib/project-link";
import {
  readCache,
  writeCache,
  getCacheAge,
  clearAllCache,
} from "../lib/cache";

/**
 * Format cache age for display
 */
function formatCacheAge(ageMs: number): string {
  const ageSecs = Math.floor(ageMs / 1000);
  const ageMins = Math.floor(ageSecs / 60);
  const ageHours = Math.floor(ageMins / 60);

  if (ageSecs < 60) {
    return ageSecs + " second" + (ageSecs === 1 ? "" : "s") + " ago";
  } if (ageMins < 60) {
    return ageMins + " minute" + (ageMins === 1 ? "" : "s") + " ago";
  } 
    return ageHours + " hour" + (ageHours === 1 ? "" : "s") + " ago";
  
}

export default class List extends BaseCommand {
  static description =
    "List workspaces and services with optional caching";

  static examples = [
    "$ apso list                    # List workspaces and services",
    "$ apso list workspaces         # List only workspaces",
    "$ apso list services           # List services for linked workspace",
    "$ apso list services --workspace <id>  # List services for specific workspace",
    "$ apso list --no-cache        # Bypass cache and fetch fresh data",
    "$ apso list --clear-cache     # Clear all cached data",
  ];

  static strict = false; // Allow unknown arguments

  static flags = {
    workspace: Flags.string({
      char: "w",
      description: "Workspace ID to filter services (required if project is not linked)",
    }),
    "no-cache": Flags.boolean({
      description: "Bypass cache and fetch fresh data from API",
      default: false,
    }),
    "clear-cache": Flags.boolean({
      description: "Clear all cached data",
      default: false,
    }),
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(List);
    // First argument can be "workspaces" or "services", default to "all"
    const listType = (argv[0] as string) || "all";

    // Handle clear cache
    if (flags["clear-cache"]) {
      clearAllCache();
      if (flags.json) {
        this.log(JSON.stringify({ success: true, message: "Cache cleared" }));
      } else {
        this.log("✓ Cache cleared");
      }
      return;
    }

    // Ensure authentication
    await this.ensureAuthenticated({
      nonInteractive:
        process.env.APSO_NON_INTERACTIVE === "1" ||
        process.env.APSO_NON_INTERACTIVE === "true",
    });

    const api = createApiClient();
    const useCache = !flags["no-cache"];

    // List workspaces
    if (listType === "all" || listType === "workspaces") {
      await this.listWorkspaces(api, useCache, flags.json, listType);
    }

    // List services
    if (listType === "all") {
      // When listing "all", show services for all workspaces
      await this.listAllServices(api, useCache, flags.json);
    } else if (listType === "services") {
      // When listing "services" specifically, use linked workspace or --workspace flag
      await this.listServices(api, flags.workspace, useCache, flags.json, listType);
    }
  }

  private async listWorkspaces(
    api: ReturnType<typeof createApiClient>,
    useCache: boolean,
    jsonOutput: boolean,
    listType: string
  ): Promise<void> {
    const cacheKey = "workspaces";
    let workspaces: WorkspaceSummary[] | null = null;
    let fromCache = false;

    // Try to read from cache
    if (useCache) {
      workspaces = readCache<WorkspaceSummary[]>(cacheKey);
      if (workspaces) {
        fromCache = true;
      }
    }

    // Fetch from API if not in cache
    if (!workspaces) {
      try {
        if (!jsonOutput && !fromCache) {
          this.log("Fetching workspaces from platform...");
        }
        workspaces = await api.listWorkspaces();
        // Write to cache
        if (useCache) {
          writeCache(cacheKey, workspaces);
        }
      } catch (error) {
        // If API fails and we have cache, use it
        if (useCache) {
          const cached = readCache<WorkspaceSummary[]>(cacheKey);
          if (cached) {
            this.warn(
              "API request failed. Using cached data: " + (error as Error).message
            );
            workspaces = cached;
            fromCache = true;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    // Output results
    if (jsonOutput) {
      this.log(
        JSON.stringify({
          workspaces,
          cached: fromCache,
          cacheAge: fromCache ? getCacheAge(cacheKey) : null,
        })
      );
    } else {
      if (listType === "all") {
        this.log("");
        this.log("=== Workspaces ===");
        this.log("");
      }

      if (fromCache) {
        const age = getCacheAge(cacheKey);
        if (age !== null) {
          this.log("(Using cached data from " + formatCacheAge(age) + ")");
          this.log("");
        }
      }

      if (workspaces.length === 0) {
        this.log("No workspaces found.");
      } else {
        for (const ws of workspaces) {
          this.log(`  ${ws.name} (${ws.slug})`);
          this.log("");
        }
      }
    }
  }

  private async listServices(
    api: ReturnType<typeof createApiClient>,
    workspaceIdFlag: string | undefined,
    useCache: boolean,
    jsonOutput: boolean,
    listType: string
  ): Promise<void> {
    // Determine workspace ID
    let workspaceId: string | undefined = workspaceIdFlag;

    if (!workspaceId) {
      // Try to get from linked project
      const linkInfo = readProjectLink();
      if (linkInfo) {
        workspaceId = linkInfo.link.workspaceId;
      }
    }

    if (!workspaceId) {
      this.error(
        "Workspace ID is required. Either:\n" +
          "  • Link your project: apso link\n" +
          "  • Specify workspace: apso list services --workspace <id>"
      );
    }

    const cacheKey = `services_${workspaceId}`;
    let services: ServiceSummary[] | null = null;
    let fromCache = false;

    // Try to read from cache
    if (useCache) {
      services = readCache<ServiceSummary[]>(cacheKey);
      if (services) {
        fromCache = true;
      }
    }

    // Fetch from API if not in cache
    if (!services) {
      try {
        if (!jsonOutput && !fromCache) {
          this.log("Fetching services from platform...");
        }
        services = await api.listServices(workspaceId);
        // Write to cache
        if (useCache) {
          writeCache(cacheKey, services);
        }
      } catch (error) {
        // If API fails and we have cache, use it
        if (useCache) {
          const cached = readCache<ServiceSummary[]>(cacheKey);
          if (cached) {
            this.warn(
              "API request failed. Using cached data: " + (error as Error).message
            );
            services = cached;
            fromCache = true;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    // Output results
    if (jsonOutput) {
      this.log(
        JSON.stringify({
          workspaceId,
          services,
          cached: fromCache,
          cacheAge: fromCache ? getCacheAge(cacheKey) : null,
        })
      );
    } else {
      if (listType === "all") {
        this.log("");
        this.log("=== Services ===");
        this.log("");
      }

      if (fromCache) {
        const age = getCacheAge(cacheKey);
        if (age !== null) {
          this.log("(Using cached data from " + formatCacheAge(age) + ")");
        }
      }
      this.log("");

      if (services.length === 0) {
        this.log("No services found for this workspace.");
      } else {
        for (const svc of services) {
          this.log(`  ${svc.name} (${svc.slug})`);
          if (svc.environments && svc.environments.length > 0) {
            this.log(`    Environments: ${svc.environments.map((e) => e.name).join(", ")}`);
          }
          this.log("");
        }
      }
    }
  }

  private async listAllServices(
    api: ReturnType<typeof createApiClient>,
    useCache: boolean,
    jsonOutput: boolean
  ): Promise<void> {
    // First, get all workspaces
    const workspacesCacheKey = "workspaces";
    let workspaces: WorkspaceSummary[] | null = null;

    if (useCache) {
      workspaces = readCache<WorkspaceSummary[]>(workspacesCacheKey);
    }

    if (!workspaces) {
      workspaces = await api.listWorkspaces();
      if (useCache) {
        writeCache(workspacesCacheKey, workspaces);
      }
    }

    if (jsonOutput) {
      const allServices: Array<{
        workspaceId: string;
        workspaceName: string;
        services: ServiceSummary[];
      }> = [];

      for (const ws of workspaces) {
        const cacheKey = `services_${ws.id}`;
        let services: ServiceSummary[] | null = null;

        if (useCache) {
          services = readCache<ServiceSummary[]>(cacheKey);
        }

        if (!services) {
          try {
            // eslint-disable-next-line no-await-in-loop
            services = await api.listServices(ws.id.toString());
            if (useCache) {
              writeCache(cacheKey, services);
            }
          } catch {
            if (useCache) {
              const cached = readCache<ServiceSummary[]>(cacheKey);
              services = cached ? cached : [];
            } else {
              services = [];
            }
          }
        }

        allServices.push({
          workspaceId: ws.id.toString(),
          workspaceName: ws.name,
          services,
        });
      }

      this.log(JSON.stringify({ services: allServices }));
    } else {
      this.log("");
      this.log("=== Services ===");
      this.log("");

      for (const ws of workspaces) {
        const cacheKey = `services_${ws.id}`;
        let services: ServiceSummary[] | null = null;
        let fromCache = false;

        if (useCache) {
          services = readCache<ServiceSummary[]>(cacheKey);
          if (services) {
            fromCache = true;
          }
        }

        if (!services) {
          try {
            this.log(`Fetching services for ${ws.name}...`);
            // eslint-disable-next-line no-await-in-loop
            services = await api.listServices(ws.id.toString());
            if (useCache) {
              writeCache(cacheKey, services);
            }
          } catch (error) {
            if (useCache) {
              const cached = readCache<ServiceSummary[]>(cacheKey);
              if (cached) {
                this.warn(
                  `Failed to fetch services for ${ws.name}. Using cached data: ${(error as Error).message}`
                );
                services = cached;
                fromCache = true;
              } else {
                services = [];
              }
            } else {
              services = [];
            }
          }
        }

        this.log(`Workspace: ${ws.name} (${ws.slug})`);
        if (fromCache) {
          const age = getCacheAge(cacheKey);
          if (age !== null) {
            this.log(`  (Using cached data from ${formatCacheAge(age)})`);
          }
        }
        this.log("");

        if (services.length === 0) {
          this.log("  No services found.");
        } else {
          for (const svc of services) {
            this.log(`  ${svc.name} (${svc.slug})`);
            if (svc.environments && svc.environments.length > 0) {
              this.log(`    Environments: ${svc.environments.map((e) => e.name).join(", ")}`);
            }
          }
        }
        this.log("");
      }
    }
  }
}

