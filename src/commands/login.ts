import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { performOAuthFlow } from "../lib/auth/oauth";
import {
  writeCredentials,
  readCredentials,
  isAuthenticated,
} from "../lib/config/index";

export default class Login extends BaseCommand {
  static description = "Authenticate with the Apso platform";

  static examples = [`$ apso login`];

  static flags = {
    "no-browser": Flags.boolean({
      description: "Don't open browser automatically",
      default: false,
    }),
    "api-key": Flags.string({
      description: "Use API key instead of OAuth (for CI/CD)",
      hidden: true, // Not implemented yet
    }),
    "web-url": Flags.string({
      description: "Override web app URL (e.g., http://localhost:3000)",
      env: "APSO_WEB_URL",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);

    // Check if already logged in
    if (isAuthenticated()) {
      const creds = readCredentials();
      if (creds) {
        this.log(`Already logged in as ${creds.user.email}.`);
        this.log(
          "Run 'apso logout' first if you want to log in as a different user."
        );
        this.exit(0);
      }
    }

    // Get web URL from flag, environment variable, config, or auto-detect
    const { getWebBaseUrl } = await import("../lib/config/index");
    
  
    const webBaseUrl =
      process.env.APSO_WEB_URL ||
      flags["web-url"] ||
      (await getWebBaseUrl());
    
    // Debug: Log what we're getting
    if (process.env.APSO_DEBUG || process.env.DEBUG) {
      this.log(`[DEBUG] flags["web-url"]: ${flags["web-url"]}`);
      this.log(`[DEBUG] process.env.APSO_WEB_URL: ${process.env.APSO_WEB_URL}`);
      const configValue = await getWebBaseUrl();
      this.log(`[DEBUG] getWebBaseUrl(): ${configValue}`);
      this.log(`[DEBUG] Final webBaseUrl: ${webBaseUrl}`);
    }

    // Show helpful messages based on detected URL
    if (webBaseUrl.includes("localhost")) {
      this.log(`✓ Detected local development server: ${webBaseUrl}`);
    } else if (webBaseUrl.includes("app.apso.cloud") && !flags["web-url"]) {
      this.warn("Using production URL: https://app.apso.cloud");
      this.log("");
      this.log("To use local development, you can:");
      this.log(
        "  1. Set in config: apso config set webUrl http://localhost:3000"
      );
      this.log(
        "  2. Set environment: $env:APSO_WEB_URL='http://localhost:3000'"
      );
      this.log("  3. Use flag: apso login --web-url http://localhost:3000");
      this.log("");
    }

    const callbackUrl = `http://localhost:8899/callback`;
    // These parameter names follow the OAuth 2.0 spec and must use snake_case.
    const oauthParams = new URLSearchParams();
    oauthParams.set("client_id", "apso-cli");
    oauthParams.set("redirect_uri", callbackUrl);
    oauthParams.set("response_type", "code");
    oauthParams.set("scope", "read write");
    const oauthUrl = `${webBaseUrl}/auth/cli-login?${oauthParams.toString()}`;

    this.log("Opening browser for authentication...");
    this.log(`URL: ${oauthUrl}`);
    this.log("Waiting for login... (press Ctrl+C to cancel)");

    try {
      const result = await performOAuthFlow(webBaseUrl);

      // Store credentials
      writeCredentials({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        user: result.user,
      });

      const expiresAt = new Date(result.expiresAt);
      const daysUntilExpiry = Math.ceil(
        (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      this.log("");
      this.log(`✓ Successfully logged in as ${result.user.email}`);
      this.log(`  Token expires: in ${daysUntilExpiry} days`);
      this.log("");
      this.log("Tip: Run 'apso whoami' to check your login status");
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("timeout")) {
        this.error("Login timed out. Please try again.");
      } else if (err.message.includes("Failed to open browser")) {
        this.log("");
        this.error(err.message);
      } else if (
        err.message.includes("404") ||
        err.message.includes("Not Found")
      ) {
        this.error(
          `Login endpoint not found (404). Please verify:\n` +
            `  1. The backend server is running at ${webBaseUrl}\n` +
            `  2. The endpoint /auth/cli-login exists\n` +
            `  3. If using a different URL, set APSO_WEB_URL environment variable\n` +
            `     Example: $env:APSO_WEB_URL='http://localhost:3000'`
        );
      } else {
        // Show detailed error message
        this.error(
          `Login failed: ${err.message}\n\n` +
            `Troubleshooting:\n` +
            `  - Check if backend API is running\n` +
            `  - Verify API URL: apso config get apiUrl\n` +
            `  - Set API URL: apso config set apiUrl http://localhost:3001\n` +
            `  - Enable debug: $env:APSO_DEBUG='1' apso login`
        );
      }
      this.exit(1);
    }
  }
}
