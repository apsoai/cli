import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ConfigManager from '../../lib/config-manager';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';

export default class RepoList extends Command {
  static description = 'List GitHub repositories';

  static examples = [
    '$ apso repo list',
    '$ apso repo list --page 2',
    '$ apso repo list --filter private',
    '$ apso repo list --sort name',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    json: Flags.boolean({
      description: 'output in JSON format',
      default: false,
    }),
    page: Flags.integer({
      char: 'p',
      description: 'page number',
      default: 1,
    }),
    filter: Flags.string({
      char: 'f',
      description: 'filter repositories (public/private/all)',
      options: ['public', 'private', 'all'],
      default: 'all',
    }),
    sort: Flags.string({
      char: 's',
      description: 'sort repositories (name/updated/created)',
      options: ['name', 'updated', 'created'],
      default: 'updated',
    }),
    'per-page': Flags.integer({
      description: 'number of repositories per page',
      default: 30,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepoList);
    const configManager = new ConfigManager();

    try {
      // Check authentication - directly check for token instead of using getAuthStatus
      const token = await configManager.getGitHubToken();
      if (!token) {
        this.error('Not connected to GitHub. Run `apso github connect` first.');
      }

      const githubClient = new GitHubClient(configManager);

      // Get repositories with pagination, filtering, and sorting
      const repositories = await githubClient.listRepositories({
        visibility: flags.filter as 'all' | 'public' | 'private',
        sort: flags.sort as 'created' | 'updated' | 'pushed' | 'full_name',
        direction: flags.sort === 'name' ? 'asc' : 'desc',
        // eslint-disable-next-line camelcase
        per_page: flags['per-page'],
        page: flags.page,
      });

      if (flags.json) {
        console.log(JSON.stringify(repositories, null, 2));
      } else {
        console.log(chalk.blue(`📚 Your GitHub Repositories (${repositories.length}):\n`));
        repositories.forEach((repo) => {
          console.log(`${chalk.bold(repo.full_name)} - ${repo.description || 'No description'}`);
          console.log(chalk.gray(`  ${repo.private ? 'Private' : 'Public'} • ${repo.html_url}`));
          console.log('');
        });
        
        // Show pagination info
        if (repositories.length > 0) {
          console.log(chalk.gray(`Page ${flags.page} of results (${flags['per-page']} per page)`));
        }
      }
    } catch (error: any) {
      if (error instanceof GitHubAPIError) {
        this.error(`GitHub API error: ${error.message}`);
      } else {
        this.error(`Failed to list repositories: ${error.message}`);
      }
    }
  }
}
