import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager, CliConfig } from '../../src/lib/config';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let testConfigDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    // Create a temporary config directory for testing
    testConfigDir = path.join(os.tmpdir(), `apso-test-${Date.now()}`);
    testConfigPath = path.join(testConfigDir, 'config.json');
    
    // Create a new ConfigManager instance
    configManager = new ConfigManager();
    
    // Override the config paths for testing
    (configManager as any).configDir = testConfigDir;
    (configManager as any).configPath = testConfigPath;
  });

  afterEach(() => {
    // Clean up test config directory
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
  });

  describe('getConfig', () => {
    it('should return null when config file does not exist', () => {
      const config = configManager.getConfig();
      expect(config).toBeNull();
    });

    it('should return config when file exists', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
        user: {
          id: 1,
          email: 'test@example.com',
          fullName: 'Test User',
        },
      };

      // Create config directory and file
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig));

      const config = configManager.getConfig();
      expect(config).toEqual(testConfig);
    });

    it('should return null when config file is corrupted', () => {
      // Create invalid JSON file
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(testConfigPath, 'invalid json{');

      const config = configManager.getConfig();
      expect(config).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('should create config directory if it does not exist', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
      };

      configManager.saveConfig(testConfig);

      expect(fs.existsSync(testConfigDir)).toBe(true);
      expect(fs.existsSync(testConfigPath)).toBe(true);
    });

    it('should save config with lastUpdated timestamp', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
        user: {
          id: 1,
          email: 'test@example.com',
          fullName: 'Test User',
        },
      };

      configManager.saveConfig(testConfig);

      const savedConfig = configManager.getConfig();
      expect(savedConfig).toMatchObject(testConfig as any);
      expect(savedConfig?.lastUpdated).toBeDefined();
      expect(savedConfig?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should overwrite existing config', () => {
      const initialConfig: CliConfig = {
        token: 'old-token',
      };

      const newConfig: CliConfig = {
        token: 'new-token',
        user: {
          id: 1,
          email: 'test@example.com',
          fullName: 'Test User',
        },
      };

      configManager.saveConfig(initialConfig);
      configManager.saveConfig(newConfig);

      const savedConfig = configManager.getConfig();
      expect(savedConfig?.token).toBe('new-token');
      expect(savedConfig?.user).toEqual(newConfig.user);
    });
  });

  describe('updateConfig', () => {
    it('should merge updates with existing config', () => {
      const initialConfig: CliConfig = {
        token: 'test-token',
        user: {
          id: 1,
          email: 'old@example.com',
          fullName: 'Old User',
        },
      };

      configManager.saveConfig(initialConfig);
      configManager.updateConfig({
        user: {
          id: 1,
          email: 'new@example.com',
          fullName: 'New User',
        },
      });

      const config = configManager.getConfig();
      expect(config?.token).toBe('test-token');
      expect(config?.user?.email).toBe('new@example.com');
      expect(config?.user?.fullName).toBe('New User');
    });

    it('should preserve nested objects when updating', () => {
      const initialConfig: CliConfig = {
        token: 'test-token',
        defaultWorkspace: {
          id: 1,
          name: 'Workspace 1',
        },
        workspaces: [
          { id: 1, name: 'Workspace 1' },
          { id: 2, name: 'Workspace 2' },
        ],
      };

      configManager.saveConfig(initialConfig);
      configManager.updateConfig({
        token: 'updated-token',
      });

      const config = configManager.getConfig();
      expect(config?.token).toBe('updated-token');
      expect(config?.defaultWorkspace).toEqual(initialConfig.defaultWorkspace);
      expect(config?.workspaces).toEqual(initialConfig.workspaces);
    });
  });

  describe('clearConfig', () => {
    it('should delete config file if it exists', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
      };

      configManager.saveConfig(testConfig);
      expect(fs.existsSync(testConfigPath)).toBe(true);

      configManager.clearConfig();
      expect(fs.existsSync(testConfigPath)).toBe(false);
    });

    it('should not throw error when config file does not exist', () => {
      expect(() => configManager.clearConfig()).not.toThrow();
    });
  });

  describe('isLoggedIn', () => {
    it('should return false when no config exists', () => {
      expect(configManager.isLoggedIn()).toBe(false);
    });

    it('should return false when config exists but no token', () => {
      const testConfig: CliConfig = {
        user: {
          id: 1,
          email: 'test@example.com',
          fullName: 'Test User',
        },
      };

      configManager.saveConfig(testConfig);
      expect(configManager.isLoggedIn()).toBe(false);
    });

    it('should return true when token exists', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
        user: {
          id: 1,
          email: 'test@example.com',
          fullName: 'Test User',
        },
      };

      configManager.saveConfig(testConfig);
      expect(configManager.isLoggedIn()).toBe(true);
    });
  });

  describe('getToken', () => {
    it('should return null when no config exists', () => {
      expect(configManager.getToken()).toBeNull();
    });

    it('should return token when config exists', () => {
      const testConfig: CliConfig = {
        token: 'test-token-123',
      };

      configManager.saveConfig(testConfig);
      expect(configManager.getToken()).toBe('test-token-123');
    });
  });

  describe('getDefaultWorkspaceId', () => {
    it('should return null when no config exists', () => {
      expect(configManager.getDefaultWorkspaceId()).toBeNull();
    });

    it('should return null when no default workspace is set', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
        workspaces: [
          { id: 1, name: 'Workspace 1' },
        ],
      };

      configManager.saveConfig(testConfig);
      expect(configManager.getDefaultWorkspaceId()).toBeNull();
    });

    it('should return default workspace ID when set', () => {
      const testConfig: CliConfig = {
        token: 'test-token',
        defaultWorkspace: {
          id: 42,
          name: 'Default Workspace',
        },
      };

      configManager.saveConfig(testConfig);
      expect(configManager.getDefaultWorkspaceId()).toBe(42);
    });
  });
});

