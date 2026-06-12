import { expect } from "@jest/globals";
import {
  apsorcToServiceSchema,
  serviceSchemaToApsorc,
  computeSchemaHash,
  ParsedApsorcInput,
} from "../../../src/lib/utils/schema-convert";
import { ServiceSchema } from "../../../src/lib/api/types";

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

describe("serviceSchemaToApsorc", () => {
  test("roundtrip: apsorc -> serviceSchema -> apsorc preserves data", () => {
    const original: ParsedApsorcInput = {
      rootFolder: "src",
      apiType: "rest",
      entities: [
        {
          name: "Product",
          fields: [
            { name: "title", type: "text" },
            { name: "price", type: "decimal", nullable: true },
          ],
        },
      ],
      relationshipMap: {},
    };

    const schema = apsorcToServiceSchema(original);
    const fullSchema: ServiceSchema = {
      id: "test",
      serviceId: "svc",
      version: 1,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      ...schema,
    };

    const roundtrip = serviceSchemaToApsorc(fullSchema);

    expect(roundtrip.version).toBe(2);
    expect(roundtrip.entities).toHaveLength(1);
    expect(roundtrip.entities[0].name).toBe("Product");
    expect(roundtrip.entities[0].fields).toHaveLength(2);
    expect(roundtrip.entities[0].fields![0].name).toBe("title");
    expect(roundtrip.entities[0].fields![1].nullable).toBe(true);
  });

  test("filters primary key fields from output", () => {
    const schema: ServiceSchema = {
      id: "test",
      serviceId: "svc",
      version: 1,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      entities: [
        {
          name: "User",
          fields: [
            { name: "id", type: "integer", primaryKey: true },
            { name: "name", type: "text" },
          ],
        },
      ],
    };

    const result = serviceSchemaToApsorc(schema);
    expect(result.entities[0].fields).toHaveLength(1);
    expect(result.entities[0].fields![0].name).toBe("name");
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
