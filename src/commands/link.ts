import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink, globalConfig } from "../lib/config";
import { ProjectLinkFile } from "../lib/config/types";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { withUpgradeRetry } from "../lib/upgrade";
import { Workspace, Service } from "../lib/api/types";
import { isInteractive, missingFlag } from "../lib/utils/interactive";

export default class Link extends BaseCommand {
  static description = "Link this project to a platform service";

  static examples = [
    `$ apso link`,
    `$ apso link --workspace my-team --service my-api`,
    `$ apso link --workspace my-team --create my-new-api`,
    `$ apso link --force`,
  ];

  static flags = {
    workspace: Flags.string({
      char: "w",
      description: "Workspace slug (defaults to the active workspace)",
    }),
    service: Flags.string({
      char: "s",
      description: "Existing service slug to link",
    }),
    create: Flags.string({
      char: "c",
      description: "Create a new service with this name and link it",
    }),
    force: Flags.boolean({
      char: "f",
      description: "Overwrite existing link without confirmation",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Link);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Check .apsorc exists
    const apsorcPath = path.join(process.cwd(), ".apsorc");
    if (!fs.existsSync(apsorcPath)) {
      this.error(
        "No .apsorc found in current directory. Run 'apso init' first or navigate to an Apso project."
      );
    }

    // Check if already linked
    if (projectLink.exists() && !flags.force) {
      const existing = projectLink.read();
      if (!isInteractive()) {
        this.error(
          missingFlag(
            `Already linked to ${existing?.workspaceSlug}/${existing?.serviceSlug}. Pass --force to overwrite.`
          )
        );
      }
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: "confirm",
          name: "confirm",
          message: `Already linked to ${existing?.workspaceSlug}/${existing?.serviceSlug}. Overwrite?`,
          default: false,
        },
      ]);
      if (!confirm) {
        this.log("Link unchanged.");
        return;
      }
    }

    // Determine workspace: --workspace flag, then the active workspace, then a
    // prompt (interactive only).
    let workspace: Workspace;
    const active = globalConfig.read();
    if (flags.workspace) {
      workspace = await workspacesApi.get(flags.workspace);
    } else if (active.activeWorkspaceSlug) {
      workspace = await workspacesApi.get(active.activeWorkspaceSlug);
    } else {
      const workspaces = await workspacesApi.list();
      if (workspaces.length === 0) {
        this.error(
          "No workspaces found. Create a workspace at https://app.apso.cloud first."
        );
      }
      if (!isInteractive()) {
        this.error(
          missingFlag("Pass --workspace <slug> or set one with 'apso use'.")
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
      workspace = response.workspace;
    }

    // Determine service: --service links an existing one, --create makes a new
    // one, otherwise prompt (interactive only).
    let service: Service;
    if (flags.service) {
      service = await servicesApi.get(workspace.id, flags.service);
    } else if (flags.create) {
      this.log(`Creating service "${flags.create}"...`);
      service = await withUpgradeRetry(() =>
        servicesApi.create(workspace.id, { name: flags.create as string })
      );
    } else if (!isInteractive()) {
      this.error(
        missingFlag(
          "Pass --service <slug> to link an existing service, or --create <name> to make a new one."
        )
      );
    } else {
      const servicesResponse = await servicesApi.list(workspace.id);
      const services = servicesResponse.data;

      const choices = [
        ...services.map((svc) => ({
          name: `${svc.name} (${svc.slug})`,
          value: svc,
        })),
        { name: "+ Create new service", value: null },
      ];

      const { selectedService } = await inquirer.prompt<{
        selectedService: Service | null;
      }>([
        {
          type: "list",
          name: "selectedService",
          message: "Select a service:",
          choices,
        },
      ]);

      if (selectedService) {
        service = selectedService;
      } else {
        const { serviceName } = await inquirer.prompt<{ serviceName: string }>([
          {
            type: "input",
            name: "serviceName",
            message: "Enter a name for the new service:",
            validate: (input: string) =>
              input.trim() ? true : "Service name is required",
          },
        ]);
        this.log(`Creating service "${serviceName}"...`);
        service = await withUpgradeRetry(() =>
          servicesApi.create(workspace.id, {
            name: serviceName,
          })
        );
      }
    }

    // Write link
    const link: ProjectLinkFile = {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      serviceId: service.id,
      serviceSlug: service.slug,
      githubRepo: service.githubRepo,
      githubBranch: service.githubBranch,
      linkedAt: new Date().toISOString(),
    };
    projectLink.write(link);

    this.log(
      `Linked to workspace "${workspace.name}" / service "${service.name}"`
    );
  }
}
