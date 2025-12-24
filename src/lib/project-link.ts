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
 * Find the project root by walking up the directory tree
 * looking for .apso/link.json. If not found, use current directory.
 *
 * IMPORTANT:
 * - We now always treat the directory that actually contains `.apso/link.json`
 *   as the project root, even if it is inside the CLI repo.
 * - This ensures that when you run `apso` from `cli/`, all paths
 *   (service-code dir, .apsorc, etc.) stay under `cli/` instead of
 *   escaping to the parent `Apso/` folder.
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  // Find project root (where .apso/link.json is)
  while (currentDir !== root) {
    const linkPath = path.join(currentDir, ".apso", "link.json");
    if (fs.existsSync(linkPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
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

/**
 * Get the detected project root directory (where .apso/link.json lives).
 *
 * This is the directory where Git operations (like `git pull`) should be run
 * when integrating with the platform's code push flows.
 */
export function getProjectRoot(cwd: string = process.cwd()): string {
  return findProjectRoot(cwd);
}

/**
 * Get the authoritative .apsorc file path.
 * 
 * Architecture: Code bundle .apsorc is the single source of truth
 * - .apso/service-code/.apsorc = authoritative (matches generated code in bundle)
 * - .apsorc (root) = convenience copy for editing
 * 
 * Priority: 1) Code bundle (.apso/service-code/.apsorc), 2) Root (.apsorc)
 * The code bundle version is authoritative because it matches the generated code.
 * 
 * Sync flow:
 * - After `pull`: code bundle .apsorc → root .apsorc (code bundle is authoritative)
 * - Before `push`: root .apsorc → code bundle .apsorc (ensure bundle has latest edits)
 */
export function getAuthoritativeApsorcPath(cwd: string = process.cwd()): string {
  const projectRoot = findProjectRoot(cwd);
  const codeBundleApsorc = path.join(projectRoot, ".apso", "service-code", ".apsorc");
  const rootApsorc = path.join(projectRoot, ".apsorc");

  // Prefer code bundle .apsorc if it exists and is valid
  if (fs.existsSync(codeBundleApsorc)) {
    // Validate code bundle .apsorc has required fields
    try {
      const content = fs.readFileSync(codeBundleApsorc, "utf8");
      const parsed = JSON.parse(content);
      if (parsed.version && parsed.rootFolder && parsed.apiType) {
        return codeBundleApsorc;
      }
      // Code bundle .apsorc exists but is incomplete, fall back to root
    } catch {
      // If we can't parse it, fall back to root
    }
  }

  // Fallback to root .apsorc
  return rootApsorc;
}

/**
 * Get the root .apsorc path (convenience copy for editing)
 */
export function getRootApsorcPath(cwd: string = process.cwd()): string {
  const projectRoot = findProjectRoot(cwd);
  return path.join(projectRoot, ".apsorc");
}

/**
 * Sync .apsorc from code bundle to root (for convenience editing)
 * Returns the path that was written to
 */
export function syncApsorcToRoot(cwd: string = process.cwd()): string | null {
  const projectRoot = findProjectRoot(cwd);
  const codeBundleApsorc = path.join(projectRoot, ".apso", "service-code", ".apsorc");
  const rootApsorc = path.join(projectRoot, ".apsorc");

  if (!fs.existsSync(codeBundleApsorc)) {
    return null;
  }

  // Copy code bundle .apsorc to root
  fs.copyFileSync(codeBundleApsorc, rootApsorc);
  return rootApsorc;
}

/**
 * Sync .apsorc from root to code bundle (before code upload)
 * Ensures code bundle has the latest schema before pushing
 */
export function syncApsorcToCodeBundle(cwd: string = process.cwd()): string | null {
  const projectRoot = findProjectRoot(cwd);
  const codeBundleApsorc = path.join(projectRoot, ".apso", "service-code", ".apsorc");
  const rootApsorc = path.join(projectRoot, ".apsorc");

  if (!fs.existsSync(rootApsorc)) {
    return null;
  }

  // Validate root .apsorc has required fields before syncing
  try {
    const rootContent = fs.readFileSync(rootApsorc, "utf8");
    const rootParsed = JSON.parse(rootContent);
    if (!rootParsed.version || !rootParsed.rootFolder || !rootParsed.apiType) {
      // Root .apsorc is incomplete, don't sync
      return null;
    }
  } catch {
    // If we can't parse root .apsorc, don't sync
    return null;
  }

  // Ensure code bundle directory exists
  const codeBundleDir = path.dirname(codeBundleApsorc);
  if (!fs.existsSync(codeBundleDir)) {
    fs.mkdirSync(codeBundleDir, { recursive: true });
  }

  // Copy root .apsorc to code bundle
  fs.copyFileSync(rootApsorc, codeBundleApsorc);
  return codeBundleApsorc;
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


