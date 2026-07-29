import { expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureEnvFile } from "../../../src/lib/utils/template";

const noop = (): void => {};

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apso-env-test-"));
}

describe("ensureEnvFile", () => {
  test("creates .env from .env.local when .env is missing (cli#103)", () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, ".env.local"), "PORT=3200\n");
    fs.writeFileSync(path.join(dir, ".env.example"), "PORT=0000\n");

    ensureEnvFile(dir, noop);

    expect(fs.existsSync(path.join(dir, ".env"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf-8")).toBe("PORT=3200\n");
  });

  test("falls back to .env.example when no .env.local exists", () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, ".env.example"), "PORT=0000\n");

    ensureEnvFile(dir, noop);

    expect(fs.readFileSync(path.join(dir, ".env"), "utf-8")).toBe("PORT=0000\n");
  });

  test("does not overwrite an existing .env", () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, ".env"), "PORT=9999\n");
    fs.writeFileSync(path.join(dir, ".env.local"), "PORT=3200\n");

    ensureEnvFile(dir, noop);

    expect(fs.readFileSync(path.join(dir, ".env"), "utf-8")).toBe("PORT=9999\n");
  });

  test("is a no-op when no env source files are present", () => {
    const dir = tmpProject();

    ensureEnvFile(dir, noop);

    expect(fs.existsSync(path.join(dir, ".env"))).toBe(false);
  });
});
