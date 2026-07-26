import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { credentials, globalConfig, projectLink } from "../lib/config";

export default class Whoami extends BaseCommand {
  static description = "Display information about the current user and context";

  static examples = [
    "$ apso whoami",
    "$ apso whoami --json",
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);

    const creds = credentials.read();

    if (!creds) {
      if (flags.json) {
        this.log(JSON.stringify({ authenticated: false }, null, 2));
      } else {
        this.log("Not logged in. Run 'apso login' to authenticate.");
      }
      return;
    }

    const config = globalConfig.read();
    const link = projectLink.read();

    // Check if session is valid
    const isValid = credentials.isValid();
    const needsRefresh = credentials.needsRefresh();

    const info = {
      authenticated: true,
      user: {
        id: creds.user.id,
        email: creds.user.email,
        name: creds.user.name || undefined,
      },
      session: {
        valid: isValid,
        needsRefresh,
        expiresAt: creds.tokens.expiresAt,
      },
      context: {
        workspace: link?.workspaceSlug || config.defaultWorkspace || undefined,
        service: link?.serviceSlug || undefined,
      },
      config: {
        apiUrl: config.apiUrl,
        webUrl: config.webUrl,
      },
    };

    if (flags.json) {
      this.log(JSON.stringify(info, null, 2));
      return;
    }

    // Pretty print
    this.log("");
    this.log(`  Email:     ${creds.user.email}`);
    if (creds.user.name) {
      this.log(`  Name:      ${creds.user.name}`);
    }
    this.log(`  User ID:   ${creds.user.id}`);
    this.log("");

    // Session status
    if (!isValid) {
      this.log("  Session:   Expired (run 'apso login' to refresh)");
    } else if (needsRefresh) {
      this.log("  Session:   Valid (will refresh soon)");
    } else {
      this.log("  Session:   Valid");
    }
    this.log("");

    // Context
    if (link) {
      this.log(`  Workspace: ${link.workspaceSlug}`);
      this.log(`  Service:   ${link.serviceSlug}`);
    } else if (config.activeWorkspaceName || config.activeWorkspaceSlug) {
      const name = config.activeWorkspaceName || config.activeWorkspaceSlug;
      const slug = config.activeWorkspaceSlug;
      this.log(`  Workspace: ${name}${slug ? ` (${slug})` : ""}`);
      this.log("  Service:   None (run 'apso link' in a project to set)");
    } else {
      this.log("  Workspace: None (run 'apso use' to select one)");
      this.log("  Service:   None");
    }
    this.log("");
  }
}
