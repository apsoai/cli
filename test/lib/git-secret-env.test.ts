import { expect, describe, it, beforeEach, afterEach } from "@jest/globals";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { commitAll } from "../../src/lib/git";

// `apso deploy --local-git` committed .env.local (session secrets) because the
// TS template's .gitignore only covers .env.
describe("commitAll keeps secret env files out of commits", () => {
  let dir: string;
  const sh = (cmd: string) => execSync(cmd, { cwd: dir, encoding: "utf8" }).trim();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-git-"));
    sh("git init -q");
    sh("git config user.name t && git config user.email t@example.com");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n.env\n");
    fs.writeFileSync(path.join(dir, ".env.local"), "BETTER_AUTH_SECRET=synthetic");
    fs.writeFileSync(path.join(dir, ".env.example"), "DATABASE_URL=");
    fs.writeFileSync(path.join(dir, "main.ts"), "export {}");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("never commits .env.local but keeps .env.example", () => {
    expect(commitAll(dir, "deploy")).toBe(true);
    const files = sh("git ls-files").split("\n");
    expect(files).toEqual(expect.arrayContaining([".env.example", ".gitignore", "main.ts"]));
    expect(files).not.toContain(".env.local");
  });

  it("untracks a .env.local that an earlier commit picked up", () => {
    sh("git add -A && git commit -qm old");
    expect(sh("git ls-files")).toContain(".env.local");
    commitAll(dir, "deploy");
    expect(sh("git ls-files")).not.toContain(".env.local");
    expect(fs.existsSync(path.join(dir, ".env.local"))).toBe(true);
    commitAll(dir, "again");
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").match(/\.env\.\*/g)).toHaveLength(1);
  });
});
