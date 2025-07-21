import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as fs from "fs";
import shell from "shelljs";
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
  };

  static args = { name: Args.string() };

  async installModules(projectPath: string): Promise<void> {
    this.log("Installing modules...");
    await this.runNpmCommand(["install", "--force", "--prefix", projectPath]);
  }

  async formatApp(projectPath: string): Promise<void> {
    this.log("Formatting code...");
    shell.cd(projectPath);
    await this.runNpmCommand(["run", "format", "--prefix", projectPath]);
  }

  async startApp(projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const command = isWindows ? "npm.cmd" : "npm";
      const args = ["start"];

      const child = spawn(command, args, {
        cwd: projectPath,
        stdio: "inherit",
        shell: isWindows,
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject({
            command: `${command} ${args.join(" ")}`,
          });
          return;
        }
        resolve();
      });

      child.on("error", (err) => {
        this.log(`Error starting app: ${err.message}`);
        reject(err);
      });
    });
  }

  async cloneTemplate(projectPath: string): Promise<void> {
    this.log("Cloning service template...");

    if (!fs.existsSync(projectPath) && this.CURR_DIR !== projectPath) {
      fs.mkdirSync(projectPath);
    }

    shell.cd(projectPath);
    const repoUrl = process.env.APSO_GIT_PAT
      ? `https://${process.env.APSO_GIT_PAT}@github.com/mavric/apso-service-template.git`
      : `git@github.com:mavric/apso-service-template.git`;

    shell.exec(`git clone --depth=1 --branch=main ${repoUrl} ${projectPath}`);
    shell.exec(`rm -rf ${projectPath}/.git`);
    shell.cd(this.CURR_DIR);
  }

  async validateFlags() {
    const { flags } = await this.parse(New);

    let projectName = flags.name;
    let apiType = flags.type?.toLowerCase();

    if (!projectName) {
      projectName = '';
    }

    if (!apiType) {
      apiType = "rest";
    }

    if (!["rest", "graphql"].includes(apiType)) {
      this.error("`apiType` must be 'rest' or 'graphql'");
    }

    return { projectName, apiType };
  }

  async run(): Promise<void> {
    this.log("Initializing New Apso Server...");
    const { projectName } = await this.validateFlags();
    const CURR_DIR = process.cwd();
    const projectPath = path.join(CURR_DIR, projectName);

    await this.cloneTemplate(projectPath);
    await this.installModules(projectPath);
    await this.formatApp(projectPath);
  }
}