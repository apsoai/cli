/* eslint-disable camelcase */
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class RepoCreate extends Command {
  static description = 'Create a new GitHub repository';

  static examples = [
    '$ apso repo create my-new-repo',
    '$ apso repo create my-api --private --description "My API service"',
    '$ apso repo create frontend-app --init --service my-frontend',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    private: Flags.boolean({
      char: 'p',
      description: 'create a private repository',
      default: false,
    }),
    description: Flags.string({
      char: 'd',
      description: 'repository description',
    }),
    init: Flags.boolean({
      description: 'initialize repository with README',
      default: false,
    }),
    service: Flags.string({
      char: 's',
      description: 'automatically connect to specified service',
    }),
  };

  static args = {
    name: Args.string({
      name: 'name',
      required: true,
      description: 'name of the repository to create',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoCreate);
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

      // Create repository
      const repository = await githubClient.createRepository({
        name: args.name,
        description: flags.description,
        private: flags.private,
        auto_init: flags.init,
      });

      console.log(chalk.green('\n✓ Repository created successfully!'));
      console.log(chalk.gray(`  Repository: ${repository.full_name}`));
      console.log(chalk.gray(`  URL: ${repository.html_url}`));
      console.log(chalk.gray(`  Clone URL: ${repository.clone_url}`));

    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        this.error(`GitHub API error: ${error.message}`);
      } else {
        this.error(`Failed to create repository: ${error.message}`);
      }
    }
  }
}
