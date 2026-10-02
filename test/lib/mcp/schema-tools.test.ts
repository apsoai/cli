import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applySchemaToolToFile, registerSchemaTools } from "../../../src/lib/mcp-schema-tools";

const apsorc = {
  version: 2,
  rootFolder: "src",
  entities: [
    { name: "Contact", created_at: true, updated_at: true, fields: [{ name: "notes", type: "text", nullable: true }] },
    { name: "Note", created_at: true, updated_at: true, fields: [{ name: "body", type: "text" }] },
  ],
  relationships: [],
};

function tempApsorc(content: unknown = apsorc): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-mcp-"));
  const file = path.join(dir, ".apsorc");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

// eslint-disable-next-line unicorn/prefer-json-parse-buffer -- JSON.parse's TS type requires a string
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf-8"));

describe("MCP schema tools", () => {
  test("registers every schema-tools operation with a zod input shape and read-only hint", () => {
    const calls: unknown[][] = [];
    registerSchemaTools({ tool: (...args: unknown[]) => calls.push(args) });
    const names = calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(["get_schema", "add_field", "rename_field", "remove_relationship", "lint_schema"]));
    expect(names).toHaveLength(13);
    const addField = calls.find((c) => c[0] === "add_field")!;
    const shape = addField[2] as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(shape.entity.safeParse("Contact").success).toBe(true);
    expect(shape.field.safeParse({ name: "phone" }).success).toBe(false); // type is required
    expect(addField[3]).toEqual({ readOnlyHint: false });
    expect(calls.find((c) => c[0] === "describe_entity")![3]).toEqual({ readOnlyHint: true });
  });

  test("a write applies the op, saves .apsorc and returns the lint result", () => {
    const file = tempApsorc();
    const result = applySchemaToolToFile(file, "add_field", { entity: "Contact", field: { name: "phone", type: "text", nullable: true } });
    expect(result).toMatchObject({ ok: true, saved: true, lint: { errorCount: 0 } });
    expect(read(file).entities[0].fields.map((f: { name: string }) => f.name)).toEqual(["notes", "phone"]);
    expect(read(file).version).toBe(2);
  });

  test("a write that would add a lint error is rejected and the file is untouched", () => {
    const file = tempApsorc();
    const before = fs.readFileSync(file, "utf-8");
    const result = applySchemaToolToFile(file, "add_relationship", { from: "Note", to: "Contact", type: "ManyToOne" });
    expect(result.ok).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.message).toContain("FIELD_RELATIONSHIP_COLLISION");
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  test("reads return data without writing; v1 files are refused", () => {
    const file = tempApsorc();
    const result = applySchemaToolToFile(file, "describe_entity", { entity: "Note" });
    expect(result).toMatchObject({ ok: true, saved: false });
    expect((result.data as { entity: { name: string } }).entity.name).toBe("Note");
    expect(() => applySchemaToolToFile(tempApsorc({ ...apsorc, version: 1 }), "get_schema", {})).toThrow("version 2");
  });
});
