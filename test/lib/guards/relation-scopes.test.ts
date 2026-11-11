import { expect, describe, test } from "@jest/globals";
import { relationScopes } from "../../../src/lib/guards";
import { Entity, RelationshipMap } from "../../../src/lib/types";

const entities: Entity[] = [
  { name: "Organization" },
  { name: "Project", scopeBy: "organizationId" },
  { name: "Task", scopeBy: "project.organizationId" },
  { name: "Ticket", scopeBy: "organizationId", scopeOptions: { bypassRoles: ["support"] } },
  { name: "Note", scopeBy: "userId" },
  { name: "Draft", scopeBy: "organizationId", scopeOptions: { enforceOn: ["create", "update", "delete"] } },
];
const relationshipMap: RelationshipMap = {
  Organization: [
    { name: "Project", type: "OneToMany" },
    { name: "Ticket", type: "OneToMany" },
  ],
  Project: [
    { name: "Organization", type: "ManyToOne" },
    { name: "Task", type: "OneToMany" },
    { name: "Note", type: "OneToMany" },
    { name: "Draft", type: "OneToMany" },
  ],
  Task: [{ name: "Project", type: "ManyToOne" }],
};

describe("relationScopes", () => {
  test("is undefined without auth or without a scoped entity", () => {
    expect(relationScopes(entities, relationshipMap, false)).toBeUndefined();
    expect(relationScopes([{ name: "Organization" }], relationshipMap, true)).toBeUndefined();
  });

  test("names each relation as requests do, with the entity it loads", () => {
    const table = relationScopes(entities, relationshipMap, true)!;
    expect(Object.keys(table.Organization.relations)).toEqual(["projects", "tickets"]);
    expect(table.Task.relations).toEqual({ project: ["Project", true] });
  });

  test("marks which entities are scoped and the roles that skip the scope", () => {
    const table = relationScopes(entities, relationshipMap, true)!;
    expect(table.Organization.bypassRoles).toBeUndefined();
    expect(table.Project.bypassRoles).toEqual([]);
    expect(table.Ticket.bypassRoles).toEqual(["support"]);
    // Reads of Draft are not filtered, so it is not scoped for a relation.
    expect(table.Draft.bypassRoles).toBeUndefined();
  });

  test("a hop stays in the tenant only between entities scoped by the same keys", () => {
    const table = relationScopes(entities, relationshipMap, true)!;
    // From an entity with no scope, nothing limits the related rows.
    expect(table.Organization.relations.projects).toEqual(["Project", false]);
    // A path through a parent is scoped by the parent's key.
    expect(table.Project.relations.tasks).toEqual(["Task", true]);
    // Scoped by the caller's user id, not by the tenant.
    expect(table.Project.relations.notes).toEqual(["Note", false]);
  });
});
