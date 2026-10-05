import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { parseApsorc } from "../../lib/apsorc-parser";
import { report, smokeTest } from "../../lib/verify";

export default class TestSmoke extends BaseCommand {
  static description =
    "Start the service on a local PGlite database and call /health, every entity's list endpoint, and a create/read/delete of one row per entity (TypeScript services)";

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
    const { entities, relationshipMap, auth } = parseApsorc();
    // With auth configured every entity route needs a session, so only /health is checked.
    const result = await smokeTest(
      process.cwd(),
      auth ? [] : entities,
      relationshipMap,
      { skipBuild: flags["skip-build"] }
    );
    const summary =
      result.steps[0]?.name === "skipped"
        ? "Smoke test skipped."
        : "Smoke test passed.";
    report(
      (s) => this.log(s),
      result,
      flags.json,
      result.ok ? summary : undefined
    );
    if (!result.ok) this.exit(1);
  }
}
