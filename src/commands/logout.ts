import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials } from "../lib/config";

export default class Logout extends BaseCommand {
  static description = "Log out from the Apso platform";

  static examples = [
    "$ apso logout",
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
  };

  async run(): Promise<void> {
    await this.parse(Logout);

    if (!credentials.exists()) {
      this.log("Not logged in.");
      return;
    }

    const creds = credentials.read();
    const email = creds?.user.email || "unknown";

    // Clear local credentials
    credentials.clear();

    this.log(`Logged out from ${email}`);
  }
}
