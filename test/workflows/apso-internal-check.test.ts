import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * Ensure all GitHub Actions workflows that run the CLI have APSO_INTERNAL='1'.
 *
 * This is a safeguard to ensure internal runs are tagged. The auto-detection
 * (GITHUB_REPOSITORY_OWNER=apsoai) is the primary mechanism, and APSO_INTERNAL
 * is a redundant second layer.
 */
describe("GitHub Actions workflows APSO_INTERNAL check", () => {
  const workflowsDir = path.join(__dirname, "../../.github/workflows");

  // Workflows that run the CLI and should have APSO_INTERNAL
  const cliWorkflows = [
    "unitTests.yml",
    "scaffold-smoke.yml",
    "tarball-smoke.yml",
    "auth-smoke.yml",
    "break-each-rule.yml",
  ];

  // Workflows that don't run the CLI or don't need APSO_INTERNAL
  const excludedWorkflows = [
    "bun-lockfile.yml", // Only checks lockfile consistency
    "failureNotifications.yml", // Slack notifications
    "notify-slack-on-pr-open.yml", // Slack notifications
    "onPushToMain.yml", // Release workflow (Homebrew, npm publish)
    "secret-scan.yml", // Security scan
  ];

  for (const workflow of cliWorkflows) {
    test(`${workflow} has APSO_INTERNAL='1'`, () => {
      const workflowPath = path.join(workflowsDir, workflow);
      const content = fs.readFileSync(workflowPath, "utf8");

      // Check for workflow-level or job-level env.APSO_INTERNAL
      const hasWorkflowEnv = /^env:\s*\n\s*APSO_INTERNAL:\s*["']1["']/m.test(content);
      const hasJobEnv = /^\s{2,}env:\s*\n\s*APSO_INTERNAL:\s*["']1["']/m.test(content);

      if (!hasWorkflowEnv && !hasJobEnv) {
        throw new Error(
          `${workflow} should have APSO_INTERNAL='1' at workflow or job level`
        );
      }
      expect(hasWorkflowEnv || hasJobEnv).toBe(true);
    });
  }

  test("excluded workflows are documented", () => {
    const allWorkflows = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

    const covered = new Set([...cliWorkflows, ...excludedWorkflows]);
    const uncovered = allWorkflows.filter((f) => !covered.has(f));

    if (uncovered.length > 0) {
      throw new Error(
        `New workflows found that are not in cliWorkflows or excludedWorkflows: ${uncovered.join(", ")}`
      );
    }
    expect(uncovered).toHaveLength(0);
  });
});
