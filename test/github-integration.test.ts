import { describe, expect, test } from '@jest/globals';
import ConfigManager from '../src/lib/config-manager';
import GitHubAuth from '../src/lib/github-auth';
import GitHubClient from '../src/lib/github-client';

describe('GitHub Integration', () => {
  describe('ConfigManager', () => {
    test('should create instance without error', () => {
      expect(() => new ConfigManager()).not.toThrow();
    });

    test('should load empty config initially', () => {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      expect(config).toEqual({});
    });

    test('should save and load configuration', () => {
      const configManager = new ConfigManager();
      const testConfig = {
        github: {
          connected: true,
          username: 'testuser',
        },
      };
      
      configManager.saveConfig(testConfig);
      const loadedConfig = configManager.loadConfig();
      expect(loadedConfig.github?.username).toBe('testuser');
    });
  });

  describe('GitHubAuth', () => {
    test('should create instance without error', () => {
      const configManager = new ConfigManager();
      expect(() => new GitHubAuth(configManager)).not.toThrow();
    });

    test('should detect unauthenticated state initially', () => {
      const configManager = new ConfigManager();
      const githubAuth = new GitHubAuth(configManager);
      
      expect(githubAuth.isAuthenticated()).toBe(false);
      
      const authStatus = githubAuth.getAuthStatus();
      expect(authStatus.authenticated).toBe(false);
    });
  });

  describe('GitHubClient', () => {
    test('should create instance without error', () => {
      const configManager = new ConfigManager();
      expect(() => new GitHubClient(configManager)).not.toThrow();
    });

    test('should parse repository URLs correctly', () => {
      const configManager = new ConfigManager();
      const githubClient = new GitHubClient(configManager);

      // Test various URL formats
      const testCases = [
        {
          input: 'https://github.com/owner/repo',
          expected: { owner: 'owner', repo: 'repo' },
        },
        {
          input: 'https://github.com/owner/repo.git',
          expected: { owner: 'owner', repo: 'repo' },
        },
        {
          input: 'git@github.com:owner/repo.git',
          expected: { owner: 'owner', repo: 'repo' },
        },
        {
          input: 'owner/repo',
          expected: { owner: 'owner', repo: 'repo' },
        },
        {
          input: 'invalid-url',
          expected: null,
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = githubClient.parseRepositoryUrl(input);
        expect(result).toEqual(expected);
      });
    });

    test('should format repository URLs correctly', () => {
      const configManager = new ConfigManager();
      const githubClient = new GitHubClient(configManager);

      expect(githubClient.formatRepositoryUrl('owner', 'repo', 'https'))
        .toBe('https://github.com/owner/repo.git');
      
      expect(githubClient.formatRepositoryUrl('owner', 'repo', 'ssh'))
        .toBe('git@github.com:owner/repo.git');
    });
  });

  describe('Configuration Management', () => {
    test('should handle service repository connections', () => {
      const configManager = new ConfigManager();
      
      const repositoryConfig = {
        type: 'github' as const,
        url: 'https://github.com/owner/repo.git',
        owner: 'owner',
        name: 'repo',
        branch: 'main',
      };

      // Set repository connection
      configManager.setServiceRepository('test-service', repositoryConfig);
      
      // Verify connection was saved
      const serviceConfig = configManager.getServiceConfig('test-service');
      expect(serviceConfig?.repository).toEqual(repositoryConfig);
      
      // List services with repositories
      const servicesWithRepos = configManager.listServicesWithRepositories();
      expect(servicesWithRepos).toHaveLength(1);
      expect(servicesWithRepos[0].service).toBe('test-service');
      expect(servicesWithRepos[0].repository).toEqual(repositoryConfig);
      
      // Remove repository connection
      configManager.removeServiceRepository('test-service');
      const updatedServiceConfig = configManager.getServiceConfig('test-service');
      expect(updatedServiceConfig?.repository).toBeUndefined();
    });

    test('should handle GitHub configuration', () => {
      const configManager = new ConfigManager();
      
      // Initially no GitHub config
      expect(configManager.getGitHubConfig()).toBeNull();
      
      // Set GitHub config
      configManager.setGitHubConfig({
        connected: true,
        username: 'testuser',
      });
      
      const githubConfig = configManager.getGitHubConfig();
      expect(githubConfig?.connected).toBe(true);
      expect(githubConfig?.username).toBe('testuser');
      
      // Clear GitHub config
      configManager.clearGitHubConfig();
      expect(configManager.getGitHubConfig()).toBeNull();
    });
  });
});