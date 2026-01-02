import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readCredentials, isAuthenticated } from "../lib/config/index";

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

    // Use the same credential store as 'apso login'
    if (isAuthenticated()) {
      const creds = readCredentials();

      if (creds?.user) {
        if (flags.json) {
          this.log(
            JSON.stringify({
              authenticated: true,
              userId: creds.user.id,
              email: creds.user.email,
              fullName:
                `${creds.user.firstName ?? ""} ${
                  creds.user.lastName ?? ""
                }`.trim() || null,
            })
          );
        } else {
          this.log(`Logged in as ${creds.user.email}`);
          const fullName = `${creds.user.firstName ?? ""} ${
            creds.user.lastName ?? ""
          }`.trim();
          if (fullName) {
            this.log(`Name: ${fullName}`);
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
