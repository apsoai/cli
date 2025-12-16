import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';
import { apiClient } from '../../lib/api-client';
import * as fs from 'fs';
import * as path from 'path';

interface CreateServiceResponse {
  id: number;
  name: string;
  slug: string;
  subdomain: string;
}

export default class ServiceCreate extends BaseCommand {
  static description = 'Create a new service from local project';

  static examples = [
    '$ apso service create --name my-service',
    '$ apso service create --name my-service --workspace-id 1',
  ];

  static flags = {
    name: Flags.string({
      char: 'n',
      required: true,
      description: 'Service name',
    }),
    'workspace-id': Flags.integer({
      char: 'w',
      description: 'Workspace ID (optional, uses default if not specified)',
    }),
    'github-account': Flags.integer({
      char: 'g',
      description: 'GitHub connection ID (optional)',
    }),
    'repo-name': Flags.string({
      char: 'r',
      description: 'Repository name (creates new repo)',
    }),
    'repo-url': Flags.string({
      description: 'Existing repository URL',
    }),
    branch: Flags.string({
      char: 'b',
      default: 'main',
      description: 'Branch name (default: main)',
    }),
    push: Flags.boolean({
      char: 'p',
      default: false,
      description: 'Push local code after creation',
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
   * Read .apsorc file from current directory
   */
  private readApsorc(): any {
    const apsorcPath = path.join(process.cwd(), '.apsorc');
    if (!fs.existsSync(apsorcPath)) {
      this.warn('No .apsorc file found in current directory.');
      this.warn('Creating service without schema. You can add schema later.');
      return null;
    }

    try {
      const apsorcContent = fs.readFileSync(apsorcPath);
      return JSON.parse(apsorcContent.toString('utf8'));
    } catch (error) {
      this.error(`Failed to read .apsorc file: ${(error as Error).message}`);
    }
  }

  /**
   * Generate subdomain from service name
   */
  private generateSubdomain(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\da-z]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ServiceCreate);

    // Check authentication
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    // Get workspace ID
    const workspaceId = this.getWorkspaceId(flags['workspace-id']);

    try {
      // Read .apsorc if exists
      const apsorc = this.readApsorc();

      // Generate subdomain
      const subdomain = this.generateSubdomain(flags.name);

      this.log(`Creating service: ${flags.name}...`);

      // Create service
      const serviceResponse = await apiClient.post<CreateServiceResponse>(
        '/WorkspaceServices',
        {
          name: flags.name,
          subdomain: subdomain,
          workspaceId: workspaceId,
          apsorc: apsorc || {},
          status: 'Draft',
          tags: [],
          pricingPlanId: 1, // Default plan
          // eslint-disable-next-line camelcase
          repository_source: 'github',
          // eslint-disable-next-line camelcase
          infrastructure_details: {},
        }
      );

      const service = serviceResponse;

      this.log(`✓ Service created: ${service.name} (ID: ${service.id})`);
      this.log(`  Slug: ${service.slug}`);
      this.log(`  Subdomain: ${service.subdomain}`);

      // Handle GitHub repository connection if requested
      const wantsRepoConnection = Boolean(flags['repo-name'] || flags['repo-url']);
      const hasGithubAccount = Boolean(flags['github-account']);
      if (wantsRepoConnection && !hasGithubAccount) {
        this.warn(
          'GitHub account not specified. Skipping repository connection.'
        );
      } else if (wantsRepoConnection && hasGithubAccount) {
        // Repository creation/connection will be implemented in the future
        this.log('Repository connection not yet implemented in CLI.');
      }

      // Handle push if requested
      if (flags.push) {
        this.log('\nPush functionality will be available via "apso service push"');
        this.log(`Run: apso service push --service-id ${service.id}`);
      }
    } catch (error: any) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error('Failed to create service');
    }
  }
}

