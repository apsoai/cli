import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

interface GithubConnectionStatus {
  connectionId: number;
  connected: boolean;
  github_username?: string;
  scopes?: string[];
  token_expires_at?: string;
}

interface WorkspaceGithubConnectionStatusResponse {
  success: boolean;
  connectionStatuses: GithubConnectionStatus[];
}

export default class GithubList extends BaseCommand {
  static description = 'List connected GitHub accounts';

  static examples = [
    '$ apso github list',
    '$ apso github list --workspace-id 1',
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

  async run(): Promise<void> {
    const { flags } = await this.parse(GithubList);

    // Check authentication
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    // Get workspace ID
    const workspaceId = this.getWorkspaceId(flags['workspace-id']);

    try {
      const response = await apiClient.get<WorkspaceGithubConnectionStatusResponse>(
        `/github-connections/workspace/${workspaceId}/statuses`
      );

      const { connectionStatuses } = response;

      if (connectionStatuses.length === 0) {
        this.log('No GitHub accounts connected.');
        this.log('Run "apso github connect" to connect a GitHub account.');
        return;
      }

      this.log(`Connected GitHub Accounts (${connectionStatuses.length}):`);
      this.log('');

      connectionStatuses.forEach((connection, index) => {
        const status = connection.connected ? '✓' : '✗';
        const username = connection.github_username || 'Unknown';
        this.log(
          `  ${index + 1}. ${status} ${username} (ID: ${connection.connectionId})`
        );

        if (connection.scopes && connection.scopes.length > 0) {
          this.log(`     Scopes: ${connection.scopes.join(', ')}`);
        }

        if (connection.token_expires_at) {
          const expiresAt = new Date(connection.token_expires_at);
          this.log(`     Token expires: ${expiresAt.toLocaleString()}`);
        }

        this.log('');
      });
    } catch (error: any) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error('Failed to list GitHub connections');
    }
  }
}

