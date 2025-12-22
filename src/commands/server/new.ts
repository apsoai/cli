import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as fs from "fs";
import shell from "shelljs";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import * as path from "path";

type TargetLanguage = "typescript" | "python" | "go";

const TEMPLATE_REPOS: Record<TargetLanguage, string> = {
  typescript: "https://github.com/apsoai/service-template.git",
  python: "https://github.com/apsoai/service-template-python.git",
  go: "https://github.com/apsoai/service-template-go.git",
};

export default class New extends BaseCommand {
  static description = "Initialize your server project";

  static examples = [
    `$ apso server new --name TestProject`,
    `$ apso server new --name TestProject --language python`,
    `$ apso server new --name TestProject --language go`,
  ];

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
    language: Flags.string({
      char: "l",
      description: "target language (typescript, python, go)",
      options: ["typescript", "python", "go"],
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

  async cloneTemplate(projectPath: string, language: TargetLanguage): Promise<void> {
    const repoUrl = TEMPLATE_REPOS[language];
    this.log(`Cloning ${language} service template...`);

    if (!fs.existsSync(projectPath) && this.CURR_DIR !== projectPath) {
      fs.mkdirSync(projectPath);
    }

    shell.cd(projectPath);
    const cloneResult = shell.exec(
      `git clone --depth=1 --branch=main ${repoUrl} ${projectPath}`,
      { silent: true }
    ); // Use silent: true to suppress default output

    // Check if the command failed
    if (cloneResult.code !== 0) {
      // Provide a more generic error message for clone failures
      this.error(
        `Failed to clone the template repository from GitHub.\n` +
          `Error Output:\n${cloneResult.stderr}\n\n` +
          `Please check your network connection and ensure the repository exists at ${repoUrl}\n\n` +
          `If the problem persists, please remove the partially created directory "${projectPath}" and try again.`
      );
      // Throwing error via this.error will stop execution
    }

    // If clone was successful, proceed to remove the .git directory
    shell.exec(`rm -rf ${projectPath}/.git`);
    shell.cd(this.CURR_DIR);
  }

  async validateFlags() {
    const { flags } = await this.parse(New);

    let projectName = flags.name;
    let apiType = flags.type?.toLowerCase();
    let language = flags.language as TargetLanguage | undefined;

    if (!projectName) {
      projectName = "";
    }

    if (!apiType) {
      apiType = "rest";
    }

    if (!["rest", "graphql"].includes(apiType)) {
      this.error("`apiType` must be 'rest' or 'graphql'");
    }

    // Prompt for language if not provided
    if (!language) {
      const response = await inquirer.prompt([
        {
          type: "list",
          name: "language",
          message: "Select your target language:",
          choices: [
            { name: "TypeScript", value: "typescript" },
            { name: "Python", value: "python" },
            { name: "Go", value: "go" },
          ],
          default: "typescript",
        },
      ]);
      language = response.language as TargetLanguage;
    }

    return { projectName, apiType, language };
  }

  async run(): Promise<void> {
    this.log("Initializing New Apso Server...");
    const { projectName, language } = await this.validateFlags();
    const CURR_DIR = process.cwd();
    const projectPath = path.join(CURR_DIR, projectName);

    await this.cloneTemplate(projectPath, language);

    // Language-specific setup
    if (language === "typescript") {
      await this.installModules(projectPath);
      await this.formatApp(projectPath);
    } else if (language === "python") {
      this.log("Python project created. Run 'pip install -e .[dev]' to install dependencies.");
    } else if (language === "go") {
      this.log("Go project created. Run 'go mod tidy' to install dependencies.");
    }

    this.log(`\n✓ Project created at ${projectPath}`);
    this.log(`  Language: ${language}`);
  }
}
