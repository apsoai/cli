import { Flags } from "@oclif/core";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import {
  CopyPlan,
  CopyResult,
  PgIntrospector,
  PgSourceReader,
  PgTargetWriter,
  executeCopy,
  planCopy,
  redactConnectionString,
  targetColumnsFromSchema,
} from "../../lib/import";
import { resolveConnectionString } from "./supabase";

/** Resolve the target connection string from flag/env, else undefined. */
export function resolveTargetConnectionString(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return flagValue || env.TARGET_DATABASE_URL || env.APSO_DATABASE_URL || undefined;
}

/** Render a copy result (or dry-run plan) as a human-readable summary. */
export function formatCopyResult(result: CopyResult): string {
  const lines: string[] = [];
  const total = result.perTable.reduce((sum, t) => sum + t.rows, 0);
  lines.push(
    result.dryRun
      ? `Plan: ${result.perTable.length} table(s), ${total} source row(s) to copy.`
      : `Copied ${total} row(s) across ${result.perTable.length} table(s).`
  );
  for (const t of result.perTable) {
    lines.push(`  ${t.table}: ${t.rows} row(s)`);
  }
  if (result.missingTargetTables.length > 0) {
    lines.push(
      `  Skipped (no matching target table): ${result.missingTargetTables.join(", ")}`
    );
  }
  if (result.cyclicTables.length > 0) {
    lines.push(
      `  FK cycle (copied best-effort, may need a second pass): ${result.cyclicTables.join(", ")}`
    );
  }
  if (result.skippedColumns.length > 0) {
    lines.push("  Skipped columns:");
    for (const s of result.skippedColumns) {
      lines.push(`    - ${s.table}.${s.column} (${s.reason})`);
    }
  }
  if (result.dryRun && result.blockedTables.length > 0) {
    lines.push(
      `  WARNING: target table(s) already have rows and would block a real run: ${result.blockedTables.join(", ")}`
    );
  }
  return lines.join("\n");
}

export default class ImportData extends BaseCommand {
  static description =
    "Copy table data from a source Supabase (Postgres) database into the target database rebuilt from the imported schema. Reads the source read-only; inserts into empty target tables.";

  static examples = [
    `$ apso import data -s "postgresql://...source..." -t "postgresql://...target..."`,
    `$ apso import data --dry-run`,
    `$ apso import data --tables users,orders`,
  ];

  static flags = {
    source: Flags.string({
      char: "s",
      description:
        "Source connection string. Falls back to SUPABASE_DB_URL or DATABASE_URL, then prompts.",
    }),
    target: Flags.string({
      char: "t",
      description:
        "Target connection string. Falls back to TARGET_DATABASE_URL or APSO_DATABASE_URL, then prompts.",
    }),
    schema: Flags.string({ description: "Database schema", default: "public" }),
    tables: Flags.string({
      description: "Comma-separated list of source tables to copy (default: all)",
    }),
    "batch-size": Flags.integer({
      description: "Rows per insert batch",
      default: 500,
    }),
    "dry-run": Flags.boolean({
      description: "Plan and report row counts without writing",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip the confirmation prompt",
      default: false,
    }),
  };

  private async promptConnection(role: string): Promise<string> {
    const answer = await inquirer.prompt<{ value: string }>([
      {
        type: "password",
        name: "value",
        mask: "*",
        message: `${role} Postgres connection string:`,
        validate: (input: string) =>
          input.trim().length > 0 || "A connection string is required",
      },
    ]);
    return answer.value.trim();
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ImportData);

    const sourceConn =
      resolveConnectionString(flags.source) ||
      (await this.promptConnection("Source"));
    const targetConn =
      resolveTargetConnectionString(flags.target) ||
      (await this.promptConnection("Target"));

    const tableFilter = flags.tables
      ? flags.tables.split(",").map((t) => t.trim()).filter(Boolean)
      : undefined;

    let sourceReader: PgSourceReader | undefined;
    let targetWriter: PgTargetWriter | undefined;
    try {
      this.log("Introspecting source and target schemas...");
      const sourceSchema = await new PgIntrospector(sourceConn).introspect(
        flags.schema
      );
      const targetSchema = await new PgIntrospector(targetConn).introspect(
        flags.schema
      );

      const plan: CopyPlan = planCopy(
        sourceSchema,
        targetColumnsFromSchema(targetSchema),
        tableFilter
      );

      if (plan.tables.length === 0) {
        this.warn("No tables to copy (no source/target table overlap).");
        return;
      }

      sourceReader = await PgSourceReader.connect(sourceConn, flags.schema);
      targetWriter = await PgTargetWriter.connect(targetConn, flags.schema);

      if (flags["dry-run"]) {
        const result = await executeCopy(plan, sourceReader, targetWriter, {
          batchSize: flags["batch-size"],
          dryRun: true,
        });
        this.log("");
        this.log(formatCopyResult(result));
        this.log("");
        this.log("Dry run — no rows written.");
        return;
      }

      if (!flags.yes) {
        const tableList = plan.tables.map((t) => t.targetTable).join(", ");
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: "confirm",
            name: "confirm",
            message: `Copy data into ${plan.tables.length} target table(s) (${tableList})?`,
            default: false,
          },
        ]);
        if (!confirm) {
          this.log("Data copy cancelled.");
          return;
        }
      }

      this.log("Copying data...");
      const result = await executeCopy(plan, sourceReader, targetWriter, {
        batchSize: flags["batch-size"],
      });
      this.log("");
      this.log(formatCopyResult(result));
      this.log("Done.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const redacted = redactConnectionString(
        message.split(sourceConn).join("****").split(targetConn).join("****")
      );
      this.error(redacted);
    } finally {
      if (sourceReader) await sourceReader.close();
      if (targetWriter) await targetWriter.close();
    }
  }
}
