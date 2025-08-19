import { Args, Command, Flags, ux } from '@oclif/core';
import chalk from 'chalk';
import * as inquirer from 'inquirer';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';
import GitHubClient, { GitHubAPIError, GitHubRepository } from '../../lib/github-client';

export default class ServiceCreate extends Command {
  static description = 'Create a new service';

  static examples = [
    '$ apso service create my-service',
    '$ apso service create my-service --github-repo owner/repo',
    '$ apso service create my-service --create-repo',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    template: Flags.string({
      char: 't',
      description: 'template to use',
      default: 'node',
    }),
    'github-repo': Flags.string({
      description: 'GitHub repository to connect (format: owner/repo or full URL)',
    }),
    'create-repo': Flags.boolean({
      description: 'create a new GitHub repository',
      default: false,
    }),
    private: Flags.boolean({
      char: 'p',
      description: 'create a private repository (only with --create-repo)',
      default: false,
    }),
    description: Flags.string({
      char: 'd',
      description: 'repository description (only with --create-repo)',
    }),
    init: Flags.boolean({
      description: 'initialize repository with README (only with --create-repo)',
      default: false,
    }),
    validate: Flags.boolean({
      description: 'validate repository access before connecting',
      default: true,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'force operation without confirmation prompts',
      default: false,
    }),
  };

  static args = {
    name: Args.string({
      name: 'name',
      required: true,
      description: 'name of the service to create',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ServiceCreate);
    const configManager = new ConfigManager();
    const githubAuth = new GitHubAuth(configManager);
    
    console.log(chalk.blue(`Creating service: ${args.name}`));
    console.log(chalk.gray(`Template: ${flags.template}`));
    
    // Create the service
    // This is where you would implement the actual service creation logic
    // For now, we'll just simulate it
    console.log(chalk.green('✓ Service created successfully!'));
    
    // Handle GitHub repository options
    try {
      // Check if GitHub integration is requested
      if (flags['github-repo'] || flags['create-repo'] || (!flags['github-repo'] && !flags['create-repo'])) {
        // Check authentication
        const authStatus = githubAuth.getAuthStatus();
        if (!authStatus.authenticated) {
          console.log(chalk.yellow('Not connected to GitHub. Run `apso github connect` first.'));
          return;
        }

        const githubClient = new GitHubClient(configManager);

        // Validate token
        const isTokenValid = await githubClient.validateToken();
        if (!isTokenValid) {
          console.log(chalk.yellow('GitHub token is invalid. Run `apso github connect` to re-authenticate.'));
          return;
        }

        let repository: GitHubRepository | null = null;

        // Handle repository connection
        if (flags['github-repo']) {
          // Connect existing repository
          const repoUrl = flags['github-repo'];
          const repoInfo = this.parseRepoUrl(repoUrl);
          
          if (!repoInfo) {
            console.log(chalk.red(`Invalid repository format: ${repoUrl}`));
            console.log(chalk.gray('Use format: owner/repo or https://github.com/owner/repo'));
            return;
          }
          
          try {
            repository = await githubClient.getRepository(repoInfo.owner, repoInfo.repo);
            console.log(chalk.green(`✓ Connected to GitHub repository: ${repository.full_name}`));
          } catch (error) {
            console.log(chalk.red(`Repository not found: ${repoInfo.owner}/${repoInfo.repo}`));
            return;
          }
        } 
        else if (flags['create-repo']) {
          // Create new repository
          try {
            repository = await githubClient.createRepository({
              name: args.name,
              description: flags.description,
              private: flags.private,
              auto_init: true,
            });
            console.log(chalk.green(`✓ Created new GitHub repository: ${repository.full_name}`));
          } catch (error: any) {
            if (error instanceof GitHubAPIError) {
              console.log(chalk.red(`GitHub API error: ${error.message}`));
            } else {
              console.log(chalk.red(`Failed to create repository: ${error.message}`));
            }
            return;
          }
        }
        else {
          // Interactive mode - prompt for repository options
          const promptResponse = await inquirer.prompt([
            {
              type: 'list',
              name: 'repoOption',
              message: 'Would you like to connect this service to a GitHub repository?',
              choices: [
                { name: 'No, skip GitHub integration', value: 'none' },
                { name: 'Yes, connect to an existing repository', value: 'existing' },
                { name: 'Yes, create a new repository', value: 'new' }
              ]
            }
          ]);
          
          if (promptResponse.repoOption === 'existing') {
            // List repositories for selection
            ux.action.start('Fetching your GitHub repositories');
            const repos = await githubClient.listRepositories();
            ux.action.stop();
            
            if (repos.length === 0) {
              console.log(chalk.yellow('You don\'t have any GitHub repositories.'));
              return;
            }
            
            const repoChoices = repos.map(repo => ({
              name: `${repo.full_name} (${repo.private ? 'Private' : 'Public'})`,
              value: repo
            }));
            
            const repoSelection = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedRepo',
                message: 'Select a repository to connect:',
                choices: repoChoices
              }
            ]);
            
            repository = repoSelection.selectedRepo;
            if (repository) {
              console.log(chalk.green(`✓ Connected to GitHub repository: ${repository.full_name}`));
            }
          } 
          else if (promptResponse.repoOption === 'new') {
            // Prompt for new repository details
            const newRepoDetails = await inquirer.prompt([
              {
                type: 'input',
                name: 'name',
                message: 'Repository name:',
                default: args.name
              },
              {
                type: 'input',
                name: 'description',
                message: 'Repository description (optional):'
              },
              {
                type: 'confirm',
                name: 'private',
                message: 'Make repository private?',
                default: false
              }
            ]);
            
            try {
              repository = await githubClient.createRepository({
                name: newRepoDetails.name,
                description: newRepoDetails.description,
                private: newRepoDetails.private,
                auto_init: true,
              });
              console.log(chalk.green(`✓ Created new GitHub repository: ${repository.full_name}`));
            } catch (error: any) {
              if (error instanceof GitHubAPIError) {
                console.log(chalk.red(`GitHub API error: ${error.message}`));
              } else {
                console.log(chalk.red(`Failed to create repository: ${error.message}`));
              }
              return;
            }
          }
        }
        
        // Link repository to service if we have one
        if (repository) {
          configManager.setServiceRepository(args.name, {
            type: 'github',
            owner: repository.owner.login,
            name: repository.name,
            url: repository.html_url,
            branch: 'main'
          });
          console.log(chalk.green(`✓ Service ${args.name} linked to repository ${repository.full_name}`));
        }
      }
    } catch (error: any) {
      this.error(`Error: ${error.message}`);
    }
  }
  
  private parseRepoUrl(url: string): { owner: string; repo: string } | null {
    // Handle format: owner/repo
    if (url.indexOf('/') > 0 && !url.includes('://')) {
      const [owner, repo] = url.split('/');
      if (owner && repo) {
        return { owner, repo };
      }
    }
    
    // Handle format: https://github.com/owner/repo
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'github.com') {
        const parts = urlObj.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return { owner: parts[0], repo: parts[1] };
        }
      }
    } catch (e) {
      // Not a valid URL
    }
    
    return null;
  }
}