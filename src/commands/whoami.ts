import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readCredentials, isAuthenticated } from "../lib/config/index";

export default class Whoami extends BaseCommand {
  static description = "Display current authentication status";

  static examples = [`$ apso whoami`, `$ apso whoami --json`];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);

    if (!isAuthenticated()) {
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

    const creds = readCredentials();
    if (!creds) {
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

    const expiresAt = new Date(creds.expiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    const hoursUntilExpiry = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
    );

    let expiryText: string;
    if (daysUntilExpiry > 0) {
      expiryText = `in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`;
    } else if (hoursUntilExpiry > 0) {
      expiryText = `in ${hoursUntilExpiry} hour${hoursUntilExpiry !== 1 ? "s" : ""}`;
    } else {
      expiryText = "soon (expired or expiring)";
    }

    if (flags.json) {
      this.log(
        JSON.stringify({
          authenticated: true,
          email: creds.user.email,
          userId: creds.user.id,
          firstName: creds.user.firstName,
          lastName: creds.user.lastName,
          tokenExpiresAt: creds.expiresAt,
          tokenExpiresIn: expiryText,
        })
      );
    } else {
      this.log(`Logged in as ${creds.user.email}`);
      this.log(`Token expires: ${expiryText}`);
    }
  }
}
