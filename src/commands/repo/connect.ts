/* eslint-disable camelcase */
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class RepoConnect extends Command {
  static description = 'Connect a GitHub repository to a service';

  static examples = [
    '$ apso repo connect my-service https://github.com/owner/repo',
    '$ apso repo connect my-service owner/repo',
    '$ apso repo connect my-service --interactive',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'interactively select repository from list',
      default: false,
    }),
    branch: Flags.string({
      char: 'b',
      description: 'repository branch to use',
      default: 'main',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'force connection even if service already has a repository',
      default: false,
    }),
  };

  static args = {
    serviceName: Args.string({
      name: 'serviceName',
      required: true,
      description: 'name of the service to connect',
    }),
    repoUrl: Args.string({
      name: 'repoUrl',
      required: false,
      description: 'GitHub repository URL or owner/repo format',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoConnect);
    const configManager = new ConfigManager();


    try {
      // Check authenticationtry {
      // Check authentication directly with token
      const token = await configManager.getGitHubToken();
      if (!token) {
        this.error('Not connected to GitHub. Run `apso github connect` first.');
      }

      const githubClient = new GitHubClient(configManager);

      // Validate token
      const isTokenValid = await githubClient.validateToken();
      if (!isTokenValid) {
        this.error('GitHub token is invalid. Run `apso github connect` to re-authenticate.');
      }

      // Check if service already has a repository
      const existingConfig = configManager.getServiceConfig(args.serviceName);
      if (existingConfig?.repository && !flags.force) {
        const repo = existingConfig.repository;
        console.log(chalk.yellow(`Service '${args.serviceName}' is already connected to ${repo.type} repository: ${repo.owner}/${repo.name}`));
        
        const shouldOverwrite = await this.confirm('Do you want to overwrite this connection?');
        if (!shouldOverwrite) {
          console.log(chalk.gray('Operation cancelled.'));
          return;
        }
      }

      let repositoryInfo: { owner: string; repo: string };

      if (flags.interactive || !args.repoUrl) {
        // Interactive mode - show repository selector
        repositoryInfo = await this.selectRepositoryInteractively(githubClient);
      } else {
        // Parse repository URL/identifier
        const parsed = githubClient.parseRepositoryUrl(args.repoUrl);
        if (!parsed) {
          this.error(
            `Invalid repository format: ${args.repoUrl}\n` +
            'Supported formats:\n' +
            '  • https://github.com/owner/repo\n' +
            '  • https://github.com/owner/repo.git\n' +
            '  • git@github.com:owner/repo.git\n' +
            '  • owner/repo'
          );
        }
        repositoryInfo = parsed;
      }

      // Verify repository access
      console.log(chalk.blue(`🔍 Verifying access to ${repositoryInfo.owner}/${repositoryInfo.repo}...`));
      
      const hasAccess = await githubClient.checkRepositoryAccess(
        repositoryInfo.owner,
        repositoryInfo.repo
      );
      
      if (!hasAccess) {
        this.error(
          `Cannot access repository ${repositoryInfo.owner}/${repositoryInfo.repo}\n` +
          'Please check that:\n' +
          '  • The repository exists\n' +
          '  • You have access to the repository\n' +
          '  • The repository name is spelled correctly'
        );
      }

      // Get repository details
      const repoDetails = await githubClient.getRepository(
        repositoryInfo.owner,
        repositoryInfo.repo
      );

      // Save connection
      const repositoryConfig = {
        type: 'github' as const,
        url: repoDetails.clone_url,
        owner: repositoryInfo.owner,
        name: repositoryInfo.repo,
        branch: flags.branch,
      };

      configManager.setServiceRepository(args.serviceName, repositoryConfig);

      console.log(chalk.green('\n✓ Repository connected successfully!'));
      console.log(chalk.gray(`  Service: ${args.serviceName}`));
      console.log(chalk.gray(`  Repository: ${repositoryInfo.owner}/${repositoryInfo.repo}`));
      console.log(chalk.gray(`  Branch: ${flags.branch}`));
      console.log(chalk.gray(`  Visibility: ${repoDetails.private ? 'Private' : 'Public'}`));
      
      if (repoDetails.description) {
        console.log(chalk.gray(`  Description: ${repoDetails.description}`));
      }

      console.log(chalk.blue('\nNext steps:'));
      console.log('• Run `apso repo list` to see connected repositories');
      console.log(`• Run \`apso service deploy ${args.serviceName}\` to deploy with GitHub integration`);
      
    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        this.error(`GitHub API error: ${error.message}`);
      } else {
        this.error(`Failed to connect repository: ${error.message}`);
      }
    }
  }

  private async selectRepositoryInteractively(githubClient: GitHubClient): Promise<{ owner: string; repo: string }> {
    console.log(chalk.blue('📚 Fetching your repositories...'));
    
    const repositories = await githubClient.listRepositories({
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    });

    if (repositories.length === 0) {
      this.error('No repositories found. Create a repository first with `apso repo create <name>`.');
    }

    const { default: inquirer } = await import('inquirer');
    
    const choices = repositories.map(repo => ({
      name: `${repo.full_name} - ${repo.description || 'No description'} (${repo.private ? 'private' : 'public'})`,
      value: {
        owner: repo.owner.login,
        repo: repo.name,
      },
      short: repo.full_name,
    }));

    const { selectedRepo } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedRepo',
        message: 'Select a repository to connect:',
        choices,
        pageSize: 10,
      },
    ]);

    return selectedRepo;
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
