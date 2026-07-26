import { Args } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { credentials, globalConfig } from "../lib/config";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { Workspace } from "../lib/api/types";

/**
 * Select the active workspace for subsequent CLI commands. With no argument it
 * shows an interactive picker; pass a slug/name to set it directly. The choice
 * persists to ~/.apso/config.json and scopes every workspace-aware command.
 */
export default class Use extends BaseCommand {
  static description = "Select the active workspace for CLI commands";

  static examples = ["$ apso use", "$ apso use my-workspace"];

  static args = {
    workspace: Args.string({
      description: "Workspace slug or name (skips the picker)",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Use);

    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    const workspaces = await workspacesApi.list();
    if (workspaces.length === 0) {
      this.error(
        "No workspaces found. Create one at https://app.apso.cloud first."
      );
    }

    let ws: Workspace | undefined;
    if (args.workspace) {
      ws = workspaces.find(
        (w) => w.slug === args.workspace || w.name === args.workspace
      );
      if (!ws) {
        this.error(
          `Workspace not found: ${args.workspace}\nRun 'apso use' to pick from a list.`
        );
      }
    } else if (workspaces.length === 1) {
      ws = workspaces[0];
    } else {
      const answer = await inquirer.prompt<{ workspace: Workspace }>([
        {
          type: "list",
          name: "workspace",
          message: "Select your workspace:",
          choices: workspaces.map((w) => ({
            name: `${w.name} (${w.slug})`,
            value: w,
          })),
        },
      ]);
      ws = answer.workspace;
    }

    globalConfig.write({
      activeWorkspaceId: String(ws.id),
      activeWorkspaceSlug: ws.slug,
      activeWorkspaceName: ws.name,
    });

    this.log("");
    this.log(`  Now using workspace: ${ws.name} (${ws.slug})`);

    // Show what's in the workspace so the next step is obvious.
    try {
      const services = (await servicesApi.list(ws.id)).data;
      this.log("");
      if (services.length > 0) {
        this.log("  Services:");
        for (const s of services) {
          this.log(`    - ${s.name} (${s.slug})`);
        }
        this.log("");
        this.log("  Run 'apso link' inside a project to work with one.");
      } else {
        this.log("  No services yet.");
        this.log(
          "  Run 'apso init' to scaffold one, then 'apso deploy' to ship it."
        );
      }
    } catch {
      // listing is a convenience; never fail `use` over it
    }
    this.log("");
  }
}
