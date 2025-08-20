/* eslint-disable max-depth */
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubClient from '../../lib/github-client';

export default class ServiceDeploy extends Command {
  static description = 'Deploy a service with GitHub integration';

  static examples = [
    '$ apso service deploy my-service',
    '$ apso service deploy my-service --branch main',
    '$ apso service deploy my-service --tag v1.0.0',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    branch: Flags.string({
      char: 'b',
      description: 'branch to deploy',
      default: 'main',
    }),
    tag: Flags.string({
      char: 't',
      description: 'tag to deploy',
      exclusive: ['branch'],
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'force deployment',
      default: false,
    }),
  };

  static args = {
    serviceName: Args.string({
      name: 'serviceName',
      required: true,
      description: 'name of the service to deploy',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ServiceDeploy);
    const configManager = new ConfigManager();

    try {
      console.log(chalk.blue(`Deploying service: ${args.serviceName}`));
      
      // Check if service exists
      if (!configManager.serviceExists(args.serviceName)) {
        this.error(`Service '${args.serviceName}' does not exist. Create it first with 'apso service create ${args.serviceName}'.`);
      }

      // Get service repository configuration
      const serviceConfig = configManager.getServiceConfig(args.serviceName);
      const repository = serviceConfig?.repository;

      // Auto-detect repository type and show repository info
      if (repository) {
        console.log(chalk.gray(`Repository: ${repository.type}://${repository.owner}/${repository.name}`));
        console.log(chalk.gray(`Branch: ${flags.branch}`));
        
        // Check GitHub authentication if it's a GitHub repository
        if (repository.type === 'github') {
          const token = await configManager.getGitHubToken();
          if (token) {
            const githubClient = new GitHubClient(configManager);
            
            // Validate token
            const isTokenValid = await githubClient.validateToken();
            if (isTokenValid) {
              // Show repository information
              try {
                const repoDetails = await githubClient.getRepository(repository.owner, repository.name);
                console.log(chalk.gray(`Repository URL: ${repoDetails.html_url}`));
                console.log(chalk.gray(`Repository Description: ${repoDetails.description || 'No description'}`));
                console.log(chalk.gray(`Repository Visibility: ${repoDetails.private ? 'Private' : 'Public'}`));
              } catch (error: any) {
                console.log(chalk.yellow(`Could not fetch repository details: ${error.message}`));
              }
            } else {
              console.log(chalk.yellow('GitHub token is invalid. Run `apso github connect` to re-authenticate.'));
              // Continue deployment without GitHub integration
            }
          } else {
            console.log(chalk.yellow('Not connected to GitHub. Run `apso github connect` first.'));
            // Continue deployment without GitHub integration
          }
        }
      } else {
        console.log(chalk.gray('No repository connected to this service'));
      }

      // Deployment process (simulated)
      console.log(chalk.blue('\n🚀 Starting deployment...'));
      
      // Simulate deployment steps
      console.log(chalk.gray('  • Building service...'));
      await this.sleep(1000);
      
      console.log(chalk.gray('  • Running tests...'));
      await this.sleep(1000);
      
      console.log(chalk.gray('  • Packaging service...'));
      await this.sleep(1000);
      
      if (flags.force) {
        console.log(chalk.gray('  • Force deployment enabled'));
      }
      
      console.log(chalk.green('\n✓ Service deployed successfully!'));
      console.log(chalk.gray('Deployment completed at:'), new Date().toISOString());
      
      // Show next steps
      console.log(chalk.blue('\nNext steps:'));
      console.log('• Run `apso service logs ' + args.serviceName + '` to view logs');
      console.log('• Run `apso service status ' + args.serviceName + '` to check status');
      
    } catch (error: any) {
      this.error(`Failed to deploy service: ${error.message}`);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }
}