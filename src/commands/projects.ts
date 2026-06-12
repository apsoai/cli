import { Flags } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { Workspace, Service } from "../lib/api/types";

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

    // Determine workspace
    let workspaceSlug: string;

    if (flags.workspace) {
      workspaceSlug = flags.workspace;
    } else {
      // Try from existing link
      const link = projectLink.read();
      if (link) {
        workspaceSlug = link.workspaceSlug;
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
        workspaceSlug = response.workspace.slug;
      }
    }

    // Fetch services
    const servicesResponse = await servicesApi.list(workspaceSlug);
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
