import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';

export default class WorkspacesSetDefault extends BaseCommand {
  static description = 'Set default workspace';

  static examples = [
    '$ apso workspaces set-default --workspace-id 1',
    '$ apso workspaces set-default -w 1',
  ];

  static flags = {
    'workspace-id': Flags.integer({
      char: 'w',
      required: true,
      description: 'Workspace ID to set as default',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspacesSetDefault);

    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    const config = configManager.getConfig();

    if (!config || !config.workspaces) {
      this.error('No workspaces found. Please log in again.');
    }

    // Find the workspace
    const workspace = config.workspaces.find(
      (w) => w.id === flags['workspace-id']
    );

    if (!workspace) {
      this.error(
        `Workspace with ID ${flags['workspace-id']} not found in your workspaces.`
      );
    }

    // Update config
    configManager.updateConfig({
      defaultWorkspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
    });

    this.log(
      `✓ Default workspace set to: ${workspace.name} (ID: ${workspace.id})`
    );
  }
}

