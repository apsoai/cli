import { expect, describe, test, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveConnectionString,
  importFromIntrospector,
  formatReport,
  writeApsorcFile,
} from "../../../src/commands/import/supabase";
import {
  IntrospectedSchema,
  Introspector,
} from "../../../src/lib/import/types";
import { pgToApsorc } from "../../../src/lib/import/pg-to-apsorc";

function fakeIntrospector(s: IntrospectedSchema): Introspector {
  return { introspect: async () => s };
}

const sampleSchema: IntrospectedSchema = {
  schema: "public",
  tables: [
    {
      name: "User",
      primaryKey: ["id"],
      columns: [
        {
          name: "id",
          udtName: "uuid",
          dataType: "base",
          nullable: false,
          default: null,
          charMaxLength: null,
          numericPrecision: null,
          numericScale: null,
          ordinal: 1,
          isEnum: false,
        },
        {
          name: "email",
          udtName: "varchar",
          dataType: "base",
          nullable: false,
          default: null,
          charMaxLength: 255,
          numericPrecision: null,
          numericScale: null,
          ordinal: 2,
          isEnum: false,
        },
      ],
      foreignKeys: [],
      uniqueConstraints: [{ name: "uq_email", columns: ["email"] }],
      indexes: [],
    },
  ],
  enums: [],
  skipped: { views: ["v_active"], systemSchemas: ["auth"] },
};

describe("resolveConnectionString", () => {
  test("prefers the explicit flag", () => {
    expect(resolveConnectionString("flag://x", { SUPABASE_DB_URL: "env://y" })).toBe(
      "flag://x"
    );
  });
  test("falls back to SUPABASE_DB_URL then DATABASE_URL", () => {
    expect(resolveConnectionString(undefined, { SUPABASE_DB_URL: "s://a" })).toBe("s://a");
    expect(resolveConnectionString(undefined, { DATABASE_URL: "d://b" })).toBe("d://b");
  });
  test("returns undefined when nothing is set", () => {
    expect(resolveConnectionString(undefined, {})).toBeUndefined();
  });
});

describe("importFromIntrospector", () => {
  test("produces a valid .apsorc from a fake source", async () => {
    const { apsorc, report, unknownTypes } = await importFromIntrospector(
      fakeIntrospector(sampleSchema),
      "public"
    );
    expect(apsorc.entities.map((e) => e.name)).toEqual(["User"]);
    expect(apsorc.entities[0].primaryKeyType).toBe("uuid");
    expect(report.tablesImported).toEqual(["User"]);
    expect(unknownTypes).toEqual([]);
  });
});

describe("formatReport", () => {
  test("summarizes counts and skipped objects without leaking secrets", () => {
    const { report } = pgToApsorc(sampleSchema);
    const text = formatReport(report);
    expect(text).toContain("Imported 1 table");
    expect(text).toContain("v_active");
    expect(text).toContain("auth");
    // The report is built only from schema metadata — never connection details.
    expect(text).not.toContain("postgres");
    expect(text).not.toContain("@");
  });
});

describe("writeApsorcFile", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "apso-import-"));
    tmpDirs.push(d);
    return d;
  }

  test("writes JSON to the target path", async () => {
    const dir = tmp();
    const out = path.join(dir, ".apsorc");
    const { apsorc } = await importFromIntrospector(
      fakeIntrospector(sampleSchema),
      "public"
    );
    const { backupPath } = writeApsorcFile(apsorc, out);
    expect(backupPath).toBeUndefined();
    expect(fs.existsSync(out)).toBe(true);
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer -- TS types JSON.parse as string-only
    const parsed = JSON.parse(fs.readFileSync(out, "utf-8"));
    expect(parsed.version).toBe(2);
    expect(parsed.entities[0].name).toBe("User");
  });
});
