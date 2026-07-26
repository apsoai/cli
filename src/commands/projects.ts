import { Flags } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink, globalConfig } from "../lib/config";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { Workspace } from "../lib/api/types";

export default class Projects extends BaseCommand {
  static description = "List projects (services) in a workspace";

  static examples = [
    `$ apso projects`,
    `$ apso projects --workspace my-team`,
    `$ apso projects --json`,
  ];

  static flags = {
    workspace: Flags.string({
      char: "w",
      description: "Workspace slug",
    }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Projects);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Determine workspace. The BFF scopes services by the NUMERIC workspace id,
    // so resolve slugs to an id before listing.
    let workspaceId: string;
    let workspaceSlug: string;

    if (flags.workspace) {
      const ws = await workspacesApi.get(flags.workspace);
      workspaceId = String(ws.id);
      workspaceSlug = ws.slug;
    } else {
      // Prefer an existing link, then the active workspace set via `apso use`,
      // and only prompt as a last resort.
      const link = projectLink.read();
      const active = globalConfig.read();
      if (link) {
        workspaceId = String(link.workspaceId);
        workspaceSlug = link.workspaceSlug;
      } else if (active.activeWorkspaceId) {
        workspaceId = active.activeWorkspaceId;
        workspaceSlug = active.activeWorkspaceSlug || active.activeWorkspaceId;
      } else {
        // Prompt
        const workspaces = await workspacesApi.list();
        if (workspaces.length === 0) {
          this.error(
            "No workspaces found. Create a workspace at https://app.apso.cloud first."
          );
        }
        const response = await inquirer.prompt<{ workspace: Workspace }>([
          {
            type: "list",
            name: "workspace",
            message: "Select a workspace:",
            choices: workspaces.map((ws) => ({
              name: `${ws.name} (${ws.slug})`,
              value: ws,
            })),
          },
        ]);
        workspaceId = String(response.workspace.id);
        workspaceSlug = response.workspace.slug;
      }
    }

    // Fetch services (scoped by numeric workspace id)
    const servicesResponse = await servicesApi.list(workspaceId);
    const services = servicesResponse.data;

    if (services.length === 0) {
      this.log(`No services found in workspace "${workspaceSlug}".`);
      return;
    }

    // Get currently-linked service for highlighting
    const link = projectLink.read();
    const linkedServiceId = link?.serviceId;

    if (flags.json) {
      this.log(JSON.stringify(services, null, 2));
      return;
    }

    // Table output
    this.log(`Services in workspace "${workspaceSlug}":\n`);
    this.log(
      padRight("NAME", 24) +
        padRight("SLUG", 20) +
        padRight("STATUS", 12) +
        padRight("LAST DEPLOYED", 22) +
        "REPO"
    );
    this.log("-".repeat(90));

    for (const svc of services) {
      const isLinked = svc.id === linkedServiceId;
      const marker = isLinked ? " *" : "";
      const deployed = svc.lastDeployedAt
        ? new Date(svc.lastDeployedAt).toLocaleDateString()
        : "-";
      const repo = svc.githubRepo || "-";

      this.log(
        padRight(`${svc.name}${marker}`, 24) +
          padRight(svc.slug, 20) +
          padRight(svc.status, 12) +
          padRight(deployed, 22) +
          repo
      );
    }

    if (linkedServiceId) {
      this.log("\n* = currently linked");
    }
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}
