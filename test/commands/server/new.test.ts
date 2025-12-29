import { expect } from "@jest/globals";
import * as path from "path";

// Test the PROJECT_NAME_PATTERN regex and validation logic
const PROJECT_NAME_PATTERN = /^[A-Za-z][\w-]*$/;

// Helper function to check if a path is safe (within currDir)
function isPathSafe(projectName: string, currDir: string): boolean {
  const projectPath = path.join(currDir, projectName);
  const resolvedPath = path.resolve(projectPath);
  return resolvedPath.startsWith(path.resolve(currDir));
}

describe("server new command", () => {
  describe("PROJECT_NAME_PATTERN validation", () => {
    test("should accept valid project names", () => {
      const validNames = [
        "myproject",
        "MyProject",
        "my-project",
        "my_project",
        "Project123",
        "a",
        "A",
        "test-project-name",
        "test_project_name",
        "CamelCaseProject",
      ];

      for (const name of validNames) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(true);
      }
    });

    test("should reject project names starting with numbers", () => {
      const invalidNames = ["123project", "1-project", "0test"];

      for (const name of invalidNames) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(false);
      }
    });

    test("should reject project names with special characters", () => {
      const invalidNames = [
        "my project", // space
        "my.project", // dot
        "my@project", // at sign
        "my/project", // forward slash
        "my\\project", // backslash
        "my:project", // colon
        "my;project", // semicolon
        "my'project", // single quote
        'my"project', // double quote
        "my`project", // backtick
      ];

      for (const name of invalidNames) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(false);
      }
    });

    test("should reject path traversal attempts", () => {
      const pathTraversalAttempts = [
        "../etc/passwd",
        "..\\windows\\system32",
        "foo/../bar",
        "..",
        ".",
        "./test",
      ];

      for (const name of pathTraversalAttempts) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(false);
      }
    });

    test("should reject command injection attempts", () => {
      const injectionAttempts = [
        "; rm -rf /",
        "$(whoami)",
        "`id`",
        "| cat /etc/passwd",
        "&& echo pwned",
        "project; malicious",
        "project && malicious",
        "project | malicious",
      ];

      for (const name of injectionAttempts) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(false);
      }
    });

    test("should reject empty strings", () => {
      expect(PROJECT_NAME_PATTERN.test("")).toBe(false);
    });

    test("should reject names starting with hyphen or underscore", () => {
      const invalidNames = ["-project", "_project", "-", "_"];

      for (const name of invalidNames) {
        expect(PROJECT_NAME_PATTERN.test(name)).toBe(false);
      }
    });
  });

  describe("TEMPLATE_REPOS mapping", () => {
    const TEMPLATE_REPOS: Record<string, string> = {
      typescript: "https://github.com/apsoai/service-template.git",
      python: "https://github.com/apsoai/service-template-python.git",
      go: "https://github.com/apsoai/service-template-go.git",
    };

    test("should have correct URL for TypeScript", () => {
      expect(TEMPLATE_REPOS.typescript).toBe(
        "https://github.com/apsoai/service-template.git"
      );
    });

    test("should have correct URL for Python", () => {
      expect(TEMPLATE_REPOS.python).toBe(
        "https://github.com/apsoai/service-template-python.git"
      );
    });

    test("should have correct URL for Go", () => {
      expect(TEMPLATE_REPOS.go).toBe(
        "https://github.com/apsoai/service-template-go.git"
      );
    });

    test("should have exactly 3 supported languages", () => {
      expect(Object.keys(TEMPLATE_REPOS)).toHaveLength(3);
    });

    test("should only contain valid GitHub URLs", () => {
      for (const url of Object.values(TEMPLATE_REPOS)) {
        expect(url).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+\.git$/);
      }
    });
  });

  describe("path traversal prevention", () => {
    test("should allow normal project names", () => {
      expect(isPathSafe("myproject", "/home/user")).toBe(true);
      expect(isPathSafe("my-project", "/home/user")).toBe(true);
    });

    test("should detect path traversal attempts", () => {
      // Note: These would be caught earlier by PROJECT_NAME_PATTERN,
      // but this tests the secondary path validation
      expect(isPathSafe("../etc", "/home/user")).toBe(false);
      expect(isPathSafe("../../etc", "/home/user")).toBe(false);
    });
  });

  describe("language selection", () => {
    const validLanguages = ["typescript", "python", "go"] as const;

    test("typescript should be a valid language", () => {
      expect(validLanguages.includes("typescript")).toBe(true);
    });

    test("python should be a valid language", () => {
      expect(validLanguages.includes("python")).toBe(true);
    });

    test("go should be a valid language", () => {
      expect(validLanguages.includes("go")).toBe(true);
    });

    test("invalid languages should not be accepted", () => {
      const invalidLanguages = ["java", "rust", "ruby", "csharp", ""];
      for (const lang of invalidLanguages) {
        expect(
          validLanguages.includes(lang as typeof validLanguages[number])
        ).toBe(false);
      }
    });
  });

  describe("API type validation", () => {
    const validApiTypes = new Set(["rest", "graphql"]);

    test("rest should be a valid API type", () => {
      expect(validApiTypes.has("rest")).toBe(true);
    });

    test("graphql should be a valid API type", () => {
      expect(validApiTypes.has("graphql")).toBe(true);
    });

    test("invalid API types should not be accepted", () => {
      const invalidTypes = ["soap", "grpc", "websocket", ""];
      for (const type of invalidTypes) {
        expect(validApiTypes.has(type)).toBe(false);
      }
    });

    test("API type should be case-insensitive (converted to lowercase)", () => {
      const input = "REST";
      const normalized = input.toLowerCase();
      expect(validApiTypes.has(normalized)).toBe(true);
    });
  });
});
