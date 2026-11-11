import { expect } from "@jest/globals";
import {
  apsorcToServiceSchema,
  diffApsorc,
  computeSchemaHash,
  ParsedApsorcInput,
} from "../../../src/lib/utils/schema-convert";

describe("apsorcToServiceSchema", () => {
  test("converts entities with fields", () => {
    const input: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [
        {
          name: "User",
          fields: [
            { name: "email", type: "text", unique: true },
            { name: "age", type: "integer", nullable: true },
          ],
        },
      ],
      relationshipMap: {},
    };

    const result = apsorcToServiceSchema(input);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("User");
    expect(result.entities[0].fields).toHaveLength(2);
    expect(result.entities[0].fields[0]).toEqual({
      name: "email",
      type: "text",
      nullable: undefined,
      unique: true,
      default: undefined,
      primaryKey: undefined,
      index: undefined,
    });
  });

  test("converts entities with relationships", () => {
    const input: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [
        { name: "User", fields: [] },
        { name: "Post", fields: [] },
      ],
      relationshipMap: {
        User: [
          {
            type: "OneToMany",
            name: "Post",
            biDirectional: true,
            referenceName: "Post",
            inverseReferenceName: "User",
          },
        ],
        Post: [
          {
            type: "ManyToOne",
            name: "User",
            nullable: false,
            biDirectional: true,
            index: false,
            cascadeDelete: false,
            referenceName: "User",
            inverseReferenceName: "Post",
          },
        ],
      },
    };

    const result = apsorcToServiceSchema(input);

    expect(result.entities[0].relationships).toHaveLength(1);
    expect(result.entities[0].relationships![0].type).toBe("one-to-many");
    expect(result.entities[1].relationships).toHaveLength(1);
    expect(result.entities[1].relationships![0].type).toBe("many-to-one");
  });

  test("handles empty entities array", () => {
    const input: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [],
      relationshipMap: {},
    };

    const result = apsorcToServiceSchema(input);
    expect(result.entities).toHaveLength(0);
  });

  test("handles entity with no fields", () => {
    const input: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [{ name: "Empty" }],
      relationshipMap: {},
    };

    const result = apsorcToServiceSchema(input);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].fields).toHaveLength(0);
    expect(result.entities[0].relationships).toBeUndefined();
  });

  test("converts scopeBy", () => {
    const input: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [
        { name: "Task", fields: [], scopeBy: "workspaceId" },
        { name: "Item", fields: [], scopeBy: ["orgId", "teamId"] },
      ],
      relationshipMap: {},
    };

    const result = apsorcToServiceSchema(input);
    expect(result.entities[0].scopeBy).toEqual(["workspaceId"]);
    expect(result.entities[1].scopeBy).toEqual(["orgId", "teamId"]);
  });
});

describe("diffApsorc", () => {
  const base = {
    version: 2,
    entities: [{ name: "User" }, { name: "Post" }],
    relationships: [],
  };

  test("identical schemas have no changes, whatever the key order", () => {
    const reordered = { relationships: [], entities: base.entities, version: 2 };
    expect(diffApsorc(base, reordered).hasChanges).toBe(false);
  });

  test("names added, removed and modified entities", () => {
    const local = {
      ...base,
      entities: [{ name: "User", mcp: true }, { name: "Tag" }],
    };
    expect(diffApsorc(base, local)).toEqual({
      hasChanges: true,
      added: ["Tag"],
      removed: ["Post"],
      modified: ["User"],
    });
  });

  test("a change outside entities counts", () => {
    const local = { ...base, auth: { provider: "auth0" } };
    expect(diffApsorc(base, local).modified).toEqual([
      "relationships and settings",
    ]);
  });

  test("a service with no schema yet gets every entity as added", () => {
    expect(diffApsorc(null, base).added).toEqual(["User", "Post"]);
  });
});

describe("computeSchemaHash", () => {
  test("returns consistent hash for same input", () => {
    const schema = { entities: [{ name: "User" }] };
    const hash1 = computeSchemaHash(schema);
    const hash2 = computeSchemaHash(schema);
    expect(hash1).toBe(hash2);
  });

  test("returns different hash for different nested content", () => {
    const schema1 = { entities: [{ name: "User" }] };
    const schema2 = { entities: [{ name: "Post" }] };
    const hash1 = computeSchemaHash(schema1);
    const hash2 = computeSchemaHash(schema2);
    expect(hash1).not.toBe(hash2);
  });

  test("key ordering does not affect hash", () => {
    const schema1 = { b: 2, a: 1 };
    const schema2 = { a: 1, b: 2 };
    expect(computeSchemaHash(schema1)).toBe(computeSchemaHash(schema2));
  });

  test("hash is a 64-char hex string (SHA-256)", () => {
    const schema = { entities: [] };
    const hash = computeSchemaHash(schema);
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });
});
