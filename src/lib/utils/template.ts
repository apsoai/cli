import * as fs from "fs";
import * as path from "path";
import shell from "shelljs";
import { TargetLanguage } from "../types";

export const TEMPLATE_REPOS: Record<TargetLanguage, string> = {
  typescript: "https://github.com/apsoai/service-template-ts.git",
  python: "https://github.com/apsoai/service-template-python.git",
  go: "https://github.com/apsoai/service-template-go.git",
};

/**
 * Git ref (tag or branch) to clone for each template. Pinning to a tag makes
 * the CLI-version-to-template pairing explicit instead of a date cutoff on
 * template main. v2.0.0 is the first TS template revision on published
 * @apso/crud ^1.0.1 (dual-dialect: nestjsx + PostgREST); the Python and Go
 * template repos are untagged and don't carry the dialect work.
 */
export const TEMPLATE_REFS: Record<TargetLanguage, string> = {
  typescript: "v2.0.0",
  python: "main",
  go: "main",
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
  const templateRef = TEMPLATE_REFS[language];
  log(`Cloning ${language} service template (${templateRef})...`);

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
    `git clone --depth=1 --branch="${templateRef}" "${repoUrl}" "${projectPath}"`,
    { silent: true }
  );

  if (cloneResult.code !== 0) {
    shell.rm("-rf", projectPath);
    throw new Error(
      `Failed to clone the template repository from GitHub.\n` +
        `Error Output:\n${cloneResult.stderr}\n\n` +
        `Please check your network connection and ensure ref "${templateRef}" exists at ${repoUrl}`
    );
  }

  shell.rm("-rf", path.join(projectPath, ".git"));

  ensureEnvFile(projectPath, log);
}

/**
 * Ensure the scaffolded project has a `.env` file.
 *
 * Templates ship `.env.local` (and `.env.example`) but the NestJS env loader
 * reads `.env` by default, so a fresh scaffold would silently ignore the
 * shipped values and run on built-in defaults (wrong port, wrong database).
 * Copy `.env.local` (preferred) or `.env.example` to `.env` when no `.env`
 * exists yet. See apsoai/cli#103.
 */
export function ensureEnvFile(
  projectPath: string,
  log: (msg: string) => void
): void {
  const envPath = path.join(projectPath, ".env");
  if (fs.existsSync(envPath)) return;

  for (const source of [".env.local", ".env.example"]) {
    const sourcePath = path.join(projectPath, source);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, envPath);
      log(`Created .env from ${source}`);
      return;
    }
  }
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
