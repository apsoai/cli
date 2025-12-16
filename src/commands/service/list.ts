import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

interface WorkspaceService {
  id: number;
  name: string;
  slug: string;
  subdomain: string;
  status: string;
  // eslint-disable-next-line camelcase
  created_at?: string;
}

interface WorkspaceServicesResponse {
  data: WorkspaceService[];
  total?: number;
}

export default class ServiceList extends BaseCommand {
  static description = 'List services in workspace';

  static examples = [
    '$ apso service list',
    '$ apso service list --workspace-id 1',
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
    const { flags } = await this.parse(ServiceList);

    // Check authentication
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    // Get workspace ID
    const workspaceId = this.getWorkspaceId(flags['workspace-id']);

    try {
      const response = await apiClient.get<WorkspaceServicesResponse>(
        '/WorkspaceServices',
        {
          params: {
            s: JSON.stringify({ workspaceId }),
            limit: 100,
          },
        }
      );

      const services = response.data || [];

      if (services.length === 0) {
        this.log('No services found in this workspace.');
        this.log('Run "apso service create" to create a new service.');
        return;
      }

      this.log(`Services (${services.length}):`);
      this.log('');

      services.forEach((service) => {
        this.log(`  ${service.id}. ${service.name}`);
        this.log(`     Slug: ${service.slug}`);
        this.log(`     Subdomain: ${service.subdomain}`);
        this.log(`     Status: ${service.status}`);
        if (service.created_at) {
          const createdAt = new Date(service.created_at);
          this.log(`     Created: ${createdAt.toLocaleDateString()}`);
        }
        this.log('');
      });
    } catch (error: any) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error('Failed to list services');
    }
  }
}

