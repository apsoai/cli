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

function getApsoDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".apso");
}

function getLinkFilePath(cwd: string = process.cwd()): string {
  return path.join(getApsoDir(cwd), "link.json");
}

export function getServiceCodeDir(cwd: string = process.cwd()): string {
  return path.join(getApsoDir(cwd), "service-code");
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


