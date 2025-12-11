import BaseCommand from '../../lib/base-command';
import { configManager } from '../../lib/config';

export default class Whoami extends BaseCommand {
  static description = 'Display current user information';

  static examples = ['$ apso auth whoami'];

  async run(): Promise<void> {
    const config = configManager.getConfig();

    if (!config || !config.token) {
      this.log('Not logged in. Run "apso auth login" to authenticate.');
      return;
    }

    if (config.user) {
      this.log(`Logged in as: ${config.user.email}`);
      if (config.user.fullName) {
        this.log(`Name: ${config.user.fullName}`);
      }
      this.log(`User ID: ${config.user.id}`);
    }

    if (config.defaultWorkspace) {
      this.log(`\nDefault workspace: ${config.defaultWorkspace.name} (ID: ${config.defaultWorkspace.id})`);
    }

    if (config.workspaces && config.workspaces.length > 0) {
      this.log(`\nWorkspaces (${config.workspaces.length}):`);
      config.workspaces.forEach((workspace) => {
        const isDefault =
          workspace.id === config.defaultWorkspace?.id ? ' (default)' : '';
        this.log(`  - ${workspace.name} (ID: ${workspace.id})${isDefault}`);
      });
    }

    if (config.lastUpdated) {
      const lastUpdated = new Date(config.lastUpdated);
      this.log(`\nLast updated: ${lastUpdated.toLocaleString()}`);
    }
  }
}

