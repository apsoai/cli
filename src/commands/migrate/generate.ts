import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { parseApsorc } from "../../lib/apsorc-parser";
import { writePlannedMigration } from "../../lib/ddl/migration-file";
import { Question } from "../../lib/plan";
import {
  cliBinPath,
  migrateUnsupported,
  generateMigration,
  report,
} from "../../lib/verify";

export default class MigrateGenerate extends BaseCommand {
  static description =
    "Write a migration from the deployed schema to this project's .apsorc. Apso renders the SQL from the answered migration plan (apso migrate plan), including data moves and a down() that reverses them. Exits 2 while plan questions are open. --typeorm uses TypeORM's generator on a local PGlite database instead (TypeScript services).";

  static examples = [
    `$ apso migrate plan --baseline deployed.apsorc --answer entity:Company=rename:Organization`,
    `$ apso migrate generate --baseline deployed.apsorc`,
    `$ apso migrate generate --baseline deployed.apsorc --typeorm`,
  ];

  static flags = {
    baseline: Flags.string({
      description: "The deployed .apsorc to migrate from",
      required: true,
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
    const unsupported = migrateUnsupported(parseApsorc().language);
    if (unsupported) this.error(unsupported);

    const result = flags.typeorm
      ? await generateMigration(
          process.cwd(),
          path.resolve(flags.baseline),
          flags.name,
          cliBinPath(this.config.root)
        )
      : writePlannedMigration(
          process.cwd(),
          path.resolve(flags.baseline),
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
