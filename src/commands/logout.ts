import BaseCommand from "../lib/base-command";
import { deleteCredentials, readCredentials } from "../lib/config/index";

export default class Logout extends BaseCommand {
  static description = "Clear stored authentication credentials";

  static examples = [`$ apso logout`];

  async run(): Promise<void> {
    const creds = readCredentials();
    if (!creds) {
      this.log("Not logged in.");
      this.exit(0);
    }

    deleteCredentials();
    this.log("✓ Logged out successfully");
  }
}
