import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as fs from "fs";
import shell from 'shelljs';
import BaseCommand from "../../lib/base-command";

export default class New extends BaseCommand {
  static description = "Initialize your server project";

  static examples = [`$ apso server new --name TestProject`];

  static flags = {
    name: Flags.string({
      char: "n",
      description: "name of application",
    }),
    type: Flags.string({
      char: "t",
      description: "api type (rest or graphql)",
    }),
  };

  static args = { name: Args.string() };

  async installModules(path: string): Promise<void> {
    this.log("installing modules");
    await this.runNpmCommand(["install", "--force", "--prefix", path]);
  }

  async formatApp(root: string): Promise<void> {
    this.log("cleaning up");
    shell.cd(root);
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

  async cloneTemplate(
    projectPath: string,
    // projectName: string,
    // apiType: string,
  ): Promise<void> {
    fs.mkdirSync(projectPath);
    shell.exec(`git clone --depth=1 --branch=main git@github.com:mavric/apso-service-template.git ${projectPath}`)
    shell.exec(`rm -rf ${projectPath}/.git`);
  }

  async run(): Promise<void> {
    this.log("Initializing New Apso Server...");
    const {
      projectName,
      // apiType,
    } = await this.validateFlags();
    const CURR_DIR = process.cwd();
    const projectPath = `${CURR_DIR}/${projectName}`;

    await this.cloneTemplate(projectPath);
    await this.installModules(projectPath);
    await this.formatApp(projectPath);
  }

  async validateFlags() {
    const { flags } = await this.parse(New);

    const projectName = flags.name;
    let apiType = flags.type?.toLowerCase();
    if (typeof projectName === "undefined") {
      this.error("`name` must be set (e.g. WoofyApp)");
    }

    if (typeof apiType === "undefined") {
      apiType = "rest";
    }
    if (apiType !== "rest" && apiType !== "graphql") {
      this.error("`apiType` must be set (e.g. rest or graphql)");
    }
    return { projectName, apiType };
  }
}
