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
    const contentBuffer = fs.readFileSync(CONFIG_FILE);
    const content = contentBuffer.toString("utf-8");
    return JSON.parse(content) as Config;
  } catch {
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
    const contentBuffer = fs.readFileSync(CREDENTIALS_FILE);
    const content = contentBuffer.toString("utf-8");
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

/**
 * Write credentials.json with secure permissions (0600)
 */
export function writeCredentials(credentials: Credentials): void {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
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
 * Auto-detect web URL from API URL (without checking environment variables)
 * Internal helper function
 */
function autoDetectWebUrlFromApiUrl(): string {
  const apiUrl = getApiBaseUrl();
  try {
    const apiUrlObj = new URL(apiUrl);
    
    // If API is localhost, assume web is on port 3000 (API is typically 3001)
    if (apiUrlObj.hostname === "localhost" || apiUrlObj.hostname === "127.0.0.1") {
      return `http://${apiUrlObj.hostname}:3000`;
    }
    
    // If API hostname contains "api.", replace with "app." to get web URL
    // Examples:
    //   api.staging.apso.dev -> app.staging.apso.dev
    //   api.apso.cloud -> app.apso.cloud
    //   api.apso.ai -> app.apso.ai
    if (apiUrlObj.hostname.includes("api.")) {
      const webHostname = apiUrlObj.hostname.replace("api.", "app.");
      return `${apiUrlObj.protocol}//${webHostname}`;
    }
    
    // If API hostname contains "staging", try to infer staging web URL
    if (apiUrlObj.hostname.includes("staging")) {
      // Try common patterns: api.staging.* -> app.staging.*
      const webHostname = apiUrlObj.hostname.replace(/^api\./, "app.");
      return `${apiUrlObj.protocol}//${webHostname}`;
    }
  } catch {
    // If URL parsing fails, continue to default
  }

  // Default to production
  return "https://app.apso.cloud";
}

/**
 * Get web app base URL - auto-detected from API URL or environment variable
 * If API is localhost:3001, web is localhost:3000
 * If API is api.staging.apso.dev, web is app.staging.apso.dev
 * If API is api.apso.cloud, web is app.apso.cloud
 * Otherwise defaults to production
 */
export async function getWebBaseUrl(): Promise<string> {
  // 1. Check environment variable (highest priority)
  if (process.env.APSO_WEB_URL) {
    return process.env.APSO_WEB_URL;
  }

  // 2. Auto-detect from API URL
  return autoDetectWebUrlFromApiUrl();
}

/**
 * Get auto-detected web URL without checking environment variables
 * Useful when you need to compare with env var to detect mismatches
 */
export function getAutoDetectedWebUrl(): string {
  return autoDetectWebUrlFromApiUrl();
}

/**
 * Synchronous version (for cases where we can't use async)
 * Auto-detects from API URL or uses environment variable
 */
export function getWebBaseUrlSync(): string {
  // 1. Check environment variable (highest priority)
  if (process.env.APSO_WEB_URL) {
    return process.env.APSO_WEB_URL;
  }

  // 2. Auto-detect from API URL
  return autoDetectWebUrlFromApiUrl();
}
