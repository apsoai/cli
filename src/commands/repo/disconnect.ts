import { Command, Flags, Args } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';

export default class RepoDisconnect extends Command {
  static description = 'Disconnect a GitHub repository from a service';

  static examples = [
    '$ apso repo disconnect my-service',
    '$ apso repo disconnect my-service --force',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    force: Flags.boolean({
      description: 'skip confirmation prompt',
      default: false,
      char: 'f',
    }),
  };

  static args = {
    service: Args.string({
      description: 'service name',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoDisconnect);
    const configManager = new ConfigManager();
    
    // Check if service exists
    if (!configManager.serviceExists(args.service)) {
      console.log(chalk.red(`Service '${args.service}' does not exist`));
      return;
    }
    
    // Check if service has a repository connected
    const repository = configManager.getServiceRepository(args.service);
    if (!repository) {
      console.log(chalk.yellow(`Service '${args.service}' does not have a repository connected`));
      return;
    }
    
    // Confirm disconnection
    if (!flags.force) {
      const shouldDisconnect = await this.confirm(
        `Are you sure you want to disconnect repository ${chalk.bold(repository.url)} from service ${chalk.bold(args.service)}?`
      );
      
      if (!shouldDisconnect) {
        console.log(chalk.yellow('Repository disconnection cancelled'));
        return;
      }
    }
    
    // Disconnect repository
    try {
      configManager.disconnectRepositoryFromService(args.service);
      console.log(chalk.green(`✓ Repository disconnected from service ${chalk.bold(args.service)}`));
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
      } else {
        console.log(chalk.red('An unknown error occurred'));
      }
    }
  }

    try {
      configManager.removeServiceRepository(args.serviceName);
      console.log(chalk.green(`✓ Repository disconnected from service: ${args.serviceName}`));
    } catch (error: any) {
      this.error(`Failed to disconnect repository: ${error.message}`);
    }
  }
}
