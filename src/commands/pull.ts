import BaseCommand from "../lib/base-command";
import { readProjectLink, getServiceCodeDir, getProjectRoot } from "../lib/project-link";
import { createApiClient } from "../lib/api/client";
import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import { GithubConnection } from "../lib/api";
import { decrypt } from "../lib/utils/git";

export default class Pull extends BaseCommand {
  static description =
    "Pull the latest code from GitHub repository (like git pull)";

  static examples = [
    `$ apso pull  # Pull latest code from GitHub`,
    `$ apso pull --rebase  # Pull with rebase`,
    `$ apso pull --ff-only  # Fast-forward only`,
  ];

  // Allow unknown flags to pass through to git pull
  static strict = false;

  async run(): Promise<void> {
    // Get all raw arguments after the command name
    // This captures all flags and arguments that git pull accepts
    const pullIndex = process.argv.findIndex(arg => arg === "pull" || arg.endsWith("/pull"));
    const rawArgs = pullIndex >= 0 ? process.argv.slice(pullIndex + 1) : [];

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

    // Build git pull arguments
    // Start with "pull origin <branch>" and add any user-provided flags/args
    const branch = link.githubBranch || "main";
    const gitArgs: string[] = ["pull", "origin", branch];

    // Add any additional arguments/flags passed by user (e.g., --rebase, --ff-only, etc.)
    if (rawArgs.length > 0) {
      gitArgs.push(...rawArgs);
    }

    // Pull code from GitHub
    const api = createApiClient();
    await this.pullServiceCode(api, link, gitArgs);
  }

  private async pullServiceCode(
    api: ReturnType<typeof createApiClient>,
    link: { workspaceId: string; serviceId: string; serviceSlug: string; connectionId?: number; githubOwner?: string; repoName?: string; githubBranch?: string | null },
    gitArgs: string[]
  ): Promise<void> {
    try {
      const projectRoot = getProjectRoot();
      const expectedCodeDir = getServiceCodeDir();
      const resolvedExpectedDir = path.resolve(expectedCodeDir);
      const currentDir = process.cwd();
      const resolvedCurrentDir = path.resolve(currentDir);

      // Debug: show what directory we're checking
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(`[DEBUG] Project root: ${projectRoot}`);
        this.log(`[DEBUG] Expected code directory: ${resolvedExpectedDir}`);
        this.log(`[DEBUG] Current working directory: ${resolvedCurrentDir}`);
      }

      // Determine the actual code directory
      // Case 1: Current directory is the project root and has .git (repo cloned into project root)
      // Case 2: Expected serviceName subdirectory exists
      // Case 3: Current directory is the expected directory (user is in the code directory)
      let resolvedCodeDir: string;

      const currentDirGit = path.join(resolvedCurrentDir, ".git");
      const expectedDirGit = path.join(resolvedExpectedDir, ".git");

      // Debug: check what exists
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(`[DEBUG] Checking current dir .git: ${fs.existsSync(currentDirGit)}`);
        this.log(`[DEBUG] Checking expected dir exists: ${fs.existsSync(resolvedExpectedDir)}`);
        this.log(`[DEBUG] Checking expected dir .git: ${fs.existsSync(expectedDirGit)}`);
        this.log(`[DEBUG] Current dir === project root: ${resolvedCurrentDir === projectRoot}`);
        this.log(`[DEBUG] Current dir === expected dir: ${resolvedCurrentDir === resolvedExpectedDir}`);
      }

      // Check in order of preference:
      // 1. Current directory matches expected and has .git
      // 2. Expected directory exists and has .git
      // 3. Current directory is project root and has .git

      if (resolvedCurrentDir === resolvedExpectedDir && fs.existsSync(currentDirGit)) {
        // User is in the expected code directory and it has .git
        resolvedCodeDir = resolvedCurrentDir;
        if (process.env.DEBUG || process.env.APSO_DEBUG) {
          this.log(`[DEBUG] Using current directory as code directory (matches expected, has .git)`);
        }
      } else if (fs.existsSync(resolvedExpectedDir) && fs.existsSync(expectedDirGit)) {
        // Code repository is in the expected serviceName subdirectory
        resolvedCodeDir = resolvedExpectedDir;
        if (process.env.DEBUG || process.env.APSO_DEBUG) {
          this.log(`[DEBUG] Using expected service directory as code directory`);
        }
      } else if (resolvedCurrentDir === projectRoot && fs.existsSync(currentDirGit)) {
        // Code repository is in the project root itself
        resolvedCodeDir = resolvedCurrentDir;
        if (process.env.DEBUG || process.env.APSO_DEBUG) {
          this.log(`[DEBUG] Using project root as code directory (has .git)`);
        }
      } else {
        // Code directory not found or not a git repository
        this.log("");
        this.warn("Code repository not found locally.");
        this.log("");
        this.log(`Checked locations:`);
        this.log(`  1. Project root: ${projectRoot} ${fs.existsSync(currentDirGit) ? "(has .git)" : "(no .git)"}`);
        if (resolvedExpectedDir !== projectRoot) {
          const expectedExists = fs.existsSync(resolvedExpectedDir);
          const expectedHasGit = fs.existsSync(expectedDirGit);
          this.log(`  2. Service directory: ${resolvedExpectedDir}`);
          this.log(`     - Directory exists: ${expectedExists ? "Yes" : "No"}`);
          this.log(`     - Has .git folder: ${expectedHasGit ? "Yes" : "No"}`);

          // If directory exists but no .git, provide specific guidance
          if (expectedExists && !expectedHasGit) {
            this.log("");
            this.warn("Directory exists but is not a git repository.");
            this.log("This might mean the clone didn't complete successfully.");
            this.log("");
            this.log("Try one of the following:");
            this.log(`  1. Remove the directory and clone again: rm -rf "${resolvedExpectedDir}" && apso clone`);
            this.log(`  2. Or manually initialize git: cd "${resolvedExpectedDir}" && git init && git remote add origin <repo-url>`);
            return;
          }
        }
        this.log("");
        this.log("Please clone your repository first:");
        this.log(`  Run: apso clone`);
        this.log("");
        this.log("This will clone the code repository to your local machine.");
        return;
      }

      // Check if it's a git repository (should already be checked above, but double-check)
      const gitDir = path.join(resolvedCodeDir, ".git");
      if (!fs.existsSync(gitDir)) {
        this.log("");
        this.log("");
        this.log("Please clone your repository first:");
        this.log(`  Run: apso clone`);
        this.log("");
        this.log("Or remove the existing directory and clone again.");
        return;
      }

      // Check if GitHub connection is available
      if (!link.connectionId) {
        this.log("");
        this.warn("GitHub connection not found.");
        this.log("");
        this.log("Please connect your service to GitHub first:");
        this.log(`  Run: apso github:connect`);
        return;
      }

      // Check if repository info is available
      if (!link.githubOwner || !link.repoName) {
        this.log("");
        this.warn("GitHub repository information not found.");
        this.log("");
        this.log("Please connect your service to GitHub first:");
        this.log(`  Run: apso github:connect`);
        return;
      }

      // Fetch GitHub connection details
      this.log("");
      this.log("Fetching GitHub connection details...");

      let githubConnection: GithubConnection;
      try {
        githubConnection = await api.rawRequest<GithubConnection>(
          `/GithubConnections/${link.connectionId}`
        );
      } catch (error) {
        const err = error as Error;
        this.warn(`Failed to fetch GitHub connection: ${err.message}`);
        this.warn("You can still use 'apso push' to push schema changes.");
        return;
      }

      // Determine branch
      const branch = link.githubBranch || "main";

      // Decrypt token for authentication
      const decryptedToken = decrypt(githubConnection.accessToken);
      const authenticatedRepoUrl = `https://x-access-token:${decryptedToken}@github.com/${link.githubOwner}/${link.repoName}.git`;

      this.log("");
      this.log("Pulling latest code from GitHub...");
      this.log(`  Repository: ${link.githubOwner}/${link.repoName}`);
      this.log(`  Branch: ${branch}`);

      // Set environment variable to prevent git from prompting for credentials
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      };

      // Change to code directory and pull
      const originalCwd = process.cwd();
      try {
        process.chdir(resolvedCodeDir);

        // Update remote URL with authenticated URL to ensure authentication works
        const remoteUpdateResult = shell.exec(
          `git remote set-url origin "${authenticatedRepoUrl}"`,
          { silent: true, env }
        );

        if (remoteUpdateResult.code !== 0) {
          this.warn("Failed to update git remote URL. Continuing with existing remote...");
        }

        // Fetch latest changes first
        const fetchResult = shell.exec(
          `git fetch origin ${branch}`,
          { silent: true, env }
        );

        if (fetchResult.code !== 0) {
          const errorOutput = fetchResult.stderr || fetchResult.stdout || "Unknown error";
          this.warn(`Failed to fetch from GitHub: ${errorOutput}`);
          this.warn("You can still use 'apso push' to push schema changes.");
          return;
        }

        // Execute git pull with the provided arguments
        // gitArgs already includes "pull origin <branch>" and any flags
        const pullCommand = `git ${gitArgs.join(" ")}`;
        const pullResult = shell.exec(
          pullCommand,
          { silent: false, env } // Set to false to show git output
        );

        if (pullResult.code !== 0) {
          const errorOutput = pullResult.stderr || pullResult.stdout || "Unknown error";
          this.error(
            `Failed to pull code from GitHub.\n` +
            `Error: ${errorOutput}\n\n` +
            `Troubleshooting:\n` +
            `  - Check your network connection\n` +
            `  - Verify you have access to the repository\n` +
            `  - Check if there are local changes that need to be committed or stashed\n` +
            `  - Verify the branch exists: ${branch}`
          );
          return;
        }

        this.log(`✓ Code pulled successfully from GitHub`);
        this.log(`  Location: ${path.basename(resolvedCodeDir)}/`);
      } finally {
        process.chdir(originalCwd);
      }
    } catch (error) {
      const err = error as Error;
      this.warn(`Failed to pull service code: ${err.message}`);
      this.warn("You can still use 'apso push' to push schema changes.");
    }
  }
}

