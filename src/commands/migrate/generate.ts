import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { readApsorcFile } from "../../lib/apsorc-parser";
import { writePlannedMigration } from "../../lib/ddl/migration-file";
import { Question } from "../../lib/plan";
import {
  Baseline,
  baselineFile,
  resolveBaseline,
} from "../../lib/plan/baseline";
import {
  cliBinPath,
  generateMigration,
  report,
} from "../../lib/verify";

export default class MigrateGenerate extends BaseCommand {
  static description =
    "Write a migration from the deployed schema to this project's .apsorc. Apso renders the SQL from the answered migration plan (apso migrate plan), including data moves and a down() that reverses them. Exits 2 while plan questions are open. The migration is a TypeORM class, an Alembic revision or a goose SQL file, by the service's language. --typeorm uses TypeORM's generator on a local PGlite database instead (TypeScript services).";

  static examples = [
    `$ apso migrate plan --answer entity:Company=rename:Organization`,
    `$ apso migrate generate`,
    `$ apso migrate generate --typeorm`,
  ];

  static flags = {
    baseline: Flags.string({
      description:
        "The deployed .apsorc to migrate from. Defaults to the schema after the newest planned migration, or the .apsorc from the last commit that changed the migrations folder",
    }),
    name: Flags.string({
      description: "Migration name",
      default: "SchemaUpdate",
    }),
    plan: Flags.string({
      description: "Migration plan with the answers",
      default: ".apso/migration-plan.json",
    }),
    typeorm: Flags.boolean({
      description:
        "Use TypeORM's migration:generate instead of Apso's plan (no data moves)",
      default: false,
    }),
    json: Flags.boolean({
      description: "Print the result as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateGenerate);
    const { apsorc } = readApsorcFile();
    if (flags.typeorm && (apsorc.language ?? "typescript") !== "typescript")
      this.error("--typeorm works on TypeScript services only.");
    let baseline: Baseline;
    try {
      baseline = resolveBaseline(
        process.cwd(),
        apsorc,
        flags.baseline,
        path.resolve(flags.plan)
      );
    } catch (error) {
      this.error((error as Error).message, { exit: 1 });
    }
    const result = flags.typeorm
      ? await generateMigration(
          process.cwd(),
          baselineFile(baseline),
          flags.name,
          cliBinPath(this.config.root)
        )
      : writePlannedMigration(
          process.cwd(),
          baseline.schema,
          flags.name,
          path.resolve(flags.plan)
        );
    const { open } = result as { open?: Question[] };
    if (open && open.length > 0) {
      if (flags.json) this.log(JSON.stringify(result));
      else {
        this.log(result.steps[0].output ?? "");
        for (const q of open)
          this.log(
            `\n${q.id}\n  ${q.subject}\n  options: ${q.options.join(" | ")}${
              q.suggested ? ` (suggested: ${q.suggested})` : ""
            }`
          );
      }
      this.exit(2);
    }
    const summary = result.needed
      ? `Created ${result.file}`
      : "The database already matches; no migration needed.";
    report(
      (s) => this.log(s),
      result,
      flags.json,
      result.ok ? summary : undefined
    );
    if (!result.ok) this.exit(1);
  }
}
