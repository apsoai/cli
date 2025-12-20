/**
 * Platform CLI Configuration Paths
 *
 * Manages file paths for global and project-level configuration.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * Get the global configuration directory (~/.apso/)
 * Can be overridden with APSO_CONFIG_DIR environment variable
 */
export function getGlobalConfigDir(): string {
  const envDir = process.env.APSO_CONFIG_DIR;
  if (envDir) {
    return envDir;
  }
  return path.join(os.homedir(), ".apso");
}

/**
 * Get path to global config file (~/.apso/config.json)
 */
export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), "config.json");
}

/**
 * Get path to credentials file (~/.apso/credentials.json)
 */
export function getCredentialsPath(): string {
  return path.join(getGlobalConfigDir(), "credentials.json");
}

/**
 * Get path to cache directory (~/.apso/cache/)
 */
export function getCacheDir(): string {
  return path.join(getGlobalConfigDir(), "cache");
}

/**
 * Get project-level config directory (.apso/)
 * @param projectDir - The project directory (defaults to cwd)
 */
export function getProjectConfigDir(projectDir?: string): string {
  return path.join(projectDir || process.cwd(), ".apso");
}

/**
 * Get path to project link file (.apso/link.json)
 * @param projectDir - The project directory (defaults to cwd)
 */
export function getProjectLinkPath(projectDir?: string): string {
  return path.join(getProjectConfigDir(projectDir), "link.json");
}

/**
 * Get path to sync queue file (.apso/sync-queue.json)
 * @param projectDir - The project directory (defaults to cwd)
 */
export function getSyncQueuePath(projectDir?: string): string {
  return path.join(getProjectConfigDir(projectDir), "sync-queue.json");
}

/**
 * Get path to project backups directory (.apso/backups/)
 * @param projectDir - The project directory (defaults to cwd)
 */
export function getProjectBackupsDir(projectDir?: string): string {
  return path.join(getProjectConfigDir(projectDir), "backups");
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param dirPath - Path to the directory
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure the global config directory exists with correct permissions
 */
export function ensureGlobalConfigDir(): void {
  const configDir = getGlobalConfigDir();
  ensureDir(configDir);

  // Set restrictive permissions on Unix systems
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(configDir, 0o700);
    } catch {
      // Ignore permission errors (e.g., on some CI systems)
    }
  }
}

/**
 * Ensure the project config directory exists
 * @param projectDir - The project directory (defaults to cwd)
 */
export function ensureProjectConfigDir(projectDir?: string): void {
  ensureDir(getProjectConfigDir(projectDir));
}

/**
 * Check if a project is linked to the platform
 * @param projectDir - The project directory (defaults to cwd)
 */
export function isProjectLinked(projectDir?: string): boolean {
  return fs.existsSync(getProjectLinkPath(projectDir));
}

/**
 * Check if user is authenticated (credentials file exists)
 */
export function hasCredentials(): boolean {
  return fs.existsSync(getCredentialsPath());
}
