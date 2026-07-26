import { Flags } from "@oclif/core";
import { execSync } from "child_process";
import BaseCommand from "../lib/base-command";

/**
 * Update the CLI in place. Detects whether it was installed via Homebrew or npm
 * and runs the matching upgrade command, so users don't have to remember the
 * incantation. `--check` only reports whether an update is available.
 */
export default class Update extends BaseCommand {
  static description = "Update the Apso CLI to the latest version";

  static examples = ["$ apso update", "$ apso update --check"];

  static flags = {
    check: Flags.boolean({
      description: "Only check whether a newer version is available",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Update);
    const current = this.config.version;

    let latest = "";
    try {
      latest = execSync("npm view @apso/cli version", {
        encoding: "utf-8",
        timeout: 15000,
      }).trim();
    } catch {
      this.warn("Could not reach npm to check for the latest version.");
    }

    if (latest) {
      this.log(`  Installed: ${current}`);
      this.log(`  Latest:    ${latest}`);
      this.log("");
    }

    if (latest && latest === current) {
      this.log("You're on the latest version.");
      return;
    }

    if (flags.check) {
      if (latest) this.log(`Update available: ${current} -> ${latest}`);
      this.log("Run 'apso update' to upgrade.");
      return;
    }

    // Pick the upgrade command based on how the CLI was installed.
    const installRoot = `${this.config.root || ""} ${process.execPath}`;
    const isBrew = /(?:Cellar|homebrew|\/opt\/homebrew)/i.test(installRoot);
    const cmd = isBrew
      ? "brew upgrade apsoai/tap/apso"
      : "npm install -g @apso/cli@latest";

    this.log(`Updating via: ${cmd}`);
    this.log("");
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch {
      this.error(
        `Update failed. Run it manually:\n  ${cmd}` +
          (isBrew ? "" : "\n(or 'brew upgrade apsoai/tap/apso' if you used Homebrew)")
      );
    }

    this.log("");
    this.log(`Updated to ${latest || "the latest version"}.`);
    this.log("Run 'apso --version' to confirm.");
  }
}
