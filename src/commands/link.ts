import { Flags, ux } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readCredentials } from "../lib/config/index";
import {
  createApiClient,
  ServiceSummary,
  WorkspaceSummary,
} from "../lib/api/client";
import {
  ExistingLinkInfo,
  ProjectLink,
  isSameLink,
  readProjectLink,
  writeProjectLink,
} from "../lib/project-link";

export default class Link extends BaseCommand {
  static description =
    "Link the current project directory to an Apso workspace service";

  static examples = [
    "$ apso link",
    "$ apso link --workspace ws_abc123 --service svc_def456",
    "$ apso link --workspace ws_abc123 --service svc_def456 --env prod",
  ];

  static flags = {
    workspace: Flags.string({
      description: "Workspace ID to link to",
    }),
    service: Flags.string({
      description: "Service ID to link to",
    }),
    env: Flags.string({
      description: "Environment or variant identifier (optional)",
    }),
    json: Flags.boolean({
      description: "Output machine-readable JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Link);
    const api = createApiClient();

    // Ensure user is authenticated, reuse shared helper.
    const nonInteractive =
      Boolean(flags.workspace || flags.service) ||
      process.env.APSO_NON_INTERACTIVE === "1" ||
      process.env.APSO_NON_INTERACTIVE === "true";

    await this.ensureAuthenticated({ nonInteractive });

    const existing = this.safeReadExistingLink();

    const isNonInteractive = Boolean(flags.workspace || flags.service);

    await (isNonInteractive
      ? this.handleNonInteractive(
          flags.workspace,
          flags.service,
          flags.env,
          api,
          existing
        )
      : this.handleInteractive(flags.env, api, existing));
  }

  private safeReadExistingLink(): ExistingLinkInfo | null {
    try {
      const existing = readProjectLink();
      if (existing) {
        this.log(
          `Current link: workspaceId=${existing.link.workspaceId}, serviceId=${existing.link.serviceId}`
        );
      }
      return existing;
    } catch (error) {
      const err = error as Error;
      this.warn(err.message);
      return null;
    }
  }

  private async handleNonInteractive(
    workspaceId: string | undefined,
    serviceId: string | undefined,
    env: string | undefined,
    api: ReturnType<typeof createApiClient>,
    existing: ExistingLinkInfo | null
  ): Promise<void> {
    if (!workspaceId || !serviceId) {
      this.error(
        "Both --workspace and --service flags are required in non-interactive mode."
      );
    }

    const workspaces = await api.listWorkspaces();
    const workspaceIdNum = Number(workspaceId);
    const workspace = workspaces.find((w) => w.id === workspaceIdNum);

    if (!workspace) {
      this.error(`Workspace ID is invalid: ${workspaceId}`);
    }

    const services = await api.listServices(String(workspace.id));
    const serviceIdNum = Number(serviceId);
    const service = services.find((s) => s.id === serviceIdNum);

    if (!service) {
      this.error(`Service ID is invalid: ${serviceId}`);
    }

    await this.persistLink(workspace, service, env, existing, false);
  }

  private async handleInteractive(
    env: string | undefined,
    api: ReturnType<typeof createApiClient>,
    existing: ExistingLinkInfo | null
  ): Promise<void> {
    let workspaces = await api.listWorkspaces();

    if (workspaces.length === 0) {
      this.log("");
      this.log("No workspaces found for your account.");
      const createWs = await ux.confirm(
        "Would you like to create a new workspace now? (y/n)"
      );

      if (!createWs) {
        this.error(
          "A workspace is required to link a project. Create one in the Apso dashboard and re-run 'apso link'."
        );
      }

      const workspaceName = await ux.prompt(
        "Enter a name for the new workspace",
        {
          required: true,
        }
      );

      const created = await api.createWorkspace(workspaceName);

      this.log(
        `✓ Created workspace "${created.name}" (id=${created.id}, slug=${created.slug}).`
      );

      // Refresh workspace list so the new one appears
      workspaces = await api.listWorkspaces();
    }

    const workspace = await this.promptForWorkspace(workspaces);

    const services = await api.listServices(String(workspace.id));

    if (services.length === 0) {
      this.error(
        `No services found for workspace "${workspace.name}". Please create a service in the Apso dashboard first.`
      );
    }

    const service = await this.promptForService(services);

    // If env flag not provided and service has environments, ask interactively.
    let finalEnv = env;
    if (!finalEnv && service.environments && service.environments.length > 0) {
      finalEnv = await this.promptForEnvironment(service.environments);
    }

    await this.showSummaryAndConfirm(workspace, service, finalEnv, existing);
  }

  private async promptForWorkspace(
    workspaces: WorkspaceSummary[]
  ): Promise<WorkspaceSummary> {
    this.log("");
    this.log("Available workspaces:");

    workspaces.forEach((w, idx) => {
      this.log(`  [${idx + 1}] ${w.name} (id=${w.id}, slug=${w.slug})`);
    });

    const answer = await ux.prompt("Select a workspace by number", {
      required: true,
    });

    const index = Number.parseInt(answer, 10);

    if (Number.isNaN(index) || index < 1 || index > workspaces.length) {
      this.error("Invalid workspace selection.");
    }

    return workspaces[index - 1];
  }

  private async promptForService(
    services: ServiceSummary[]
  ): Promise<ServiceSummary> {
    this.log("");
    this.log("Available services:");

    services.forEach((s, idx) => {
      this.log(`  [${idx + 1}] ${s.name} (id=${s.id}, slug=${s.slug})`);
    });

    const answer = await ux.prompt("Select a service by number", {
      required: true,
    });

    const index = Number.parseInt(answer, 10);

    if (Number.isNaN(index) || index < 1 || index > services.length) {
      this.error("Invalid service selection.");
    }

    return services[index - 1];
  }

  private async promptForEnvironment(
    envs: ServiceSummary["environments"]
  ): Promise<string | undefined> {
    if (!envs || envs.length === 0) {
      return undefined;
    }

    this.log("");
    this.log("Available environments/variants:");

    envs.forEach((e, idx) => {
      this.log(
        `  [${idx + 1}] ${e.name} (id=${e.id}${
          e.slug ? `, slug=${e.slug}` : ""
        })`
      );
    });

    const answer = await ux.prompt(
      "Select an environment by number (or press Enter to skip)",
      {
        required: false,
      }
    );

    if (!answer.trim()) {
      return undefined;
    }

    const index = Number.parseInt(answer, 10);

    if (Number.isNaN(index) || index < 1 || index > envs.length) {
      this.error("Invalid environment selection.");
    }

    return envs[index - 1].id;
  }

  private async showSummaryAndConfirm(
    workspace: WorkspaceSummary,
    service: ServiceSummary,
    env: string | undefined,
    existing: ExistingLinkInfo | null
  ): Promise<void> {
    this.log("");
    this.log("Link summary:");
    this.log(`  Workspace: ${workspace.name} (id=${workspace.id})`);
    this.log(`  Service:   ${service.name} (id=${service.id})`);
    if (env) {
      this.log(`  Env:       ${env}`);
    }

    if (existing) {
      this.log("");
      this.log(
        "Warning: this project is already linked. Linking again will update '.apso/link.json'."
      );
    }

    const proceed = await ux.confirm("Proceed with linking? (y/n)");

    if (!proceed) {
      this.log("Linking cancelled.");
      this.exit(0);
    }

    await this.persistLink(workspace, service, env, existing, true);
  }

  private async persistLink(
    workspace: WorkspaceSummary,
    service: ServiceSummary,
    env: string | undefined,
    existing: ExistingLinkInfo | null,
    fromInteractiveFlow: boolean
  ): Promise<void> {
    const creds = readCredentials();
    const email = creds?.user?.email ?? "unknown";

    const now = new Date().toISOString();

    const newLink: ProjectLink = {
      workspaceId: String(workspace.id),
      workspaceSlug: workspace.slug,
      serviceId: String(service.id),
      serviceSlug: service.slug,
      githubRepo: existing?.link.githubRepo ?? null,
      githubBranch: existing?.link.githubBranch ?? null,
      linkedAt: now,
      lastSyncedAt: existing?.link.lastSyncedAt ?? null,
      lastSyncDirection: existing?.link.lastSyncDirection ?? null,
      localSchemaHash: existing?.link.localSchemaHash ?? null,
      remoteSchemaHash: existing?.link.remoteSchemaHash ?? null,
      createdBy: existing?.link.createdBy ?? email,
      cliVersion: this.config.version,
    };

    if (isSameLink(existing?.link, newLink)) {
      this.log(
        "Project is already linked to the selected workspace and service. No changes made."
      );
      this.exit(0);
    }

    const linkPath = writeProjectLink(newLink, {
      cliVersion: this.config.version,
    });

    if (fromInteractiveFlow) {
      this.log("");
    }

    this.log(
      `✓ Project linked to workspace "${workspace.name}" and service "${service.name}".`
    );
    if (env) {
      this.log(`  Environment: ${env}`);
    }
    this.log(`  Link file:   ${linkPath}`);

    this.log("");
    this.log("Next steps:");
    this.log("  • Run 'apso pull' to download the schema");
    this.log("  • Run 'apso status' to check sync state");
  }
}
