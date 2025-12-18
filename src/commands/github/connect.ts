import { Flags, ux } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { isAuthenticated } from "../../lib/config/index";
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
  data: {
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
  }[];
};

type FetchBranchesPayload = {
  data: {
    name: string;
  }[];
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

    // 1. Ensure user is authenticated
    if (!isAuthenticated()) {
      const shouldLogin = await ux.confirm(
        "You are not logged in. Would you like to log in now? (y/n)"
      );
      if (shouldLogin) {
        await this.config.runCommand("login", []);
        if (!isAuthenticated()) {
          this.error(
            "Authentication failed. Please run 'apso login' manually and try again."
          );
        }
      } else {
        this.error("Please run 'apso login' first and try again.");
      }
    }

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
      const nameToId = new Map<string, number>();
      const items = connections.map((c) => {
        const label = `${
          c.github_username || "account " + c.connectionId
        } (id=${c.connectionId})`;
        nameToId.set(label, c.connectionId);
        return label;
      });
      const chosen = await ux.prompt(
        `GitHub account`,
        { type: "autocomplete", name: "account", choices: items } as any
      );
      connectionId = nameToId.get(chosen)!;
    }

    // 6. List repositories for that connection and let user choose (or filter)
    this.log("");
    this.log("Fetching repositories from GitHub...");
    const repos = await this.listGithubRepositories(api, connectionId);
    if (!repos.length) {
      this.error(
        "No repositories found for this GitHub connection. Please create a repository in GitHub and try again."
      );
    }

    const repoChoices = repos.map((r) => r.fullName);
    const repoFullName = await ux.prompt(
      "Select repository (or type to search)",
      { type: "autocomplete", name: "repo", choices: repoChoices } as any
    );

    const selectedRepo = repos.find((r) => r.fullName === repoFullName);
    if (!selectedRepo) {
      this.error(`Repository "${repoFullName}" not found in the fetched list.`);
    }

    // 7. List branches for the selected repository
    this.log("");
    this.log(`Fetching branches for ${selectedRepo.fullName}...`);
    const branches = await this.listBranches(
      api,
      connectionId,
      selectedRepo.fullName
    );

    if (!branches.length) {
      this.error(
        `No branches found in repository ${selectedRepo.fullName}. Please create a branch in GitHub and try again.`
      );
    }

    const branchChoices = branches.map((b) => b.name);
    const defaultBranch =
      selectedRepo.defaultBranch && branchChoices.includes(selectedRepo.defaultBranch)
        ? selectedRepo.defaultBranch
        : branchChoices[0];

    const selectedBranch = await ux.prompt(
      `Select branch [default: ${defaultBranch}]`,
      { type: "autocomplete", name: "branch", choices: branchChoices } as any
    );

    const branchName = selectedBranch || defaultBranch;

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
    const apiBaseUrl = (api as any)["apiBaseUrl"] || "";
    return `${apiBaseUrl}/github-connections/connect/${numericId}`;
  }

  private async listGithubRepositories(
    api: ReturnType<typeof createApiClient>,
    connectionId: number
  ): Promise<{ fullName: string; htmlUrl: string; defaultBranch: string }[]> {
    const path = `/github-connections/list-github-repos/${connectionId}`;
    const resp = await api.rawRequest<ListGithubRepositoriesPayload>(path);
    const items = resp.data || [];
    return items.map((r: any) => ({
      fullName: r.fullName || r.full_name || `${r.owner}/${r.name}`,
      htmlUrl: r.htmlUrl || r.html_url,
      defaultBranch: r.defaultBranch || r.default_branch || "main",
    }));
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
}


