import { Args, Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { envApi } from "../../lib/api/services";
import { confirmOrExit, linkedService } from "../../lib/environments";

export default class EnvRemove extends BaseCommand {
  static description =
    "Tear down the linked service's staging environment and stop the add-on. Production is untouched.";

  static examples = [`$ apso env remove staging`, `$ apso env remove staging --yes`];

  static args = {
    environment: Args.string({ description: "Environment to remove", options: ["staging"], required: true }),
  };

  static flags = {
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EnvRemove);
    const service = await linkedService(this);
    if (!(await envApi.get(service.id, "staging"))) {
      this.log(`"${service.name}" has no staging environment.`);
      return;
    }
    const ok = await confirmOrExit(
      this,
      flags.yes,
      `Tear down staging for "${service.name}"? Its stack and database branch are deleted.`
    );
    if (!ok) return this.log("Cancelled.");
    await envApi.removeStaging(service.id);
    this.log("Staging is being torn down. Production is unchanged.");
  }
}
