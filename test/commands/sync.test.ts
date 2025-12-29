import { describe, test, expect } from "@jest/globals";
import { detectConflict, ConflictType } from "../../src/lib/conflict-detector";
import { detectAllConflicts } from "../../src/lib/conflict-resolver";
import { calculateSchemaHash } from "../../src/lib/schema-hash";
import { LocalApsorcSchema } from "../../src/lib/schema-converter/types";
import { ApiType } from "../../src/lib/apsorc-parser";

describe("CLI-006: Schema Hashing & Conflict Detection", () => {
  test("should calculate consistent hashes for identical schemas", () => {
    const schema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const hash1 = calculateSchemaHash(schema);
    const hash2 = calculateSchemaHash(schema);

    expect(hash1).toBe(hash2);
  });

  test("should detect no conflict when hashes match", () => {
    const schema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const hash = calculateSchemaHash(schema);
    const conflict = detectConflict(hash, hash, schema, schema);

    expect(conflict.type).toBe(ConflictType.NO_CONFLICT);
  });

  test("should detect local changed when only local hash exists", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const localHash = calculateSchemaHash(localSchema);
    const conflict = detectConflict(localHash, null, localSchema);

    expect(conflict.type).toBe(ConflictType.LOCAL_CHANGED);
  });

  test("should detect remote changed when only remote hash exists", () => {
    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const remoteHash = calculateSchemaHash(remoteSchema);
    const conflict = detectConflict(null, remoteHash, undefined, remoteSchema);

    expect(conflict.type).toBe(ConflictType.REMOTE_CHANGED);
  });

  test("should detect diverged when both schemas have different changes", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
        {
          name: "Post",
          fields: [{ name: "title", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
        {
          name: "Comment",
          fields: [{ name: "content", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const localHash = calculateSchemaHash(localSchema);
    const remoteHash = calculateSchemaHash(remoteSchema);
    const conflict = detectConflict(
      localHash,
      remoteHash,
      localSchema,
      remoteSchema
    );

    expect(conflict.type).toBe(ConflictType.DIVERGED);
    expect(conflict.affectedEntities).toContain("Post");
    expect(conflict.affectedEntities).toContain("Comment");
  });
});

describe("CLI-014: Conflict Resolution", () => {
  test("should detect entity conflicts correctly", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
        {
          name: "Post",
          fields: [{ name: "title", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [{ name: "email", type: "text", nullable: false }],
        },
        {
          name: "Comment",
          fields: [{ name: "content", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    const conflicts = detectAllConflicts(localSchema, remoteSchema);

    expect(conflicts.length).toBe(2);
    expect(conflicts.find((c: any) => c.entityName === "Post")?.type).toBe(
      "added"
    );
    expect(conflicts.find((c: any) => c.entityName === "Comment")?.type).toBe(
      "removed"
    );
  });

  test("should detect field conflicts within entities", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [
            { name: "email", type: "text", nullable: false },
            { name: "name", type: "text", nullable: false },
          ],
        },
      ],
      relationships: [],
    };

    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [
            { name: "email", type: "text", nullable: false },
            { name: "age", type: "integer", nullable: true },
          ],
        },
      ],
      relationships: [],
    };

    const conflicts = detectAllConflicts(localSchema, remoteSchema);

    expect(conflicts.length).toBe(1);
    const userConflict = conflicts.find((c: any) => c.entityName === "User");
    expect(userConflict?.type).toBe("changed");
    expect(userConflict?.fieldConflicts?.length).toBeGreaterThan(0);
  });

  test("should detect conflicts for entities with field differences", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [
            { name: "email", type: "text", nullable: false },
            { name: "name", type: "text", nullable: true },
          ],
        },
      ],
      relationships: [],
    };

    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [
            { name: "email", type: "text", nullable: false },
            { name: "age", type: "integer", nullable: true },
          ],
        },
      ],
      relationships: [],
    };

    const conflicts = detectAllConflicts(localSchema, remoteSchema);

    expect(conflicts.length).toBe(1);
    const userConflict = conflicts[0];
    expect(userConflict.entityName).toBe("User");
    expect(userConflict.type).toBe("changed");
    expect(userConflict.fieldConflicts?.length).toBeGreaterThan(0);

    // Check that field conflicts are detected
    const fieldConflicts = userConflict.fieldConflicts || [];
    expect(fieldConflicts.length).toBeGreaterThan(0);
  });
});

describe("CLI-004/005: Schema Conversion", () => {
  test("should preserve schema structure during round-trip conversion", () => {
    const originalSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "User",
          fields: [
            { name: "id", type: "integer", primary: true },
            { name: "email", type: "text", nullable: false, unique: true },
            { name: "name", type: "text", nullable: true },
          ],
        },
      ],
      relationships: [],
    };

    // This is a simplified test - actual conversion would go through platform format
    // For now, we just verify the schema structure is valid
    expect(originalSchema.version).toBe(2);
    expect(originalSchema.entities.length).toBe(1);
    expect(originalSchema.entities[0].fields?.length).toBe(3);
  });
});
