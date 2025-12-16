import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';
import { apiClient } from '../../lib/api-client';
import open from 'open';

interface ConnectGithubResponse {
  url: string;
  message: string;
}

interface GithubConnectionStatus {
  connectionId: number;
  connected: boolean;
  // eslint-disable-next-line camelcase
  github_username?: string;
  scopes?: string[];
  // eslint-disable-next-line camelcase
  token_expires_at?: string;
}

interface WorkspaceGithubConnectionStatusResponse {
  success: boolean;
  connectionStatuses: GithubConnectionStatus[];
}

export default class GithubConnect extends BaseCommand {
  static description = 'Connect GitHub account to your workspace';

  static examples = [
    '$ apso github connect',
    '$ apso github connect --workspace-id 1',
  ];

  static flags = {
    'workspace-id': Flags.integer({
      char: 'w',
      description: 'Workspace ID (optional, uses default if not specified)',
    }),
  };

  /**
   * Get workspace ID from flags or config
   */
  private getWorkspaceId(workspaceId?: number): number {
    if (workspaceId) {
      return workspaceId;
    }

    const defaultWorkspaceId = configManager.getDefaultWorkspaceId();
    if (!defaultWorkspaceId) {
      this.error(
        'No workspace specified. Use --workspace-id or set a default workspace.'
      );
    }

    return defaultWorkspaceId;
  }

  /**
   * Poll for GitHub connection status
   */
  private async pollForConnection(
    workspaceId: number,
    maxAttempts = 30
  ): Promise<GithubConnectionStatus> {
    const initialCount = await this.getConnectionCount(workspaceId);

    for (let i = 0; i < maxAttempts; i++) {
      // eslint-disable-next-line no-await-in-loop
      await this.sleep(2000); // Wait 2 seconds between polls

      // eslint-disable-next-line no-await-in-loop
      const response = await apiClient.get<WorkspaceGithubConnectionStatusResponse>(
        `/github-connections/workspace/${workspaceId}/statuses`
      );

      const { connectionStatuses } = response;

      // Check if a new connection was added
      if (connectionStatuses.length > initialCount) {
        // Return the newest connection (assuming it's the last one)
        const newConnections = connectionStatuses.slice(initialCount);
        const connected = newConnections.find((c) => c.connected);
        if (connected) {
          return connected;
        }
      }

      // Also check if any existing connection became connected
      const newlyConnected = connectionStatuses.find(
        (c) => c.connected && (!c.github_username || i > 5)
      );
      if (newlyConnected) {
        return newlyConnected;
      }
    }

    throw new Error('GitHub connection timeout: Authorization not completed');
  }

  /**
   * Get current connection count
   */
  private async getConnectionCount(workspaceId: number): Promise<number> {
    try {
      const response = await apiClient.get<WorkspaceGithubConnectionStatusResponse>(
        `/github-connections/workspace/${workspaceId}/statuses`
      );
      return response.connectionStatuses?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(GithubConnect);

    // Check authentication
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    // Get workspace ID
    const workspaceId = this.getWorkspaceId(flags['workspace-id']);

    try {
      // Get GitHub OAuth URL
      this.log('Getting GitHub authorization URL...');
      const redirectUrl =
        process.env.APSO_CLIENT_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://app.apso.cloud';

      const response = await apiClient.get<ConnectGithubResponse>(
        `/github-connections/connect/${workspaceId}`,
        {
          params: {
            redirectUrl: `${redirectUrl}/api/github-connections/callback`,
          },
        }
      );

      // Open browser
      this.log('Opening browser for GitHub authorization...');
      this.log(`If the browser doesn't open, visit: ${response.url}`);

      try {
        await open(response.url);
      } catch {
        this.log(`\nCould not open browser automatically. Please visit:\n${response.url}\n`);
      }

      // Poll for connection
      this.log('\nWaiting for GitHub authorization...');
      this.log('Complete the authorization in your browser, then return here.');

      const connection = await this.pollForConnection(workspaceId);

      if (connection.connected && connection.github_username) {
        this.log(
          `✓ Successfully connected GitHub account: ${connection.github_username}`
        );
        if (connection.connectionId) {
          this.log(`Connection ID: ${connection.connectionId}`);
        }
      } else {
        this.error('GitHub connection completed but status is unclear.');
      }
    } catch (error: any) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error('Failed to connect GitHub account');
    }
  }
}

