import BaseCommand from "../../lib/base-command";

export default class New extends BaseCommand {
  static hidden = true;
  static description = "[Deprecated] Use 'apso init' instead";

  static examples = [`$ apso init`];

  static strict = false;

  async run(): Promise<void> {
    this.warn(
      '"apso server new" is deprecated. Use "apso init" instead.'
    );
    await this.config.runCommand("init", this.argv);
  }
}
