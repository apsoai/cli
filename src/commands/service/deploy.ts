import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';
import GitHubClient from '../../lib/github-client';

export default class ServiceDeploy extends Command {
  static description = 'Deploy a service';

  static examples = [
    '$ apso service deploy my-service',
    '$ apso service deploy my-service --env production',
    '$ apso service deploy my-service --branch main',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    env: Flags.string({
      char: 'e',
      description: 'environment to deploy to',
      default: 'development',
    }),
    branch: Flags.string({
      char: 'b',
      description: 'GitHub branch to deploy',
      default: 'main',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'force deployment without confirmation',
      default: false,
    }),
  };

  static args = {
    service: Args.string({
      description: 'service name',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ServiceDeploy);
    const configManager = new ConfigManager();
    
    // Check if service exists
    if (!configManager.serviceExists(args.service)) {
      console.log(chalk.red(`Service '${args.service}' does not exist`));
      console.log(chalk.yellow('Create the service first with `apso service create`'));
      return;
    }
    
    // Check if service has a repository connected
    const repository = configManager.getServiceRepository(args.service);
    if (!repository) {
      console.log(chalk.red(`Service '${args.service}' does not have a repository connected`));
      console.log(chalk.yellow('Connect a repository first with `apso repo connect`'));
      return;
    }
    
    // Check if repository is GitHub
    if (repository.type !== 'github') {
      console.log(chalk.red(`Service '${args.service}' is connected to a non-GitHub repository`));
      console.log(chalk.yellow('Only GitHub repositories are supported for deployment'));
      return;
    }
    
    // Check GitHub authentication
    const githubAuth = new GitHubAuth(configManager);
    const authStatus = githubAuth.getAuthStatus();
    if (!authStatus.authenticated) {
      console.log(chalk.red('✗ Not connected to GitHub'));
      console.log(chalk.yellow('Run `apso github connect` to authenticate with GitHub'));
      return;
    }
    
    // Confirm deployment
    if (!flags.force) {
      const shouldDeploy = await this.confirm(
        `Are you sure you want to deploy service ${chalk.bold(args.service)} to ${chalk.bold(flags.env)} from branch ${chalk.bold(flags.branch)}?`
      );
      
      if (!shouldDeploy) {
        console.log(chalk.yellow('Deployment cancelled'));
        return;
      }
    }
    
    // Deploy service
    try {
      console.log(chalk.blue(`Deploying service ${chalk.bold(args.service)} to ${chalk.bold(flags.env)} from branch ${chalk.bold(flags.branch)}...`));
      
      // Simulate deployment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(chalk.green(`✓ Service ${chalk.bold(args.service)} deployed successfully to ${chalk.bold(flags.env)}`));
      console.log(chalk.blue('\nDeployment details:'));
      console.log(`• Service: ${args.service}`);
      console.log(`• Environment: ${flags.env}`);
      console.log(`• Repository: ${repository.owner}/${repository.name}`);
      console.log(`• Branch: ${flags.branch}`);
      console.log(`• Deployment ID: ${this.generateDeploymentId()}`);
      console.log(`• Status: ${chalk.green('Success')}`);
      
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
        
        // Provide helpful suggestions
        if (error.message.includes('rate limit')) {
          console.log(chalk.yellow('GitHub API rate limit exceeded. Try again later.'));
        } else if (error.message.includes('network')) {
          console.log(chalk.yellow('Network error. Check your internet connection and try again.'));
        } else if (error.message.includes('branch')) {
          console.log(chalk.yellow(`Branch '${flags.branch}' not found. Check the branch name and try again.`));
        }
      } else {
        console.log(chalk.red('An unknown error occurred'));
      }
    }
  }
  
  private generateDeploymentId(): string {
    return `deploy-${Math.random().toString(36).substring(2, 10)}`;
  }
}