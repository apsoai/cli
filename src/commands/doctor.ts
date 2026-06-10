import * as path from "path";
import { Flags } from "@oclif/core";
import * as inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { parseApsorc, findConfigPath } from "../lib/apsorc-parser";
import { TargetLanguage } from "../lib/types";
import { DiagnosticContext } from "../lib/doctor/types";
import {
  runDiagnostics,
  formatFindings,
  isGhAvailable,
  searchExistingIssues,
  fileGitHubIssue,
} from "../lib/doctor/runner";

export default class Doctor extends BaseCommand {
  static description =
    "Run diagnostic checks on generated code and optionally file a GitHub issue with findings";

  static examples = [
    `$ apso doctor`,
    `$ apso doctor --json`,
    `$ apso doctor --report`,
  ];

  static flags = {
    report: Flags.boolean({
      description:
        "File a GitHub issue with diagnostic findings (requires gh CLI)",
      default: false,
    }),
    json: Flags.boolean({
      description: "Output findings as JSON instead of human-readable text",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);

    // Find and parse .apsorc
    const configPath = findConfigPath();
    if (!configPath) {
      this.error("No .apsorc file found in the current directory or parent directories.");
    }

    let parsed;
    try {
      parsed = parseApsorc();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to parse .apsorc: ${msg}`);
    }

    const projectRoot = path.dirname(configPath);
    const language: TargetLanguage = parsed.language || "typescript";

    const ctx: DiagnosticContext = {
      entities: parsed.entities,
      relationshipMap: parsed.relationshipMap,
      rootFolder: parsed.rootFolder || "src",
      language,
      projectRoot,
    };

    if (!flags.json) {
      this.log("Running diagnostics...");
    }

    const findings = await runDiagnostics(ctx);

    // Output
    if (flags.json) {
      this.log(JSON.stringify(findings, null, 2));
    } else {
      this.log("");
      this.log(formatFindings(findings));
      const errors = findings.filter((f) => f.severity === "error").length;
      const warnings = findings.filter((f) => f.severity === "warning").length;
      this.log(
        `${findings.length} finding(s): ${errors} error(s), ${warnings} warning(s)`
      );
    }

    // Report flow
    if (flags.report) {
      const actionable = findings.filter(
        (f) => f.severity === "error" || f.severity === "warning"
      );

      if (actionable.length === 0) {
        this.log("No errors or warnings to report.");
        return;
      }

      if (!isGhAvailable()) {
        this.error(
          "GitHub CLI (gh) is not installed or not authenticated.\n" +
            "Install: https://cli.github.com\n" +
            "Authenticate: gh auth login"
        );
      }

      // Dedupe check
      const firstError = actionable.find((f) => f.severity === "error") || actionable[0];
      const searchTitle = firstError.message.slice(0, 100);
      const existing = searchExistingIssues(searchTitle);

      if (existing.length > 0) {
        this.log("");
        this.log("Potentially related open issues:");
        for (const issue of existing) {
          this.log(`  #${issue.number}: ${issue.title}`);
          this.log(`    ${issue.url}`);
        }
        this.log("");

        const { proceed } = await inquirer.prompt([
          {
            type: "confirm",
            name: "proceed",
            message: "File a new issue anyway?",
            default: false,
          },
        ]);

        if (!proceed) {
          this.log("Aborted.");
          return;
        }
      }

      // Confirm before filing
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `File a GitHub issue with ${actionable.length} finding(s) against apsoai/cli?`,
          default: true,
        },
      ]);

      if (!confirm) {
        this.log("Aborted.");
        return;
      }

      try {
        const url = fileGitHubIssue(findings, ctx);
        this.log(`Issue filed: ${url}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.error(`Failed to file issue: ${msg}`);
      }
    }
  }
}
