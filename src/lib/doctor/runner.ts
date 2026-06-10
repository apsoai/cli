import { execSync } from "child_process";
import * as os from "os";
import { DiagnosticFinding, DiagnosticContext } from "./types";
import {
  checkPkStrategy,
  checkUnusedImports,
  checkFieldTypeMismatch,
  checkRelationshipTarget,
  checkMigrationSandbox,
} from "./checks";

/**
 * Run all diagnostic checks and return aggregated findings.
 *
 * Sync checks run first (schema validation, code scanning).
 * The migration sandbox check is async and runs last.
 */
export async function runDiagnostics(
  ctx: DiagnosticContext
): Promise<DiagnosticFinding[]> {
  const findings: DiagnosticFinding[] = [];

  // Sync checks
  findings.push(...checkFieldTypeMismatch(ctx));
  findings.push(...checkRelationshipTarget(ctx));
  findings.push(...checkPkStrategy(ctx));
  findings.push(...checkUnusedImports(ctx));

  // Async checks
  const sandboxFindings = await checkMigrationSandbox(ctx);
  findings.push(...sandboxFindings);

  return findings;
}

/**
 * Format findings as a human-readable string.
 */
export function formatFindings(findings: DiagnosticFinding[]): string {
  if (findings.length === 0) {
    return "No issues found.";
  }

  const lines: string[] = [];
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  if (errors.length > 0) {
    lines.push(`${errors.length} error(s):`);
    for (const f of errors) {
      lines.push(formatFinding(f));
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push(`${warnings.length} warning(s):`);
    for (const f of warnings) {
      lines.push(formatFinding(f));
    }
    lines.push("");
  }

  if (infos.length > 0) {
    lines.push(`${infos.length} info(s):`);
    for (const f of infos) {
      lines.push(formatFinding(f));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatFinding(f: DiagnosticFinding): string {
  const parts = [`  [${f.severity.toUpperCase()}] ${f.message}`];
  if (f.file) {
    parts.push(`    File: ${f.file}`);
  }
  if (f.suggestion) {
    parts.push(`    Fix: ${f.suggestion}`);
  }
  return parts.join("\n");
}

/**
 * Check if the GitHub CLI is installed and authenticated.
 */
export function isGhAvailable(): boolean {
  try {
    execSync("gh auth status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Search for existing issues that might duplicate what we're about to file.
 */
export function searchExistingIssues(
  title: string
): { number: number; title: string; url: string }[] {
  try {
    // Extract key terms from the title for search
    const searchQuery = title.slice(0, 100);
    const result = execSync(
      `gh issue list --repo apsoai/cli --search "${searchQuery.replace(/"/g, '\\"')}" --state open --json number,title,url --limit 5`,
      { encoding: "utf-8", timeout: 15_000 }
    );
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Build and file a GitHub issue from diagnostic findings.
 * Returns the URL of the created issue.
 */
export function fileGitHubIssue(
  findings: DiagnosticFinding[],
  ctx: DiagnosticContext
): string {
  const pkg = loadCliVersion();
  const title = buildIssueTitle(findings);
  const body = buildIssueBody(findings, ctx, pkg);

  const result = execSync(
    `gh issue create --repo apsoai/cli --title "${title.replace(/"/g, '\\"')}" --body-file -`,
    {
      input: body,
      encoding: "utf-8",
      timeout: 30_000,
    }
  );

  return result.trim();
}

function loadCliVersion(): string {
  try {
    const pkg = require("../../../package.json");
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function buildIssueTitle(findings: DiagnosticFinding[]): string {
  const firstError = findings.find((f) => f.severity === "error");
  if (firstError) {
    const prefix = firstError.entity ? `[${firstError.entity}] ` : "";
    return `[doctor] ${prefix}${firstError.message}`.slice(0, 120);
  }
  return `[doctor] ${findings.length} diagnostic finding(s)`;
}

function buildIssueBody(
  findings: DiagnosticFinding[],
  ctx: DiagnosticContext,
  cliVersion: string
): string {
  const sections: string[] = [];

  // Environment
  sections.push("## Environment");
  sections.push(`- \`@apso/cli\` ${cliVersion} (${os.platform()}, node ${process.version})`);
  sections.push(`- Language: ${ctx.language}`);
  sections.push("");

  // Findings table
  sections.push("## Diagnostic findings");
  sections.push("");
  sections.push("| Severity | Check | Entity | Message |");
  sections.push("|----------|-------|--------|---------|");
  for (const f of findings) {
    sections.push(
      `| ${f.severity} | ${f.check} | ${f.entity || "-"} | ${f.message} |`
    );
  }
  sections.push("");

  // Schema excerpt (entity names, field types, PK types -- no field values or data)
  sections.push("## Schema excerpt");
  sections.push("```json");
  const excerpt = ctx.entities.map((e) => ({
    name: e.name,
    primaryKeyType: e.primaryKeyType || "serial",
    fields: (e.fields || []).map((f) => ({
      name: f.name,
      type: f.type,
    })),
  }));
  sections.push(JSON.stringify(excerpt, null, 2));
  sections.push("```");
  sections.push("");

  // Suggestions
  const suggestions = findings
    .filter((f) => f.suggestion)
    .map((f) => `- **${f.check}**: ${f.suggestion}`);
  if (suggestions.length > 0) {
    sections.push("## Suggested fixes");
    sections.push(suggestions.join("\n"));
    sections.push("");
  }

  sections.push("---");
  sections.push("Filed automatically by `apso doctor --report`");

  return sections.join("\n");
}
