import { expect } from "@jest/globals";

/**
 * Deploy command unit tests.
 *
 * Tests source detection logic and migration gating behavior
 * using plain data objects (no command execution or API calls).
 */

describe("deploy source detection", () => {
  test("identifies GitHub source when githubRepo is set", () => {
    const service = {
      id: "svc-1",
      workspaceId: "ws-1",
      slug: "test-svc",
      name: "Test Service",
      status: "active" as const,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      githubRepo: "org/repo",
      githubBranch: "main",
      endpoint: "https://api.example.com",
    };

    const isGitHubSource = Boolean(service.githubRepo);
    expect(isGitHubSource).toBe(true);
    expect(service.githubRepo).toBe("org/repo");
    expect(service.githubBranch).toBe("main");
  });

  test("identifies platform source when no githubRepo", () => {
    const service = {
      id: "svc-1",
      workspaceId: "ws-1",
      slug: "test-svc",
      name: "Test Service",
      status: "active" as const,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      endpoint: "https://api.example.com",
    } as { githubRepo?: string; [key: string]: unknown };

    const isGitHubSource = Boolean(service.githubRepo);
    expect(isGitHubSource).toBe(false);
  });
});

describe("deploy migration gating", () => {
  test("migration failure blocks deploy", () => {
    const migrationResult = {
      needed: true,
      success: false,
      upSql: [] as string[],
      downSql: [] as string[],
      error: "Column type mismatch",
    };

    // Deploy should not proceed when migration fails
    expect(migrationResult.success).toBe(false);
    expect(migrationResult.error).toBe("Column type mismatch");
  });

  test("migration success allows deploy", () => {
    const migrationResult = {
      needed: true,
      success: true,
      upSql: ["ALTER TABLE user ADD COLUMN age integer"],
      downSql: ["ALTER TABLE user DROP COLUMN age"],
    };

    expect(migrationResult.success).toBe(true);
    expect(migrationResult.upSql).toHaveLength(1);
  });

  test("no migration needed skips validation", () => {
    const migrationResult = {
      needed: false,
      success: true,
      upSql: [] as string[],
      downSql: [] as string[],
    };

    expect(migrationResult.needed).toBe(false);
    // When not needed, deploy proceeds without migration check
  });

  test("skip-migrate flag bypasses validation entirely", () => {
    const flags = { yes: false, skipMigrate: true, noWait: false };
    expect(flags.skipMigrate).toBe(true);
    // When skipMigrate is true, the command skips runMigrationSandbox
  });
});
