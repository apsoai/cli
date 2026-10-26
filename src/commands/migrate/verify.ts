import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { parseApsorc } from "../../lib/apsorc-parser";
import {
  cliBinPath,
  migrateUnsupported,
  report,
  verifyMigration,
} from "../../lib/verify";

export default class MigrateVerify extends BaseCommand {
  static description =
    "Run a migration on a local PGlite copy of the deployed schema, then check the database matches this project's entities (TypeScript services)";

  static examples = [
    `$ apso migrate verify --baseline deployed.apsorc --migration src/migrations/1700000000000-SchemaUpdate-migration.ts`,
    `$ apso migrate verify --baseline deployed.apsorc --migration src/migrations/1700000000000-SchemaUpdate-migration.ts --seed seed.sql`,
  ];

  static flags = {
    baseline: Flags.string({
      description: "The deployed .apsorc the migration starts from",
      required: true,
    }),
    migration: Flags.string({
      description: "The migration file to run",
      required: true,
    }),
    seed: Flags.string({
      description:
        "SQL file of rows to insert into the deployed schema before the migration runs; the check then fails if the migration loses any of them",
    }),
    "accept-loss": Flags.boolean({
      description: "Report seeded rows or values the migration loses without failing",
      default: false,
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
    const unsupported = migrateUnsupported(parseApsorc().language);
    if (unsupported) this.error(unsupported);
    const result = await verifyMigration(
      process.cwd(),
      path.resolve(flags.baseline),
      flags.migration,
      cliBinPath(this.config.root),
      {
        skipBuild: flags["skip-build"],
        seedFile: flags.seed,
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
