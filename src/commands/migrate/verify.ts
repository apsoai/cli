import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { readApsorcFile } from "../../lib/apsorc-parser";
import { baselineFile, latestPlannedMigration } from "../../lib/plan/baseline";
import {
  cliBinPath,
  report,
  verifyMigration,
} from "../../lib/verify";

export default class MigrateVerify extends BaseCommand {
  static description =
    "Run a migration on a local PGlite copy of the deployed schema, then check the database matches this project's entities (TypeScript), or a fresh build of its .apsorc (Python and Go, which also run down and check it gives back the deployed schema)";

  static examples = [
    `$ apso migrate verify`,
    `$ apso migrate verify --seed seed.sql --check checks.sql`,
    `$ apso migrate verify --seed seed.sql --check checks.sql --accept-loss contact.fullName`,
    `$ apso migrate verify --baseline deployed.apsorc --migration src/migrations/1700000000000-SchemaUpdate-migration.ts`,
  ];

  static flags = {
    baseline: Flags.string({
      description:
        "The deployed .apsorc the migration starts from. Defaults to the schema saved with the migration's plan",
    }),
    migration: Flags.string({
      description:
        "The migration file to run. Defaults to the newest planned migration",
    }),
    seed: Flags.string({
      description:
        "SQL file of rows to insert into the deployed schema before the migration runs; the check then fails if the migration loses any of them",
    }),
    check: Flags.string({
      description:
        "SQL file of SELECTs run after the migration; each row must have a boolean ok (and a label naming the check), e.g. SELECT bool_and(\"firstName\" <> '') AS ok, 'every contact has a first name' AS label FROM contact",
    }),
    "accept-loss": Flags.string({
      description:
        "A table or table.column whose seeded data the migration may drop on purpose (repeatable); pair it with --check to prove where the data went",
      multiple: true,
      default: [],
    }),
    "skip-build": Flags.boolean({
      description: "Use the existing dist/ build instead of building first",
      default: false,
    }),
    json: Flags.boolean({
      description: "Print the result as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateVerify);
    const { apsorc } = readApsorcFile();
    const latest = latestPlannedMigration(process.cwd(), apsorc);
    const migration = flags.migration ?? latest?.file;
    if (!migration)
      this.error(
        "No planned migration found. Run apso migrate generate, or pass --migration.",
        { exit: 1 }
      );
    // The migration's own plan says which schema it starts from.
    const saved =
      latest && path.resolve(latest.file) === path.resolve(migration)
        ? latest.saved
        : undefined;
    let baseline: string;
    if (flags.baseline) baseline = path.resolve(flags.baseline);
    else if (saved)
      baseline = baselineFile({
        schema: saved.before,
        source: latest!.planFile,
      });
    else
      this.error(
        `No saved plan for ${migration}; pass the deployed .apsorc with --baseline.`,
        { exit: 1 }
      );
    const result = await verifyMigration(
      process.cwd(),
      baseline,
      migration,
      cliBinPath(this.config.root),
      {
        skipBuild: flags["skip-build"],
        seedFile: flags.seed,
        checkFile: flags.check,
        acceptLoss: flags["accept-loss"],
      }
    );
    report(
      (s) => this.log(s),
      result,
      flags.json,
      result.ok ? "Migration verified." : undefined
    );
    if (!result.ok) this.exit(1);
  }
}
