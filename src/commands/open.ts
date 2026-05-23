import { Flags } from "@oclif/core";
import { exec } from "child_process";
import * as os from "os";
import BaseCommand from "../lib/base-command";
import { credentials, projectLink } from "../lib/config";
import { globalConfig } from "../lib/config";
import { servicesApi } from "../lib/api/services";

export default class Open extends BaseCommand {
  static description = "Open the service dashboard or endpoint in browser";

  static examples = [
    `$ apso open`,
    `$ apso open --endpoint`,
    `$ apso open --dashboard`,
  ];

  static flags = {
    endpoint: Flags.boolean({
      char: "e",
      description: "Open the service API endpoint",
      default: false,
    }),
    dashboard: Flags.boolean({
      char: "d",
      description: "Open the service dashboard (default)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Open);

    // Auth guard
    if (!credentials.isValid()) {
      this.error("Not logged in. Run 'apso login' first.");
    }

    // Link guard
    const link = projectLink.read();
    if (!link) {
      this.error("Project not linked. Run 'apso link' first.");
    }

    const config = globalConfig.read();

    if (flags.endpoint) {
      // Open the live API endpoint
      const service = await servicesApi.get(
        link.workspaceSlug,
        link.serviceSlug
      );
      if (!service.endpoint) {
        this.error(
          "Service has no endpoint. Deploy first with 'apso deploy'."
        );
      }
      this.log(`Opening endpoint: ${service.endpoint}`);
      openUrl(service.endpoint);
    } else {
      // Open the dashboard (default)
      const dashboardUrl = `${config.webUrl}/workspaces/${link.workspaceSlug}/services/${link.serviceSlug}`;
      this.log(`Opening dashboard: ${dashboardUrl}`);
      openUrl(dashboardUrl);
    }
  }
}

function openUrl(url: string): void {
  const platform = os.platform();
  let command: string;

  switch (platform) {
    case "darwin":
      command = `open "${url}"`;
      break;
    case "win32":
      command = `start "" "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
      break;
  }

  exec(command, (error) => {
    if (error) {
      // Fail silently -- the URL was already printed
    }
  });
}
