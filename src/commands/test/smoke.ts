import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { parseApsorc } from "../../lib/apsorc-parser";
import { report, smokeTest } from "../../lib/verify";

export default class TestSmoke extends BaseCommand {
  static description =
    "Start the service on a local PGlite database and call /health and every entity's list endpoint (TypeScript services)";

  static examples = [`$ apso test smoke`];

  static flags = {
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
    const { flags } = await this.parse(TestSmoke);
    const { entities, auth } = parseApsorc();
    // With auth configured every entity route needs a session, so only /health is checked.
    const names = auth ? [] : entities.map((e) => e.name);
    const result = await smokeTest(process.cwd(), names, {
      skipBuild: flags["skip-build"],
    });
    report(
      (s) => this.log(s),
      result,
      flags.json,
      result.ok ? "Smoke test passed." : undefined
    );
    if (!result.ok) this.exit(1);
  }
}
