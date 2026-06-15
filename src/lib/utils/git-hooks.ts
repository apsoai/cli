import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * The Apso co-author git trailer. Appended to commits that include
 * Apso-generated work so Apso is credited as a co-author.
 */
export const APSO_COAUTHOR_TRAILER = "Co-authored-by: Apso <bot@apso.ai>";

/**
 * Relative path (from the repo top-level) where the managed hook is installed.
 * Modern git resolves a relative `core.hooksPath` from the repository root.
 */
export const APSO_HOOKS_DIR = ".apso/hooks";

/**
 * Builds the `prepare-commit-msg` bash script that appends the Apso co-author
 * trailer to commits that touch Apso-generated paths.
 *
 * Pure function (no side effects) so it can be unit-tested directly.
 *
 * Behaviour of the generated script:
 * - Skips merge/squash commits (`$2` is `merge` or `squash`).
 * - Honors the `APSO_NO_COAUTHOR=1` opt-out.
 * - Only acts when the staged changes include an Apso-generated path
 *   (a path segment named `autogen/`).
 * - Adds the trailer idempotently via `git interpret-trailers`, which handles
 *   trailer-block formatting + dedupe and coexists with other `Co-authored-by`
 *   trailers (e.g. Claude).
 */
export function buildCoAuthorHookScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Managed by Apso (@apso/cli). Appends an Apso co-author trailer to commits
# that include Apso-generated files. To opt out, set APSO_NO_COAUTHOR=1 or
# remove this hook (and unset core.hooksPath).

COMMIT_MSG_FILE="\${1:-}"
COMMIT_SOURCE="\${2:-}"

# Don't trailer merge or squash commit messages.
if [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ]; then
  exit 0
fi

# Opt-out.
if [ "\${APSO_NO_COAUTHOR:-}" = "1" ]; then
  exit 0
fi

# Only act when the staged changes include an Apso-generated path.
if ! git diff --cached --name-only | grep -qE '(^|/)autogen/'; then
  exit 0
fi

# Add the trailer idempotently. git handles formatting + dedupe and coexists
# with an existing "Co-authored-by: Claude" trailer.
git interpret-trailers --in-place --if-exists addIfDifferent \\
  --trailer "${APSO_COAUTHOR_TRAILER}" "$COMMIT_MSG_FILE"
`;
}

export interface InstallCoAuthorHookOptions {
  /** When true, skip installation (e.g. `.apsorc` set `coAuthor: false`). */
  disabled?: boolean;
}

export interface InstallCoAuthorHookResult {
  installed: boolean;
  reason?: "disabled" | "not-a-git-repo" | "custom-hookspath" | "error";
}

/**
 * Installs the Apso co-author `prepare-commit-msg` hook into a project.
 *
 * Best-effort: never throws. Callers can log the result.
 *
 * - Respects the `disabled` option and the `APSO_NO_COAUTHOR=1` env opt-out.
 * - No-ops (returns `not-a-git-repo`) outside a git work tree.
 * - Writes `<projectRoot>/.apso/hooks/prepare-commit-msg` (mode 0755).
 * - Sets the repo-local `core.hooksPath` to `.apso/hooks` when unset; leaves it
 *   alone (and reports success) when it's already `.apso/hooks`; refuses to
 *   clobber a custom `core.hooksPath` (husky etc.) and reports
 *   `custom-hookspath` so the caller can guide the user.
 */
export function installCoAuthorHook(
  projectRoot: string,
  opts: InstallCoAuthorHookOptions = {}
): InstallCoAuthorHookResult {
  try {
    if (opts.disabled || process.env.APSO_NO_COAUTHOR === "1") {
      return { installed: false, reason: "disabled" };
    }

    // Verify we're inside a git work tree.
    try {
      execFileSync("git", ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"], {
        stdio: "ignore",
      });
    } catch {
      return { installed: false, reason: "not-a-git-repo" };
    }

    // Write the hook script.
    const hooksDir = path.join(projectRoot, ".apso", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "prepare-commit-msg");
    fs.writeFileSync(hookPath, buildCoAuthorHookScript(), { mode: 0o755 });
    // writeFileSync's mode is subject to umask on create and ignored on
    // overwrite; chmod explicitly so the hook is always executable.
    fs.chmodSync(hookPath, 0o755);

    // Inspect the current core.hooksPath.
    let currentHooksPath = "";
    try {
      currentHooksPath = execFileSync(
        "git",
        ["-C", projectRoot, "config", "--get", "core.hooksPath"],
        { encoding: "utf8" }
      ).trim();
    } catch {
      // `git config --get` exits non-zero when the key is unset.
      currentHooksPath = "";
    }

    if (currentHooksPath === "") {
      execFileSync(
        "git",
        ["-C", projectRoot, "config", "core.hooksPath", APSO_HOOKS_DIR],
        { stdio: "ignore" }
      );
      return { installed: true };
    }

    if (currentHooksPath === APSO_HOOKS_DIR) {
      return { installed: true };
    }

    // Some other hooks path is configured (husky, etc.). Don't clobber it.
    return { installed: false, reason: "custom-hookspath" };
  } catch {
    return { installed: false, reason: "error" };
  }
}
