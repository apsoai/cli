import * as path from "path";
import * as fs from "fs";
import type { ProjectLink } from "../types/link";

/**
 * Name of the link configuration file
 */
export const LINK_FILE_NAME = "link.json";

/**
 * Name of the .apso directory
 */
export const APSO_DIR_NAME = ".apso";

/**
 * Finds the project root directory by searching upwards for .apsorc or .apso directory.
 * @returns The absolute path to the project root, or null if not found.
 */
export const findProjectRoot = (): string | null => {
  let currentDir = process.cwd();

  while (currentDir !== path.parse(currentDir).root) {
    const apsorcPath = path.join(currentDir, ".apsorc");
    const apsoDirPath = path.join(currentDir, APSO_DIR_NAME);

    // If we find either .apsorc or .apso directory, this is the project root
    if (fs.existsSync(apsorcPath) || fs.existsSync(apsoDirPath)) {
      return currentDir;
    }

    currentDir = path.dirname(currentDir);
  }

  // Check root directory as well
  const rootApsorcPath = path.join(currentDir, ".apsorc");
  const rootApsoDirPath = path.join(currentDir, APSO_DIR_NAME);

  if (fs.existsSync(rootApsorcPath) || fs.existsSync(rootApsoDirPath)) {
    return currentDir;
  }

  return null;
};

/**
 * Gets the path to the .apso directory for the current project.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns The absolute path to the .apso directory, or null if project root not found.
 */
export const getApsoDirPath = (projectRoot?: string | null): string | null => {
  const root = projectRoot ?? findProjectRoot();
  if (!root) {
    return null;
  }
  return path.join(root, APSO_DIR_NAME);
};

/**
 * Gets the path to the link.json file for the current project.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns The absolute path to link.json, or null if project root not found.
 */
export const getLinkFilePath = (projectRoot?: string | null): string | null => {
  const apsoDir = getApsoDirPath(projectRoot);
  if (!apsoDir) {
    return null;
  }
  return path.join(apsoDir, LINK_FILE_NAME);
};

/**
 * Ensures the .apso directory exists in the project root.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns The absolute path to the .apso directory, or null if project root not found.
 * @throws Error if directory creation fails.
 */
export const ensureApsoDir = async (
  projectRoot?: string | null
): Promise<string | null> => {
  const root = projectRoot ?? findProjectRoot();
  if (!root) {
    return null;
  }

  const apsoDir = path.join(root, APSO_DIR_NAME);

  if (!fs.existsSync(apsoDir)) {
    await fs.promises.mkdir(apsoDir, { recursive: true });
  }

  return apsoDir;
};

/**
 * Reads and parses the link.json file.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns The parsed ProjectLink object, or null if file doesn't exist or is invalid.
 */
export const readLinkFile = async (
  projectRoot?: string | null
): Promise<ProjectLink | null> => {
  const linkFilePath = getLinkFilePath(projectRoot);
  if (!linkFilePath || !fs.existsSync(linkFilePath)) {
    return null;
  }

  try {
    const buffer = await fs.promises.readFile(linkFilePath);
    const link = JSON.parse(buffer.toString("utf-8")) as ProjectLink;
    return link;
  } catch {
    // File exists but is invalid JSON or unreadable
    return null;
  }
};

/**
 * Writes the link.json file with the provided ProjectLink data.
 * @param link The ProjectLink object to write.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @throws Error if project root not found, directory creation fails, or file write fails.
 */
export const writeLinkFile = async (
  link: ProjectLink,
  projectRoot?: string | null
): Promise<void> => {
  const root = projectRoot ?? findProjectRoot();
  if (!root) {
    throw new Error(
      "Project root not found. Please run this command from within an Apso project directory."
    );
  }

  const apsoDir = await ensureApsoDir(root);
  if (!apsoDir) {
    throw new Error("Failed to create .apso directory");
  }

  const linkFilePath = path.join(apsoDir, LINK_FILE_NAME);
  const content = JSON.stringify(link, null, 2);

  await fs.promises.writeFile(linkFilePath, content, "utf-8");
};

/**
 * Checks if the current project is linked to a platform service.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns Promise resolving to true if link.json exists and is valid, false otherwise.
 */
export const isProjectLinked = async (
  projectRoot?: string | null
): Promise<boolean> => {
  const link = await readLinkFile(projectRoot);
  return link !== null;
};

/**
 * Deletes the link.json file, effectively unlinking the project.
 * @param projectRoot Optional project root. If not provided, will search for it.
 * @returns true if file was deleted, false if it didn't exist or couldn't be deleted.
 */
export const deleteLinkFile = async (
  projectRoot?: string | null
): Promise<boolean> => {
  const linkFilePath = getLinkFilePath(projectRoot);
  if (!linkFilePath || !fs.existsSync(linkFilePath)) {
    return false;
  }

  try {
    await fs.promises.unlink(linkFilePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validates a ProjectLink object to ensure it has all required fields.
 * @param link The ProjectLink object to validate.
 * @returns An object with isValid boolean and errors array.
 */
export const validateLink = (link: Partial<ProjectLink>): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!link.workspaceId || typeof link.workspaceId !== "string") {
    errors.push("workspaceId is required and must be a string");
  }

  if (!link.workspaceSlug || typeof link.workspaceSlug !== "string") {
    errors.push("workspaceSlug is required and must be a string");
  }

  if (!link.serviceId || typeof link.serviceId !== "string") {
    errors.push("serviceId is required and must be a string");
  }

  if (!link.serviceSlug || typeof link.serviceSlug !== "string") {
    errors.push("serviceSlug is required and must be a string");
  }

  if (link.githubRepo !== null && typeof link.githubRepo !== "string") {
    errors.push("githubRepo must be a string or null");
  }

  if (!link.githubBranch || typeof link.githubBranch !== "string") {
    errors.push("githubBranch is required and must be a string");
  }

  if (!link.linkedAt || typeof link.linkedAt !== "string") {
    errors.push("linkedAt is required and must be a string (ISO 8601)");
  }

  if (
    link.lastSyncedAt !== null &&
    typeof link.lastSyncedAt !== "string"
  ) {
    errors.push("lastSyncedAt must be a string (ISO 8601) or null");
  }

  if (
    link.lastSyncDirection !== null &&
    link.lastSyncDirection !== undefined &&
    !["pull", "push", "both"].includes(link.lastSyncDirection)
  ) {
    errors.push(
      "lastSyncDirection must be 'pull', 'push', 'both', or null"
    );
  }

  if (
    link.localSchemaHash !== null &&
    typeof link.localSchemaHash !== "string"
  ) {
    errors.push("localSchemaHash must be a string or null");
  }

  if (
    link.remoteSchemaHash !== null &&
    typeof link.remoteSchemaHash !== "string"
  ) {
    errors.push("remoteSchemaHash must be a string or null");
  }

  if (!link.createdBy || typeof link.createdBy !== "string") {
    errors.push("createdBy is required and must be a string (user email)");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Creates a new ProjectLink object with default values.
 * @param partialLink Partial ProjectLink with required fields.
 * @returns A complete ProjectLink object with defaults filled in.
 */
export const createLink = (
  partialLink: Pick<
    ProjectLink,
    "workspaceId" | "workspaceSlug" | "serviceId" | "serviceSlug" | "createdBy"
  > &
    Partial<
      Pick<
        ProjectLink,
        | "githubRepo"
        | "githubBranch"
        | "lastSyncedAt"
        | "lastSyncDirection"
        | "localSchemaHash"
        | "remoteSchemaHash"
      >
    >
): ProjectLink => {
  return {
    workspaceId: partialLink.workspaceId,
    workspaceSlug: partialLink.workspaceSlug,
    serviceId: partialLink.serviceId,
    serviceSlug: partialLink.serviceSlug,
    githubRepo: partialLink.githubRepo ?? null,
    githubBranch: partialLink.githubBranch ?? "main",
    linkedAt: new Date().toISOString(),
    lastSyncedAt: partialLink.lastSyncedAt ?? null,
    lastSyncDirection: partialLink.lastSyncDirection ?? null,
    localSchemaHash: partialLink.localSchemaHash ?? null,
    remoteSchemaHash: partialLink.remoteSchemaHash ?? null,
    createdBy: partialLink.createdBy,
  };
};

