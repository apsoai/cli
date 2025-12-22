import * as fs from "fs";
import * as path from "path";


export interface ProjectLink {
  workspaceId: string;
  workspaceSlug: string;
  serviceId: string;
  serviceSlug: string;

  githubRepo: string | null; // e.g., "acme-corp/api-v1"
  githubBranch: string | null; // e.g., "main"

  linkedAt: string; // ISO 8601
  lastSyncedAt: string | null; // ISO 8601
  lastSyncDirection: "pull" | "push" | "both" | null;

  localSchemaHash: string | null;
  remoteSchemaHash: string | null;

  createdBy: string; // User email if available

  cliVersion?: string;
}

export interface ExistingLinkInfo {
  link: ProjectLink;
  path: string;
}

/**
 * Check if a directory is the CLI repository
 */
function isCliRepository(dir: string): boolean {
  const packageJsonPath = path.join(dir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageJson.name === "@apso/cli";
  } catch {
    return false;
  }
}

/**
 * Find the project root by walking up the directory tree
 * looking for .apso/link.json. If not found, use current directory.
 * Also ensures we're outside the CLI repository if we're inside it.
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;
  let cliRepoPath: string | null = null;

  // First, check if we're inside the CLI repository
  let checkDir = currentDir;
  while (checkDir !== root) {
    if (isCliRepository(checkDir)) {
      cliRepoPath = checkDir;
      break;
    }
    checkDir = path.dirname(checkDir);
  }

  // Find project root (where .apso/link.json is)
  while (currentDir !== root) {
    const linkPath = path.join(currentDir, ".apso", "link.json");
    if (fs.existsSync(linkPath)) {
      // If we found the project root, check if it's inside the CLI repo
      if (cliRepoPath && currentDir.startsWith(cliRepoPath)) {
        // Project root is inside CLI repo, use parent directory
        return path.dirname(cliRepoPath);
      }
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // If no .apso/link.json found, but we're in CLI repo, use parent
  if (cliRepoPath) {
    return path.dirname(cliRepoPath);
  }

  // Otherwise, return the original directory
  return path.resolve(startDir);
}

function getApsoDir(cwd: string = process.cwd()): string {
  const projectRoot = findProjectRoot(cwd);
  return path.join(projectRoot, ".apso");
}

function getLinkFilePath(cwd: string = process.cwd()): string {
  // For link.json, we still want to find it even if we're in CLI repo
  let currentDir = path.resolve(cwd);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const linkPath = path.join(currentDir, ".apso", "link.json");
    if (fs.existsSync(linkPath)) {
      return linkPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback to project root
  const projectRoot = findProjectRoot(cwd);
  return path.join(projectRoot, ".apso", "link.json");
}

export function getServiceCodeDir(cwd: string = process.cwd()): string {
  const projectRoot = findProjectRoot(cwd);
  return path.join(projectRoot, ".apso", "service-code");
}


export function readProjectLink(
  cwd: string = process.cwd()
): ExistingLinkInfo | null {
  const linkPath = getLinkFilePath(cwd);

  if (!fs.existsSync(linkPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(linkPath, "utf8");
    const data = JSON.parse(raw) as Partial<ProjectLink>;

    validateProjectLink(data);

    return {
      link: data as ProjectLink,
      path: linkPath,
    };
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Failed to read or validate ".apso/link.json": ${err.message}\n` +
        `You can fix or remove the file and re-run "apso link".`
    );
  }
}

export function validateProjectLink(data: Partial<ProjectLink>): void {
  const requiredString = [
    "workspaceId",
    "workspaceSlug",
    "serviceId",
    "serviceSlug",
    "linkedAt",
    "createdBy",
  ] as const;

  for (const key of requiredString) {
    const value = data[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`link.json is missing required field "${key}".`);
    }
  }
}

export interface WriteLinkOptions {
  cwd?: string;
  cliVersion?: string;
}

export function writeProjectLink(
  link: ProjectLink,
  options: WriteLinkOptions = {}
): string {
  const cwd = options.cwd ?? process.cwd();
  const apsoDir = getApsoDir(cwd);
  const linkPath = getLinkFilePath(cwd);

  if (!fs.existsSync(apsoDir)) {
    fs.mkdirSync(apsoDir, { recursive: true, mode: 0o700 });
  }

  const payload: ProjectLink = {
    ...link,
    cliVersion: options.cliVersion ?? link.cliVersion,
  };

  const json = JSON.stringify(payload, null, 2);

  fs.writeFileSync(linkPath, json, { mode: 0o600 });

  try {
    // On Windows this might fail; ignore errors.
    fs.chmodSync(linkPath, 0o600);
  } catch {
    // no-op
  }

  return linkPath;
}

export function isSameLink(
  a: ProjectLink | null | undefined,
  b: ProjectLink | null | undefined
): boolean {
  if (!a || !b) {
    return false;
  }

  return (
    a.workspaceId === b.workspaceId &&
    a.serviceId === b.serviceId &&
    a.workspaceSlug === b.workspaceSlug &&
    a.serviceSlug === b.serviceSlug
  );
}

/**
 * Update schema hashes in project link
 */
export function updateSchemaHashes(
  link: ProjectLink,
  localHash: string | null,
  remoteHash: string | null
): ProjectLink {
  return {
    ...link,
    localSchemaHash: localHash,
    remoteSchemaHash: remoteHash,
  };
}

/**
 * Update only the local schema hash
 */
export function updateLocalSchemaHash(
  link: ProjectLink,
  localHash: string | null
): ProjectLink {
  return {
    ...link,
    localSchemaHash: localHash,
  };
}

/**
 * Update only the remote schema hash
 */
export function updateRemoteSchemaHash(
  link: ProjectLink,
  remoteHash: string | null
): ProjectLink {
  return {
    ...link,
    remoteSchemaHash: remoteHash,
  };
}


