import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as fs from "fs";
import shell from 'shelljs';
import BaseCommand from "../../lib/base-command";
import * as path from "path";

export default class New extends BaseCommand {
  static description = "Initialize your server project";

  static examples = [`$ apso server new --name TestProject`];
  private CURR_DIR = process.cwd();
  static flags = {
    name: Flags.string({
      char: "n",
      description: "name of application",
    }),
    type: Flags.string({
      char: "t",
      description: "api type (rest or graphql)",
    }),
    help: Flags.help({ char: 'h' }),
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
      // `https://github.com/facebook/create-react-app/issues/3326.`
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
    this.log("Creating project in current folder.")
    if (!fs.existsSync(projectPath) && this.CURR_DIR !== projectPath) {
      fs.mkdirSync(projectPath);
    }

    shell.cd(projectPath);
    // Execute git clone and capture the result using HTTPS
    const cloneResult = shell.exec(`git clone --depth=1 --branch=main https://github.com/apsoai/service-template.git ${projectPath}`, { silent: true }); // Use silent: true to suppress default output

    // Check if the command failed
    if (cloneResult.code !== 0) {
        // Provide a more generic error message for clone failures
        this.error(
          `Failed to clone the template repository from GitHub.\n` +
          `Error Output:\n${cloneResult.stderr}\n\n` +
          `Please check your network connection and ensure the repository exists at https://github.com/apsoai/service-template.git\n\n` +
          `If the problem persists, please remove the partially created directory "${projectPath}" and try again.`
        );
        // Throwing error via this.error will stop execution
    }

    // If clone was successful, proceed to remove the .git directory
    shell.exec(`rm -rf ${projectPath}/.git`);
    shell.cd(this.CURR_DIR);
  }

  async run(): Promise<void> {
    this.log("Initializing New Apso Server...");
    const {
      projectName,
      // apiType,
    } = await this.validateFlags();
    const CURR_DIR = process.cwd();
    const projectPath = path.join(CURR_DIR, projectName);

    await this.cloneTemplate(projectPath);
    await this.installModules(projectPath);
    await this.formatApp(projectPath);
  }

  async validateFlags() {
    const { flags } = await this.parse(New);

    let projectName = flags.name;
    let apiType = flags.type?.toLowerCase();
    if (typeof projectName === "undefined") {
      // this.error("`name` must be set (e.g. WoofyApp)");
      projectName = '';
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
