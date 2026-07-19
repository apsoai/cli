import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import { TargetLanguage } from "../types";

export const TEMPLATE_REPOS: Record<TargetLanguage, string> = {
  // NOTE: typescript intentionally points at the v1 template (@nestjsx/crud).
  // service-template-ts depends on @apso/crud* packages that are not yet
  // published to npm (file:../ refs), and the generators still emit
  // @nestjsx/crud imports. Do not switch back to service-template-ts until:
  //   1. @apso/crud* are published to npm
  //   2. service-template-ts deps are converted to npm version refs
  //   3. generators are ported to the @apso/crud API
  typescript: "https://github.com/apsoai/service-template.git",
  python: "https://github.com/apsoai/service-template-python.git",
  go: "https://github.com/apsoai/service-template-go.git",
};

export const PROJECT_NAME_PATTERN = /^[A-Za-z][\w-]*$/;

/**
 * Clone a template repository into the given project path.
 * Removes the .git directory after cloning.
 */
export function cloneTemplate(
  projectPath: string,
  language: TargetLanguage,
  log: (msg: string) => void
): void {
  const repoUrl = TEMPLATE_REPOS[language];
  log(`Cloning ${language} service template...`);

  if (fs.existsSync(projectPath)) {
    throw new Error(`Directory already exists: ${projectPath}`);
  }

  try {
    fs.mkdirSync(projectPath, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create directory: ${(error as Error).message}`
    );
  }

  const cloneResult = shell.exec(
    `git clone --depth=1 --branch=main "${repoUrl}" "${projectPath}"`,
    { silent: true }
  );

  if (cloneResult.code !== 0) {
    shell.rm("-rf", projectPath);
    throw new Error(
      `Failed to clone the template repository from GitHub.\n` +
        `Error Output:\n${cloneResult.stderr}\n\n` +
        `Please check your network connection and ensure the repository exists at ${repoUrl}`
    );
  }

  shell.rm("-rf", path.join(projectPath, ".git"));
}

/**
 * Initialize a fresh git repository in the given directory.
 */
export function initGitRepo(projectPath: string): void {
  const result = shell.exec(`git init "${projectPath}"`, { silent: true });
  if (result.code !== 0) {
    throw new Error(`Failed to initialize git repository: ${result.stderr}`);
  }
}
