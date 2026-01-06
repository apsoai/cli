import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import { readProjectLink, getProjectRoot } from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import { GithubConnection } from "../lib/api";
import { decrypt } from "../lib/utils/git";

export default class Clone extends BaseCommand {
  static description =
    "Clone the service code from GitHub repository (like git clone)";

  static examples = [
    `$ apso clone  # Clone code from connected GitHub repository`,
    `$ apso clone --branch main  # Clone specific branch`,
    `$ apso clone --directory ./my-service  # Clone to specific directory`,
  ];

  static flags = {
    branch: Flags.string({
      char: "b",
      description: "Branch to clone (defaults to linked branch or 'main')",
    }),
    directory: Flags.string({
      char: "d",
      description: "Directory to clone into (defaults to service name)",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Clone);
    // Ensure authentication
    await this.ensureAuthenticated({
      nonInteractive:
        process.env.APSO_NON_INTERACTIVE === "1" ||
        process.env.APSO_NON_INTERACTIVE === "true",
    });

    // Read project link
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.error(
        "Project is not linked to a service.\n" +
        "Run 'apso link' first to associate this project with a platform service."
      );
    }

    const { link } = linkInfo;

    // Check if connectionId exists
    if (!link.connectionId) {
      this.error(
        "Service is not connected to GitHub.\n" +
        "Run 'apso github:connect' first to connect the service to a GitHub repository."
      );
    }

    // Check if githubRepoUrl exists
    if (!link.githubRepoUrl && !link.githubRepo) {
      this.error(
        "GitHub repository URL is not available in the project link.\n" +
        "Run 'apso github:connect' to set up the GitHub connection."
      );
    }

    const api = createApiClient();

    // Fetch GitHub connection details
    this.log("Fetching GitHub connection details...");
    let githubConnection: GithubConnection;
    try {
      githubConnection = await api.rawRequest<GithubConnection>(
        `/GithubConnections/${link.connectionId}`
      );
    } catch (error) {
      const err = error as Error;
      this.error(
        `Failed to fetch GitHub connection: ${err.message}\n\n` +
        `Troubleshooting:\n` +
        `  - Verify connection ID: ${link.connectionId}\n` +
        `  - Run 'apso github:connect' to reconnect if needed`
      );
    }

    // Determine repository path
    if (!link.githubOwner || !link.repoName) {
      this.error(
        "GitHub repository information is not available in the project link.\n" +
        "Run 'apso github:connect' to set up the GitHub connection."
      );
    }

    const repoPath = `${link.githubOwner}/${link.repoName}`;

    // Determine branch
    const branch = flags.branch || link.githubBranch || "main";

    // Determine target directory
    const projectRoot = getProjectRoot();
    const targetDir = flags.directory
      ? path.resolve(flags.directory)
      : path.join(projectRoot, link.serviceName);

    // Check if directory already exists
    if (fs.existsSync(targetDir)) {
      this.error(
        `Directory already exists: ${targetDir}\n` +
        `Please remove it first or use --directory to specify a different location.`
      );
    }

    // Construct authenticated repository URL with x-access-token prefix
    const decryptedToken = decrypt(githubConnection.accessToken);
    const repoUrl = `https://x-access-token:${decryptedToken}@github.com/${repoPath}.git`;
    const maskedRepoUrl = `https://x-access-token:***@github.com/${repoPath}.git`;

    this.log("");
    this.log("Cloning repository...");
    this.log(`  Repository: ${maskedRepoUrl}`);
    this.log(`  Branch: ${branch}`);
    this.log(`  Target: ${targetDir}`);

    // Set environment variable to prevent git from prompting for credentials
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

    const cloneResult = shell.exec(
      `git clone --depth=1 --branch="${branch}" "${repoUrl}" "${targetDir}"`,
      { silent: true, env }
    );

    if (cloneResult.code !== 0) {
      const errorOutput = cloneResult.stderr || cloneResult.stdout || "Unknown error";
      this.error(
        `Failed to clone repository.\n` +
        `Git Error: ${errorOutput}\n\n` +
        `Troubleshooting:\n` +
        `  - Check your network connection\n` +
        `  - Verify the repository exists: ${maskedRepoUrl}\n` +
        `  - Ensure you have access to the repository\n` +
        `  - Verify the branch exists: ${branch}`
      );
    }

    this.log("");
    this.log(`✓ Successfully cloned repository to ${targetDir}`);
    this.log("");
    this.log("Next steps:");
    this.log(`  • Navigate to: cd ${path.relative(process.cwd(), targetDir)}`);
    this.log("  • Review the cloned code");
    this.log("  • Run 'apso pull' to sync schema if needed");
  }

  /**
   * Get authenticated URL for git clone
   * Uses the access token from GitHub connection
   */
  private getAuthenticatedUrl(repoUrl: string, accessToken: string): string {
    // If it's already an HTTPS URL, inject the token
    if (repoUrl.startsWith("https://")) {
      // Replace https:// with https://<token>@
      return repoUrl.replace("https://", `https://${accessToken}@`);
    }
    // If it's SSH, return as-is (SSH keys should be used)
    if (repoUrl.startsWith("git@")) {
      return repoUrl;
    }
    // Default: assume HTTPS and add token
    return `https://${accessToken}@${repoUrl.replace(/^https?:\/\//, "")}`;
  }
}

