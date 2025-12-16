import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { configManager } from "../lib/config";

export default class Whoami extends BaseCommand {
  static description = "Display current authentication status";

  static examples = ["$ apso whoami", "$ apso whoami --json"];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);

    if (configManager.isLoggedIn()) {
      const config = configManager.getConfig();

      if (config?.user) {
        if (flags.json) {
          this.log(
            JSON.stringify({
              authenticated: true,
              userId: config.user.id,
              email: config.user.email,
              fullName: config.user.fullName,
              defaultWorkspace: config.defaultWorkspace ?? null,
            })
          );
        } else {
          this.log(`Logged in as ${config.user.email}`);
          this.log(`Name: ${config.user.fullName}`);

          if (config.defaultWorkspace) {
            this.log(
              `Default workspace: ${config.defaultWorkspace.name}`
            );
          }
        }

        return;
      }
    }

    // Not logged in OR config missing
    if (flags.json) {
      this.log(
        JSON.stringify({
          authenticated: false,
          message: "Not logged in",
        })
      );
    } else {
      this.log("Not logged in");
      this.log("Run 'apso login' to authenticate");
    }

    this.exit(0);
  }
}
