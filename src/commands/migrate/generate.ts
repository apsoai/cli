import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { parseApsorc } from "../../lib/apsorc-parser";
import {
  cliBinPath,
  migrateUnsupported,
  generateMigration,
  report,
} from "../../lib/verify";

export default class MigrateGenerate extends BaseCommand {
  static description =
    "Generate a TypeORM migration from the deployed schema to this project's entities, using a local PGlite database (TypeScript services)";

  static examples = [`$ apso migrate generate --baseline deployed.apsorc`];

  static flags = {
    baseline: Flags.string({
      description: "The deployed .apsorc to migrate from",
      required: true,
    }),
    name: Flags.string({
      description: "Migration name",
      default: "SchemaUpdate",
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
    const result = await generateMigration(
      process.cwd(),
      path.resolve(flags.baseline),
      flags.name,
      cliBinPath(this.config.root)
    );
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
