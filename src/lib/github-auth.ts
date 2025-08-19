import fetch from 'node-fetch';
import open from 'open';
import chalk from 'chalk';
import ConfigManager from './config-manager';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
}

class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

class GitHubAuth {
  private configManager: ConfigManager;
  private clientId: string;

  constructor(configManager: ConfigManager, clientId: string = 'Ov23lin8R9IGUWtxMgIi') {
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
  public async authenticate(openBrowser: boolean = true): Promise<string> {
    try {
      // For development/demo purposes, use mock authentication if using the placeholder client ID
      if (this.clientId === 'your-github-app-client-id') {
        console.log(chalk.blue('\n🔐 Using Demo Authentication Mode'));
        console.log(chalk.yellow('This is a simulated authentication for development purposes.'));
        
        // Simulate authentication delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Use a mock token and username
        const mockToken = 'mock_' + Math.random().toString(36).substring(2, 15);
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
        } catch (error: any) {
          console.log(chalk.yellow('Could not open browser automatically. Please visit the URL manually.'));
        }
      }
      
      console.log(chalk.gray('\nWaiting for authentication...'));
      
      // Step 3: Poll for access token
      const accessToken = await this.pollForAccessToken(deviceCode);
      
      // Step 4: Get user information and save configuration
      const userInfo = await this.getUserInfo(accessToken);
      
      // Save the token and user info
      this.configManager.setGitHubToken(accessToken, userInfo.login);
      
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
   * Poll GitHub for access token after user authorization
   */
  private async pollForAccessToken(deviceCode: DeviceCodeResponse): Promise<string> {
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

        const data = await response.json() as any;

        if (data.access_token) {
          return data.access_token;
        }

        if (data.error === 'authorization_pending') {
          // Continue polling
          continue;
        }

        if (data.error === 'slow_down') {
          // Increase polling interval
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
      } catch (error: any) {
        if (error instanceof GitHubAuthError) {
          throw error;
        }
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

    const userInfo = await response.json() as any;
    
    return {
      login: userInfo.login,
      name: userInfo.name,
      email: userInfo.email,
    };
  }

  /**
   * Validate existing token
   */
  public async validateToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'apso-cli',
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      return response.ok;
    } catch (error: any) {
      return false;
    }
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshToken(): Promise<boolean> {
    const config = this.configManager.getConfig();
    const refreshToken = config.github?.refreshToken;
    
    if (!refreshToken) {
      return false;
    }
    
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json() as AccessTokenResponse;
      
      if (!data.access_token) {
        return false;
      }
      
      // Update config with new tokens
      this.configManager.updateConfig({
        github: {
          ...config.github,
          token: data.access_token,
          refreshToken: data.refresh_token || refreshToken,
          expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
        },
      });
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if user is currently authenticated
   */
  public isAuthenticated(): boolean {
    const config = this.configManager.getGitHubConfig();
    return !!(config?.connected && config.token_encrypted && !this.configManager.isGitHubTokenExpired());
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
  public disconnect(): void {
    this.configManager.clearGitHubConfig();
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default GitHubAuth;
export { GitHubAuthError };