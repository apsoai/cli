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
  stampApsorcLanguage(projectPath, language, log);
}

/**
 * Stamp the chosen language into the scaffolded `.apsorc`.
 *
 * `apso generate` resolves its target language as flag > .apsorc > prompt.
 * The TypeScript template (pinned at v2.0.0) ships an `.apsorc` without a
 * `language` field, so a bare `apso generate` right after `apso init` fell
 * through to the interactive prompt — which errors in non-TTY contexts
 * (this is what kept the weekly scaffold-smoke workflow red). Recording the
 * language `init` was given makes the scaffold self-describing.
 *
 * Best-effort: leaves an existing `language` value alone and skips files it
 * cannot parse as JSON.
 */
export function stampApsorcLanguage(
  projectPath: string,
  language: TargetLanguage,
  log: (msg: string) => void
): void {
  const apsorcPath = path.join(projectPath, ".apsorc");
  if (!fs.existsSync(apsorcPath)) return;

  try {
    const raw = fs.readFileSync(apsorcPath, "utf-8");
    const config = JSON.parse(raw) as { language?: string };
    if (config.language) return;
    config.language = language;
    const indent = raw.match(/^([\t ]+)"/m)?.[1] ?? "  ";
    fs.writeFileSync(
      apsorcPath,
      `${JSON.stringify(config, null, indent)}\n`
    );
    log(`Recorded "language": "${language}" in .apsorc`);
  } catch {
    // .apsorc may use a format we don't fully parse (e.g. comments) —
    // leave it untouched rather than risk mangling the user's schema file.
  }
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
