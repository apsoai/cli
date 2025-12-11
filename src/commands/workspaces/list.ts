import BaseCommand from '../../lib/base-command';
import { configManager } from '../../lib/config';

export default class WorkspacesList extends BaseCommand {
  static description = "List user's workspaces";

  static examples = ['$ apso workspaces list'];

  async run(): Promise<void> {
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    const config = configManager.getConfig();

    if (!config || !config.workspaces || config.workspaces.length === 0) {
      this.log('No workspaces found.');
      this.log('Workspaces will be available after login.');
      return;
    }

    this.log(`Workspaces (${config.workspaces.length}):`);
    this.log('');

    config.workspaces.forEach((workspace) => {
      const isDefault =
        workspace.id === config.defaultWorkspace?.id ? ' (default)' : '';
      this.log(`  ${workspace.id}. ${workspace.name}${isDefault}`);
      if (workspace.slug) {
        this.log(`     Slug: ${workspace.slug}`);
      }
      this.log('');
    });

    if (config.defaultWorkspace) {
      this.log(`Default workspace: ${config.defaultWorkspace.name} (ID: ${config.defaultWorkspace.id})`);
    }
  }
}

