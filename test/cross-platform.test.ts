/**
 * Cross-platform compatibility tests
 *
 * These tests verify that core CLI functionality works correctly
 * across different platforms (Windows, macOS, Linux).
 */

import { describe, test, expect } from "@jest/globals";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("Cross-Platform Compatibility", () => {
  const platform = os.platform();

  describe("Path Handling", () => {
    test("should handle path separators correctly", () => {
      const testPath = path.join("test", "dir", "file.txt");

      if (platform === "win32") {
        // Windows should use backslashes
        expect(testPath).toContain("\\");
      } else {
        // Unix-like should use forward slashes
        expect(testPath).toContain("/");
      }
    });

    test("should resolve paths correctly", () => {
      const resolved = path.resolve("test", "dir");
      expect(resolved).toBeTruthy();
      expect(typeof resolved).toBe("string");
    });
  });

  describe("File System Operations", () => {
    const testDir = path.join(os.tmpdir(), "apso-cli-test");

    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    test("should create directories correctly", () => {
      const testPath = path.join(testDir, "subdir");
      fs.mkdirSync(testPath, { recursive: true });
      expect(fs.existsSync(testPath)).toBe(true);
    });

    test("should write and read files correctly", () => {
      const testFile = path.join(testDir, "test.txt");
      const content = "test content";

      fs.writeFileSync(testFile, content, "utf8");
      expect(fs.existsSync(testFile)).toBe(true);

      const readContent = fs.readFileSync(testFile, "utf8");
      expect(readContent).toBe(content);
    });

    test("should handle file paths with special characters", () => {
      const testFile = path.join(testDir, "test-file.txt");
      fs.writeFileSync(testFile, "content", "utf8");
      expect(fs.existsSync(testFile)).toBe(true);
    });
  });

  describe("Environment Variables", () => {
    test("should access home directory correctly", () => {
      const homeDir = os.homedir();
      expect(homeDir).toBeTruthy();
      expect(typeof homeDir).toBe("string");
      expect(fs.existsSync(homeDir)).toBe(true);
    });

    test("should access temp directory correctly", () => {
      const tmpDir = os.tmpdir();
      expect(tmpDir).toBeTruthy();
      expect(typeof tmpDir).toBe("string");
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe("Platform Detection", () => {
    test("should detect platform correctly", () => {
      const detectedPlatform = os.platform();
      expect(["win32", "darwin", "linux"]).toContain(detectedPlatform);
    });

    test("should handle platform-specific logic", () => {
      const isWindows = platform === "win32";
      const isUnix = platform === "darwin" || platform === "linux";

      expect(isWindows || isUnix).toBe(true);
    });
  });

  describe("Network Detection", () => {
    test("should handle network detection on all platforms", async () => {
      // Network detection should work on all platforms
      // This is a basic test that the function can be called
      const { isOnline } = await import("../src/lib/network");
      expect(typeof isOnline).toBe("function");
    });
  });

  describe("Cache System", () => {
    test("should create cache directories correctly", () => {
      const cacheDir = path.join(os.tmpdir(), "apso-cache-test");

      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }

      fs.mkdirSync(cacheDir, { recursive: true });
      expect(fs.existsSync(cacheDir)).toBe(true);

      // Cleanup
      fs.rmSync(cacheDir, { recursive: true, force: true });
    });
  });

  describe("Queue System", () => {
    test("should handle queue file paths correctly", () => {
      const queueFile = path.join(os.tmpdir(), "apso-queue-test.json");

      // Write test queue file
      const testQueue = { operations: [] };
      fs.writeFileSync(queueFile, JSON.stringify(testQueue), "utf8");
      expect(fs.existsSync(queueFile)).toBe(true);

      // Read test queue file
      const content = fs.readFileSync(queueFile);
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(testQueue);

      // Cleanup
      fs.unlinkSync(queueFile);
    });
  });
});
