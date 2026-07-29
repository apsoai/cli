import { Flags } from "@oclif/core";
import { exec } from "child_process";
import BaseCommand from "../../lib/base-command";
import { credentials, globalConfig, projectLink } from "../../lib/config";
import { githubApi } from "../../lib/api/services";

/**
 * Open a URL in the default browser (best-effort).
 */
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? `open "${url}"`
        : platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;
    exec(command, () => resolve());
  });
}

const sleep = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/**
 * `apso github connect` — walk the user through connecting their GitHub
 * account so the CLI can push generated code to a real repository.
 *
 * The GitHub OAuth handshake is a browser+cookie flow on the app, so we open
 * the app's authorize URL (where the user is signed in) and poll the platform
 * until the connection appears — the same pattern as `apso login`.
 */
export default class GithubConnect extends BaseCommand {
  static description = "Connect a GitHub account to push generated code to a repo";

  static examples = ["$ apso github connect"];

  static flags = {
    help: Flags.help({ char: "h" }),
    "workspace-id": Flags.string({
      description: "Workspace id to connect (defaults to the linked project)",
    }),
    timeout: Flags.integer({
      description: "Seconds to wait for the connection",
      default: 300,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GithubConnect);

    if (!credentials.isValid()) {
      this.error("Not authenticated. Run 'apso login' first.");
    }

    const workspaceId =
      flags["workspace-id"] ||
      process.env.APSO_WORKSPACE_ID ||
      projectLink.read()?.workspaceId;

    if (!workspaceId) {
      this.error(
        "No workspace. Run 'apso link' first, or pass --workspace-id."
      );
    }

    // Already connected?
    const existing = await githubApi.getConnection();
    if (existing.connected) {
      this.log(
        `GitHub is already connected${existing.login ? ` as ${existing.login}` : ""}.`
      );
      return;
    }

    const config = globalConfig.read();
    const authorizeUrl = `${config.webUrl}/api/github/authorize?workspaceId=${workspaceId}`;

    this.log("Opening GitHub authorization in your browser...");
    this.log("");
    this.log("If the browser doesn't open, visit this URL:");
    this.log(`  ${authorizeUrl}`);
    this.log("");
    this.log(
      "You must be signed in to the Apso app in your browser to authorize."
    );
    this.log("");
    await openBrowser(authorizeUrl);

    this.log("Waiting for the GitHub connection to complete...");
    const deadline = Date.now() + flags.timeout * 1000;
    /* eslint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      await sleep(3000);
      try {
        const conn = await githubApi.getConnection();
        if (conn.connected) {
          this.log("");
          this.log(
            `Connected to GitHub${conn.login ? ` as ${conn.login}` : ""}.`
          );
          this.log("Next: run 'apso deploy' to push your code and deploy.");
          return;
        }
      } catch {
        // transient; keep polling
      }
    }
    /* eslint-enable no-await-in-loop */

    this.error(
      "Timed out waiting for the GitHub connection. Re-run 'apso github connect' to try again."
    );
  }
}
