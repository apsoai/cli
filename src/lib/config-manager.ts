/* eslint-disable camelcase */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import * as crypto from 'crypto';
import * as keytar from 'keytar';

interface GitHubConfig {
  connected: boolean;
  username: string;
  token_encrypted?: string;
  token_expires?: string;
  refresh_token?: string;
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
    const ivBuffer = crypto.randomBytes(16);
    const iv = new Uint8Array(ivBuffer);
    const key = new Uint8Array(Buffer.from(this.encryptionKey, 'hex'));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return iv:authTag:encrypted format
    return `${ivBuffer.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }
    
    const iv = new Uint8Array(Buffer.from(parts[0], 'hex'));
    const authTag = new Uint8Array(Buffer.from(parts[1], 'hex'));
    const encrypted = parts[2];
    
    const keyArray = new Uint8Array(Buffer.from(this.encryptionKey, 'hex'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyArray, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  private async storeInKeychain(service: string, account: string, password: string): Promise<boolean> {
    try {
      await keytar.setPassword(service, account, password);
      return true;
    } catch (error) {
      console.warn('Failed to store in keychain, falling back to file storage:', error);
      return false;
    }
  }
  
  private async getFromKeychain(service: string, account: string): Promise<string | null> {
    try {
      return await keytar.getPassword(service, account);
    } catch (error) {
      console.warn('Failed to retrieve from keychain, falling back to file storage:', error);
      return null;
    }
  }
  
  private async deleteFromKeychain(service: string, account: string): Promise<boolean> {
    try {
      return await keytar.deletePassword(service, account);
    } catch (error) {
      console.warn('Failed to delete from keychain:', error);
      return false;
    }
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
    // eslint-disable-next-line no-negated-condition
    config.github = !config.github ? {
        connected: false,
        username: '',
        ...githubConfig
      } : { ...config.github, ...githubConfig };
    this.saveConfig(config);
  }

  public async setGitHubToken(token: string, username: string, expiresAt?: Date, refreshToken?: string): Promise<void> {
    // Try to store in OS keychain first
    const keychainStored = await this.storeInKeychain('apso-cli', `github_token_${username}`, token);
    
    // If keychain storage failed, encrypt and store in config file
    const githubConfig: GitHubConfig = {
      connected: true,
      username,
      token_expires: expiresAt?.toISOString(),
    };
    
    // Only store encrypted token in file if keychain failed
    if (!keychainStored) {
      githubConfig.token_encrypted = this.encrypt(token);
    }
    
    // Store refresh token if provided
    if (refreshToken) {
      // Try to store refresh token in keychain
      const refreshTokenStored = await this.storeInKeychain('apso-cli', `github_refresh_token_${username}`, refreshToken);
      
      // Only store in config if keychain failed
      if (!refreshTokenStored) {
        githubConfig.refresh_token = this.encrypt(refreshToken);
      }
    }
    
    this.setGitHubConfig(githubConfig);
  }

  public async getGitHubToken(): Promise<string | null> {
    const githubConfig = this.getGitHubConfig();
    if (!githubConfig?.username) {
      return null;
    }
    
    // Try to get from keychain first
    const keychainToken = await this.getFromKeychain('apso-cli', `github_token_${githubConfig.username}`);
    if (keychainToken) {
      return keychainToken;
    }
    
    // Fall back to encrypted file storage
    if (githubConfig.token_encrypted) {
      try {
        return this.decrypt(githubConfig.token_encrypted);
      } catch (error: any) {
        console.warn('Failed to decrypt GitHub token:', error);
        return null;
      }
    }
    
    return null;
  }
  
  public async getGitHubRefreshToken(): Promise<string | null> {
    const githubConfig = this.getGitHubConfig();
    if (!githubConfig?.username) {
      return null;
    }
    
    // Try to get from keychain first
    const keychainToken = await this.getFromKeychain('apso-cli', `github_refresh_token_${githubConfig.username}`);
    if (keychainToken) {
      return keychainToken;
    }
    
    // Fall back to encrypted file storage
    if (githubConfig.refresh_token) {
      try {
        return this.decrypt(githubConfig.refresh_token);
      } catch (error: any) {
        console.warn('Failed to decrypt GitHub refresh token:', error);
        return null;
      }
    }
    
    return null;
  }

  public async clearGitHubConfig(): Promise<void> {
    const config = this.loadConfig();
    const username = config.github?.username;
    
    // Remove from keychain if username exists
    if (username) {
      await this.deleteFromKeychain('apso-cli', `github_token_${username}`);
      await this.deleteFromKeychain('apso-cli', `github_refresh_token_${username}`);
    }
    
    // Remove from config file
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
  
  // Added missing methods
  public serviceExists(serviceName: string): boolean {
    const config = this.loadConfig();
    // eslint-disable-next-line no-implicit-coercion
    return !!config.services?.[serviceName];
  }
  
  public getServiceRepository(serviceName: string): RepositoryConfig | null {
    const serviceConfig = this.getServiceConfig(serviceName);
    return serviceConfig?.repository || null;
  }
  
  public disconnectRepositoryFromService(serviceName: string): void {
    this.removeServiceRepository(serviceName);
  }
  
  // For testing purposes
  public getConfig(): ApsoConfig {
    return this.loadConfig();
  }
  
  public updateConfig(config: Partial<ApsoConfig>): void {
    const currentConfig = this.loadConfig();
    this.saveConfig({ ...currentConfig, ...config });
  }
  
  public getConnectedRepositories(): Array<{ service: string; url: string }> {
    const services = this.loadConfig().services || {};
    return Object.entries(services)
      .filter(([_, config]) => config.repository)
      .map(([service, config]) => ({
        service,
        url: config.repository!.url
      }));
  }
  
  public connectRepositoryToService(serviceName: string, repository: RepositoryConfig): void {
    this.setServiceRepository(serviceName, repository);
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