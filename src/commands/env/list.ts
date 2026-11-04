import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { envApi } from "../../lib/api/services";
import { linkedService } from "../../lib/environments";

export default class EnvList extends BaseCommand {
  static description = "List the linked service's environments (production, staging)";

  static examples = [`$ apso env list`, `$ apso env list --json`];

  static flags = {
    json: Flags.boolean({ description: "Output as JSON", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EnvList);
    const service = await linkedService(this);
    const envs = await envApi.list(service.id);
    if (flags.json) {
      this.log(JSON.stringify(envs, null, 2));
      return;
    }
    for (const e of envs) {
      this.log(`${e.environment.padEnd(12)}${(e.buildStatus || e.status || "-").padEnd(22)}${e.url ?? "-"}`);
    }
    if (!envs.some((e) => e.environment === "staging")) {
      this.log("\nNo staging environment. Add one with 'apso env add staging'.");
    }
  }
}
