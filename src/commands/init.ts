import { Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { TargetLanguage } from "../lib/types";
import { credentials, projectLink } from "../lib/config";
import { ProjectLinkFile } from "../lib/config/types";
import { workspacesApi, servicesApi } from "../lib/api/services";
import { withUpgradeRetry } from "../lib/upgrade";
import { Workspace, Service } from "../lib/api/types";
import {
  PROJECT_NAME_PATTERN,
  cloneTemplate,
  initGitRepo,
} from "../lib/utils/template";

export default class Init extends BaseCommand {
  static description = "Create a new Apso project or clone an existing one";

  static examples = [
    `$ apso init`,
    `$ apso init --name my-app --language typescript`,
    `$ apso init --name my-app --language python --skip-platform`,
  ];

  static flags = {
    name: Flags.string({
      char: "n",
      description: "Project name",
    }),
    language: Flags.string({
      char: "l",
      description: "Target language (typescript, python, go)",
      options: ["typescript", "python", "go"],
    }),
    "skip-platform": Flags.boolean({
      description: "Skip platform linking (offline mode)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    // Check for git
    if (!shell.which("git")) {
      this.error(
        "git is required but not found. Please install git and try again."
      );
    }

    // Detect existing project
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, ".apsorc")) ||
      fs.existsSync(path.join(cwd, ".apso", "link.json"))
    ) {
      this.error(
        "An Apso project already exists in this directory. Run commands from a different directory or remove .apsorc / .apso/link.json first."
      );
    }

    const isAuthenticated = !flags["skip-platform"] && credentials.isValid();

    await (isAuthenticated ? this.runAuthenticated(flags) : this.runOffline(flags));
  }

  private async runAuthenticated(flags: {
    name?: string;
    language?: string;
    "skip-platform": boolean;
  }): Promise<void> {
    // Ask: create new or clone existing
    const { action } = await inquirer.prompt<{
      action: "create" | "clone";
    }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Create a new project", value: "create" },
          { name: "Clone an existing project", value: "clone" },
        ],
      },
    ]);

    await (action === "clone" ? this.cloneExisting() : this.createNew(flags));
  }

  private async cloneExisting(): Promise<void> {
    // Select workspace
    const workspaces = await workspacesApi.list();
    if (workspaces.length === 0) {
      this.error(
        "No workspaces found. Create a workspace at https://app.apso.cloud first."
      );
    }

    const { workspace } = await inquirer.prompt<{ workspace: Workspace }>([
      {
        type: "list",
        name: "workspace",
        message: "Select a workspace:",
        choices: workspaces.map((ws) => ({
          name: `${ws.name} (${ws.slug})`,
          value: ws,
        })),
      },
    ]);

    // Select service
    const servicesResponse = await servicesApi.list(workspace.slug);
    if (servicesResponse.data.length === 0) {
      this.error(
        `No services found in workspace "${workspace.name}". Create one first or choose "Create a new project".`
      );
    }

    const { service } = await inquirer.prompt<{ service: Service }>([
      {
        type: "list",
        name: "service",
        message: "Select a service to clone:",
        choices: servicesResponse.data.map((svc) => ({
          name: `${svc.name} (${svc.slug})`,
          value: svc,
        })),
      },
    ]);

    const projectPath = path.join(process.cwd(), service.slug);

    // Validate the resolved path stays within cwd
    const resolvedPath = path.resolve(projectPath);
    if (!resolvedPath.startsWith(path.resolve(process.cwd()))) {
      this.error("Invalid service slug: path traversal detected");
    }

    if (service.githubRepo) {
      // Clone from GitHub
      this.log(`Cloning from ${service.githubRepo}...`);
      const branch = service.githubBranch || "main";
      const cloneResult = shell.exec(
        `git clone --branch="${branch}" "${service.githubRepo}" "${projectPath}"`,
        { silent: true }
      );
      if (cloneResult.code !== 0) {
        this.error(
          `Failed to clone repository: ${cloneResult.stderr}`
        );
      }
    } else {
      // No GitHub repo, clone template instead
      this.log(
        "No GitHub repository linked to this service. Cloning default template..."
      );
      cloneTemplate(projectPath, "typescript", this.log.bind(this));
      initGitRepo(projectPath);
    }

    // Write project link
    const link: ProjectLinkFile = {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      serviceId: service.id,
      serviceSlug: service.slug,
      githubRepo: service.githubRepo,
      githubBranch: service.githubBranch,
      linkedAt: new Date().toISOString(),
    };
    projectLink.write(link, projectPath);

    this.log(`\nProject cloned to ${projectPath}`);
    this.log(
      `Linked to workspace "${workspace.name}" / service "${service.name}"`
    );
  }

  private async createNew(flags: {
    name?: string;
    language?: string;
  }): Promise<void> {
    // Prompt for name if not provided
    let projectName = flags.name;
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

    if (!projectName || !PROJECT_NAME_PATTERN.test(projectName)) {
      this.error(
        "Project name must start with a letter and contain only letters, numbers, hyphens, and underscores"
      );
    }

    // Prompt for language if not provided
    let language = flags.language as TargetLanguage | undefined;
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

    const projectPath = path.join(process.cwd(), projectName);
    const resolvedPath = path.resolve(projectPath);
    if (!resolvedPath.startsWith(path.resolve(process.cwd()))) {
      this.error("Invalid project name: path traversal detected");
    }

    // Select workspace
    const workspaces = await workspacesApi.list();
    if (workspaces.length === 0) {
      this.error(
        "No workspaces found. Create a workspace at https://app.apso.cloud first."
      );
    }

    const { workspace } = await inquirer.prompt<{ workspace: Workspace }>([
      {
        type: "list",
        name: "workspace",
        message: "Select a workspace:",
        choices: workspaces.map((ws) => ({
          name: `${ws.name} (${ws.slug})`,
          value: ws,
        })),
      },
    ]);

    // Create service on platform
    this.log(`Creating service "${projectName}" in workspace "${workspace.name}"...`);
    const serviceName: string = projectName;
    const service = await withUpgradeRetry(() =>
      servicesApi.create(workspace.slug, {
        name: serviceName,
      })
    );

    // Clone template
    cloneTemplate(projectPath, language!, this.log.bind(this));
    initGitRepo(projectPath);

    // Write project link
    const link: ProjectLinkFile = {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      serviceId: service.id,
      serviceSlug: service.slug,
      linkedAt: new Date().toISOString(),
    };
    projectLink.write(link, projectPath);

    await this.postSetup(projectPath, language!);

    this.log(`\nProject created at ${projectPath}`);
    this.log(`Language: ${language}`);
    this.log(
      `Linked to workspace "${workspace.name}" / service "${service.name}"`
    );
  }

  private async runOffline(flags: {
    name?: string;
    language?: string;
    "skip-platform": boolean;
  }): Promise<void> {
    // Prompt for name if not provided
    let projectName = flags.name;
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

    if (!projectName || !PROJECT_NAME_PATTERN.test(projectName)) {
      this.error(
        "Project name must start with a letter and contain only letters, numbers, hyphens, and underscores"
      );
    }

    // Prompt for language if not provided
    let language = flags.language as TargetLanguage | undefined;
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

    const projectPath = path.join(process.cwd(), projectName);
    const resolvedPath = path.resolve(projectPath);
    if (!resolvedPath.startsWith(path.resolve(process.cwd()))) {
      this.error("Invalid project name: path traversal detected");
    }

    // Clone template and init git
    cloneTemplate(projectPath, language!, this.log.bind(this));
    initGitRepo(projectPath);

    await this.postSetup(projectPath, language!);

    this.log(`\nProject created at ${projectPath}`);
    this.log(`Language: ${language}`);
    this.log(
      'Run "apso login" to link this project to the Apso platform.'
    );
  }

  private async postSetup(
    projectPath: string,
    language: TargetLanguage
  ): Promise<void> {
    switch (language) {
      case "typescript": {
        if (shell.which("npm")) {
          this.log("Installing modules...");
          await this.runNpmCommand([
            "install",
            "--force",
            "--prefix",
            projectPath,
          ]);
        } else {
          this.log(
            "Warning: npm not found. Skipping module installation."
          );
        }
        break;
      }
      case "python": {
        this.log(
          "Python project created. Run 'pip install -e .[dev]' to install dependencies."
        );
        break;
      }
      case "go": {
        this.log(
          "Go project created. Run 'go mod tidy' to install dependencies."
        );
        break;
      }
    }
  }
}
