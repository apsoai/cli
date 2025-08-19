import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';

export default class GitHubDisconnect extends Command {
  static description = 'Disconnect from GitHub and remove stored credentials';

  static examples = [
    '$ apso github disconnect',
    '$ apso github disconnect --force',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    force: Flags.boolean({
      char: 'f',
      description: 'disconnect without confirmation',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitHubDisconnect);
    const configManager = new ConfigManager();
    const githubAuth = new GitHubAuth(configManager);

    try {
      // Check if currently connected
      const authStatus = githubAuth.getAuthStatus();
      
      if (!authStatus.authenticated) {
        console.log(chalk.yellow('ℹ No GitHub connection found.'));
        return;
      }

      console.log(chalk.blue(`Current GitHub connection: ${chalk.bold(authStatus.username)}`));

      // Confirm disconnection unless forced
      if (!flags.force) {
        const shouldDisconnect = await this.confirm(
          'Are you sure you want to disconnect from GitHub? This will remove your stored credentials.'
        );
        
        if (!shouldDisconnect) {
          console.log(chalk.gray('Operation cancelled.'));
          return;
        }
      }

      // Show what will be affected
      const servicesWithRepos = configManager.listServicesWithRepositories();
      const githubServices = servicesWithRepos.filter(s => s.repository.type === 'github');
      
      if (githubServices.length > 0) {
        console.log(chalk.yellow('\nThe following services are connected to GitHub repositories:'));
        githubServices.forEach(({ service, repository }) => {
          console.log(chalk.gray(`  • ${service} → ${repository.owner}/${repository.name}`));
        });
        console.log(chalk.yellow('\nThese connections will remain, but you will need to re-authenticate to manage them.'));
      }

      // Disconnect
      githubAuth.disconnect();
      
      console.log(chalk.green('\n✓ Successfully disconnected from GitHub'));
      console.log(chalk.gray('Your GitHub credentials have been removed from the local configuration.'));
      
      // Show reconnection info
      console.log(chalk.blue('\nTo reconnect:'));
      console.log('• Run `apso github connect` to authenticate again');
      
    } catch (error: any) {
      this.error(`Failed to disconnect from GitHub: ${error.message}`);
    }
  }

  private async confirm(message: string): Promise<boolean> {
    const { default: inquirer } = await import('inquirer');
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message,
        default: false,
      },
    ]);
    return confirmed;
  }
}
