import { Command, Flags, Args } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class RepoCreate extends Command {
  static description = 'Create a new GitHub repository';

  static examples = [
    '$ apso repo create my-repo',
    '$ apso repo create my-repo --private',
    '$ apso repo create my-repo --description "My new repository"',
    '$ apso repo create my-repo --init',
    '$ apso repo create my-repo --service my-service',
  ];

  static args = {
    name: Args.string({
      description: 'repository name',
      required: true,
    }),
  };

  static flags = {
    help: Flags.help({ char: 'h' }),
    private: Flags.boolean({
      description: 'create private repository',
      default: false,
    }),
    description: Flags.string({
      description: 'repository description',
      char: 'd',
    }),
    init: Flags.boolean({
      description: 'initialize repository with README',
      default: false,
    }),
    service: Flags.string({
      description: 'connect repository to service',
      char: 's',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoCreate);
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
      
      // Create repository
      console.log(chalk.blue(`Creating ${flags.private ? 'private' : 'public'} repository ${chalk.bold(args.name)}...`));
      
      const repository = await githubClient.createRepository({
        name: args.name,
        description: flags.description,
        private: flags.private,
        auto_init: flags.init,
      });
      
      console.log(chalk.green(`✓ Repository created: ${chalk.bold(repository.full_name)}`));
      console.log(chalk.green(`URL: ${repository.html_url}`));
      
      // Connect to service if requested
      if (flags.service) {
        // Check if service exists
        if (!configManager.serviceExists(flags.service)) {
          console.log(chalk.yellow(`Service '${flags.service}' does not exist. Repository created but not connected.`));
          console.log(chalk.yellow('Create the service first with `apso service create`'));
        } else {
          console.log(chalk.blue(`Connecting repository to service ${chalk.bold(flags.service)}...`));
          
          // Check if service already has a repository
          const existingRepo = configManager.getServiceRepository(flags.service);
          if (existingRepo) {
            console.log(chalk.yellow(`Service '${flags.service}' is already connected to repository:`));
            console.log(chalk.yellow(`  ${existingRepo.url}`));
            
            const shouldReconnect = await this.confirm('Do you want to replace this connection?');
            if (!shouldReconnect) {
              console.log(chalk.yellow('Repository created but not connected to service.'));
              return;
            }
            console.log(chalk.yellow('Removing existing repository connection...'));
          }
          
          // Connect repository to service
          configManager.connectRepositoryToService(flags.service, {
            type: 'github',
            url: repository.html_url,
            owner: repository.owner.login,
            name: repository.name,
          });
          
          console.log(chalk.green(`✓ Connected repository to service ${chalk.bold(flags.service)}`));
        }
      }
      
      // Show next steps
      console.log(chalk.blue('\nNext steps:'));
      console.log(`• Clone the repository: git clone ${repository.clone_url}`);
      if (!flags.service) {
        console.log(`• Connect to a service: apso repo connect <service-name> ${repository.full_name}`);
      }
      console.log(`• View in browser: ${repository.html_url}`);
      
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
        
        // Provide helpful suggestions
        if (error.message.includes('name already exists')) {
          console.log(chalk.yellow('A repository with this name already exists.'));
          console.log(chalk.yellow('Try a different name or check your existing repositories.'));
        } else if (error.message.includes('rate limit')) {
          console.log(chalk.yellow('GitHub API rate limit exceeded. Try again later.'));
        } else if (error.message.includes('network')) {
          console.log(chalk.yellow('Network error. Check your internet connection and try again.'));
        }
      } else {
        console.log(chalk.red('An unknown error occurred'));
      }
    }
  }
}
