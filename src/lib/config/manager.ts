/**
 * Configuration Manager
 *
 * Handles reading/writing configuration and credentials files
 * with proper security measures.
 */

import * as fs from "fs";
import * as path from "path";
import {
  CredentialsFile,
  GlobalConfigFile,
  ProjectLinkFile,
  SyncQueueFile,
  SyncQueueItem,
  DEFAULT_GLOBAL_CONFIG,
  CONFIG_ENV_VARS,
} from "./types";
import {
  getGlobalConfigPath,
  getCredentialsPath,
  getProjectLinkPath,
  getSyncQueuePath,
  getProjectBackupsDir,
  ensureGlobalConfigDir,
  ensureProjectConfigDir,
  ensureDir,
} from "./paths";

// Get CLI version from package.json
let cliVersion = "0.0.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("../../../package.json");
  cliVersion = pkg.version;
} catch {
  // Ignore if package.json not found
}

/**
 * Read JSON file safely
 */
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file with optional restrictive permissions
 */
function writeJsonFile(
  filePath: string,
  data: unknown,
  secure = false
): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, "utf-8");

  // Set restrictive permissions for sensitive files on Unix
  if (secure && process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Ignore permission errors
    }
  }
}

/**
 * Global Configuration Manager
 */
export const globalConfig = {
  /**
   * Read global configuration, merging defaults and environment variables
   */
  read(): GlobalConfigFile {
    ensureGlobalConfigDir();
    const fileConfig = readJsonFile<Partial<GlobalConfigFile>>(
      getGlobalConfigPath()
    );

    // Start with defaults
    const config = { ...DEFAULT_GLOBAL_CONFIG };

    // Merge file config
    if (fileConfig) {
      Object.assign(config, fileConfig);
    }

    // Override with environment variables
    if (process.env.APSO_API_URL) {
      config.apiUrl = process.env.APSO_API_URL;
    }
    if (process.env.APSO_WEB_URL) {
      config.webUrl = process.env.APSO_WEB_URL;
    }
    if (process.env.APSO_DEBUG === "true" || process.env.APSO_DEBUG === "1") {
      config.verbose = true;
    }
    if (
      process.env.APSO_NO_COLOR === "true" ||
      process.env.APSO_NO_COLOR === "1" ||
      process.env.NO_COLOR
    ) {
      config.noColor = true;
    }

    return config;
  },

  /**
   * Write global configuration
   */
  write(config: Partial<GlobalConfigFile>): void {
    ensureGlobalConfigDir();
    const existing = this.read();
    const merged = { ...existing, ...config };
    writeJsonFile(getGlobalConfigPath(), merged);
  },

  /**
   * Get a specific configuration value
   */
  get<K extends keyof GlobalConfigFile>(key: K): GlobalConfigFile[K] {
    return this.read()[key];
  },

  /**
   * Set a specific configuration value
   */
  set<K extends keyof GlobalConfigFile>(
    key: K,
    value: GlobalConfigFile[K]
  ): void {
    this.write({ [key]: value });
  },

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    writeJsonFile(getGlobalConfigPath(), DEFAULT_GLOBAL_CONFIG);
  },
};

/**
 * Credentials Manager
 */
export const credentials = {
  /**
   * Read stored credentials
   */
  read(): CredentialsFile | null {
    return readJsonFile<CredentialsFile>(getCredentialsPath());
  },

  /**
   * Write credentials (with secure file permissions)
   */
  write(creds: Omit<CredentialsFile, "updatedAt" | "cliVersion">): void {
    ensureGlobalConfigDir();
    const fullCreds: CredentialsFile = {
      ...creds,
      updatedAt: new Date().toISOString(),
      cliVersion,
    };
    writeJsonFile(getCredentialsPath(), fullCreds, true);
  },

  /**
   * Clear stored credentials
   */
  clear(): void {
    const credsPath = getCredentialsPath();
    if (fs.existsSync(credsPath)) {
      fs.unlinkSync(credsPath);
    }
  },

  /**
   * Check if credentials exist and are not expired
   */
  isValid(): boolean {
    const creds = this.read();
    if (!creds) {
      return false;
    }

    // Check if access token is expired
    const expiresAt = new Date(creds.tokens.expiresAt);
    const now = new Date();
    return expiresAt > now;
  },

  /**
   * Check if credentials exist (may be expired)
   */
  exists(): boolean {
    return this.read() !== null;
  },

  /**
   * Check if token needs refresh (expires within 5 minutes)
   */
  needsRefresh(): boolean {
    const creds = this.read();
    if (!creds) {
      return false;
    }

    const expiresAt = new Date(creds.tokens.expiresAt);
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return expiresAt <= fiveMinutesFromNow;
  },
};

/**
 * Project Link Manager
 */
export const projectLink = {
  /**
   * Read project link configuration
   */
  read(projectDir?: string): ProjectLinkFile | null {
    return readJsonFile<ProjectLinkFile>(getProjectLinkPath(projectDir));
  },

  /**
   * Write project link configuration
   */
  write(link: ProjectLinkFile, projectDir?: string): void {
    ensureProjectConfigDir(projectDir);
    writeJsonFile(getProjectLinkPath(projectDir), link);
  },

  /**
   * Remove project link
   */
  remove(projectDir?: string): void {
    const linkPath = getProjectLinkPath(projectDir);
    if (fs.existsSync(linkPath)) {
      fs.unlinkSync(linkPath);
    }
  },

  /**
   * Check if project is linked
   */
  exists(projectDir?: string): boolean {
    return this.read(projectDir) !== null;
  },

  /**
   * Update sync metadata after successful sync
   */
  updateSyncMetadata(
    metadata: {
      lastSyncedAt: string;
      localSchemaHash: string;
      remoteSchemaHash: string;
    },
    projectDir?: string
  ): void {
    const link = this.read(projectDir);
    if (link) {
      this.write({ ...link, ...metadata }, projectDir);
    }
  },
};

/**
 * Sync Queue Manager
 */
export const syncQueue = {
  /**
   * Read sync queue
   */
  read(projectDir?: string): SyncQueueFile {
    const queue = readJsonFile<SyncQueueFile>(getSyncQueuePath(projectDir));
    return queue || { version: 1, operations: [] };
  },

  /**
   * Write sync queue
   */
  write(queue: SyncQueueFile, projectDir?: string): void {
    ensureProjectConfigDir(projectDir);
    writeJsonFile(getSyncQueuePath(projectDir), queue);
  },

  /**
   * Add operation to queue
   */
  add(
    operation: Omit<SyncQueueItem, "id" | "queuedAt" | "retryCount">,
    projectDir?: string
  ): string {
    const queue = this.read(projectDir);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const item: SyncQueueItem = {
      ...operation,
      id,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    };
    queue.operations.push(item);
    this.write(queue, projectDir);
    return id;
  },

  /**
   * Remove operation from queue
   */
  remove(id: string, projectDir?: string): void {
    const queue = this.read(projectDir);
    queue.operations = queue.operations.filter((op) => op.id !== id);
    this.write(queue, projectDir);
  },

  /**
   * Get pending operations count
   */
  count(projectDir?: string): number {
    return this.read(projectDir).operations.length;
  },

  /**
   * Clear all operations
   */
  clear(projectDir?: string): void {
    this.write({ version: 1, operations: [] }, projectDir);
  },

  /**
   * Update operation retry count and error
   */
  updateRetry(
    id: string,
    error: string,
    projectDir?: string
  ): void {
    const queue = this.read(projectDir);
    const op = queue.operations.find((o) => o.id === id);
    if (op) {
      op.retryCount += 1;
      op.lastError = error;
      this.write(queue, projectDir);
    }
  },
};

/**
 * Create a backup of a file
 */
export function createBackup(
  filePath: string,
  projectDir?: string
): string {
  const backupsDir = getProjectBackupsDir(projectDir);
  ensureDir(backupsDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = path.basename(filePath);
  const backupPath = path.join(backupsDir, `${fileName}-${timestamp}`);

  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}
