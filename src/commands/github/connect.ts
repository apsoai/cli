import { Flags, ux } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { createApiClient } from "../../lib/api/client";
import {
  ExistingLinkInfo,
  ProjectLink,
  readProjectLink,
  writeProjectLink,
} from "../../lib/project-link";
import { exec } from "child_process";
import { promisify } from "util";

type GithubConnectionStatus = {
  connectionId: number;
  connected: boolean;
  github_username?: string;
};

type WorkspaceGithubConnectionStatusDto = {
  success: boolean;
  connectionStatuses: GithubConnectionStatus[];
};

type ListGithubRepositoriesPayload = {
  repositories: Array<{
    fullName?: string;
    full_name?: string;
    name?: string;
    owner?: string;
    htmlUrl?: string;
    html_url?: string;
    defaultBranch?: string;
    default_branch?: string;
  }>;
  totalCount?: number;
  totalPages?: number;
};

type FetchBranchesPayload = {
  data: {
    name: string;
  }[];
};

type CreateGithubRepositoryInput = {
  connectionId: number;
  serviceName: string;
  private?: boolean;
  auto_init?: boolean;
  gitignore_template?: string;
  license_template?: string;
};

type CreateRepositoryPayload = {
  success?: boolean;
  message?: string;
  repository: {
    fullName?: string;
    full_name?: string;
    name: string;
    owner?: {
      login?: string;
    };
    default_branch?: string;
    defaultBranch?: string;
  };
};

const execAsync = promisify(exec);

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  switch (platform) {
    case "win32":
      command = `start "" "${url}"`;
      break;
    case "darwin":
      command = `open "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
      break;
  }

  await execAsync(command);
}

export default class GithubConnect extends BaseCommand {
  static description =
    "Connect the linked Apso service to a GitHub repository and branch (like the web app does)";

  static examples = [
    `$ apso github:connect`,
    `$ apso github:connect --no-browser`,
  ];

  static flags = {
    "no-browser": Flags.boolean({
      description: "Do not auto-open the GitHub connect URL in a browser",
      default: false,
    }),
    "workspace-id": Flags.string({
      description:
        "Workspace ID (overrides the ID from .apso/link.json). Mostly for CI.",
    }),
    "service-id": Flags.string({
      description:
        "Service ID (overrides the ID from .apso/link.json). Mostly for CI.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GithubConnect);

    // 1. Ensure user is authenticated (supports non-interactive mode via APSO_NON_INTERACTIVE)
    await this.ensureAuthenticated({
      nonInteractive:
        process.env.APSO_NON_INTERACTIVE === "1" ||
        process.env.APSO_NON_INTERACTIVE === "true",
    });

    // 2. Read link.json for workspace/service context
    const linkInfo = this.readOrErrorLink();
    const link = linkInfo.link;

    const workspaceId = flags["workspace-id"] || link.workspaceId;
    const serviceId = flags["service-id"] || link.serviceId;

    const api = createApiClient();

    this.log(
      `Connecting service "${link.serviceSlug}" (${serviceId}) in workspace "${link.workspaceSlug}" (${workspaceId}) to GitHub...`
    );

    // 3. Check if service is already connected to GitHub
    const serviceDetails = await this.getServiceDetails(api, serviceId);
    const infraDetails = (serviceDetails.infrastructure_details as any) || {};
    const existingRepoName = infraDetails.repoName || infraDetails.githubRepoName;
    const existingBranchName = infraDetails.branchName;
    const existingConnectionId = infraDetails.githubConnectionId;

    if (existingRepoName && existingBranchName && existingConnectionId) {
      this.log("");
      this.log("✓ Service is already connected to GitHub:");
      this.log(`  Repository: ${existingRepoName}`);
      this.log(`  Branch:     ${existingBranchName}`);
      this.log(`  Connection ID: ${existingConnectionId}`);

      // Extract owner from repoName (format: "owner/repo")
      const repoFullName = existingRepoName.includes("/")
        ? existingRepoName
        : `${infraDetails.githubOwner || "unknown"}/${existingRepoName}`;

      // Update local link file with existing connection info
      const updatedLink: ProjectLink = {
        ...link,
        githubRepo: repoFullName,
        githubBranch: existingBranchName,
      };
      writeProjectLink(updatedLink);

      this.log("");
      this.log("✓ Local link file updated with GitHub connection info");
      this.log("");
      this.log("To change the GitHub connection, use the web app or disconnect first.");
      return;
    }

    // 4. Ensure there is at least one GitHub connection for this workspace
    const connections = await this.getWorkspaceGithubConnections(api, workspaceId);
    let connectionId: number;

    if (connections.length === 0) {
      this.log("");
      this.log(
        "No GitHub connections found for this workspace. You need to authorize GitHub first."
      );

      const connectUrl = await this.getGithubConnectUrl(api, workspaceId);

      this.log("");
      this.log("Opening browser to connect GitHub...");
      this.log(connectUrl);
      this.log("");

      if (!flags["no-browser"]) {
        try {
          await openInBrowser(connectUrl);
        } catch (err) {
          this.warn(
            `Failed to open browser automatically. Please open this URL manually:\n${connectUrl}`
          );
        }
      } else {
        this.log(
          "Browser auto-open disabled. Please open the URL above to complete GitHub authorization."
        );
      }

      this.log(
        "Waiting for GitHub connection to be created... (Ctrl+C to cancel)"
      );

      // Poll for new connection
      const timeoutMs = 5 * 60 * 1000;
      const start = Date.now();
      let latestConnections: GithubConnectionStatus[] = [];

      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 3000));
        latestConnections = await this.getWorkspaceGithubConnections(
          api,
          workspaceId
        );
        if (latestConnections.length > 0) {
          break;
        }
      }

      if (latestConnections.length === 0) {
        this.error(
          "Timed out waiting for GitHub connection. Please try again after completing authorization in the browser."
        );
      }

      connections.push(...latestConnections);
    }

    // 5. Let the user choose which connection (if multiple)
    if (connections.length === 1) {
      connectionId = connections[0].connectionId;
      this.log(
        `Using GitHub account: ${connections[0].github_username || "unknown"}`
      );
    } else {
      this.log("");
      this.log("Multiple GitHub connections found. Please select one:");
      connections.forEach((c, idx) => {
        const label = `${
          c.github_username || "account " + c.connectionId
        } (id=${c.connectionId})`;
        this.log(`  [${idx + 1}] ${label}`);
      });
      this.log("");

      const answer = await ux.prompt("Select a GitHub account by number", {
        required: true,
      });

      const index = Number.parseInt(answer, 10);

      if (Number.isNaN(index) || index < 1 || index > connections.length) {
        this.error("Invalid GitHub account selection.");
      }

      connectionId = connections[index - 1].connectionId;
    }

    // 6. List repositories for that connection and let user choose (or filter)
    this.log("");
    this.log("Fetching repositories from GitHub...");
    let repos = await this.listGithubRepositories(api, connectionId);
    let selectedRepo: { fullName: string; htmlUrl: string; defaultBranch: string } | null = null;

    if (!repos.length) {
      this.log("");
      this.warn("No repositories found for this GitHub connection.");
      this.log("");
      
      const shouldCreate = await ux.confirm(
        "Would you like to create a new repository? (y/n)"
      );

      if (!shouldCreate) {
        this.log("");
        this.log("Possible reasons for no repositories:");
        this.log("  • The GitHub account has no repositories");
        this.log("  • The OAuth token doesn't have access to repositories");
        this.log("  • The repositories are private and the token lacks permissions");
        this.log("");
        this.log("Troubleshooting:");
        this.log("  • Check your GitHub account has repositories");
        this.log("  • Verify the OAuth app has 'repo' scope permissions");
        this.log("  • Try disconnecting and reconnecting GitHub");
        this.log("  • Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso github:connect");
        this.error(
          "No repositories found. Please create a repository in GitHub or run this command again to create one."
        );
      }

      // Create a new repository
      selectedRepo = await this.createNewRepository(api, connectionId, link.serviceSlug);
    } else {
      // User selects from existing repositories
      this.log("");
      this.log("Available repositories:");
      repos.forEach((r, idx) => {
        this.log(`  [${idx + 1}] ${r.fullName}`);
      });
      this.log("");

      const answer = await ux.prompt("Select a repository by number", {
        required: true,
      });

      const index = Number.parseInt(answer, 10);

      if (Number.isNaN(index) || index < 1 || index > repos.length) {
        this.error("Invalid repository selection.");
      }

      selectedRepo = repos[index - 1];
    }

    // 7. List branches for the selected repository
    this.log("");
    this.log(`Fetching branches for ${selectedRepo.fullName}...`);
    
    // For newly created repositories, wait a moment and retry if no branches found
    let branches = await this.listBranches(
      api,
      connectionId,
      selectedRepo.fullName
    );

    if (!branches.length) {
      // If repository was just created, wait and retry
      this.log("No branches found yet. Waiting for repository to initialize...");
      const maxRetries = 5;
      const retryDelay = 2000; // 2 seconds

      for (let attempt = 0; attempt < maxRetries && !branches.length; attempt++) {
        if (attempt > 0) {
          this.log(`  Retrying... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
        branches = await this.listBranches(api, connectionId, selectedRepo.fullName);
      }

      if (!branches.length) {
        // Default to 'main' branch for new repositories
        this.warn("No branches found. Using 'main' as default branch.");
        branches = [{ name: "main" }];
      }
    }

    this.log("");
    this.log("Available branches:");
    branches.forEach((b, idx) => {
      const isDefault = b.name === (selectedRepo.defaultBranch || "main");
      this.log(`  [${idx + 1}] ${b.name}${isDefault ? " (default)" : ""}`);
    });
    this.log("");

    const defaultBranch =
      selectedRepo.defaultBranch && branches.some((b) => b.name === selectedRepo.defaultBranch)
        ? selectedRepo.defaultBranch
        : branches[0]?.name || "main";

    const answer = await ux.prompt(
      `Select a branch by number [default: ${defaultBranch}]`,
      { required: false }
    );

    let branchName: string;
    if (!answer.trim()) {
      branchName = defaultBranch;
    } else {
      const index = Number.parseInt(answer, 10);
      if (Number.isNaN(index) || index < 1 || index > branches.length) {
        this.error("Invalid branch selection.");
      }
      branchName = branches[index - 1].name;
    }

    // 8. Call backend to connect repository to service
    this.log("");
    this.log(
      `Linking service ${serviceId} to ${selectedRepo.fullName} (branch: ${branchName})...`
    );

    await this.connectRepositoryToService(
      api,
      serviceId,
      connectionId,
      selectedRepo.fullName
    );

    // 9. Create webhook for the service/repository
    await this.createWebhook(api, serviceId, connectionId);

    // 10. Update local link.json with repo/branch information
    const updatedLink: ProjectLink = {
      ...link,
      githubRepo: selectedRepo.fullName,
      githubBranch: branchName,
    };
    writeProjectLink(updatedLink);

    this.log("");
    this.log("✓ GitHub connected successfully for this service");
    this.log(`  Repository: ${selectedRepo.fullName}`);
    this.log(`  Branch:     ${branchName}`);
    this.log("");
    this.log("Next steps:");
    this.log("  • Run 'apso push' to push schema to the platform");
    this.log("  • Use the web app to deploy and review generated code");
  }

  private readOrErrorLink(): ExistingLinkInfo {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.error(
        "Project is not linked to a service.\n" +
          "Run 'apso link' first to associate this project with a platform service."
      );
    }
    return linkInfo!;
  }

  private async getServiceDetails(
    api: ReturnType<typeof createApiClient>,
    serviceId: string
  ): Promise<{ infrastructure_details?: any }> {
    const numericId = Number(serviceId);
    if (Number.isNaN(numericId)) {
      this.error(`Invalid service ID: ${serviceId}`);
    }

    const path = `/WorkspaceServices/${numericId}`;
    return await api.rawRequest<{ infrastructure_details?: any }>(path);
  }

  private async getWorkspaceGithubConnections(
    api: ReturnType<typeof createApiClient>,
    workspaceId: string
  ): Promise<GithubConnectionStatus[]> {
    const numericId = Number(workspaceId);
    if (Number.isNaN(numericId)) {
      this.error(`Invalid workspace ID: ${workspaceId}`);
    }

    const path = `/github-connections/workspace/${numericId}/statuses`;
    const resp = await api.rawRequest<WorkspaceGithubConnectionStatusDto>(path);

    return resp.connectionStatuses || [];
  }

  private async getGithubConnectUrl(
    api: ReturnType<typeof createApiClient>,
    workspaceId: string
  ): Promise<string> {
    const numericId = Number(workspaceId);
    if (Number.isNaN(numericId)) {
      this.error(`Invalid workspace ID: ${workspaceId}`);
    }

    // Backend GithubConnectionController exposes GET /github-connections/connect/:workspaceId
    // It returns JSON with a 'url' field containing the GitHub OAuth URL
    const path = `/github-connections/connect/${numericId}`;
    const response = await api.rawRequest<{ url: string; message?: string }>(path);
    
    if (!response.url) {
      this.error(
        `Backend did not return a GitHub OAuth URL. Response: ${JSON.stringify(response)}`
      );
    }
    
    return response.url;
  }

  private async listGithubRepositories(
    api: ReturnType<typeof createApiClient>,
    connectionId: number
  ): Promise<{ fullName: string; htmlUrl: string; defaultBranch: string }[]> {
    const path = `/github-connections/list-github-repos/${connectionId}`;
    
    try {
      const resp = await api.rawRequest<ListGithubRepositoriesPayload>(path);
      
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(`[DEBUG] Repository API response: ${JSON.stringify(resp, null, 2).substring(0, 500)}`);
      }
      
      // Backend returns { repositories: [...], totalCount: number, totalPages: number }
      const items = resp.repositories || [];
      
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(`[DEBUG] Found ${items.length} repositories from API (totalCount: ${resp.totalCount || 'unknown'})`);
      }
      
      return items.map((r: any) => ({
        fullName: r.fullName || r.full_name || `${r.owner?.login || r.owner || 'unknown'}/${r.name || 'unknown'}`,
        htmlUrl: r.htmlUrl || r.html_url || r.html_url,
        defaultBranch: r.defaultBranch || r.default_branch || "main",
      }));
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to fetch repositories: ${err.message}`);
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(`[DEBUG] Full error: ${err.stack}`);
      }
      // Return empty array so the calling code can show a helpful error message
      return [];
    }
  }

  private async listBranches(
    api: ReturnType<typeof createApiClient>,
    connectionId: number,
    repoFullName: string
  ): Promise<{ name: string }[]> {
    const encodedRepo = encodeURIComponent(repoFullName);
    const path = `/github-connections/list-branches/${connectionId}/${encodedRepo}`;
    const resp = await api.rawRequest<FetchBranchesPayload>(path);
    return resp.data || [];
  }

  private async connectRepositoryToService(
    api: ReturnType<typeof createApiClient>,
    serviceId: string,
    connectionId: number,
    repoFullName: string
  ): Promise<void> {
    const numericServiceId = Number(serviceId);
    if (Number.isNaN(numericServiceId)) {
      this.error(`Invalid service ID: ${serviceId}`);
    }

    const body = {
      connectionId,
      repoFullName,
    };

    const path = `/github-connections/connect-repository/${numericServiceId}`;
    await api.rawRequest(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async createWebhook(
    api: ReturnType<typeof createApiClient>,
    serviceId: string,
    connectionId: number
  ): Promise<void> {
    const numericServiceId = Number(serviceId);
    if (Number.isNaN(numericServiceId)) {
      this.error(`Invalid service ID: ${serviceId}`);
    }

    const path = `/github-connections/webhook?serviceId=${numericServiceId}&connectionId=${connectionId}`;
    await api.rawRequest(path, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  private async createNewRepository(
    api: ReturnType<typeof createApiClient>,
    connectionId: number,
    serviceSlug: string
  ): Promise<{ fullName: string; htmlUrl: string; defaultBranch: string }> {
    this.log("");
    this.log("Creating a new GitHub repository...");
    this.log("");

    // Prompt for repository name (default to service slug)
    const repoName = await ux.prompt("Repository name", {
      default: serviceSlug,
      required: true,
    });

    // Prompt for repository visibility
    const isPrivate = await ux.confirm(
      "Make this repository private? (y/n)"
    );

    // Prompt for auto-initialize (creates README, .gitignore, license)
    const autoInit = await ux.confirm(
      "Initialize repository with README, .gitignore, and license? (y/n)"
    );

    let gitignoreTemplate: string | undefined;
    let licenseTemplate: string | undefined;

    if (autoInit) {
      // For now, we'll use common templates. In the future, could prompt for specific ones.
      // GitHub API accepts templates like "Node", "Python", etc.
      const useGitignore = await ux.confirm(
        "Add a .gitignore template? (y/n)"
      );
      if (useGitignore) {
        gitignoreTemplate = "Node"; // Default to Node.js template
      }

      const useLicense = await ux.confirm(
        "Add a license? (y/n)"
      );
      if (useLicense) {
        licenseTemplate = "mit"; // Default to MIT license
      }
    }

    try {
      this.log("");
      this.log(`Creating repository "${repoName}"...`);

      const createPayload: CreateGithubRepositoryInput = {
        connectionId,
        serviceName: repoName,
        private: isPrivate,
        auto_init: autoInit,
        gitignore_template: gitignoreTemplate,
        license_template: licenseTemplate,
      };

      const path = `/github-connections/create-repository`;
      const response = await api.rawRequest<CreateRepositoryPayload>(path, {
        method: "POST",
        body: JSON.stringify(createPayload),
      });

      if (!response.repository) {
        throw new Error("Repository creation response missing repository data");
      }

      const repo = response.repository;
      const fullName =
        repo.fullName ||
        repo.full_name ||
        `${repo.owner?.login || "unknown"}/${repo.name}`;

      this.log("");
      this.log(`✓ Repository "${fullName}" created successfully!`);

      return {
        fullName,
        htmlUrl: "",
        defaultBranch: repo.default_branch || repo.defaultBranch || "main",
      };
    } catch (error) {
      const err = error as Error;
      this.error(
        `Failed to create repository: ${err.message}\n` +
          "\nTroubleshooting:" +
          "\n  • Check that the repository name is valid (alphanumeric, hyphens, underscores)" +
          "\n  • Ensure the repository name doesn't already exist" +
          "\n  • Verify your GitHub connection has permission to create repositories" +
          "\n  • Run with DEBUG=1 for more details: $env:APSO_DEBUG='1'; apso github:connect"
      );
    }
  }
}


