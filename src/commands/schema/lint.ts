import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import { fixSchema, formatLintReport, LintIssue, lintSchema, LintResult } from "@apso/schema-tools";
import BaseCommand from "../../lib/base-command";
import { createBackup } from "../../lib/config";
import { ApsorcType, readApsorcFile } from "../../lib/apsorc-parser";

/** Lints (and with `fix`, repairs and saves) an .apsorc file. */
export function lintApsorc(
  configPath: string,
  apsorc: ApsorcType,
  fix: boolean
): { result: LintResult; fixed: LintIssue[]; backupPath?: string } {
  if (!fix) return { result: lintSchema(apsorc), fixed: [] };
  const { schema, applied } = fixSchema(apsorc);
  let backupPath: string | undefined;
  if (applied.length > 0) {
    backupPath = createBackup(configPath, path.dirname(configPath));
    fs.writeFileSync(configPath, `${JSON.stringify(schema, null, 2)}\n`, "utf-8");
  }
  return { result: lintSchema(schema), fixed: applied, backupPath };
}

export default class SchemaLint extends BaseCommand {
  static description =
    "Check the local .apsorc for names and settings that would break the generated code";

  static examples = [
    "$ apso schema lint",
    "$ apso schema lint --fix",
    "$ apso schema lint --json",
  ];

  static flags = {
    fix: Flags.boolean({
      description: "Apply the safe automatic fixes and save .apsorc (a backup is kept)",
      default: false,
    }),
    json: Flags.boolean({
      description: "Print the result as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaLint);

    let file;
    try {
      file = readApsorcFile();
    } catch (error: unknown) {
      this.error(`Failed to read .apsorc: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (file.apsorc.version !== 2) {
      this.error("apso schema lint supports version 2 .apsorc files only.");
    }

    const { result, fixed, backupPath } = lintApsorc(file.configPath, file.apsorc, flags.fix);

    if (flags.json) {
      this.log(JSON.stringify({ ...result, fixed }, null, 2));
    } else {
      if (fixed.length > 0) {
        this.log(`Fixed ${fixed.length} issue(s) in ${file.configPath} (backup: ${backupPath}):`);
        for (const issue of fixed) this.log(`  - ${issue.rule}: ${issue.message}`);
        this.log("");
      }
      this.log(formatLintReport(result));
      if (!flags.fix && result.issues.some((issue) => issue.fixable)) {
        this.log('\nRun "apso schema lint --fix" to apply the auto-fixable changes.');
      }
    }

    if (result.errorCount > 0) this.exit(1);
  }
}
