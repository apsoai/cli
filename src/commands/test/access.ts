import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { accessTest } from "../../lib/access";
import { parseApsorc } from "../../lib/apsorc-parser";

export default class TestAccess extends BaseCommand {
  static description =
    "Start the service and prove the access rules on this project's own schema: who may call, tenant scope (scopeBy), permissions, API keys and MCP tools. Test sign-ins are signed by a local issuer with the claim names from the auth block; the service is pointed at it through AUTH_JWT_ISSUER and AUTH_JWKS_URI for this run only. Rows are created for two test tenants and deleted afterwards. TypeScript services run on a local PGlite database; Python and Go services run on the database in DATABASE_URL. Prints pass or fail per rule and exits 1 on any failure";

  static examples = [`$ apso test access`, `$ apso test access --json`];

  static flags = {
    "skip-build": Flags.boolean({
      description:
        "Use the existing dist/ build instead of building first (TypeScript)",
      default: false,
    }),
    verbose: Flags.boolean({
      description: "Print every case, not only the failures",
      default: false,
    }),
    json: Flags.boolean({
      description: "Print the result as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TestAccess);
    const { entities, relationshipMap, auth, language } = parseApsorc();
    const result = await accessTest(process.cwd(), entities, relationshipMap, {
      skipBuild: flags["skip-build"],
      language,
      auth,
      log: flags.verbose && !flags.json ? (line) => this.log(line) : undefined,
    });
    if (flags.json) {
      this.log(JSON.stringify(result));
    } else {
      for (const s of result.steps) {
        this.log(`${s.ok ? "ok  " : "FAIL"} ${s.name}`);
        if (s.output) this.log(s.output.replace(/^/gm, "     "));
      }
      for (const note of result.notes) this.log(note);
      if (result.lines.length > 0) this.log("");
      for (const line of result.lines) {
        const count = line.cases > 0 ? `${line.cases} cases` : line.detail;
        this.log(`${line.id.padEnd(4)} ${line.result.padEnd(8)} ${count}`);
      }
      if (result.failures.length > 0) {
        this.log("\nFailed cases:");
        for (const f of result.failures)
          this.log(`- ${f.label}${f.detail ? `\n    ${f.detail}` : ""}`);
      }
      if (result.lines.length > 0)
        this.log(
          result.ok
            ? "\nAccess rules passed. Rule text: https://github.com/apsoai/cli/issues/208"
            : "\nAccess rules FAILED."
        );
    }
    if (!result.ok) this.exit(1);
  }
}
