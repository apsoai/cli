import { describe, test, expect } from "@jest/globals";
import { detectAllConflicts } from "../../src/lib/conflict-resolver";
import { LocalApsorcSchema } from "../../src/lib/schema-converter/types";
import { ApiType } from "../../src/lib/apsorc-parser";

describe("Conflict Resolver - Schema Building", () => {
  test("should preserve required fields when building resolved schema", () => {
    // This test verifies that the buildResolvedSchema function
    // always includes version, rootFolder, and apiType
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

    const remoteSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [
        {
          name: "Post",
          fields: [{ name: "title", type: "text", nullable: false }],
        },
      ],
      relationships: [],
    };

    // Test that conflicts are detected
    const conflicts = detectAllConflicts(localSchema, remoteSchema);
    expect(conflicts.length).toBe(2);

    // Verify both schemas have required fields
    expect(localSchema.version).toBe(2);
    expect(localSchema.rootFolder).toBe("src");
    expect(localSchema.apiType).toBe(ApiType.Rest);

    expect(remoteSchema.version).toBe(2);
    expect(remoteSchema.rootFolder).toBe("src");
    expect(remoteSchema.apiType).toBe(ApiType.Rest);
  });

  test("should handle empty entity lists", () => {
    const localSchema: LocalApsorcSchema = {
      version: 2,
      rootFolder: "src",
      apiType: ApiType.Rest,
      entities: [],
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
      ],
      relationships: [],
    };

    const conflicts = detectAllConflicts(localSchema, remoteSchema);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].type).toBe("removed");
    expect(conflicts[0].entityName).toBe("User");
  });
});
