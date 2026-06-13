import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import { createBackup } from "../../lib/config";
import { findConfigPath } from "../../lib/apsorc-parser";
import { parseRelationships } from "../../lib/utils/relationships";
import { ApsorcRelationship } from "../../lib/types/relationship";
import {
  ApsorcImportOutput,
  ImportReport,
  Introspector,
  PgIntrospector,
  findUnknownEmittedTypes,
  pgToApsorc,
  redactConnectionString,
} from "../../lib/import";

/**
 * Resolve the Postgres connection string from an explicit flag or, failing
 * that, the SUPABASE_DB_URL / DATABASE_URL environment variables. Returns
 * undefined if none is set (the command then prompts interactively).
 */
export function resolveConnectionString(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return flagValue || env.SUPABASE_DB_URL || env.DATABASE_URL || undefined;
}

/**
 * Run the full introspect -> convert -> validate pipeline against any
 * Introspector. Throws if the generated relationships fail to parse. Pure of
 * file/console I/O so it can be unit-tested with a fake Introspector.
 */
export async function importFromIntrospector(
  introspector: Introspector,
  schema: string
): Promise<{
  apsorc: ApsorcImportOutput;
  report: ImportReport;
  unknownTypes: string[];
}> {
  const introspected = await introspector.introspect(schema);
  const { apsorc, report } = pgToApsorc(introspected);

  // Validate by running the generated relationships through the real parser.
  parseRelationships(apsorc.relationships as ApsorcRelationship[]);

  return {
    apsorc,
    report,
    unknownTypes: findUnknownEmittedTypes(apsorc),
  };
}

/** Render the import report as a human-readable summary (contains no secrets). */
export function formatReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(
    `Imported ${report.tablesImported.length} table(s) and ${report.relationships} relationship(s).`
  );
  if (report.tablesImported.length > 0) {
    lines.push(`  Tables: ${report.tablesImported.join(", ")}`);
  }
  if (report.viewsSkipped.length > 0) {
    lines.push(`  Skipped views: ${report.viewsSkipped.join(", ")}`);
  }
  if (report.systemSchemasSkipped.length > 0) {
    lines.push(
      `  Skipped system schemas: ${report.systemSchemasSkipped.join(", ")}`
    );
  }

  const w = report.warnings;
  const review: string[] = [];
  if (w.compositePks.length > 0)
    review.push(`  - Composite primary keys (review): ${w.compositePks.join(", ")}`);
  if (w.nonStandardPks.length > 0)
    review.push(`  - Non-"id" primary keys (kept as fields): ${w.nonStandardPks.join(", ")}`);
  if (w.noPrimaryKey.length > 0)
    review.push(`  - Tables with no primary key: ${w.noPrimaryKey.join(", ")}`);
  if (w.compositeFks.length > 0)
    review.push(`  - Composite foreign keys (kept as columns, no relationship): ${w.compositeFks.join(", ")}`);
  if (w.fkColumnNameUnmapped.length > 0)
    review.push(`  - Foreign keys whose generated column may differ: ${w.fkColumnNameUnmapped.join(", ")}`);
  if (w.joinTablesDetected.length > 0)
    review.push(`  - Join tables (could be modeled as ManyToMany): ${w.joinTablesDetected.join(", ")}`);
  if (w.arraysLossy.length > 0)
    review.push(`  - Array columns reduced to text: ${w.arraysLossy.join(", ")}`);
  if (w.typesDefaulted.length > 0)
    review.push(
      `  - Unknown types defaulted to text: ${w.typesDefaulted
        .map((t) => `${t.column} (${t.udt})`)
        .join(", ")}`
    );
  if (w.defaultsDropped.length > 0)
    review.push(`  - Column defaults dropped: ${w.defaultsDropped.join(", ")}`);

  if (review.length > 0) {
    lines.push("", "Review the following (not fully represented):", ...review);
  }
  return lines.join("\n");
}

/**
 * Write the generated .apsorc to disk, backing up any existing file first.
 * Returns the backup path if one was made.
 */
export function writeApsorcFile(
  apsorc: ApsorcImportOutput,
  outPath: string
): { backupPath?: string } {
  let backupPath: string | undefined;
  if (fs.existsSync(outPath)) {
    backupPath = createBackup(outPath);
  }
  fs.writeFileSync(outPath, JSON.stringify(apsorc, null, 2), "utf-8");
  return { backupPath };
}

export default class ImportSupabase extends BaseCommand {
  static description =
    "Introspect an existing Supabase (Postgres) database and generate a local .apsorc schema. Read-only: it never writes to the source database.";

  static examples = [
    `$ apso import supabase`,
    `$ apso import supabase -c "postgresql://postgres:[pw]@db.[ref].supabase.co:5432/postgres"`,
    `$ SUPABASE_DB_URL="postgresql://..." apso import supabase --dry-run`,
  ];

  static flags = {
    "connection-string": Flags.string({
      char: "c",
      description:
        "Postgres connection string. Falls back to SUPABASE_DB_URL or DATABASE_URL, then prompts.",
    }),
    schema: Flags.string({
      description: "Database schema to import",
      default: "public",
    }),
    out: Flags.string({
      char: "o",
      description: "Path to write the .apsorc (default: existing .apsorc or ./.apsorc)",
    }),
    "dry-run": Flags.boolean({
      description: "Introspect and print a summary without writing any file",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip the overwrite confirmation prompt",
      default: false,
    }),
  };

  /** Overridable for testing. */
  protected makeIntrospector(connectionString: string): Introspector {
    return new PgIntrospector(connectionString);
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ImportSupabase);

    let connectionString = resolveConnectionString(flags["connection-string"]);
    if (!connectionString) {
      const answer = await inquirer.prompt<{ connectionString: string }>([
        {
          type: "password",
          name: "connectionString",
          mask: "*",
          message: "Supabase Postgres connection string:",
          validate: (input: string) =>
            input.trim().length > 0 || "A connection string is required",
        },
      ]);
      connectionString = answer.connectionString.trim();
    }

    try {
      this.log("Connecting and introspecting schema (read-only)...");
      const introspector = this.makeIntrospector(connectionString);
      const { apsorc, report, unknownTypes } = await importFromIntrospector(
        introspector,
        flags.schema
      );

      this.log("");
      this.log(formatReport(report));

      if (unknownTypes.length > 0) {
        this.warn(
          `Some column types were not recognized and defaulted to text: ${[
            ...new Set(unknownTypes),
          ].join(", ")}`
        );
      }

      if (report.tablesImported.length === 0) {
        this.warn(
          `No base tables found in schema "${flags.schema}". Nothing to write.`
        );
        return;
      }

      if (flags["dry-run"]) {
        this.log("");
        this.log("Dry run — no file written.");
        return;
      }

      const outPath =
        flags.out ?? findConfigPath() ?? path.join(process.cwd(), ".apsorc");

      if (fs.existsSync(outPath) && !flags.yes) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: "confirm",
            name: "confirm",
            message: `Overwrite ${outPath} with the imported schema?`,
            default: false,
          },
        ]);
        if (!confirm) {
          this.log("Import cancelled.");
          return;
        }
      }

      const { backupPath } = writeApsorcFile(apsorc, outPath);
      if (backupPath) this.log(`Backup created: ${backupPath}`);
      this.log(`Schema written to ${outPath}`);
      this.log("");
      this.log("Next steps:");
      this.log("  - Review the .apsorc, especially any items flagged above");
      this.log("  - Run 'apso migrate' to validate the schema locally");
      this.log("  - Run 'apso generate' to scaffold code");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Defense-in-depth: never surface the connection string in an error.
      this.error(redactConnectionString(message.split(connectionString).join("****")));
    }
  }
}
