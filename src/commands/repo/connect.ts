import { Command, Flags, Args } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class RepoConnect extends Command {
  static description = 'Connect a GitHub repository to a service';

  static examples = [
    '$ apso repo connect my-service https://github.com/user/repo',
    '$ apso repo connect my-service user/repo',
    '$ apso repo connect my-service user/repo --no-validate',
  ];

  static args = {
    service: Args.string({
      description: 'service name',
      required: true,
    }),
    repo: Args.string({
      description: 'GitHub repository URL or owner/repo shorthand',
      required: true,
    }),
  };

  static flags = {
    help: Flags.help({ char: 'h' }),
    validate: Flags.boolean({
      description: 'validate repository access before connecting',
      default: true,
      allowNo: true,
    }),
    force: Flags.boolean({
      description: 'skip confirmation prompt',
      default: false,
      char: 'f',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoConnect);
    const configManager = new ConfigManager();
    const githubAuth = new GitHubAuth(configManager);
    
    // Check if authenticated
    const authStatus = githubAuth.getAuthStatus();
    if (!authStatus.authenticated) {
      console.log(chalk.red('✗ Not connected to GitHub'));
      console.log(chalk.yellow('Run `apso github connect` to authenticate with GitHub'));
      return;
    }
    
    try {
      const githubClient = new GitHubClient(configManager);
      
      // Parse repository URL or shorthand
      let owner: string;
      let repo: string;
      let repoUrl: string;
      
      if (args.repo.includes('github.com')) {
        // Parse URL
        const url = new URL(args.repo);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
          throw new Error('Invalid GitHub repository URL');
        }
        owner = parts[0];
        repo = parts[1];
        repoUrl = args.repo;
      } else if (args.repo.includes('/')) {
        // Parse owner/repo format
        const parts = args.repo.split('/');
        if (parts.length !== 2) {
          throw new Error('Invalid repository format. Use owner/repo');
        }
        owner = parts[0];
        repo = parts[1];
        repoUrl = `https://github.com/${owner}/${repo}`;
      } else {
        throw new Error('Invalid repository format. Use URL or owner/repo');
      }
      
      // Check if service exists
      if (!configManager.serviceExists(args.service)) {
        console.log(chalk.red(`Service '${args.service}' does not exist`));
        console.log(chalk.yellow('Create the service first with `apso service create`'));
        return;
      }
      
      // Check if service already has a repository
      const existingRepo = configManager.getServiceRepository(args.service);
      if (existingRepo) {
        if (!flags.force) {
          console.log(chalk.yellow(`Service '${args.service}' is already connected to repository:`));
          console.log(chalk.yellow(`  ${existingRepo.url}`));
          
          const shouldReconnect = await this.confirm('Do you want to replace this connection?');
          if (!shouldReconnect) {
            return;
          }
        }
        console.log(chalk.yellow('Removing existing repository connection...'));
      }
      
      // Validate repository access if requested
      if (flags.validate) {
        console.log(chalk.blue('Validating repository access...'));
        try {
          const repository = await githubClient.getRepository(owner, repo);
          
          // Show repository details
          console.log(chalk.green('Repository details:'));
          console.log(`  Name: ${repository.full_name}`);
          console.log(`  Visibility: ${repository.private ? 'Private' : 'Public'}`);
          console.log(`  URL: ${repository.html_url}`);
          
          if (!flags.force) {
            const shouldConnect = await this.confirm('Connect this repository to the service?');
            if (!shouldConnect) {
              return;
            }
          }
          
          // Connect repository to service
          configManager.connectRepositoryToService(args.service, {
            type: 'github',
            url: repository.html_url,
            owner: repository.owner.login,
            name: repository.name,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.log(chalk.red(`Repository validation failed: ${error.message}`));
            console.log(chalk.yellow('The repository may not exist or you may not have access to it.'));
            
            if (!flags.force) {
              const shouldContinue = await this.confirm('Connect anyway? (Not recommended)');
              if (!shouldContinue) {
                return;
              }
            }
            
            // Connect without validation
            configManager.connectRepositoryToService(args.service, {
              type: 'github',
              url: repoUrl,
              owner,
              name: repo,
            });
          } else {
            throw error;
          }
        }
      } else {
        // Connect without validation
        configManager.connectRepositoryToService(args.service, {
          type: 'github',
          url: repoUrl,
          owner,
          name: repo,
        });
      }
      
      console.log(chalk.green(`✓ Connected ${chalk.bold(`${owner}/${repo}`)} to service ${chalk.bold(args.service)}`));
      console.log(chalk.green(`Repository URL: ${repoUrl}`));
      console.log(chalk.dim('You can now use this repository for deployments with `apso service deploy`'));
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
        
        // Provide helpful suggestions
        if (error.message.includes('not found')) {
          console.log(chalk.yellow('The repository may not exist or you may not have access to it.'));
          console.log(chalk.yellow('Check the repository name and your GitHub permissions.'));
        } else if (error.message.includes('network')) {
          console.log(chalk.yellow('Network error. Check your internet connection and try again.'));
        }
      } else {
        console.log(chalk.red('An unknown error occurred'));
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
