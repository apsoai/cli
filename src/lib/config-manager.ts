import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import * as crypto from 'crypto';

interface GitHubConfig {
  connected: boolean;
  username: string;
  token_encrypted?: string;
  token_expires?: string;
}

interface RepositoryConfig {
  type: 'github' | 'codecommit';
  url: string;
  owner: string;
  name: string;
  branch?: string;
}

interface ServiceConfig {
  repository?: RepositoryConfig;
}

interface ApsoConfig {
  github?: GitHubConfig;
  services?: { [serviceName: string]: ServiceConfig };
}

class ConfigManager {
  private configPath: string;
  private encryptionKey: string;

  constructor() {
    const apsoDir = path.join(os.homedir(), '.apso');
    this.configPath = path.join(apsoDir, 'config.yml');
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.ensureConfigDir();
  }

  private ensureConfigDir(): void {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  private getOrCreateEncryptionKey(): string {
    const keyPath = path.join(os.homedir(), '.apso', '.key');
    
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
    
    // Generate a new encryption key
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  private encrypt(text: string): string {
    // For demo purposes, use a simple encoding
    return Buffer.from(text).toString('base64');
  }

  private decrypt(encryptedText: string): string {
    // For demo purposes, use a simple decoding
    return Buffer.from(encryptedText, 'base64').toString('utf8');
  }

  public loadConfig(): ApsoConfig {
    if (!fs.existsSync(this.configPath)) {
      return {};
    }
    
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf8');
      return yaml.parse(configContent) || {};
    } catch (error: any) {
      console.warn('Failed to load config, using defaults:', error);
      return {};
    }
  }

  public saveConfig(config: ApsoConfig): void {
    try {
      const yamlContent = yaml.stringify(config, {
        indent: 2,
        lineWidth: 120,
      });
      fs.writeFileSync(this.configPath, yamlContent, { mode: 0o600 });
    } catch (error: any) {
      throw new Error(`Failed to save config: ${error}`);
    }
  }

  // GitHub configuration methods
  public getGitHubConfig(): GitHubConfig | null {
    const config = this.loadConfig();
    return config.github || null;
  }

  public setGitHubConfig(githubConfig: Partial<GitHubConfig>): void {
    const config = this.loadConfig();
    if (!config.github) {
      config.github = {
        connected: false,
        username: '',
        ...githubConfig
      };
    } else {
      config.github = { ...config.github, ...githubConfig };
    }
    this.saveConfig(config);
  }

  public setGitHubToken(token: string, username: string, expiresAt?: Date): void {
    const encryptedToken = this.encrypt(token);
    const githubConfig: GitHubConfig = {
      connected: true,
      username,
      token_encrypted: encryptedToken,
      token_expires: expiresAt?.toISOString(),
    };
    this.setGitHubConfig(githubConfig);
  }

  public getGitHubToken(): string | null {
    const githubConfig = this.getGitHubConfig();
    if (!githubConfig?.token_encrypted) {
      return null;
    }
    
    try {
      return this.decrypt(githubConfig.token_encrypted);
    } catch (error: any) {
      console.warn('Failed to decrypt GitHub token:', error);
      return null;
    }
  }

  public clearGitHubConfig(): void {
    const config = this.loadConfig();
    delete config.github;
    this.saveConfig(config);
  }

  public isGitHubTokenExpired(): boolean {
    const githubConfig = this.getGitHubConfig();
    if (!githubConfig?.token_expires) {
      return false; // Assume non-expiring if no expiry date
    }
    
    const expiryDate = new Date(githubConfig.token_expires);
    return expiryDate <= new Date();
  }

  // Service configuration methods
  public getServiceConfig(serviceName: string): ServiceConfig | null {
    const config = this.loadConfig();
    return config.services?.[serviceName] || null;
  }

  public setServiceRepository(serviceName: string, repository: RepositoryConfig): void {
    const config = this.loadConfig();
    if (!config.services) {
      config.services = {};
    }
    if (!config.services[serviceName]) {
      config.services[serviceName] = {};
    }
    config.services[serviceName].repository = repository;
    this.saveConfig(config);
  }

  public removeServiceRepository(serviceName: string): void {
    const config = this.loadConfig();
    if (config.services?.[serviceName]) {
      delete config.services[serviceName].repository;
      if (Object.keys(config.services[serviceName]).length === 0) {
        delete config.services[serviceName];
      }
    }
    this.saveConfig(config);
  }

  public listServicesWithRepositories(): Array<{ service: string; repository: RepositoryConfig }> {
    const config = this.loadConfig();
    const result: Array<{ service: string; repository: RepositoryConfig }> = [];
    
    if (config.services) {
      for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
        if (serviceConfig.repository) {
          result.push({ service: serviceName, repository: serviceConfig.repository });
        }
      }
    }
    
    return result;
  }

  // Utility methods
  public getConfigPath(): string {
    return this.configPath;
  }

  public configExists(): boolean {
    return fs.existsSync(this.configPath);
  }

  public deleteConfig(): void {
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
    }
    
    // Also remove encryption key
    const keyPath = path.join(os.homedir(), '.apso', '.key');
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
    }
  }
}

export default ConfigManager;
export { GitHubConfig, RepositoryConfig, ServiceConfig, ApsoConfig };