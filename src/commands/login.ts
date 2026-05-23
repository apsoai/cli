import { Flags } from "@oclif/core";
import * as http from "http";
import * as crypto from "crypto";
import { exec } from "child_process";
import BaseCommand from "../lib/base-command";
import { credentials, globalConfig } from "../lib/config";
import { authApi } from "../lib/api/services";

/**
 * Open a URL in the default browser
 */
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let command: string;

    if (platform === "darwin") {
      command = `open "${url}"`;
    } else if (platform === "win32") {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Generate a random state token for CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Create a simple HTML response for the callback
 */
function createHtmlResponse(success: boolean, message: string): string {
  const color = success ? "#10b981" : "#ef4444";
  const icon = success ? "✓" : "✗";

  return `<!DOCTYPE html>
<html>
<head>
  <title>Apso CLI ${success ? "Login Successful" : "Login Failed"}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      color: ${color};
      margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.5rem; }
    p { color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${success ? "Login Successful" : "Login Failed"}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default class Login extends BaseCommand {
  static description = "Authenticate with the Apso platform";

  static examples = [
    "$ apso login",
    "$ apso login --token <api-token>",
  ];

  static flags = {
    help: Flags.help({ char: "h" }),
    token: Flags.string({
      char: "t",
      description: "Use an API token directly (for CI/CD)",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);

    // Check if already logged in
    if (credentials.isValid()) {
      const creds = credentials.read();
      if (creds) {
        this.log(`Already logged in as ${creds.user.email}`);
        this.log("Run 'apso logout' first to switch accounts.");
        return;
      }
    }

    // Handle direct token login (for CI/CD)
    if (flags.token) {
      await this.loginWithToken(flags.token);
      return;
    }

    // Browser-based OAuth flow
    await this.loginWithBrowser();
  }

  /**
   * Login using a direct API token (for CI/CD)
   */
  private async loginWithToken(token: string): Promise<void> {
    this.log("Validating token...");

    try {
      // Store the token temporarily to make the API call
      credentials.write({
        tokens: {
          accessToken: token,
          refreshToken: token,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          tokenType: "Bearer",
        },
        user: {
          id: "",
          email: "",
        },
      });

      // Validate by fetching profile
      const profile = await authApi.getProfile();

      // Update with real user info
      credentials.write({
        tokens: {
          accessToken: token,
          refreshToken: token,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          tokenType: "Bearer",
        },
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        },
      });

      this.log(`Logged in as ${profile.email}`);
    } catch (error) {
      credentials.clear();
      this.error("Invalid token. Please check your token and try again.");
    }
  }

  /**
   * Login using browser-based OAuth flow
   */
  private async loginWithBrowser(): Promise<void> {
    const config = globalConfig.read();
    const state = generateState();

    // Find an available port
    const port = await this.findAvailablePort();
    const callbackUrl = `http://localhost:${port}/callback`;

    // Track server for cleanup
    let callbackServer: http.Server | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (callbackServer) {
        try {
          callbackServer.closeAllConnections();
          callbackServer.close();
        } catch {
          // Ignore cleanup errors
        }
        callbackServer = null;
      }
    };

    // Create promise to wait for callback
    const tokenPromise = new Promise<{ code: string; receivedState: string }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${port}`);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const receivedState = url.searchParams.get("state");
          const error = url.searchParams.get("error");

          // Close connection header to ensure browser doesn't keep connection open
          res.setHeader("Connection", "close");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(createHtmlResponse(false, "Authorization was denied. You can close this window."), () => {
              cleanup();
              reject(new Error(error === "access_denied" ? "Authorization denied by user" : error));
            });
            return;
          }

          if (!code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(createHtmlResponse(false, "No authorization code received. Please try again."), () => {
              cleanup();
              reject(new Error("No authorization code received"));
            });
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(createHtmlResponse(true, "You can close this window and return to the terminal."), () => {
            cleanup();
            resolve({ code, receivedState: receivedState || "" });
          });
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      callbackServer = server;

      server.listen(port, "127.0.0.1", () => {
        // Server is ready
      });

      // Timeout after 5 minutes
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Login timed out. Please try again."));
      }, 5 * 60 * 1000);
    });

    // Build authorization URL
    const authUrl = `${config.webUrl}/cli-login?callback=${encodeURIComponent(callbackUrl)}&state=${state}`;

    this.log("Opening browser for authentication...");
    this.log("");
    this.log("If the browser doesn't open, visit this URL:");
    this.log(authUrl);
    this.log("");

    try {
      await openBrowser(authUrl);
    } catch {
      this.log("Could not open browser automatically. Please visit the URL above.");
    }

    this.log("Waiting for authorization...");

    try {
      const { code, receivedState } = await tokenPromise;

      // Verify state to prevent CSRF
      if (receivedState !== state) {
        this.error("Security error: State mismatch. Please try again.");
      }

      this.log("Exchanging authorization code...");

      // Exchange code for tokens
      let tokenResponse;
      try {
        tokenResponse = await authApi.exchangeCode(code);
      } catch (exchangeError: unknown) {
        const err = exchangeError as { message?: string };
        this.error(err.message || "Failed to exchange authorization code. Please try again.");
      }

      // Validate response has required fields
      if (!tokenResponse || !tokenResponse.user) {
        this.error("Server returned invalid response. Please try again.");
      }

      // Use expiresAt directly from response, or calculate from expiresIn, or default to 7 days
      let expiresAt: string;
      if (tokenResponse.expiresAt) {
        expiresAt = tokenResponse.expiresAt;
      } else if (tokenResponse.expiresIn) {
        expiresAt = new Date(Date.now() + tokenResponse.expiresIn * 1000).toISOString();
      } else {
        expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      // Store credentials
      credentials.write({
        tokens: {
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken,
          expiresAt,
          tokenType: tokenResponse.tokenType || "Bearer",
        },
        user: {
          id: tokenResponse.user.id,
          email: tokenResponse.user.email,
          name: tokenResponse.user.name,
          avatarUrl: tokenResponse.user.avatarUrl,
        },
      });

      this.log("");
      this.log(`Successfully logged in as ${tokenResponse.user.email}`);
      this.log("");
      this.log("Next steps:");
      this.log("  apso whoami     - View your account info");
      this.log("  apso services   - List your services");
      this.log("  apso tui        - Launch interactive UI");
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error("Login failed. Please try again.");
    }
  }

  /**
   * Find an available port for the callback server
   */
  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close();
          reject(new Error("Could not find available port"));
        }
      });
      server.on("error", reject);
    });
  }
}
