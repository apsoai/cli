/* eslint-disable valid-jsdoc */
/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */
/**
 * GitHub Authentication Module
 * 
 * This module handles GitHub authentication using OAuth device flow.
 * It implements secure token storage using:
 * - OS keychain as primary storage (macOS Keychain, Windows Credential Manager, Linux libsecret)
 * - Encrypted file storage as fallback (AES-256-GCM encryption)
 * - Automatic token refresh when tokens expire
 */

import fetch from 'node-fetch';
import open from 'open';
import chalk from 'chalk';
import ConfigManager from './config-manager';

/**
 * Response from GitHub device code endpoint
 */
interface DeviceCodeResponse {
  device_code: string;      // Code used for polling
  user_code: string;        // Code shown to user
  verification_uri: string; // URL for user to visit
  expires_in: number;       // Seconds until the device code expires
  interval: number;         // Polling interval in seconds
}

/**
 * Response from GitHub access token endpoint
 */
interface AccessTokenResponse {
  access_token?: string;     // The GitHub access token
  token_type?: string;       // Token type (usually "bearer")
  scope?: string;            // Granted scopes
  expires_in?: number;      // Seconds until token expires
  refresh_token?: string;   // Token used to refresh access without re-auth
  error?: string;           // Error code if request failed
  error_description?: string; // Error description if request failed
}

/**
 * Custom error class for GitHub authentication errors
 */
class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

/**
 * GitHub Authentication Manager
 * 
 * Handles the complete GitHub authentication flow:
 * - OAuth device flow for authentication
 * - Secure token storage (OS keychain with encrypted file fallback)
 * - Token validation and auto-refresh
 */
class GitHubAuth {
  private configManager: ConfigManager;
  private clientId: string;

  /**
   * Creates a new GitHub authentication manager
   * 
   * @param configManager - Configuration manager for storing tokens securely
   * @param clientId - GitHub OAuth app client ID
   */
  constructor(configManager: ConfigManager, clientId = 'Ov23lin8R9IGUWtxMgIi') {
    this.configManager = configManager;
    this.clientId = clientId;
    
    // For demo/development purposes, add support for mock authentication
    if (this.clientId === 'your-github-app-client-id') {
      console.log(chalk.yellow('⚠️  Using placeholder GitHub client ID. For production use:'));
      console.log(chalk.yellow('   1. Register an OAuth app at https://github.com/settings/developers'));
      console.log(chalk.yellow('   2. Set the GITHUB_CLIENT_ID environment variable'));
      console.log(chalk.yellow('   3. Or update the client ID in the code'));
    }
  }

  /**
   * Initiate the GitHub OAuth device flow
   */
  public async authenticate(openBrowser = true): Promise<string> {
    try {
      // For development/demo purposes, use mock authentication if using the placeholder client ID
      if (this.clientId === 'your-github-app-client-id') {
        console.log(chalk.blue('\n🔐 Using Demo Authentication Mode'));
        console.log(chalk.yellow('This is a simulated authentication for development purposes.'));
        
        // Simulate authentication delay
        await new Promise(resolve => {
          setTimeout(resolve, 1500);
        });
        
        // Use a mock token and username
        const mockToken = 'mock_' + Math.random().toString(36).slice(2, 15);
        const mockUsername = 'demo_user';
        
        // Save the mock token and user info
        this.configManager.setGitHubToken(mockToken, mockUsername);
        
        console.log(chalk.green(`\n✓ Successfully authenticated as ${chalk.bold(mockUsername)} (DEMO MODE)`));
        console.log(chalk.yellow('Note: This is a simulated connection and will not access real GitHub APIs.'));
        
        return mockToken;
      }
      
      // Normal OAuth flow for production use
      // Step 1: Request device and user verification codes
      const deviceCode = await this.requestDeviceCode();
      
      // Step 2: Display user code and open browser
      console.log(chalk.blue('\n🔐 GitHub Authentication Required'));
      console.log(chalk.yellow(`\nPlease visit: ${deviceCode.verification_uri}`));
      console.log(chalk.yellow(`Enter user code: ${chalk.bold(deviceCode.user_code)}`));
      
      if (openBrowser) {
        console.log(chalk.gray('\nOpening browser...'));
        try {
          await open(deviceCode.verification_uri);
        } catch {
          console.log(chalk.yellow('Could not open browser automatically. Please visit the URL manually.'));
        }
      }
      
      console.log(chalk.gray('\nWaiting for authentication...'));
      
      // Step 3: Poll for access token
      const tokenResponse = await this.pollForAccessToken(deviceCode);
      const accessToken = tokenResponse.access_token;
      
      // Check if accessToken is defined
      if (!accessToken) {
        throw new GitHubAuthError('Failed to obtain access token');
      }
      
      // Step 4: Get user information and save configuration
      const userInfo = await this.getUserInfo(accessToken);
      
      // Calculate expiry time if provided in the response
      let expiresAt: Date | undefined;
      if (tokenResponse.expires_in) {
        expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokenResponse.expires_in);
      }
      
      // Save the token and user info
      await this.configManager.setGitHubToken(
        accessToken, 
        userInfo.login, 
        expiresAt, 
        tokenResponse.refresh_token
      );
      
      console.log(chalk.green(`\n✓ Successfully authenticated as ${chalk.bold(userInfo.login)}`));
      
      return accessToken;
    } catch (error: any) {
      if (error instanceof GitHubAuthError) {
        throw error;
      }
      throw new GitHubAuthError(`Authentication failed: ${error.message || String(error)}`);
    }
  }

  /**
   * Request device and user verification codes from GitHub
   */
  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'apso-cli',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        scope: 'repo user:email',
      }),
    });

    if (!response.ok) {
      throw new GitHubAuthError(`Failed to request device code: ${response.statusText}`);
    }

    const data = await response.json() as DeviceCodeResponse;
    
    if (!data.device_code || !data.user_code) {
      throw new GitHubAuthError('Invalid response from GitHub device code endpoint');
    }

    return data;
  }

  /**
   * Poll GitHub for access token after user authorization.
   * @param deviceCode - The device code response from GitHub's device flow.
   * @returns A promise that resolves to the access token response.
   */
  private async pollForAccessToken(deviceCode: DeviceCodeResponse): Promise<AccessTokenResponse> {
    const startTime = Date.now();
    const expiresInMs = deviceCode.expires_in * 1000;
    const intervalMs = deviceCode.interval * 1000;

    while (Date.now() - startTime < expiresInMs) {
      await this.sleep(intervalMs);

      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'apso-cli',
          },
          body: JSON.stringify({
            client_id: this.clientId,
            device_code: deviceCode.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        const data = await response.json() as AccessTokenResponse;

        if (data.access_token) {
          return data;
        }

        if (data.error === 'authorization_pending') {
          continue;
        }

        if (data.error === 'slow_down') {
          await this.sleep(intervalMs);
          continue;
        }

        if (data.error === 'expired_token') {
          throw new GitHubAuthError('Device code expired. Please try again.');
        }

        if (data.error === 'access_denied') {
          throw new GitHubAuthError('Access denied by user.');
        }

        throw new GitHubAuthError(`OAuth error: ${data.error_description || data.error}`);
      } catch {
        // Network errors - continue polling
        console.log(chalk.gray('.'));
      }
    }

    throw new GitHubAuthError('Authentication timed out. Please try again.');
  }

  /**
   * Get user information using access token
   */
  private async getUserInfo(accessToken: string): Promise<{ login: string; name: string | null; email: string | null }> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${accessToken}`,
        'User-Agent': 'apso-cli',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new GitHubAuthError(`Failed to get user info: ${response.statusText}`);
    }

    const userInfo: any = await response.json();
    
    return {
      login: userInfo.login,
      name: userInfo.name,
      email: userInfo.email,
    };
  }

  /**
   * Validate existing token and auto-refresh if expired
   */
  public async validateToken(token: string, autoRefresh = true): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'apso-cli',
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      // If token is valid, return true
      if (response.ok) {
        return true;
      }
      
      // If auto-refresh is enabled and token is expired (401), try to refresh
      if (autoRefresh && response.status === 401) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          console.log(chalk.green('✓ GitHub token automatically refreshed'));
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = await this.configManager.getGitHubRefreshToken();
      if (!refreshToken) {
        return false;
      }
      
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'apso-cli',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      const data = await response.json() as AccessTokenResponse;
      
      if (data.access_token) {
        // Calculate expiry time if provided
        let expiresAt: Date | undefined;
        if (data.expires_in) {
          expiresAt = new Date();
          expiresAt.setSeconds(expiresAt.getSeconds() + data.expires_in);
        }
        
        // Get user info to confirm token works
        const userInfo = await this.getUserInfo(data.access_token);
        
        // Save the new token
        await this.configManager.setGitHubToken(
          data.access_token, 
          userInfo.login, 
          expiresAt, 
          data.refresh_token
        );
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn('Token refresh failed:', error);
      return false;
    }
  }

  /**
   * Check if user is currently authenticated
   */
  public isAuthenticated(): boolean {
    const config = this.configManager.getGitHubConfig();
    return Boolean(config?.connected && config.token_encrypted && !this.configManager.isGitHubTokenExpired());
  }

  /**
   * Get current authentication status
   */
  public getAuthStatus(): {
    authenticated: boolean;
    username?: string;
    tokenExpired?: boolean;
  } {
    const config = this.configManager.getGitHubConfig();
    
    if (!config?.connected || !config.token_encrypted) {
      return { authenticated: false };
    }

    const tokenExpired = this.configManager.isGitHubTokenExpired();
    
    return {
      authenticated: !tokenExpired,
      username: config.username,
      tokenExpired,
    };
  }

  /**
   * Clear authentication
   */
  public async disconnect(): Promise<void> {
    await this.configManager.clearGitHubConfig();
  }

  /**
   * Manual token setup (for CI/CD or manual configuration)
   */
  public async setManualToken(token: string): Promise<void> {
    // For demo purposes, accept a special token format
    if (token === 'demo_token_123') {
      console.log(chalk.yellow('Using demo mode with mock GitHub account'));
      this.configManager.setGitHubToken(token, 'demo_user');
      return;
    }
    
    // Validate the token first
    const isValid = await this.validateToken(token);
    if (!isValid) {
      throw new GitHubAuthError('Invalid GitHub token provided');
    }

    // Get user info
    const userInfo = await this.getUserInfo(token);
    
    // Save configuration
    this.configManager.setGitHubToken(token, userInfo.login);
    
    console.log(chalk.green(`✓ GitHub token configured for user: ${userInfo.login}`));
  }

  /**
   * Utility method to sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }
}

export default GitHubAuth;
export { GitHubAuthError };