import * as http from "http";
import { URL } from "url";
import { promisify } from "util";
import { exec } from "child_process";
import { getApiBaseUrl, getWebBaseUrl } from "../config/index";

const execAsync = promisify(exec);

const OAUTH_CALLBACK_PORT = 8899;
const OAUTH_CALLBACK_PATH = "/callback";
const OAUTH_CLIENT_ID = "apso-cli";

export interface OAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
function startCallbackServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      const fullUrl = new URL(req.url, `http://localhost:${OAUTH_CALLBACK_PORT}`);
      
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`Callback server received request: ${req.url}`);
        console.log(`Pathname: ${fullUrl.pathname}, Expected: ${OAUTH_CALLBACK_PATH}`);
      }
      
      // Handle both /callback and /oauth/callback for compatibility
      if (fullUrl.pathname === OAUTH_CALLBACK_PATH || fullUrl.pathname === "/oauth/callback") {
        const code = fullUrl.searchParams.get("code") as string | null;
        const error = fullUrl.searchParams.get("error") as string | null;

        if (error) {
          res.writeHead(400);
          res.end(`Authentication failed: ${error}`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body>
                <h1>Authentication successful!</h1>
                <p>You can close this window and return to the CLI.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
          server.close();
          resolve(code);
        } else {
          res.writeHead(400);
          res.end("Missing authorization code");
          server.close();
          reject(new Error("Missing authorization code"));
        }
      } else {
        res.writeHead(404);
        res.end(`Not Found. Expected path: ${OAUTH_CALLBACK_PATH}`);
      }
    });

    server.listen(OAUTH_CALLBACK_PORT, "localhost", () => {
      // Server started successfully
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        console.log(`OAuth callback server listening on http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`);
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timeout"));
    }, 5 * 60 * 1000);
  });
}

/**
 * Open browser to OAuth URL
 */
async function openBrowser(oauthUrl: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  switch (platform) {
    case "win32":
      command = `start "" "${oauthUrl}"`;
      break;
    case "darwin":
      command = `open "${oauthUrl}"`;
      break;
    default:
      // Linux and others
      command = `xdg-open "${oauthUrl}"`;
      break;
  }

  try {
    await execAsync(command);
  } catch {
    // Browser might not open, but that's okay - user can manually open
    throw new Error(
      `Failed to open browser automatically. Please open this URL manually:\n${oauthUrl}`
    );
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  code: string
): Promise<OAuthResult> {
  const apiBaseUrl = getApiBaseUrl();
  const callbackUrl = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  const tokenExchangeUrl = `${apiBaseUrl}/auth/cli/callback`;

  if (process.env.DEBUG || process.env.APSO_DEBUG) {
    console.log(`Exchanging authorization code for tokens...`);
    console.log(`API URL: ${tokenExchangeUrl}`);
    console.log(`Code: ${code.slice(0, 10)}...`);
  }

  try {
    const response = await fetch(tokenExchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        redirectUri: callbackUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Token exchange failed (${response.status}): ${errorText}`;
      
      if (response.status === 404) {
        errorMessage = `Backend endpoint not found: ${tokenExchangeUrl}\n` +
          `The backend API needs to implement POST /auth/cli/callback endpoint.\n` +
          `Current API URL: ${apiBaseUrl}\n` +
          `Set APSO_API_URL environment variable if using a different API server.\n` +
          `Example: $env:APSO_API_URL='http://localhost:3001'`;
      } else if (response.status >= 500) {
        errorMessage = `Backend server error (${response.status}): ${errorText}\n` +
          `API URL: ${tokenExchangeUrl}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // Validate response structure
    if (!data.accessToken || !data.refreshToken || !data.expiresAt || !data.user) {
      throw new Error(
        `Invalid token response from backend. Missing required fields.\n` +
        `Expected: { accessToken, refreshToken, expiresAt, user }\n` +
        `Received: ${JSON.stringify(data)}`
      );
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      user: data.user,
    };
  } catch (error) {
    const err = error as Error;
    
    // Handle network errors
    if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
      throw new Error(
        `Cannot connect to backend API at ${tokenExchangeUrl}\n` +
        `Please verify:\n` +
        `  1. The backend server is running\n` +
        `  2. The API URL is correct (current: ${apiBaseUrl})\n` +
        `  3. If using local development, set: $env:APSO_API_URL='http://localhost:3001'\n` +
        `  4. The endpoint /auth/cli/callback is implemented\n` +
        `\nOriginal error: ${err.message}`
      );
    }
    
    throw error;
  }
}

/**
 * Perform OAuth flow: start server, open browser, exchange code for tokens
 */
export async function performOAuthFlow(webBaseUrl?: string): Promise<OAuthResult> {
  const baseUrl = webBaseUrl || await getWebBaseUrl();
  const callbackUrl = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  
  // Build OAuth URL with standard OAuth 2.0 parameters
  const oauthParams = new URLSearchParams();
  oauthParams.set("client_id", OAUTH_CLIENT_ID);
  oauthParams.set("redirect_uri", callbackUrl);
  oauthParams.set("response_type", "code");
  oauthParams.set("scope", "read write");
  const oauthUrl = `${baseUrl}/auth/cli-login?${oauthParams.toString()}`;

  // Start callback server
  const serverPromise = startCallbackServer();

  // Open browser
  try {
    await openBrowser(oauthUrl);
  } catch (error) {
    // If browser fails to open, still wait for callback (user can open manually)
    console.log((error as Error).message);
  }

  // Wait for callback
  const code = await serverPromise;

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  return tokens;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<OAuthResult> {
  const apiBaseUrl = getApiBaseUrl();

  const response = await fetch(`${apiBaseUrl}/auth/cli/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Token refresh failed");
  }

  const data = await response.json();
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || refreshToken, // Use new refresh token if provided
    expiresAt: data.expiresAt,
    user: data.user,
  };
}