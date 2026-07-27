import { Flags } from "@oclif/core";
import * as http from "http";
import * as crypto from "crypto";
import { exec } from "child_process";
import BaseCommand from "../lib/base-command";
import { credentials, globalConfig } from "../lib/config";
import { authApi, workspacesApi } from "../lib/api/services";

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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
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
    .logo {
      margin-bottom: 1.5rem;
    }
    .logo svg {
      width: 48px;
      height: 48px;
    }
    .status-icon {
      font-size: 2rem;
      color: ${color};
      margin-bottom: 0.5rem;
    }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
    p { color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg width="48" height="48" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="18" cy="17.9947" rx="18" ry="17.9947" fill="white"/>
        <path d="M35.9775 17.0728C35.4957 7.56425 27.6321 0 17.9988 0C17.6236 0 17.2531 0.0153841 16.8837 0.039052C16.8683 0.039052 16.8565 0.0426022 16.8411 0.0426022C16.5014 0.0639032 16.1652 0.0946714 15.8326 0.13609C15.7805 0.13964 15.7331 0.147924 15.681 0.153841C15.3721 0.196443 15.0691 0.241412 14.766 0.295848C14.7175 0.301765 14.6725 0.313599 14.624 0.319516C13.5906 0.515959 12.582 0.801157 11.6149 1.16801C11.5604 1.18931 11.506 1.21298 11.448 1.23191C11.1899 1.33487 10.939 1.44137 10.6868 1.55261C10.6146 1.58338 10.5448 1.61651 10.4714 1.64965C10.2287 1.76207 9.98369 1.88041 9.74694 2.00348C9.68657 2.03425 9.6262 2.06384 9.56465 2.09697C8.97396 2.40939 8.39747 2.75731 7.8494 3.13244C7.79495 3.16913 7.74286 3.20818 7.68605 3.24723C7.47415 3.39515 7.26818 3.54663 7.05866 3.7052C6.97698 3.76911 6.90122 3.82946 6.82191 3.89336C6.63962 4.03537 6.46442 4.18093 6.28804 4.33004C6.20873 4.39986 6.13297 4.46613 6.0513 4.53595C5.87255 4.69925 5.69381 4.86256 5.51743 5.03297C5.45706 5.08741 5.39669 5.14776 5.33513 5.20575C5.10193 5.43651 4.87465 5.672 4.6533 5.9146C4.64146 5.93235 4.62607 5.95128 4.61068 5.96312C4.40708 6.19033 4.21413 6.42109 4.02236 6.65067C3.96199 6.72996 3.90162 6.80806 3.84006 6.8838C3.69801 7.06604 3.55833 7.2471 3.4222 7.43171C3.39498 7.47431 3.36183 7.51691 3.33105 7.55951C3.33105 7.55951 3.3346 7.55951 3.3346 7.56307C1.23938 10.5062 0 14.1072 0 18.0006C0 21.894 1.23938 25.4915 3.33934 28.4369L3.33579 28.4405C3.39971 28.5316 3.46955 28.6156 3.53584 28.7067C3.65066 28.8582 3.76667 29.0132 3.88386 29.1612C3.9833 29.2949 4.09338 29.4192 4.19874 29.5434C4.31356 29.6854 4.43193 29.8251 4.55268 29.9611C4.6675 30.0949 4.78943 30.2191 4.90662 30.3434C5.02499 30.4736 5.14336 30.5978 5.26766 30.7185C5.39787 30.8522 5.53163 30.9765 5.66776 31.1031C5.78614 31.2155 5.90451 31.3268 6.02289 31.4333C6.17085 31.567 6.32237 31.6913 6.47389 31.8155C6.58871 31.9126 6.70472 32.012 6.81954 32.1066C6.98645 32.2344 7.15573 32.3575 7.32264 32.4889C7.40195 32.5433 7.47415 32.6072 7.55583 32.6616C7.55583 32.6616 7.55583 32.6581 7.55938 32.6581C10.5022 34.761 14.1019 36 17.9988 36C21.8957 36 25.4919 34.761 28.4406 32.6581V32.6616C28.4678 32.6439 28.4927 32.6226 28.5164 32.6013C28.7472 32.4404 28.9674 32.2676 29.1887 32.096C29.2314 32.0629 29.274 32.0297 29.3166 31.9966C29.841 31.5729 30.3382 31.1209 30.8105 30.6451C30.8472 30.6061 30.8862 30.5635 30.9253 30.5244C31.1135 30.3339 31.2946 30.1304 31.4769 29.928C31.5373 29.8617 31.5953 29.7943 31.6557 29.7245C31.8107 29.5399 31.9646 29.3552 32.1138 29.1635C32.1718 29.0914 32.2321 29.0156 32.289 28.9422C32.4464 28.7363 32.5956 28.5328 32.7471 28.321C32.7861 28.2606 32.8288 28.2026 32.8714 28.1423C33.0596 27.8665 33.2383 27.5908 33.4135 27.3056C33.423 27.2843 33.4348 27.263 33.4467 27.2417C33.6041 26.9837 33.7497 26.721 33.8918 26.4571C33.9367 26.366 33.9829 26.2749 34.0279 26.1909C34.1309 25.9849 34.2315 25.779 34.3309 25.5696C34.3795 25.4666 34.428 25.3637 34.473 25.2572C34.5606 25.0536 34.6482 24.8477 34.7275 24.6394C34.7701 24.5365 34.8127 24.4335 34.8518 24.3306C34.9453 24.088 35.0305 23.8371 35.1122 23.585C35.1299 23.5211 35.1548 23.4572 35.1761 23.3909C35.2791 23.0762 35.3667 22.7578 35.4484 22.4336C35.4697 22.3484 35.4851 22.2644 35.5064 22.1792C35.5667 21.9366 35.6188 21.6975 35.6674 21.449C35.6887 21.3366 35.71 21.2182 35.7313 21.1011C35.768 20.8798 35.8035 20.6585 35.8307 20.4372C35.8485 20.3129 35.8639 20.1922 35.8793 20.068C35.9065 19.8349 35.9278 19.6017 35.9455 19.365C35.9515 19.2585 35.9633 19.1473 35.9692 19.0408C35.987 18.6952 36 18.3473 36 18.0018C36 17.6929 35.9941 17.384 35.9763 17.0752L35.9775 17.0728ZM9.37525 14.4043C9.13258 14.5285 8.90885 14.6409 8.90885 14.6409C9.07221 13.6256 9.6842 12.7238 10.6028 12.26C11.2598 11.9262 12.0635 11.7262 12.9028 11.7262C13.8628 11.7262 14.7542 11.9925 15.4692 12.4836C15.8172 12.6954 16.106 12.9416 16.3203 13.2043C16.4718 13.3712 16.6292 13.5925 16.7807 13.8433L17.2862 14.719L16.3771 14.2765C15.7284 13.964 15.017 13.8007 14.3079 13.8007C12.1712 13.8007 10.4418 15.1853 10.0263 17.39L9.92687 17.9592C9.92687 17.9592 8.80231 16.532 9.96357 14.1214C9.88426 14.1522 9.62146 14.2824 9.37525 14.4031V14.4043ZM23.7471 26.0583L22.7563 25.4157C22.7468 25.4063 22.735 25.4004 22.7231 25.3921L22.1751 25.0347L21.608 24.6678L20.1663 23.7282C19.2477 23.1223 18.6878 22.0679 18.6878 20.9236V20.2088C19.1305 20.0124 19.4335 19.636 19.4335 19.2006C19.4335 18.7887 19.1672 18.4278 18.7671 18.2254C18.7339 18.2101 18.7031 18.1947 18.67 18.1828C18.4735 18.0976 18.2427 18.0467 18 18.0467C17.7573 18.0467 17.5277 18.0988 17.33 18.1828C17.2969 18.1947 17.2661 18.2101 17.2365 18.2254C16.834 18.429 16.5665 18.7887 16.5665 19.2006C16.5665 19.6372 16.8695 20.0124 17.3122 20.2088V20.9236C17.3122 22.0691 16.7512 23.1223 15.8337 23.7282L14.3943 24.6678L13.8273 25.0347L13.2757 25.3921C13.2638 25.4015 13.2544 25.4074 13.2425 25.4157L12.2517 26.0583L11.9452 22.1389C11.9274 21.1934 12.1144 20.3094 12.4932 19.5307C12.4932 19.5248 12.4968 19.5213 12.4968 19.5213C12.833 18.8302 13.3183 18.2219 13.954 17.7249C15.217 16.7284 16.7085 16.5675 17.9988 16.8764C19.2891 16.5675 20.7806 16.7284 22.0437 17.7249C22.677 18.2219 23.1647 18.8302 23.5009 19.5213C23.5009 19.5213 23.5044 19.5248 23.5044 19.5307C23.8832 20.3094 24.0714 21.1934 24.056 22.1389L23.7471 26.0583ZM21.6874 13.8019C20.9818 13.8019 20.2657 13.9652 19.6205 14.2776L18.7079 14.7202L19.2204 13.8445C19.366 13.5936 19.527 13.3723 19.6809 13.2055C19.8928 12.9416 20.184 12.6966 20.5297 12.4848C21.2423 11.9937 22.136 11.7274 23.096 11.7274C23.9353 11.7274 24.7379 11.9274 25.396 12.2611C26.3111 12.725 26.9266 13.6268 27.0864 14.6421C27.0864 14.6421 26.8651 14.5297 26.6224 14.4054C26.3797 14.2847 26.1169 14.1546 26.0341 14.1238C27.1918 16.5356 26.0708 17.9615 26.0708 17.9615L25.9713 17.3923C25.5535 15.1865 23.8264 13.8031 21.6862 13.8031L21.6874 13.8019ZM26.8591 30.4014C24.6739 26.6334 26.8591 22.8194 26.8591 22.8194L27.7564 24.7246C29.4409 22.6016 31.0318 19.3627 30.3263 15.1131C29.9629 12.9262 28.8384 11.0482 26.9775 9.52986C25.75 8.52398 24.3022 8.01512 22.6746 8.01512C20.9049 8.01512 19.2867 8.60327 18.2261 9.04467L17.9988 9.13816L17.7715 9.04467C16.7109 8.60208 15.0927 8.01512 13.3207 8.01512C11.6966 8.01512 10.2512 8.52398 9.01776 9.52986C7.16046 11.047 6.03354 12.9262 5.6725 15.1131C4.96699 19.3627 6.55675 22.6016 8.2424 24.7246L9.13613 22.8194C9.13613 22.8194 11.3213 26.6334 9.13613 30.4014C5.25464 27.6322 2.72379 23.0915 2.72379 17.9604C2.72379 9.52395 9.55991 2.68394 17.9988 2.68394C26.4377 2.68394 33.2774 9.52395 33.2774 17.9604C33.2774 23.0915 30.7442 27.6334 26.8591 30.4014Z" fill="#0C0C0C"/>
      </svg>
    </div>
    <div class="status-icon">${success ? "&#10003;" : "&#10007;"}</div>
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
    } catch {
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

      // Brand-new users have no workspace yet. Workspaces are created in the web
      // app (not the CLI), so guide them there explicitly and offer to open it —
      // otherwise a first-timer hits a bare "No workspaces found" later with no
      // idea what to do.
      const workspaces = await workspacesApi.list().catch(() => []);
      if (workspaces.length === 0) {
        const onboardingUrl = `${globalConfig.read().webUrl}/onboarding/workspace`;
        this.log("You don't have a workspace yet.");
        this.log("Workspaces are created in the Apso web app:");
        this.log(`  ${onboardingUrl}`);
        this.log("");
        this.log("Opening it in your browser...");
        await openBrowser(onboardingUrl).catch(() => {
          this.log("(Could not open the browser — visit the URL above.)");
        });
        this.log("");
        this.log("Once your workspace exists, run 'apso use' to select it.");
      } else {
        this.log("Next steps:");
        this.log("  apso use        - Select your workspace");
        this.log("  apso whoami     - View your account + workspace");
        this.log("  apso projects   - List services in a workspace");
      }
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
