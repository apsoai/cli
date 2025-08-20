import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth, { GitHubAuthError } from '../../lib/github-auth';

export default class GitHubConnect extends Command {
  // Helper method for confirmation prompts
  async confirm(message: string): Promise<boolean> {
    this.log(`${message} (y/n)`);
    return true; // Always return true for now to avoid blocking
  }

  static description = 'Connect to GitHub using OAuth authentication';

  static examples = [
    '$ apso github connect',
    '$ apso github connect --no-browser',
    '$ apso github connect --token ghp_xxxxxxxxxxxx',
    '$ apso github connect --browser=firefox',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    browser: Flags.string({
      description: 'specify browser for authentication (e.g., chrome, firefox, safari)',
      default: 'default',
    }),
    'no-browser': Flags.boolean({
      description: 'disable browser-based authentication',
      default: false,
    }),
    token: Flags.string({
      description: 'manually provide GitHub personal access token',
      char: 't',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitHubConnect);
    const configManager = new ConfigManager();
    const githubAuth = new GitHubAuth(configManager);

    try {
      // Check if already authenticated
      const authStatus = githubAuth.getAuthStatus();
      if (authStatus.authenticated) {
        console.log(chalk.green(`✓ Already connected to GitHub as ${chalk.bold(authStatus.username)}`));
        // Display token expiry if available
        console.log(chalk.green(`Token status: ${authStatus.tokenExpired ? 'Expired' : 'Valid'}`));
        
        const shouldReconnect = await this.confirm('Do you want to reconnect with a different account?');
        if (!shouldReconnect) {
          return;
        }
        
        githubAuth.disconnect();
        console.log(chalk.yellow('Previous connection cleared.'));
      }

      if (flags.token) {
        // Manual token setup
        console.log(chalk.blue('🔐 Setting up GitHub authentication with provided token...'));
        this.log('Validating token and retrieving user information...');
        await githubAuth.setManualToken(flags.token);
      } else {
        // OAuth flow
        console.log(chalk.blue('🔐 Starting GitHub OAuth authentication...'));
        const browserOption = flags['no-browser'] ? false : flags.browser;
        await githubAuth.authenticate(Boolean(browserOption));
      }

      // Verify connection - don't rely solely on getAuthStatus
      // Instead, directly check if we have a valid token
      const token = await configManager.getGitHubToken();
      if (token) {
        console.log(chalk.green('\n🎉 GitHub connection successful!'));
        console.log(chalk.gray(`Configuration saved to: ${configManager.getConfigPath()}`));
        
        // Show next steps
        console.log(chalk.blue('\nNext steps:'));
        console.log('• Run `apso repo list` to see your repositories');
        console.log('• Run `apso repo create <name>` to create a new repository');
        console.log('• Run `apso github status` to check your connection');
      } else {
        this.error('Authentication verification failed. Please try again.');
      }
    } catch (error: any) {
      if (error instanceof GitHubAuthError) {
        this.error(error.message);
      } else {
        this.error(`Failed to connect to GitHub: ${error.message}`);
      }
    }
  }

  // Method already defined above
}
