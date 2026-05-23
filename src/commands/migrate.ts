import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { parseApsorc } from "../lib/apsorc-parser";
import { readSnapshot, hasChanges, ComparableSchema } from "../lib/migrate/snapshot";
import {
  runMigrationSandbox,
  applyMigration,
  resetSandbox,
} from "../lib/migrate/sandbox";

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

    // Quick check against snapshot
    const snapshot = readSnapshot();
    const currentComparable: ComparableSchema = {
      entities: parsed.entities.map((e) => ({
        name: e.name,
        fields: e.fields?.map((f) => ({
          name: f.name,
          type: f.type,
          nullable: f.nullable,
          unique: f.unique,
          default: f.default ?? undefined,
          index: f.index,
        })),
        primaryKeyType: e.primaryKeyType,
        created_at: e.created_at,
        updated_at: e.updated_at,
        scopeBy: e.scopeBy,
      })),
    };

    if (!hasChanges(currentComparable, snapshot)) {
      if (!flags.sql) {
        this.log("Schema unchanged. No migration needed.");
      }
      return;
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
