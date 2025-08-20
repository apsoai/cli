import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';

export default class RepoDisconnect extends Command {
  static description = 'Disconnect a GitHub repository from a service';

  static examples = [
    '$ apso repo disconnect my-service',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
  };

  static args = {
    serviceName: Args.string({
      name: 'serviceName',
      required: true,
      description: 'name of the service to disconnect',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(RepoDisconnect);
    const configManager = new ConfigManager();

    try {
      configManager.removeServiceRepository(args.serviceName);
      console.log(chalk.green(`✓ Repository disconnected from service: ${args.serviceName}`));
    } catch (error: any) {
      this.error(`Failed to disconnect repository: ${error.message}`);
    }
  }
}
