/* eslint-disable camelcase */
import { Args, Command, Flags, ux } from '@oclif/core';
import chalk from 'chalk';
import * as inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import ConfigManager from '../../lib/config-manager';
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
      description: 'GitHub repository to connect',
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
    
    console.log(chalk.blue(`Creating service: ${args.name}`));
    console.log(chalk.gray(`Template: ${flags.template}`));
    
    // Create the service directory
    const serviceDir = path.join(process.cwd(), args.name);
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }
    
    // Create a basic package.json
    const packageJson = {
      name: args.name,
      version: '1.0.0',
      description: `Service ${args.name} created with ${flags.template} template`,
      main: 'index.js',
      scripts: {
        start: 'node index.js',
        test: 'echo "Error: no test specified" && exit 1'
      },
      keywords: [flags.template, 'service'],
      author: '',
      license: 'ISC'
    };
    
    fs.writeFileSync(path.join(serviceDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    
    // Create a basic index.js file
    const indexJsContent = `// Service: ${args.name}
// Template: ${flags.template}

console.log('Hello from ${args.name} service!');

// TODO: Implement your service logic here
`;
    
    fs.writeFileSync(path.join(serviceDir, 'index.js'), indexJsContent);
    
    console.log(chalk.green(`✓ Service '${args.name}' created successfully with template '${flags.template}'!`));
    console.log(chalk.gray(`  Service directory: ${serviceDir}`));
    
    // Handle GitHub repository options
    await this.handleGitHubIntegration(flags, args, configManager);
  }

  private async handleGitHubIntegration(flags: any, args: any, configManager: ConfigManager): Promise<void> {
    // Check if GitHub integration is requested
    if (!(flags['github-repo'] || flags['create-repo'])) {
      return;
    }

    try {
      // Check GitHub authentication directly with token
      const token = await configManager.getGitHubToken();
      if (!token) {
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
        repository = await this.connectExistingRepository(flags, githubClient);
      }
      else if (flags['create-repo']) {
        repository = await this.createRepository(flags, args, githubClient);
      }
      else {
        repository = await this.interactiveRepositorySetup(flags, args, githubClient);
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
    } catch (error: any) {
      this.error(`Error: ${error.message}`);
    }
  }

  private async connectExistingRepository(flags: any, githubClient: GitHubClient): Promise<GitHubRepository | null> {
    // Connect existing repository
    const repoUrl = flags['github-repo'];
    const repoInfo = this.parseRepoUrl(repoUrl);
    
    if (!repoInfo) {
      console.log(chalk.red(`Invalid repository format: ${repoUrl}`));
      console.log(chalk.gray('Use format: owner/repo or https://github.com/owner/repo'));
      return null;
    }
    
    try {
      const repository = await githubClient.getRepository(repoInfo.owner, repoInfo.repo);
      console.log(chalk.green(`✓ Connected to GitHub repository: ${repository.full_name}`));
      return repository;
    } catch {
      console.log(chalk.red(`Repository not found: ${repoInfo.owner}/${repoInfo.repo}`));
      return null;
    }
  }

  private async createRepository(flags: any, args: any, githubClient: GitHubClient): Promise<GitHubRepository | null> {
    // Create new repository
    try {
      const repository = await githubClient.createRepository({
        name: args.name,
        description: flags.description,
        private: flags.private,
        auto_init: true,
      });
      console.log(chalk.green(`✓ Created new GitHub repository: ${repository.full_name}`));
      return repository;
    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        console.log(chalk.red(`GitHub API error: ${error.message}`));
      } else {
        console.log(chalk.red(`Failed to create repository: ${error.message}`));
      }
      return null;
    }
  }

  private async interactiveRepositorySetup(flags: any, args: any, githubClient: GitHubClient): Promise<GitHubRepository | null> {
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
      return this.connectExistingFromList(githubClient);
    }
    
    if (promptResponse.repoOption === 'new') {
      return this.createNewRepositoryFromPrompt(args, githubClient);
    }
    
    return null;
  }

  private async connectExistingFromList(githubClient: GitHubClient): Promise<GitHubRepository | null> {
    // List repositories for selection
    ux.action.start('Fetching your GitHub repositories');
    const repos = await githubClient.listRepositories();
    ux.action.stop();
    
    if (repos.length === 0) {
      console.log(chalk.yellow('You don\'t have any GitHub repositories.'));
      return null;
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
    
    const repository = repoSelection.selectedRepo;
    if (repository) {
      console.log(chalk.green(`✓ Connected to GitHub repository: ${repository.full_name}`));
    }
    return repository;
  }

  private async createNewRepositoryFromPrompt(args: any, githubClient: GitHubClient): Promise<GitHubRepository | null> {
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
      const repository = await githubClient.createRepository({
        name: newRepoDetails.name,
        description: newRepoDetails.description,
        private: newRepoDetails.private,
        auto_init: true,
      });
      console.log(chalk.green(`✓ Created new GitHub repository: ${repository.full_name}`));
      return repository;
    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        console.log(chalk.red(`GitHub API error: ${error.message}`));
      } else {
        console.log(chalk.red(`Failed to create repository: ${error.message}`));
      }
      return null;
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
    } catch {
      // Not a valid URL
    }
    
    return null;
  }
}
