import { Args, Flags } from "@oclif/core";
import { spawn } from "child_process";
import * as fs from "fs";
import shell from "shelljs";
import inquirer from "inquirer";
import BaseCommand from "../../lib/base-command";
import * as path from "path";
import { TargetLanguage } from "../../lib/types";

const TEMPLATE_REPOS: Record<TargetLanguage, string> = {
  typescript: "https://github.com/apsoai/service-template.git",
  python: "https://github.com/apsoai/service-template-python.git",
  go: "https://github.com/apsoai/service-template-go.git",
};

const PROJECT_NAME_PATTERN = /^[A-Za-z][\w-]*$/;

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

    // Create directory if it doesn't exist
    if (!fs.existsSync(projectPath)) {
      try {
        fs.mkdirSync(projectPath, { recursive: true });
      } catch (err) {
        this.error(`Failed to create directory: ${(err as Error).message}`);
      }
    } else {
      this.error(`Directory already exists: ${projectPath}`);
    }

    // Use quoted paths to prevent command injection
    const cloneResult = shell.exec(
      `git clone --depth=1 --branch=main "${repoUrl}" "${projectPath}"`,
      { silent: true }
    );

    // Check if the command failed
    if (cloneResult.code !== 0) {
      // Clean up the failed directory
      shell.rm("-rf", projectPath);
      this.error(
        `Failed to clone the template repository from GitHub.\n` +
          `Error Output:\n${cloneResult.stderr}\n\n` +
          `Please check your network connection and ensure the repository exists at ${repoUrl}`
      );
    }

    // If clone was successful, proceed to remove the .git directory using safe shelljs method
    shell.rm("-rf", path.join(projectPath, ".git"));
  }

  async validateFlags() {
    const { flags } = await this.parse(New);

    let projectName = flags.name;
    let apiType = flags.type?.toLowerCase();
    let language = flags.language as TargetLanguage | undefined;

    // Prompt for project name if not provided
    if (!projectName) {
      const response = await inquirer.prompt([
        {
          type: "input",
          name: "projectName",
          message: "Enter your project name:",
          validate: (input: string) => {
            if (!input.trim()) {
              return "Project name is required";
            }
            if (!PROJECT_NAME_PATTERN.test(input)) {
              return "Project name must start with a letter and contain only letters, numbers, hyphens, and underscores";
            }
            return true;
          },
        },
      ]);
      projectName = response.projectName;
    }

    // Validate project name format (security: prevent command injection and path traversal)
    if (!projectName || !PROJECT_NAME_PATTERN.test(projectName)) {
      this.error(
        "Project name must start with a letter and contain only letters, numbers, hyphens, and underscores"
      );
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

    return { projectName: projectName as string, apiType, language };
  }

  async run(): Promise<void> {
    // Check for required dependencies
    if (!shell.which("git")) {
      this.error("git is required but not found. Please install git and try again.");
    }

    this.log("Initializing New Apso Server...");
    const { projectName, language } = await this.validateFlags();
    const projectPath = path.join(this.CURR_DIR, projectName);

    // Validate the resolved path is within current directory (prevent path traversal)
    const resolvedPath = path.resolve(projectPath);
    if (!resolvedPath.startsWith(path.resolve(this.CURR_DIR))) {
      this.error("Invalid project name: path traversal detected");
    }

    await this.cloneTemplate(projectPath, language);

    // Language-specific setup
    if (language === "typescript") {
      if (!shell.which("npm")) {
        this.log("Warning: npm not found. Skipping module installation.");
      } else {
        await this.installModules(projectPath);
        await this.formatApp(projectPath);
      }
    } else if (language === "python") {
      this.log("Python project created. Run 'pip install -e .[dev]' to install dependencies.");
    } else if (language === "go") {
      this.log("Go project created. Run 'go mod tidy' to install dependencies.");
    }

    this.log(`\nProject created at ${projectPath}`);
    this.log(`Language: ${language}`);
  }
}
