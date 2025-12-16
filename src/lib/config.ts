import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CliConfig {
  token?: string;
  user?: {
    id: number;
    email: string;
    fullName: string;
  };
  defaultWorkspace?: {
    id: number;
    name: string;
    slug?: string;
  };
  workspaces?: Array<{
    id: number;
    name: string;
    slug?: string;
  }>;
  lastUpdated?: string;
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    // Determine config directory based on OS
    const homeDir = os.homedir();
    this.configDir = process.platform === 'win32' ? path.join(process.env.APPDATA || homeDir, '.apso') : path.join(homeDir, '.apso');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Ensure config directory exists
   */
  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Read config from file
   */
  getConfig(): CliConfig | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        return null;
      }

      const data = fs.readFileSync(this.configPath);
      return JSON.parse(data.toString('utf8')) as CliConfig;
    } catch {
      // If file is corrupted or unreadable, return null
      return null;
    }
  }

  /**
   * Save config to file
   */
  saveConfig(config: CliConfig): void {
    try {
      this.ensureConfigDir();

      // Set last updated timestamp
      const updatedConfig: CliConfig = {
        ...config,
        lastUpdated: new Date().toISOString(),
      };

      // Write config file with restricted permissions (600 = owner read/write only)
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(updatedConfig, null, 2),
        { mode: 0o600 }
      );
    } catch (error) {
      throw new Error(`Failed to save config: ${(error as Error).message}`);
    }
  }

  /**
   * Update config (merge with existing)
   */
  updateConfig(updates: Partial<CliConfig>): void {
    const existing = this.getConfig() || {};
    const merged: CliConfig = {
      ...existing,
      ...updates,
      // Preserve nested objects by merging
      user: updates.user || existing.user,
      defaultWorkspace: updates.defaultWorkspace || existing.defaultWorkspace,
      workspaces: updates.workspaces || existing.workspaces,
    };
    this.saveConfig(merged);
  }

  /**
   * Clear config (logout)
   */
  clearConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath);
      }
    } catch (error) {
      throw new Error(`Failed to clear config: ${(error as Error).message}`);
    }
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    const config = this.getConfig();
    return Boolean(config && config.token);
  }

  /**
   * Get stored token
   */
  getToken(): string | null {
    const config = this.getConfig();
    return config?.token || null;
  }

  /**
   * Get default workspace ID
   */
  getDefaultWorkspaceId(): number | null {
    const config = this.getConfig();
    return config?.defaultWorkspace?.id || null;
  }
}

// Export singleton instance
export const configManager = new ConfigManager();