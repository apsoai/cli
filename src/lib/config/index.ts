import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Config {
  defaultWorkspace?: string;
  defaultService?: string;
  editor?: string;
  colorScheme?: "auto" | "light" | "dark";
  jsonOutput?: boolean;
  telemetry?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
  webUrl?: string; // Preferred web app URL (e.g., http://localhost:3000 or https://app.apso.cloud)
  apiUrl?: string; // Preferred API URL (e.g., http://localhost:3001 or https://api.apso.cloud)
}

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601 timestamp
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), ".apso");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

/**
 * Ensure the ~/.apso directory exists
 */
export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Read config.json, creating default if it doesn't exist
 */
export function readConfig(): Config {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: Config = {
      colorScheme: "auto",
      jsonOutput: false,
      telemetry: true,
      logLevel: "info",
    };
    writeConfig(defaultConfig);
    return defaultConfig;
  }
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as Config;
  } catch (error) {
    // If file is corrupted, return defaults
    const defaultConfig: Config = {
      colorScheme: "auto",
      jsonOutput: false,
      telemetry: true,
      logLevel: "info",
    };
    writeConfig(defaultConfig);
    return defaultConfig;
  }
}

/**
 * Write config.json
 */
export function writeConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  // On Windows, explicitly set permissions after write
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Ignore errors on platforms that don't support chmod
  }
}

/**
 * Update specific config values
 */
export function updateConfig(updates: Partial<Config>): Config {
  const config = readConfig();
  const updated = { ...config, ...updates };
  writeConfig(updated);
  return updated;
}

/**
 * Read credentials.json
 */
export function readCredentials(): Credentials | null {
  ensureConfigDir();
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    const content = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(content) as Credentials;
  } catch (error) {
    return null;
  }
}

/**
 * Write credentials.json with secure permissions (0600)
 */
export function writeCredentials(credentials: Credentials): void {
  ensureConfigDir();
  fs.writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify(credentials, null, 2),
    { mode: 0o600 }
  );
  // On Windows, explicitly set permissions after write
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    // Ignore errors on platforms that don't support chmod
  }
}

/**
 * Delete credentials.json
 */
export function deleteCredentials(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const creds = readCredentials();
  if (!creds) {
    return false;
  }
  // Check if token is expired
  const expiresAt = new Date(creds.expiresAt);
  return expiresAt > new Date();
}


/**
 * Get API base URL from config, environment, or default
 */
export function getApiBaseUrl(): string {
  // 1. Check environment variable (highest priority)
  if (process.env.APSO_API_URL) {
    return process.env.APSO_API_URL;
  }
  
  // 2. Check config file
  const config = readConfig();
  if (config.apiUrl) {
    return config.apiUrl;
  }
  
  // 3. Default to production
  return "https://api.apso.cloud";
}

/**
 * Get web app base URL from config, environment, or default to production
 */
export async function getWebBaseUrl(): Promise<string> {
  // 1. Check environment variable (highest priority)
  if (process.env.APSO_WEB_URL) {
    return process.env.APSO_WEB_URL;
  }
  
  // 2. Check config file
  const config = readConfig();
  if (config.webUrl) {
    return config.webUrl;
  }
  
  // 3. Default to production
  return "https://app.apso.cloud";
}

/**
 * Synchronous version (for cases where we can't use async)
 * Uses config file or environment variable only
 */
export function getWebBaseUrlSync(): string {
  // 1. Check environment variable (highest priority)
  if (process.env.APSO_WEB_URL) {
    return process.env.APSO_WEB_URL;
  }
  
  // 2. Check config file
  const config = readConfig();
  if (config.webUrl) {
    return config.webUrl;
  }
  
  // 3. Default to production
  return "https://app.apso.cloud";
}
