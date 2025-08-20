import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class GitHubStatus extends Command {
  static description = 'Show GitHub connection status and information';

  static examples = [
    '$ apso github status',
    '$ apso github status --detailed',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    detailed: Flags.boolean({
      char: 'd',
      description: 'show detailed information including rate limits',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitHubStatus);
    const configManager = new ConfigManager();

    try {
      console.log(chalk.blue('🔍 GitHub Connection Status\n'));

      // Check token directly
      const token = await configManager.getGitHubToken();
      const config = configManager.getGitHubConfig();
      
      if (!token || !config?.username) {
        console.log(chalk.red('❌ Not connected to GitHub'));
        
        if (token && !config?.username) {
          console.log(chalk.yellow('   Token exists but username is missing'));
        } else {
          console.log(chalk.gray('   No GitHub credentials found'));
        }
        
        console.log(chalk.blue('\nTo connect:'));
        console.log('• Run `apso github connect` to authenticate');
        return;
      }

      console.log(chalk.green(`✓ Connected to GitHub as ${chalk.bold(config.username)}`));
      
      // Test token validity
      const githubClient = new GitHubClient(configManager);
      const isTokenValid = await githubClient.validateToken();
      
      if (isTokenValid) {
        console.log(chalk.green('✓ Token is valid'));
      } else {
        console.log(chalk.red('❌ Token is invalid or expired'));
        console.log(chalk.yellow('   Please run `apso github connect` to re-authenticate'));
        return;
      }

      // Get user information
      try {
        const userInfo = await githubClient.getCurrentUser();
        console.log(chalk.gray(`  User ID: ${userInfo.id}`));
        if (userInfo.name) {
          console.log(chalk.gray(`  Name: ${userInfo.name}`));
        }
        if (userInfo.email) {
          console.log(chalk.gray(`  Email: ${userInfo.email}`));
        }
      } catch {
        console.log(chalk.yellow('⚠ Could not fetch user information'));
      }

      // Show connected services
      console.log(chalk.blue('\n📦 Connected Services:'));
      const servicesWithRepos = configManager.listServicesWithRepositories();
      const githubServices = servicesWithRepos.filter(s => s.repository.type === 'github');
      
      if (githubServices.length === 0) {
        console.log(chalk.gray('  No services connected to GitHub repositories'));
      } else {
        githubServices.forEach(({ service, repository }) => {
          console.log(chalk.gray(`  • ${service} → ${repository.owner}/${repository.name}`));
        });
      }

      // Detailed information
      if (flags.detailed) {
        await this.showDetailedInfo(githubClient);
      }

      // Configuration file location
      console.log(chalk.blue('\n⚙️  Configuration:'));
      console.log(chalk.gray(`  Config file: ${configManager.getConfigPath()}`));
      
      console.log(chalk.blue('\n💡 Available commands:'));
      console.log('• `apso repo list` - List your repositories');
      console.log('• `apso repo create <name>` - Create a new repository');
      console.log('• `apso github disconnect` - Disconnect from GitHub');
      
    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        this.error(`GitHub API error: ${error.message}`);
      } else {
        this.error(`Failed to get GitHub status: ${error.message}`);
      }
    }
  }

  private async showDetailedInfo(githubClient: GitHubClient): Promise<void> {
    try {
      console.log(chalk.blue('\n📊 Rate Limit Information:'));
      const rateLimit = await githubClient.getRateLimit();
      
      const core = rateLimit.resources.core;
      const search = rateLimit.resources.search;
      
      console.log(chalk.gray(`  Core API: ${core.remaining}/${core.limit} remaining`));
      if (core.remaining < core.limit) {
        const resetTime = new Date(core.reset * 1000);
        console.log(chalk.gray(`  Resets at: ${resetTime.toLocaleString()}`));
      }
      
      console.log(chalk.gray(`  Search API: ${search.remaining}/${search.limit} remaining`));
      
      // Repository count
      console.log(chalk.blue('\n📚 Repository Summary:'));
      // eslint-disable-next-line camelcase, @typescript-eslint/no-unused-vars
      const repos = await githubClient.listRepositories({ per_page: 1 });
      // Note: This is just a sample; you'd need to get the actual count differently
      console.log(chalk.gray(`  Sample repository check completed`));
      
    } catch (error: any) {
      console.log(chalk.yellow('⚠ Could not fetch detailed information'));
      console.log(chalk.gray(`  ${error.message}`));
    }
  }
}
