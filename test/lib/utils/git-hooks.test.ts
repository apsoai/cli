import {
  expect,
  describe,
  it,
  beforeEach,
  afterEach,
  afterAll,
} from "@jest/globals";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCoAuthorHookScript,
  installCoAuthorHook,
  APSO_COAUTHOR_TRAILER,
  APSO_HOOKS_DIR,
} from "../../../src/lib/utils/git-hooks";

describe("buildCoAuthorHookScript", () => {
  const script = buildCoAuthorHookScript();

  it("is a bash script with strict mode", () => {
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(script).toContain("set -euo pipefail");
  });

  it("contains the Apso co-author trailer", () => {
    expect(script).toContain("Co-authored-by: Apso <bot@apso.ai>");
    expect(script).toContain(APSO_COAUTHOR_TRAILER);
  });

  it("guards on an autogen/ staged path", () => {
    expect(script).toContain("git diff --cached --name-only");
    expect(script).toContain("grep -qE '(^|/)autogen/'");
  });

  it("honors the APSO_NO_COAUTHOR opt-out", () => {
    expect(script).toContain("APSO_NO_COAUTHOR");
  });

  it("skips merge and squash commits", () => {
    expect(script).toContain('"merge"');
    expect(script).toContain('"squash"');
  });

  it("uses git interpret-trailers to add the trailer idempotently", () => {
    expect(script).toContain("git interpret-trailers");
    expect(script).toContain("--if-exists addIfDifferent");
  });
});

const tmpDirs: string[] = [];

const makeRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-hook-"));
  tmpDirs.push(dir);
  execFileSync("git", ["-C", dir, "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@apso.ai"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", dir, "config", "user.name", "Apso Test"], {
    stdio: "ignore",
  });
  return dir;
};

const getHooksPath = (dir: string): string => {
  try {
    return execFileSync(
      "git",
      ["-C", dir, "config", "--get", "core.hooksPath"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return "";
  }
};

const commit = (dir: string, msg: string): string => {
  execFileSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.email=test@apso.ai",
      "-c",
      "user.name=Apso Test",
      "commit",
      "-m",
      msg,
    ],
    { stdio: "ignore" }
  );
  return execFileSync("git", ["-C", dir, "log", "-1", "--pretty=%B"], {
    encoding: "utf8",
  });
};

describe("installCoAuthorHook", () => {
  let tmpDir: string;
  const origEnv = process.env.APSO_NO_COAUTHOR;

  beforeEach(() => {
    delete process.env.APSO_NO_COAUTHOR;
    tmpDir = makeRepo();
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.APSO_NO_COAUTHOR;
    } else {
      process.env.APSO_NO_COAUTHOR = origEnv;
    }
  });

  afterAll(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes an executable hook and sets core.hooksPath", () => {
    const result = installCoAuthorHook(tmpDir);
    expect(result).toEqual({ installed: true });

    const hookPath = path.join(tmpDir, ".apso", "hooks", "prepare-commit-msg");
    expect(fs.existsSync(hookPath)).toBe(true);
    // Executable bit set for the owner.
    const mode = fs.statSync(hookPath).mode;
    expect(mode & 0o100).toBe(0o100);
    expect(fs.readFileSync(hookPath, "utf8")).toContain(APSO_COAUTHOR_TRAILER);

    expect(getHooksPath(tmpDir)).toBe(APSO_HOOKS_DIR);
  });

  it("is idempotent on a second call", () => {
    expect(installCoAuthorHook(tmpDir)).toEqual({ installed: true });
    expect(installCoAuthorHook(tmpDir)).toEqual({ installed: true });
    expect(getHooksPath(tmpDir)).toBe(APSO_HOOKS_DIR);
  });

  it("does not clobber a custom core.hooksPath", () => {
    execFileSync("git", ["-C", tmpDir, "config", "core.hooksPath", ".husky"], {
      stdio: "ignore",
    });
    const result = installCoAuthorHook(tmpDir);
    expect(result).toEqual({ installed: false, reason: "custom-hookspath" });
    expect(getHooksPath(tmpDir)).toBe(".husky");
  });

  it("returns disabled when opts.disabled is set", () => {
    expect(installCoAuthorHook(tmpDir, { disabled: true })).toEqual({
      installed: false,
      reason: "disabled",
    });
  });

  it("returns disabled when APSO_NO_COAUTHOR=1", () => {
    process.env.APSO_NO_COAUTHOR = "1";
    expect(installCoAuthorHook(tmpDir)).toEqual({
      installed: false,
      reason: "disabled",
    });
  });

  it("returns not-a-git-repo outside a work tree", () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "apso-nonrepo-"));
    tmpDirs.push(nonRepo);
    expect(installCoAuthorHook(nonRepo)).toEqual({
      installed: false,
      reason: "not-a-git-repo",
    });
  });

  describe("end-to-end commit behaviour", () => {
    it("adds the trailer only when an autogen/ file is staged", () => {
      installCoAuthorHook(tmpDir);

      // Commit with an autogen/ file staged -> trailer expected.
      const autogenFile = path.join(tmpDir, "src", "autogen", "thing.ts");
      fs.mkdirSync(path.dirname(autogenFile), { recursive: true });
      fs.writeFileSync(autogenFile, "export const x = 1;\n");
      execFileSync("git", ["-C", tmpDir, "add", "."], { stdio: "ignore" });
      const autogenMsg = commit(tmpDir, "feat: generated entity");
      expect(autogenMsg).toContain(APSO_COAUTHOR_TRAILER);

      // Commit with only a non-autogen file staged -> no trailer.
      const handFile = path.join(tmpDir, "src", "hand.ts");
      fs.writeFileSync(handFile, "export const y = 2;\n");
      execFileSync("git", ["-C", tmpDir, "add", "."], { stdio: "ignore" });
      const handMsg = commit(tmpDir, "chore: hand written");
      expect(handMsg).not.toContain(APSO_COAUTHOR_TRAILER);
    });
  });
});
