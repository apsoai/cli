/**
 * Local git helpers for the deploy flow.
 *
 * The CLI pushes generated code to GitHub with the user's own local git (their
 * credentials / credential helper) — not through apso.ai. The platform only
 * needs the repo *connected* to the service so the provisioner can clone it at
 * deploy time.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

export function gitAvailable(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepo(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, ".git"));
}

export function initRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    run("git init", cwd);
  }
}

export function getOriginUrl(cwd: string): string | null {
  try {
    return run("git remote get-url origin", cwd);
  } catch {
    return null;
  }
}

/** Parse `owner/repo` from an https or ssh GitHub remote URL. */
export function parseRepoFullName(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The repo the local project is already wired to, if any (owner/repo). */
export function localRepoFullName(cwd: string): string | null {
  return parseRepoFullName(getOriginUrl(cwd));
}

export function setOrigin(cwd: string, repoUrl: string): void {
  if (getOriginUrl(cwd)) {
    run(`git remote set-url origin ${repoUrl}`, cwd);
  } else {
    run(`git remote add origin ${repoUrl}`, cwd);
  }
}

export function hasUncommittedChanges(cwd: string): boolean {
  return run("git status --porcelain", cwd).length > 0;
}

/** Stage everything and commit, unless there is nothing to commit. */
export function commitAll(cwd: string, message: string): boolean {
  run("git add -A", cwd);
  if (!hasUncommittedChanges(cwd)) {
    // Something may still be staged with no worktree diff; check the index.
    const staged = (() => {
      try {
        return run("git diff --cached --name-only", cwd).length > 0;
      } catch {
        return false;
      }
    })();
    if (!staged) return false;
  }
  // Second -m adds a trailer paragraph attributing the code to Apso. Mirrors
  // the "Co-Authored-By" convention: a machine-visible footprint on every
  // commit the CLI makes.
  run(
    `git commit -m ${JSON.stringify(message)} -m ${JSON.stringify(
      APSO_COMMIT_TRAILER
    )}`,
    cwd
  );
  return true;
}

/** Attribution trailer appended to every commit the CLI creates. */
export const APSO_COMMIT_TRAILER = "Generated with Apso (https://apso.ai)";

/** Push the current HEAD to origin/<branch>, setting upstream. */
export function pushHead(cwd: string, branch: string): void {
  run(`git push -u origin HEAD:${branch}`, cwd);
}

export function httpsUrlFor(repoFullName: string): string {
  return `https://github.com/${repoFullName}.git`;
}
