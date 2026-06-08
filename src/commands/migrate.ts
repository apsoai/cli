import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { parseApsorc } from "../lib/apsorc-parser";
import {
  runMigrationSandbox,
  applyMigration,
  resetSandbox,
} from "../lib/migrate/sandbox";
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

    // Run the sandbox
    const result = await runMigrationSandbox(
      { entities: parsed.entities, relationshipMap: parsed.relationshipMap },
    );

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
}
