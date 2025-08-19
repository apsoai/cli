import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { table } from 'table';
import ConfigManager from '../../lib/config-manager';
import GitHubAuth from '../../lib/github-auth';
import GitHubClient, { GitHubAPIError } from '../../lib/github-client';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export default class RepoList extends Command {
  static description = 'List GitHub repositories';

  static examples = [
    '$ apso repo list',
    '$ apso repo list --filter=private',
    '$ apso repo list --sort=updated',
    '$ apso repo list --page=2 --per-page=10',
    '$ apso repo list --output=json',
  ];

  static flags = {
    help: Flags.help({ char: 'h' }),
    filter: Flags.string({
      description: 'filter repositories by visibility',
      options: ['all', 'public', 'private'],
      default: 'all',
    }),
    sort: Flags.string({
      description: 'sort repositories by field',
      options: ['name', 'updated', 'created'],
      default: 'name',
    }),
    page: Flags.integer({
      description: 'page number for paginated results',
      default: 1,
    }),
    'per-page': Flags.integer({
      description: 'number of repositories per page',
      default: 30,
    }),
    output: Flags.string({
      description: 'output format',
      options: ['table', 'json', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepoList);
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
      
      // Map sort flag to API parameter
      const sortMap: Record<string, string> = {
        'name': 'full_name',
        'updated': 'updated',
        'created': 'created'
      };
      
      const repos = await githubClient.listRepositories({
        visibility: flags.filter as 'all' | 'public' | 'private',
        sort: sortMap[flags.sort] as 'full_name' | 'updated' | 'created' | 'pushed',
        direction: flags.sort === 'name' ? 'asc' : 'desc',
        per_page: flags['per-page'],
        page: flags.page
      });
      
      if (repos.length === 0) {
        console.log(chalk.yellow('No repositories found'));
        return;
      }
      
      // Get connected services
      const connectedRepos = configManager.getConnectedRepositories();
      
      // Prepare data with connected service information
      const reposWithServiceInfo = repos.map(repo => {
        const connectedService = connectedRepos.find(r => r.url === repo.html_url);
        return {
          name: repo.name,
          full_name: repo.full_name,
          visibility: repo.private ? 'private' : 'public',
          updated: repo.updated_at,
          updated_ago: this.getTimeAgo(new Date(repo.updated_at)),
          created: repo.created_at,
          url: repo.html_url,
          clone_url: repo.clone_url,
          connected: Boolean(connectedService),
          service: connectedService?.service || null
        };
      });
      
      // Output based on format
      if (flags.output === 'json') {
        console.log(JSON.stringify(reposWithServiceInfo, null, 2));
        return;
      }
      
      if (flags.output === 'yaml') {
        console.log(yaml.dump(reposWithServiceInfo));
        return;
      }
      
      // Display as table (default)
      const tableData = [
        ['NAME', 'VISIBILITY', 'UPDATED', 'CONNECTED', 'SERVICE'],
      ];
      
      for (const repo of reposWithServiceInfo) {
        tableData.push([
          repo.name,
          repo.visibility,
          repo.updated_ago,
          repo.connected ? '✓' : '',
          repo.service || ''
        ]);
      }
      
      console.log(table(tableData));
      
      // Show pagination info
      console.log(chalk.dim(`Page ${flags.page} · ${repos.length} repositories · Filter: ${flags.filter} · Sort: ${flags.sort}`));
      
      if (repos.length === flags['per-page']) {
        console.log(chalk.dim(`Use --page=${flags.page + 1} to see more repositories`));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
        
        // Provide helpful suggestions
        if (error.message.includes('rate limit')) {
          console.log(chalk.yellow('GitHub API rate limit exceeded. Try again later or authenticate with a token.'));
        } else if (error.message.includes('network')) {
          console.log(chalk.yellow('Network error. Check your internet connection and try again.'));
        }
      } else {
        console.log(chalk.red('An unknown error occurred'));
      }
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffMonth / 12);

    if (diffYear > 0) {
      return `${diffYear} ${diffYear === 1 ? 'year' : 'years'} ago`;
    } else if (diffMonth > 0) {
      return `${diffMonth} ${diffMonth === 1 ? 'month' : 'months'} ago`;
    } else if (diffDay > 0) {
      return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
    } else if (diffHour > 0) {
      return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffMin > 0) {
      return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
    } else {
      return 'just now';
    }
  }
}
