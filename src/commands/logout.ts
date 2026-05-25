import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials } from "../lib/config";
import { authApi } from "../lib/api";

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

    // Revoke session on the server
    try {
      await authApi.logout();
    } catch {
      // Server-side revocation is best-effort.
      // If the server is unreachable or the session is already expired,
      // we still clear local credentials.
    }

    // Clear local credentials
    credentials.clear();

    this.log(`Logged out from ${email}`);
  }
}
