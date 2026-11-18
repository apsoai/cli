import { expect, describe, test } from "@jest/globals";
import Ajv from "ajv";
import * as fs from "fs";
import * as path from "path";
import { introspectClient } from "../../src/lib/import/introspect";
import { pgToApsorc } from "../../src/lib/import/pg-to-apsorc";

// apsorc.schema.json is the published description of .apsorc. Nothing in the
// CLI reads it, so it once fell far behind what the CLI accepts. Every
// version 2 fixture in this repo, and what `apso import` writes, must be
// valid against it: a new setting fails here until the schema file has it.
const root = path.join(__dirname, "../..");
const schema = JSON.parse(
  fs.readFileSync(path.join(root, "apsorc.schema.json")).toString()
);
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const problems = (apsorc: unknown): string[] =>
  validate(apsorc)
    ? []
    : (validate.errors ?? []).map(
        (e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`
      );

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    return /\.apsorc$|apsorc[^/]*\.json$/.test(entry.name) ? [file] : [];
  });
const fixtures = walk(path.join(root, "test"))
  .map((file): [string, { version?: number }] => [
    path.relative(root, file),
    JSON.parse(fs.readFileSync(file).toString()),
  ])
  .filter(([, apsorc]) => apsorc.version === 2);

describe("apsorc.schema.json", () => {
  test("finds the fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(20);
  });

  test.each(fixtures)("accepts %s", (_file, apsorc) => {
    expect(problems(apsorc)).toEqual([]);
  });

  test("accepts what apso import writes", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(
      fs
        .readFileSync(path.join(root, "test/fixtures/import/roundtrip.sql"))
        .toString()
    );
    const { apsorc } = pgToApsorc(await introspectClient(db, "public"));
    await db.close();
    expect(problems({ language: "typescript", ...apsorc })).toEqual([]);
  });

  test("rejects a setting it does not know", () => {
    expect(
      problems({ version: 2, entities: [{ name: "A", notASetting: true }] })
    ).not.toEqual([]);
  });
});
