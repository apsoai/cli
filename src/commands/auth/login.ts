import BaseCommand from '../../lib/base-command';
import { configManager } from '../../lib/config';
import open from 'open';
import * as http from 'http';
import { URL } from 'url';
import axios from 'axios';

interface LoginUrlResponse {
  loginUrl: string;
  sessionToken: string;
  expiresIn: number;
}

interface CallbackResponse {
  success: boolean;
  cliToken: string;
  user: {
    id: number;
    email: string;
    fullName: string;
  };
  workspaces: Array<{
    id: number;
    name: string;
    slug?: string;
  }>;
}

export default class Login extends BaseCommand {
  static description = 'Authenticate with Apso platform';

  static examples = ['$ apso login'];

  private server: http.Server | null = null;
  private callbackPort = 0; // Will be assigned dynamically

  /**
   * Get login URL from backend
   */
  private async getLoginUrl(): Promise<LoginUrlResponse> {
    try {
      // Use the client API URL (Next.js app) instead of backend API
      const clientBaseUrl =
        process.env.APSO_CLIENT_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://app.apso.cloud';

      const loginUrl = `${clientBaseUrl}/api/auth/cli-login-url`;
      
      // Log the URL being called (helpful for debugging)
      if (process.env.DEBUG) {
        this.log(`DEBUG: Calling ${loginUrl}`);
      }

      // Use axios directly for unauthenticated request
      const response = await axios.get<LoginUrlResponse>(loginUrl);
      return response.data;
    } catch (error: any) {
      const clientBaseUrl =
        process.env.APSO_CLIENT_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://app.apso.cloud';
      
      const loginUrl = `${clientBaseUrl}/api/auth/cli-login-url`;
      
      if (error.response) {
        // Axios error with response
        const status = error.response.status;
        const statusText = error.response.statusText;
        const data = error.response.data;
        
        if (status === 400 || status === 404) {
          throw new Error(
            `Failed to get login URL: ${status} ${statusText}\n` +
            `The endpoint ${loginUrl} may not be available.\n` +
            `For local development, set APSO_CLIENT_URL environment variable:\n` +
            `  export APSO_CLIENT_URL=http://localhost:3000\n` +
            `  (Windows: set APSO_CLIENT_URL=http://localhost:3000)`
          );
        }
        
        throw new Error(
          `Failed to get login URL: ${status} ${statusText}${data?.error ? ` - ${data.error}` : ''}\n` +
          `URL: ${loginUrl}`
        );
      } else if (error.request) {
        // Request was made but no response received
        throw new Error(
          `Failed to connect to ${loginUrl}\n` +
          `Please check:\n` +
          `  1. The server is running\n` +
          `  2. The URL is correct\n` +
          `  3. Your network connection\n` +
          `For local development, set: APSO_CLIENT_URL=http://localhost:3000`
        );
      } else {
        // Error setting up the request
        throw new Error(`Failed to get login URL: ${error.message}`);
      }
    }
  }

  /**
   * Start local HTTP server to receive callback
   * Returns callbackUrl immediately, but promise resolves only after callback is received
   */
  private startCallbackServer(
    sessionToken: string
  ): Promise<{ port: number; callbackUrl: string }> {
    let callbackResolve: ((value: { port: number; callbackUrl: string }) => void) | null = null;
    let callbackReject: ((error: Error) => void) | null = null;
    let serverInfo: { port: number; callbackUrl: string } | null = null;

    return new Promise((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;

      this.server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }

        // Log incoming requests for debugging
        this.log(`\n[DEBUG] Received request: ${req.method} ${req.url}`);

        const callbackUrl = new URL(req.url, `http://localhost:${this.callbackPort}`);
        const token = callbackUrl.searchParams.get('token');
        const authToken = callbackUrl.searchParams.get('authToken');
        const error = callbackUrl.searchParams.get('error');

        // Handle callback
        if (callbackUrl.pathname === '/callback') {
          this.log(`[DEBUG] Callback received - token: ${token ? 'present' : 'missing'}, authToken: ${authToken ? 'present' : 'missing'}`);
          if (error) {
            res.writeHead(400);
            res.end(`
              <html>
                <body>
                  <h1>Login Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            this.server?.close();
            if (callbackReject) {
              callbackReject(new Error(`Login failed: ${error}`));
            }
            return;
          }

          if (token === sessionToken && authToken) {
            this.log(`[DEBUG] Valid callback received, processing...`);
            // Success - send response to browser
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Login Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);

            // Process the callback
            this.processCallback(sessionToken, authToken as string)
              .then(() => {
                this.log(`[DEBUG] Callback processed successfully`);
                if (callbackResolve && serverInfo) {
                  callbackResolve(serverInfo);
                }
                this.server?.close();
              })
              .catch((error_) => {
                this.log(`[DEBUG] Error processing callback: ${error_.message}`);
                if (callbackReject) {
                  callbackReject(error_);
                }
                this.server?.close();
              });
          } else if (token !== sessionToken || !authToken) {
            const hasAuthToken = Boolean(authToken);
            this.log(
              `[DEBUG] Invalid callback - token match: ${token === sessionToken}, has authToken: ${hasAuthToken}`
            );
            res.writeHead(400);
            res.end(`
              <html>
                <body>
                  <h1>Invalid Callback</h1>
                  <p>Missing or invalid parameters.</p>
                  <p>Expected token: ${sessionToken.slice(0, 10)}...</p>
                  <p>Received token: ${token ? (token as string).slice(0, 10) + '...' : 'missing'}</p>
                </body>
              </html>
            `);
            this.server?.close();
            if (callbackReject) {
              callbackReject(
                new Error(
                  `Invalid callback parameters - token match: ${token === sessionToken}, has authToken: ${hasAuthToken}`
                )
              );
            }
          }
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      // Find available port
      this.server.listen(0, 'localhost', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          this.callbackPort = port;
          const callbackUrl = `http://localhost:${port}/callback`;
          serverInfo = { port, callbackUrl };
          // Don't resolve yet - wait for callback
        } else if (callbackReject) {
            callbackReject(new Error('Failed to start callback server'));
          }
      });

      this.server.on('error', (err) => {
        if (callbackReject) {
          callbackReject(err);
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.server && callbackReject) {
          this.server.close();
          callbackReject(new Error('Login timeout: Please try again'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Process the callback and exchange token
   */
  private async processCallback(
    sessionToken: string,
    authToken: string
  ): Promise<void> {
    try {
      const clientBaseUrl =
        process.env.APSO_CLIENT_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://app.apso.cloud';

      // Use axios directly for unauthenticated request
      const response = await axios.get<CallbackResponse>(
        `${clientBaseUrl}/api/auth/cli-callback`,
        {
          params: {
            token: sessionToken,
            authToken: authToken,
          },
        }
      );
      
      const callbackData = response.data;

      if (callbackData.success && callbackData.cliToken) {
        // Save config
        configManager.saveConfig({
          token: callbackData.cliToken,
          user: callbackData.user,
          defaultWorkspace: callbackData.workspaces[0]
            ? {
                id: callbackData.workspaces[0].id,
                name: callbackData.workspaces[0].name,
                slug: callbackData.workspaces[0].slug,
              }
            : undefined,
          workspaces: callbackData.workspaces,
        });

        this.log(`✓ Successfully logged in as ${callbackData.user.email}`);
        if (callbackData.workspaces.length > 0) {
          this.log(
            `Default workspace: ${callbackData.workspaces[0].name} (ID: ${callbackData.workspaces[0].id})`
          );
        }
      } else {
        throw new Error('Login failed: Invalid response from server');
      }
    } catch (error: any) {
      if (error instanceof Error) {
        throw new TypeError(`Failed to complete login: ${error.message}`);
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    // Check if already logged in
    if (configManager.isLoggedIn()) {
      const config = configManager.getConfig();
      this.log(
        `Already logged in as ${config?.user?.email || 'unknown'}. Use 'apso auth logout' to log out first.`
      );
      return;
    }

    try {
      this.log('Getting login URL...');
      const { loginUrl, sessionToken } = await this.getLoginUrl();

      this.log('Starting local callback server...');
      
      // Start callback server - it will resolve only after callback is received
      // and we don't rely on the promise executor return value
      let callbackUrl = '';
      const callbackPromise = new Promise<{ port: number; callbackUrl: string }>(
        (resolve, reject) => {
          this.startCallbackServer(sessionToken)
            .then((info) => {
              callbackUrl = info.callbackUrl;
              resolve(info);
            })
            .catch(reject);
        }
      );

      // Update login URL with callback URL
      const loginUrlWithCallback = `${loginUrl}&callbackUrl=${encodeURIComponent(callbackUrl)}`;

      this.log(`Callback server listening on: ${callbackUrl}`);
      this.log('Opening browser for authentication...');
      this.log(`If the browser doesn't open, visit: ${loginUrlWithCallback}`);

      // Open browser
      try {
        await open(loginUrlWithCallback);
      } catch {
        this.log(
          `\nCould not open browser automatically. Please visit:\n${loginUrlWithCallback}\n`
        );
      }

      this.log('\nWaiting for authentication...');
      this.log('Complete the login in your browser, then return here.');

      // Wait for callback to complete (this will resolve when callback is received and processed)
      await callbackPromise;
    } catch (error: any) {
      if (this.server) {
        this.server.close();
      }
      this.error(error.message || 'Login failed');
    }
  }
}

