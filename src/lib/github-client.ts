/* eslint-disable unicorn/numeric-separators-style */
/* eslint-disable camelcase */
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import ConfigManager from './config-manager';

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  updated_at: string;
  created_at: string;
  owner: {
    login: string;
    type: string;
  };
  permissions?: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  type: string;
}

interface CreateRepositoryOptions {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
}

interface ListRepositoriesOptions {
  visibility?: 'all' | 'public' | 'private';
  sort?: 'created' | 'updated' | 'pushed' | 'full_name';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

class GitHubAPIError extends Error {
  public status?: number;
  public response?: any;

  constructor(message: string, status?: number, response?: any) {
    super(message);
    this.name = 'GitHubAPIError';
    this.status = status;
    this.response = response;
  }
}

class GitHubClient {
  private client: AxiosInstance;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'apso-cli',
      },
      timeout: 30000,
    });

    // Add auth interceptor
    this.client.interceptors.request.use(async (config) => {
      const token = await this.configManager.getGitHubToken();
      if (token) {
        config.headers.Authorization = `token ${token}`;
      }
      return config;
    });

    // Add error response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const { status, data } = error.response;
          let message = `GitHub API error (${status})`;
          
          if (data?.message) {
            message += `: ${data.message}`;
          }
          
          switch (status) {
          case 401: {
            message += ' - Please check your GitHub authentication';
          
          break;
          }
          case 403: {
            message += ' - Rate limit exceeded or insufficient permissions';
          
          break;
          }
          case 404: {
            message += ' - Repository or resource not found';
          
          break;
          }
          // No default
          }
          
          throw new GitHubAPIError(message, status, data);
        }
        
        throw new GitHubAPIError(`Network error: ${error.message}`);
      }
    );
  }

  // Authentication methods
  public async getCurrentUser(): Promise<GitHubUser> {
    try {
      const response: AxiosResponse<GitHubUser> = await this.client.get('/user');
      return response.data;
    } catch {
      throw new GitHubAPIError('Failed to get current user information');
    }
  }

  public async validateToken(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  // Repository methods
  public async listRepositories(options: ListRepositoriesOptions = {}): Promise<GitHubRepository[]> {
    try {
      const params = {
        visibility: options.visibility || 'all',
        sort: options.sort || 'updated',
        direction: options.direction || 'desc',
        per_page: options.per_page || 30,
        page: options.page || 1,
      };

      const response: AxiosResponse<GitHubRepository[]> = await this.client.get('/user/repos', { params });
      return response.data;
    } catch {
      throw new GitHubAPIError('Failed to list repositories');
    }
  }

  public async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    try {
      const response: AxiosResponse<GitHubRepository> = await this.client.get(`/repos/${owner}/${repo}`);
      return response.data;
    } catch {
      throw new GitHubAPIError(`Failed to get repository ${owner}/${repo}`);
    }
  }

  public async createRepository(options: CreateRepositoryOptions): Promise<GitHubRepository> {
    try {
      const response: AxiosResponse<GitHubRepository> = await this.client.post('/user/repos', {
        name: options.name,
        description: options.description,
        private: options.private || false,
        auto_init: options.auto_init || false,
      });
      return response.data;
    } catch (error: any) {
      if (error instanceof GitHubAPIError && error.status === 422) {
        throw new GitHubAPIError(`Repository '${options.name}' already exists or name is invalid`);
      }
      throw new GitHubAPIError(`Failed to create repository '${options.name}'`);
    }
  }

  public async deleteRepository(owner: string, repo: string): Promise<void> {
    try {
      await this.client.delete(`/repos/${owner}/${repo}`);
    } catch {
      throw new GitHubAPIError(`Failed to delete repository ${owner}/${repo}`);
    }
  }

  public async checkRepositoryAccess(owner: string, repo: string): Promise<boolean> {
    try {
      await this.getRepository(owner, repo);
      return true;
    } catch (error: any) {
      if (error instanceof GitHubAPIError && (error.status === 404 || error.status === 403)) {
        return false;
      }
      throw error;
    }
  }

  // Utility methods
  public parseRepositoryUrl(url: string): { owner: string; repo: string } | null {
    // Support multiple URL formats:
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // owner/repo
    
    const patterns = [
      /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?\$/,
      /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
      /^([^/]+)\/([^/]+)$/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
        };
      }
    }

    return null;
  }

  public formatRepositoryUrl(owner: string, repo: string, format: 'https' | 'ssh' = 'https'): string {
    if (format === 'ssh') {
      return `git@github.com:${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }

  // Rate limit information
  public async getRateLimit(): Promise<any> {
    try {
      const response = await this.client.get('/rate_limit');
      return response.data;
    } catch {
      throw new GitHubAPIError('Failed to get rate limit information');
    }
  }

  // Search repositories
  public async searchRepositories(query: string, options: { per_page?: number; page?: number } = {}): Promise<{
    items: GitHubRepository[];
    total_count: number;
  }> {
    try {
      const params = {
        q: query,
        per_page: options.per_page || 30,
        page: options.page || 1,
      };

      const response = await this.client.get('/search/repositories', { params });
      return response.data;
    } catch {
      throw new GitHubAPIError('Failed to search repositories');
    }
  }
}

export default GitHubClient;
export { GitHubRepository, GitHubUser, CreateRepositoryOptions, ListRepositoriesOptions, GitHubAPIError };