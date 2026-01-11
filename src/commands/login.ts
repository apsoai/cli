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
      // Note: We don't use 'env' here so we can handle APSO_WEB_URL manually and apply auto-correction
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

    // Get web URL from flag, environment variable, or auto-detect from API URL
    const { getWebBaseUrl, getApiBaseUrl, getAutoDetectedWebUrl } = await import("../lib/config/index");
    
    const apiBaseUrl = getApiBaseUrl();
    
    // Auto-detect the correct web URL based on API URL (without env var override)
    const autoDetectedWebUrl = getAutoDetectedWebUrl();
    
    // Get web URL from flag (explicit override) or environment variable
    const explicitWebUrl = flags["web-url"] || process.env.APSO_WEB_URL;
    
    // Check if there's a mismatch between API and the web URL
    const apiIsLocalhost = apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
    const explicitWebIsLocalhost = explicitWebUrl ? (explicitWebUrl.includes("localhost") || explicitWebUrl.includes("127.0.0.1")) : false;
    
    // Auto-correct: If API and web URL don't match environments, use auto-detected URL
    // (unless explicitly overridden by --web-url flag)
    let webBaseUrl: string;
    if (flags["web-url"]) {
      // Explicit --web-url flag takes highest priority (user explicitly wants this URL)
      webBaseUrl = flags["web-url"];
    } else if (explicitWebUrl && !apiIsLocalhost && explicitWebIsLocalhost) {
      // API is not localhost (staging/production) but web URL is localhost - auto-correct
      this.warn(
        `⚠ Auto-correcting web URL mismatch:\n` +
        `  API URL: ${apiBaseUrl}\n` +
        `  Web URL (env var): ${explicitWebUrl} (mismatch)\n` +
        `  Using auto-detected: ${autoDetectedWebUrl}\n` +
        `\n` +
        `To use localhost, set both: $env:APSO_API_URL='http://localhost:3001' $env:APSO_WEB_URL='http://localhost:3000'`
      );
      webBaseUrl = autoDetectedWebUrl;
    } else if (explicitWebUrl && apiIsLocalhost && !explicitWebIsLocalhost) {
      // API is localhost but web URL is not localhost - auto-correct
      this.warn(
        `⚠ Auto-correcting web URL mismatch:\n` +
        `  API URL: ${apiBaseUrl}\n` +
        `  Web URL (env var): ${explicitWebUrl} (mismatch)\n` +
        `  Using auto-detected: ${autoDetectedWebUrl}\n` +
        `\n` +
        `For local development, both should be localhost.`
      );
      webBaseUrl = autoDetectedWebUrl;
    } else {
      // Use explicit web URL if set, otherwise use auto-detected
      webBaseUrl = explicitWebUrl || autoDetectedWebUrl;
    }
    
    // Debug: Log what we're getting
    if (process.env.APSO_DEBUG || process.env.DEBUG) {
      this.log(`[DEBUG] flags["web-url"]: ${flags["web-url"]}`);
      this.log(`[DEBUG] process.env.APSO_WEB_URL: ${process.env.APSO_WEB_URL}`);
      this.log(`[DEBUG] API URL: ${apiBaseUrl}`);
      this.log(`[DEBUG] Auto-detected web URL: ${autoDetectedWebUrl}`);
      this.log(`[DEBUG] Final webBaseUrl: ${webBaseUrl}`);
    }

    // Show helpful messages based on detected URL
    if (webBaseUrl.includes("localhost")) {
      this.log(`✓ Detected local development server: ${webBaseUrl}`);
    } else if (webBaseUrl.includes("staging")) {
      this.log(`✓ Using staging URL: ${webBaseUrl}`);
    } else if (webBaseUrl.includes("app.apso.cloud") || webBaseUrl.includes("app.apso.ai")) {
      this.log(`✓ Using production URL: ${webBaseUrl}`);
      if (!flags["web-url"] && !process.env.APSO_WEB_URL) {
        this.log("");
        this.log("To use local development, you can:");
        this.log(
          "  1. Set environment: $env:APSO_WEB_URL='http://localhost:3000'"
        );
        this.log("  2. Use flag: apso login --web-url http://localhost:3000");
        this.log("  3. Set API URL to localhost (web URL will auto-detect): $env:APSO_API_URL='http://localhost:3001'");
        this.log("");
      }
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
            `     Example: $env:APSO_WEB_URL='http://localhost:3000'\n` +
            `  4. Or set API URL (web URL will auto-detect): $env:APSO_API_URL='http://localhost:3001'`
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
