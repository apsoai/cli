import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
    // execFile (shell: false) — no shell interpretation of arguments.
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The GitHub repository issues are filed against.
 */
const ISSUE_REPO = "apsoai/cli";

/**
 * Build the argv array for `gh issue list --search`.
 *
 * Pure function (no side effects) so it can be unit-tested. The search query
 * is returned as its own array element and is NEVER concatenated into a shell
 * string, so backticks / quotes / `$()` in the title are treated literally.
 */
export function buildIssueSearchArgs(title: string): string[] {
  // Extract key terms from the title for search (passed as a single argv arg).
  const searchQuery = title.slice(0, 100);
  return [
    "issue",
    "list",
    "--repo",
    ISSUE_REPO,
    "--search",
    searchQuery,
    "--state",
    "open",
    "--json",
    "number,title,url",
    "--limit",
    "5",
  ];
}

/**
 * Search for existing issues that might duplicate what we're about to file.
 */
export function searchExistingIssues(
  title: string
): { number: number; title: string; url: string }[] {
  try {
    // execFile with an args array (shell: false). The title is passed as a
    // distinct argv element, so it is never shell-evaluated.
    const result = execFileSync("gh", buildIssueSearchArgs(title), {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Build the argv array for `gh issue create`.
 *
 * Pure function (no side effects) so it can be unit-tested. The title is
 * returned as its own array element directly after `--title` and the body is
 * passed via `--body-file <path>`. Nothing is concatenated into a shell string,
 * so backticks / `$()` / quotes / newlines in the title are passed literally
 * (no command substitution, no injection).
 */
export function buildIssueCreateArgs(
  title: string,
  bodyFilePath: string
): string[] {
  return [
    "issue",
    "create",
    "--repo",
    ISSUE_REPO,
    "--title",
    title,
    "--body-file",
    bodyFilePath,
  ];
}

/**
 * File a GitHub issue with an arbitrary title and body.
 *
 * The body is written to a temp file and passed via `--body-file`, and the
 * title is passed as a discrete argv element via execFile (shell: false). The
 * child's stdin is explicitly not inherited from the parent so it cannot
 * consume / blank the body.
 *
 * Returns the URL of the created issue.
 */
export function fileIssue(title: string, body: string): string {
  const bodyFilePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "apso-issue-")),
    "body.md"
  );
  try {
    fs.writeFileSync(bodyFilePath, body, "utf-8");

    const result = execFileSync("gh", buildIssueCreateArgs(title, bodyFilePath), {
      encoding: "utf-8",
      timeout: 30_000,
      // Do not pipe the parent's stdin into the child (the body is supplied via
      // file). stdout/stderr are captured by execFileSync.
      stdio: ["ignore", "pipe", "pipe"],
    });

    return result.trim();
  } finally {
    fs.rmSync(path.dirname(bodyFilePath), { recursive: true, force: true });
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

  return fileIssue(title, body);
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
