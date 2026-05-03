import BaseCommand from "../../lib/base-command";

export default class Scaffold extends BaseCommand {
  static hidden = true;
  static description = "[Deprecated] Use 'apso generate' instead";

  static examples = [`$ apso generate`];

  static strict = false;

  async run(): Promise<void> {
    this.warn(
      '"apso server scaffold" is deprecated. Use "apso generate" instead.'
    );
    await this.config.runCommand("generate", this.argv);
  }
}
