import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { parseApsorc } from "../lib/apsorc-parser";
import inquirer from "inquirer";
import {
  runMigrationSandbox,
  applyMigration,
  resetSandbox,
  detectRenameCandidates,
  FieldRename,
} from "../lib/migrate/sandbox";
import { readSnapshot } from "../lib/migrate/snapshot";
import { createGenerator } from "../lib";
import { TargetLanguage, GeneratorConfig } from "../lib/types";
import { createFile } from "../lib/utils/file-system";

export default class Migrate extends BaseCommand {
  static description =
    "Detect schema changes, generate migration SQL, and test against a local PGlite sandbox";

  static examples = [
    `$ apso migrate`,
    `$ apso migrate --apply`,
    `$ apso migrate --reset`,
    `$ apso migrate --sql`,
    `$ apso migrate --rename User.fullName=displayName`,
  ];

  static flags = {
    apply: Flags.boolean({
      description:
        "Apply the migration: update the local snapshot after a successful test",
      default: false,
    }),
    reset: Flags.boolean({
      description: "Reset the sandbox (clear snapshot and PGlite data)",
      default: false,
    }),
    sql: Flags.boolean({
      description: "Output raw SQL only (for piping to files)",
      default: false,
    }),
    rename: Flags.string({
      description:
        "Confirm a field rename without prompting, as Entity.old=new (repeatable)",
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Migrate);

    // Handle reset
    if (flags.reset) {
      resetSandbox();
      this.log("Sandbox reset. Snapshot and PGlite data cleared.");
      return;
    }

    // Parse .apsorc
    let parsed;
    try {
      parsed = parseApsorc();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.error(`Failed to parse .apsorc: ${msg}`);
    }

    if (!flags.sql) {
      this.log("Schema changes detected. Running migration sandbox...");
    }

    const candidates = detectRenameCandidates(readSnapshot(), parsed.entities);
    const renames = await this.resolveRenames(candidates, flags.rename || []);

    // Run the sandbox
    const result = await runMigrationSandbox(
      { entities: parsed.entities, relationshipMap: parsed.relationshipMap },
      undefined,
      renames
    );

    // TypeORM renames on its own when a table has exactly one changed column,
    // so a declined candidate can still come back as a RENAME. Say so.
    for (const declined of candidates.filter((c) => !renames.includes(c))) {
      if (result.upSql.some((sql) => sql.includes(`RENAME COLUMN "${declined.from}" TO "${declined.to}"`))) {
        this.warn(
          `${declined.entity}.${declined.from} was renamed to ${declined.to} anyway (TypeORM treats a single changed column as a rename). ` +
            "Edit the migration if you need a fresh, empty column."
        );
      }
    }

    if (!result.needed) {
      if (!flags.sql) {
        this.log("No database-level changes detected.");
      }
      return;
    }

    // Output results
    if (flags.sql) {
      // Raw SQL output mode
      for (const sql of result.upSql) {
        this.log(sql + ";");
      }
      return;
    }

    if (result.success) {
      this.log("");
      this.log("Migration SQL (up):");
      this.log("---");
      for (const sql of result.upSql) {
        this.log(`  ${sql};`);
      }
      this.log("---");
      this.log("");
      this.log(`${result.upSql.length} statement(s) generated and tested.`);
      this.log("Migration validated against local PGlite.");

      // Generate language-native migration files for Python and Go
      const language: TargetLanguage = parsed.language || "typescript";
      if (language !== "typescript") {
        const generatorConfig: GeneratorConfig = {
          language,
          rootFolder: parsed.rootFolder || "src",
          apiType: parsed.apiType || "rest",
          entities: parsed.entities,
          relationshipMap: parsed.relationshipMap,
        };

        const generator = createGenerator(generatorConfig);
        const migrationFiles = await generator.generateMigration({
          entities: parsed.entities,
          relationshipMap: parsed.relationshipMap,
          upSql: result.upSql,
          downSql: result.downSql,
        });

        for (const file of migrationFiles) {
          const fullPath = path.join(process.cwd(), file.path);
          // eslint-disable-next-line no-await-in-loop
          await createFile(fullPath, file.content);
          this.log(`Generated migration file: ${file.path}`);
        }
      }

      if (flags.apply) {
        applyMigration({
          entities: parsed.entities,
          relationshipMap: parsed.relationshipMap,
        });
        this.log("Snapshot updated.");
      } else {
        this.log("Run with --apply to update the snapshot.");
      }
    } else {
      this.log("");
      this.log("Migration FAILED.");
      if (result.error) {
        this.log(`Error: ${result.error}`);
      }
      if (result.upSql.length > 0) {
        this.log("");
        this.log("Attempted SQL:");
        for (const sql of result.upSql) {
          this.log(`  ${sql};`);
        }
      }
      this.exit(1);
    }
  }

  /**
   * Decide which rename candidates are real renames. --rename flags win; a TTY
   * gets a prompt (on stderr, so --sql output stays clean); otherwise warn and
   * fall back to DROP + ADD.
   */
  private async resolveRenames(
    candidates: FieldRename[],
    flagged: string[]
  ): Promise<FieldRename[]> {
    const key = (r: FieldRename) => `${r.entity}.${r.from}=${r.to}`;
    const unknown = flagged.filter((f) => !candidates.some((c) => key(c) === f));
    if (unknown.length > 0) {
      this.error(
        `No matching rename candidate for: ${unknown.join(", ")}. ` +
          `Candidates: ${candidates.map((c) => key(c)).join(", ") || "none"}`
      );
    }

    const confirmed: FieldRename[] = [];
    const prompt = inquirer.createPromptModule({ output: process.stderr });
    for (const candidate of candidates) {
      if (flagged.includes(key(candidate))) {
        confirmed.push(candidate);
      } else if (process.stdin.isTTY) {
        // eslint-disable-next-line no-await-in-loop
        const { isRename } = await prompt([
          {
            type: "confirm",
            name: "isRename",
            message: `Was ${candidate.entity}.${candidate.from} renamed to ${candidate.to}? (No drops ${candidate.from} and its data)`,
            default: true,
          },
        ]);
        if (isRename) confirmed.push(candidate);
      } else {
        this.warn(
          `${candidate.entity}.${candidate.from} -> ${candidate.to} looks like a rename but will DROP ${candidate.from}. ` +
            `Pass --rename ${key(candidate)} to keep its data.`
        );
      }
    }
    return confirmed;
  }
}
