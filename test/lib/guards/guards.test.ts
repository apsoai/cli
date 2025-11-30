import { expect } from "@jest/globals";
import { getScopedEntities, hasScopedEntities } from "../../../src/lib/guards";
import { Entity } from "../../../src/lib/types";

describe("guards module", () => {
  describe("hasScopedEntities", () => {
    test("returns false when no entities have scopeBy", () => {
      const entities: Entity[] = [
        {
          name: "User",
          fields: [{ name: "email", type: "text" }],
        },
        {
          name: "Post",
          fields: [{ name: "title", type: "text" }],
        },
      ];

      expect(hasScopedEntities(entities)).toBe(false);
    });

    test("returns true when at least one entity has scopeBy", () => {
      const entities: Entity[] = [
        {
          name: "User",
          fields: [{ name: "email", type: "text" }],
        },
        {
          name: "Project",
          fields: [{ name: "name", type: "text" }],
          scopeBy: "workspaceId",
        },
      ];

      expect(hasScopedEntities(entities)).toBe(true);
    });

    test("returns true when multiple entities have scopeBy", () => {
      const entities: Entity[] = [
        {
          name: "Project",
          fields: [{ name: "name", type: "text" }],
          scopeBy: "workspaceId",
        },
        {
          name: "Task",
          fields: [{ name: "title", type: "text" }],
          scopeBy: ["workspaceId", "projectId"],
        },
      ];

      expect(hasScopedEntities(entities)).toBe(true);
    });
  });

  describe("getScopedEntities", () => {
    test("returns empty array when no entities have scopeBy", () => {
      const entities: Entity[] = [
        {
          name: "User",
          fields: [{ name: "email", type: "text" }],
        },
      ];

      const result = getScopedEntities(entities);
      expect(result).toEqual([]);
    });

    test("returns scoped entity config for direct field scope", () => {
      const entities: Entity[] = [
        {
          name: "Project",
          fields: [{ name: "name", type: "text" }],
          scopeBy: "workspaceId",
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "Project",
        routeName: "projects",
        repoName: "projectRepository",
        scopes: [
          {
            field: "workspaceId",
            contextKey: "workspaceId",
            direct: true,
            path: undefined,
          },
        ],
        injectOnCreate: true,
        enforceOn: ["find", "get", "create", "update", "delete"],
        bypassRoles: [],
      });
    });

    test("returns scoped entity config for nested path scope", () => {
      const entities: Entity[] = [
        {
          name: "Comment",
          fields: [{ name: "text", type: "text" }],
          scopeBy: "task.workspaceId",
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "Comment",
        routeName: "comments",
        repoName: "commentRepository",
        scopes: [
          {
            field: "task",
            contextKey: "workspaceId",
            direct: false,
            path: "task.workspaceId",
          },
        ],
        injectOnCreate: true,
        enforceOn: ["find", "get", "create", "update", "delete"],
        bypassRoles: [],
      });
    });

    test("handles multiple scope fields", () => {
      const entities: Entity[] = [
        {
          name: "Task",
          fields: [{ name: "title", type: "text" }],
          scopeBy: ["workspaceId", "projectId"],
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0].scopes).toEqual([
        {
          field: "workspaceId",
          contextKey: "workspaceId",
          direct: true,
          path: undefined,
        },
        {
          field: "projectId",
          contextKey: "projectId",
          direct: true,
          path: undefined,
        },
      ]);
    });

    test("uses custom scopeOptions when provided", () => {
      const entities: Entity[] = [
        {
          name: "AuditLog",
          fields: [{ name: "action", type: "text" }],
          scopeBy: "workspaceId",
          scopeOptions: {
            injectOnCreate: false,
            enforceOn: ["find", "get"],
            bypassRoles: ["admin", "superadmin"],
          },
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0].injectOnCreate).toBe(false);
      expect(result[0].enforceOn).toEqual(["find", "get"]);
      expect(result[0].bypassRoles).toEqual(["admin", "superadmin"]);
    });

    test("merges partial scopeOptions with defaults", () => {
      const entities: Entity[] = [
        {
          name: "Project",
          fields: [{ name: "name", type: "text" }],
          scopeBy: "workspaceId",
          scopeOptions: {
            bypassRoles: ["admin"],
          },
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0].injectOnCreate).toBe(true); // default
      expect(result[0].enforceOn).toEqual([
        "find",
        "get",
        "create",
        "update",
        "delete",
      ]); // default
      expect(result[0].bypassRoles).toEqual(["admin"]); // custom
    });

    test("generates correct route names for various entity names", () => {
      const entities: Entity[] = [
        {
          name: "Project",
          fields: [],
          scopeBy: "workspaceId",
        },
        {
          name: "DiscoverySession",
          fields: [],
          scopeBy: "workspaceId",
        },
        {
          name: "Task",
          fields: [],
          scopeBy: "workspaceId",
        },
      ];

      const result = getScopedEntities(entities);

      expect(result[0].routeName).toBe("projects");
      expect(result[1].routeName).toBe("discoverysessions");
      expect(result[2].routeName).toBe("tasks");
    });

    test("generates correct repository names for various entity names", () => {
      const entities: Entity[] = [
        {
          name: "Project",
          fields: [],
          scopeBy: "workspaceId",
        },
        {
          name: "DiscoverySession",
          fields: [],
          scopeBy: "workspaceId",
        },
      ];

      const result = getScopedEntities(entities);

      expect(result[0].repoName).toBe("projectRepository");
      expect(result[1].repoName).toBe("discoverySessionRepository");
    });

    test("filters out entities without scopeBy", () => {
      const entities: Entity[] = [
        {
          name: "User",
          fields: [{ name: "email", type: "text" }],
        },
        {
          name: "Project",
          fields: [{ name: "name", type: "text" }],
          scopeBy: "workspaceId",
        },
        {
          name: "Workspace",
          fields: [{ name: "name", type: "text" }],
        },
        {
          name: "Task",
          fields: [{ name: "title", type: "text" }],
          scopeBy: "projectId",
        },
      ];

      const result = getScopedEntities(entities);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.name)).toEqual(["Project", "Task"]);
    });
  });
});
