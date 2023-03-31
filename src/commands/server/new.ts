import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { createDirectoryContents } from "../../lib/util";
import BaseCommand from "../../lib/base-command";

export default class New extends BaseCommand {
  static description = "Initialize your server project";

  static examples = [`$ apso server new --name TestProject`];

  static flags = {
    name: Flags.string({
      char: "n",
      description: "name of application",
    }),
  };

  static args = { name: Args.string() };

  async installModules(root: string): Promise<void> {
    await this.runNpmCommand(["install", "--prefix", root]);
  }

  async formatApp(root: string): Promise<void> {
    await this.runNpmCommand(["run", "format", "--prefix", root]);
  }

  async startApp(root: string): Promise<void> {
    return new Promise((resolve: any, reject) => {
      const command = "npm";
      const args: string[] = ["start"];

      // Explicitly set cwd() to work around issues like
      // https://github.com/facebook/create-react-app/issues/3326.
      // Unfortunately we can only do this for Yarn because npm support for
      // equivalent --prefix flag doesn't help with this issue.
      // This is why for npm, we run checkThatNpmCanReadCwd() early instead.
      // args.push('--cwd')
      // args.push(root)
      // args.push('--verbose')

      const child = spawn(command, args, { stdio: "inherit", cwd: root });
      child.on("close", (code) => {
        if (code !== 0) {
          reject({
            command: `${command} ${args.join(" ")}`,
          });
          return;
        }
        resolve();
      });
    });
  }

  async run(): Promise<void> {
    this.log("Initializing New Apso Server...");
    const { flags } = await this.parse(New);

    const projectName = flags.name;
    if (typeof projectName === "undefined") {
      this.error("`name` must be set (e.g. WoofyApp)");
    }

    const templatePath = `${path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "apso-service-template"
    )}`;
    const CURR_DIR = process.cwd();
    const projectPath = `${CURR_DIR}/${projectName}`;
    fs.mkdirSync(projectPath);
    createDirectoryContents(templatePath, projectName);
    // this.log("installing modules");
    // await this.installModules(projectPath);
    await this.formatApp(projectPath);
  }
}
