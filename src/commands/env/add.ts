import { Args, Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { envApi } from "../../lib/api/services";
import { confirmOrExit, linkedService } from "../../lib/environments";

export default class EnvAdd extends BaseCommand {
  static description =
    "Add a staging environment to the linked service. It gets its own stack, URL and database branch, and starts the paid staging add-on.";

  static examples = [`$ apso env add staging`, `$ apso env add staging --yes`];

  static args = {
    environment: Args.string({ description: "Environment to add", options: ["staging"], required: true }),
  };

  static flags = {
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EnvAdd);
    const service = await linkedService(this);
    if (await envApi.get(service.id, "staging")) {
      this.log(`"${service.name}" already has staging. Deploy to it with 'apso deploy --env staging'.`);
      return;
    }
    const ok = await confirmOrExit(
      this,
      flags.yes,
      `Add staging to "${service.name}"? This starts the paid staging add-on.`
    );
    if (!ok) return this.log("Cancelled.");
    await envApi.addStaging(service.id);
    this.log(`Staging is being created for "${service.name}". Deploy to it with 'apso deploy --env staging'.`);
  }
}
