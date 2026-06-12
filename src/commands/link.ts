import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { ProjectLinkFile } from "../lib/config/types";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { Workspace, Service } from "../lib/api/types";

export default class Link extends BaseCommand {
  static description = "Link this project to a platform service";

  static examples = [
    `$ apso link`,
    `$ apso link --workspace my-team --service my-api`,
    `$ apso link --force`,
  ];

  static flags = {
    workspace: Flags.string({
      char: "w",
      description: "Workspace slug",
    }),
    service: Flags.string({
      char: "s",
      description: "Service slug",
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

    // Determine workspace
    let workspace: Workspace;
    if (flags.workspace) {
      workspace = await workspacesApi.get(flags.workspace);
    } else {
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
      workspace = response.workspace;
    }

    // Determine service
    let service: Service;
    if (flags.service) {
      service = await servicesApi.get(workspace.slug, flags.service);
    } else {
      const servicesResponse = await servicesApi.list(workspace.slug);
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
        // Create new service
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
        service = await servicesApi.create(workspace.slug, {
          name: serviceName,
        });
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
