import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { credentials } from "../../lib/config";

export default class Tui extends BaseCommand {
  static description = "Launch interactive terminal UI for browsing workspaces and services";

  static examples = [
    `$ apso tui`,
    `$ apso tui --fullscreen`,
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
    fullscreen: Flags.boolean({
      char: "f",
      description: "Launch in fullscreen mode",
      default: true,
    }),
  };

  async run(): Promise<void> {
    // Check if user is authenticated
    if (!credentials.exists()) {
      this.error("Not authenticated. Run 'apso login' first.");
    }

    if (!credentials.isValid()) {
      this.error("Session expired. Run 'apso login' to authenticate.");
    }

    // Dynamic import to avoid loading React/Ink when not needed
    const { startTui } = await import("../../tui");
    await startTui();
  }
}
