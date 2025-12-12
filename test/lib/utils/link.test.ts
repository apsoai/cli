import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  findProjectRoot,
  getApsoDirPath,
  getLinkFilePath,
  ensureApsoDir,
  readLinkFile,
  writeLinkFile,
  isProjectLinked,
  deleteLinkFile,
  validateLink,
  createLink,
  APSO_DIR_NAME,
  LINK_FILE_NAME,
} from "../../../src/lib/utils/link";
import type { ProjectLink } from "../../../src/lib/types/link";

describe("Link Utilities", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save original working directory
    originalCwd = process.cwd();
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-test-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("findProjectRoot", () => {
    test("should find project root when .apsorc exists", () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const subdir = path.join(projectRoot, "subdir");
      fs.mkdirSync(subdir, { recursive: true });
      process.chdir(subdir);
      const found = findProjectRoot();

      expect(found).toBe(projectRoot);
    });

    test("should find project root when .apso directory exists", () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(path.join(projectRoot, APSO_DIR_NAME), { recursive: true });

      const subdir = path.join(projectRoot, "subdir");
      fs.mkdirSync(subdir, { recursive: true });
      process.chdir(subdir);
      const found = findProjectRoot();

      expect(found).toBe(projectRoot);
    });

    test("should return null when no project root found", () => {
      const found = findProjectRoot();
      expect(found).toBeNull();
    });

    test("should find project root in current directory", () => {
      const projectRoot = tempDir;
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const found = findProjectRoot();
      expect(found).toBe(projectRoot);
    });
  });

  describe("getApsoDirPath", () => {
    test("should return path to .apso directory", () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const apsoDir = getApsoDirPath(projectRoot);
      expect(apsoDir).toBe(path.join(projectRoot, APSO_DIR_NAME));
    });

    test("should return null when project root not found", () => {
      const apsoDir = getApsoDirPath();
      expect(apsoDir).toBeNull();
    });
  });

  describe("getLinkFilePath", () => {
    test("should return path to link.json", () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const linkPath = getLinkFilePath(projectRoot);
      expect(linkPath).toBe(
        path.join(projectRoot, APSO_DIR_NAME, LINK_FILE_NAME)
      );
    });

    test("should return null when project root not found", () => {
      const linkPath = getLinkFilePath();
      expect(linkPath).toBeNull();
    });
  });

  describe("ensureApsoDir", () => {
    test("should create .apso directory if it doesn't exist", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const apsoDir = await ensureApsoDir(projectRoot);

      expect(apsoDir).toBe(path.join(projectRoot, APSO_DIR_NAME));
      expect(apsoDir).not.toBeNull();
      expect(fs.existsSync(apsoDir!)).toBe(true);
    });

    test("should not fail if .apso directory already exists", async () => {
      const projectRoot = path.join(tempDir, "project");
      const apsoDirPath = path.join(projectRoot, APSO_DIR_NAME);
      fs.mkdirSync(apsoDirPath, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const apsoDir = await ensureApsoDir(projectRoot);

      expect(apsoDir).toBe(apsoDirPath);
      expect(apsoDir).not.toBeNull();
      expect(fs.existsSync(apsoDir!)).toBe(true);
    });

    test("should return null when project root not found", async () => {
      const apsoDir = await ensureApsoDir();
      expect(apsoDir).toBeNull();
    });
  });

  describe("createLink", () => {
    test("should create link with required fields and defaults", () => {
      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
      });

      expect(link.workspaceId).toBe("ws_123");
      expect(link.workspaceSlug).toBe("test-workspace");
      expect(link.serviceId).toBe("svc_456");
      expect(link.serviceSlug).toBe("test-service");
      expect(link.createdBy).toBe("test@example.com");
      expect(link.githubBranch).toBe("main");
      expect(link.githubRepo).toBeNull();
      expect(link.linkedAt).toBeDefined();
      expect(link.lastSyncedAt).toBeNull();
      expect(link.lastSyncDirection).toBeNull();
      expect(link.localSchemaHash).toBeNull();
      expect(link.remoteSchemaHash).toBeNull();
    });

    test("should use provided optional fields", () => {
      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
        githubRepo: "owner/repo",
        githubBranch: "develop",
        localSchemaHash: "sha256:abc123",
      });

      expect(link.githubRepo).toBe("owner/repo");
      expect(link.githubBranch).toBe("develop");
      expect(link.localSchemaHash).toBe("sha256:abc123");
    });
  });

  describe("validateLink", () => {
    test("should validate a complete valid link", () => {
      const link: ProjectLink = {
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        githubRepo: "owner/repo",
        githubBranch: "main",
        linkedAt: new Date().toISOString(),
        lastSyncedAt: null,
        lastSyncDirection: null,
        localSchemaHash: null,
        remoteSchemaHash: null,
        createdBy: "test@example.com",
      };

      const result = validateLink(link);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject link with missing required fields", () => {
      const link = {
        workspaceId: "ws_123",
        // Missing workspaceSlug, serviceId, etc.
      };

      const result = validateLink(link);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should reject invalid lastSyncDirection", () => {
      const link: Partial<ProjectLink> = {
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        githubBranch: "main",
        linkedAt: new Date().toISOString(),
        createdBy: "test@example.com",
        lastSyncDirection: "invalid" as any,
      };

      const result = validateLink(link);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("lastSyncDirection"))).toBe(
        true
      );
    });

    test("should accept null values for optional fields", () => {
      const link: ProjectLink = {
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        githubRepo: null,
        githubBranch: "main",
        linkedAt: new Date().toISOString(),
        lastSyncedAt: null,
        lastSyncDirection: null,
        localSchemaHash: null,
        remoteSchemaHash: null,
        createdBy: "test@example.com",
      };

      const result = validateLink(link);
      expect(result.isValid).toBe(true);
    });
  });

  describe("writeLinkFile and readLinkFile", () => {
    test("should write and read link file successfully", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
      });

      await writeLinkFile(link, projectRoot);

      const readLink = await readLinkFile(projectRoot);

      expect(readLink).not.toBeNull();
      expect(readLink?.workspaceId).toBe(link.workspaceId);
      expect(readLink?.workspaceSlug).toBe(link.workspaceSlug);
      expect(readLink?.serviceId).toBe(link.serviceId);
      expect(readLink?.serviceSlug).toBe(link.serviceSlug);
      expect(readLink?.createdBy).toBe(link.createdBy);
    });

    test("should throw error when project root not found", async () => {
      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
      });

      await expect(writeLinkFile(link, null)).rejects.toThrow(
        "Project root not found"
      );
    });

    test("should return null when reading non-existent link file", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const readLink = await readLinkFile(projectRoot);
      expect(readLink).toBeNull();
    });

    test("should return null when reading invalid JSON", async () => {
      const projectRoot = path.join(tempDir, "project");
      const apsoDir = path.join(projectRoot, APSO_DIR_NAME);
      fs.mkdirSync(apsoDir, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");
      fs.writeFileSync(
        path.join(apsoDir, LINK_FILE_NAME),
        "invalid json content {"
      );

      const readLink = await readLinkFile(projectRoot);
      expect(readLink).toBeNull();
    });
  });

  describe("isProjectLinked", () => {
    test("should return true when link file exists", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
      });

      await writeLinkFile(link, projectRoot);

      const linked = await isProjectLinked(projectRoot);
      expect(linked).toBe(true);
    });

    test("should return false when link file does not exist", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const linked = await isProjectLinked(projectRoot);
      expect(linked).toBe(false);
    });

    test("should return false when project root not found", async () => {
      const linked = await isProjectLinked();
      expect(linked).toBe(false);
    });
  });

  describe("deleteLinkFile", () => {
    test("should delete link file successfully", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
      });

      await writeLinkFile(link, projectRoot);

      const deleted = await deleteLinkFile(projectRoot);
      expect(deleted).toBe(true);

      const linkPath = getLinkFilePath(projectRoot);
      expect(linkPath).not.toBeNull();
      expect(fs.existsSync(linkPath!)).toBe(false);
    });

    test("should return false when link file does not exist", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      const deleted = await deleteLinkFile(projectRoot);
      expect(deleted).toBe(false);
    });

    test("should return false when project root not found", async () => {
      const deleted = await deleteLinkFile();
      expect(deleted).toBe(false);
    });
  });

  describe("integration tests", () => {
    test("should handle full link lifecycle", async () => {
      const projectRoot = path.join(tempDir, "project");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, ".apsorc"), "{}");

      // Create link
      const link = createLink({
        workspaceId: "ws_123",
        workspaceSlug: "test-workspace",
        serviceId: "svc_456",
        serviceSlug: "test-service",
        createdBy: "test@example.com",
        githubRepo: "owner/repo",
      });

      // Write link
      await writeLinkFile(link, projectRoot);
      expect(await isProjectLinked(projectRoot)).toBe(true);

      // Read and verify
      const readLink = await readLinkFile(projectRoot);
      expect(readLink).not.toBeNull();
      expect(readLink?.githubRepo).toBe("owner/repo");

      // Update link
      const updatedLink: ProjectLink = {
        ...readLink!,
        lastSyncedAt: new Date().toISOString(),
        lastSyncDirection: "push",
      };
      await writeLinkFile(updatedLink, projectRoot);

      // Verify update
      const updatedReadLink = await readLinkFile(projectRoot);
      expect(updatedReadLink?.lastSyncedAt).toBe(updatedLink.lastSyncedAt);
      expect(updatedReadLink?.lastSyncDirection).toBe("push");

      // Delete link
      await deleteLinkFile(projectRoot);
      expect(await isProjectLinked(projectRoot)).toBe(false);
    });
  });
});

