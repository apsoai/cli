import { expect, describe, test } from "@jest/globals";
import { relationScopes, removedScopeOptionErrors, scopedReferences } from "../../../src/lib/guards";
import { Entity, RelationshipMap } from "../../../src/lib/types";

const entities: Entity[] = [
  { name: "Organization" },
  { name: "Project", scopeBy: "organizationId" },
  { name: "Task", scopeBy: "project.organizationId" },
  { name: "Ticket", scopeBy: "organizationId", scopeOptions: { bypassRoles: ["support"] } },
  { name: "Note", scopeBy: "userId" },
  { name: "Draft" },
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
    // Draft has no scopeBy.
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

  test("lists each scoped entity's own scope fields, which the rows a relation loads must match", () => {
    const table = relationScopes(entities, relationshipMap, true)!;
    expect(table.Project.scope).toEqual({ organizationId: "organizationId" });
    expect(table.Note.scope).toEqual({ userId: "userId" });
    // Scoped through its parent: no tenant column of its own.
    expect(table.Task.scope).toEqual({});
    expect(table.Organization.scope).toBeUndefined();
  });

  test("an entity scoped through a parent is same-tenant only from that parent, through one relation", () => {
    const withTicketTasks: RelationshipMap = {
      ...relationshipMap,
      Ticket: [{ name: "Task", type: "OneToMany" }],
    };
    expect(relationScopes(entities, withTicketTasks, true)!.Ticket.relations.tasks).toEqual(["Task", false]);
    const twice: RelationshipMap = {
      ...relationshipMap,
      Project: [...relationshipMap.Project, { name: "Task", type: "OneToMany", referenceName: "archivedTask" }],
    };
    const table = relationScopes(entities, twice, true)!;
    expect(table.Project.relations.tasks).toEqual(["Task", false]);
    expect(table.Project.relations.archivedTasks).toEqual(["Task", false]);
  });
});

describe("scopedReferences", () => {
  const table = relationScopes(entities, relationshipMap, true);
  const ticket = entities.find((e) => e.name === "Ticket")!;

  test("keeps foreign keys to tenant-scoped entities, without the entity's own scope field", () => {
    expect(
      scopedReferences(ticket, [["organizationId", "Organization"], ["projectId", "Project"], ["draftId", "Draft"]], table)
    ).toEqual({ projectId: "Project" });
  });

  test("is empty when nothing is scoped", () => {
    expect(scopedReferences(ticket, [["projectId", "Project"]], {})).toEqual({});
  });
});

describe("removedScopeOptionErrors", () => {
  test("refuses scopeOptions.injectOnCreate and enforceOn, and names the replacement", () => {
    for (const value of [true, false]) {
      const doc: Entity = { name: "Doc", scopeBy: "organizationId", scopeOptions: { injectOnCreate: value } as any };
      const [error, ...rest] = removedScopeOptionErrors([doc, ...entities]);
      expect(rest).toEqual([]);
      expect(error).toContain("Doc.scopeOptions.injectOnCreate is no longer an option");
      expect(error).toContain("always comes from the caller");
      expect(error).toContain("A service caller (API key) can set any tenant");
    }
    const drafts: Entity = { name: "Doc", scopeBy: "organizationId", scopeOptions: { enforceOn: ["find", "get"] } as any };
    const [enforce] = removedScopeOptionErrors([drafts]);
    expect(enforce).toContain("Doc.scopeOptions.enforceOn is no longer an option");
    expect(enforce).toContain("on every operation");
    expect(enforce).toContain("service caller (API key)");
    expect(removedScopeOptionErrors(entities)).toEqual([]);
  });
});
