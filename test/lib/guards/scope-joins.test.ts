import { expect } from "@jest/globals";
import { Entity, RelationshipMap } from "../../../src/lib/types";
import { joinHopCheck } from "../../../src/lib/guards";
import { getNestedRelationships } from "../../../src/lib/utils/relationships";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { PythonGenerator } from "../../../src/lib/generators/python";

// Organization and User are shared (no scopeBy); Project and Task belong to
// one organization. Joined rows skip the tenant filter, so a join may not
// step from a shared entity into a scoped one.
const entities: Entity[] = [
  { name: "Organization", fields: [{ name: "name", type: "text" }] },
  { name: "User", fields: [{ name: "email", type: "text" }] },
  { name: "Project", scopeBy: "organizationId", fields: [{ name: "name", type: "text" }] },
  { name: "Task", scopeBy: "project.organizationId", fields: [{ name: "title", type: "text" }] },
];

const relationshipMap: RelationshipMap = {
  Organization: [{ type: "OneToMany", name: "Project" }],
  User: [
    { type: "OneToMany", name: "Task" },
    { type: "OneToMany", name: "Project" },
  ],
  Project: [
    { type: "ManyToOne", name: "Organization", nullable: false },
    { type: "OneToMany", name: "Task" },
    { type: "ManyToOne", name: "User", referenceName: "owner" },
  ],
  Task: [
    { type: "ManyToOne", name: "Project", nullable: false },
    { type: "ManyToOne", name: "User", referenceName: "assignee" },
  ],
};

describe("joinHopCheck", () => {
  const allow = joinHopCheck(entities, true)!;

  test("allows hops onto shared entities and within one tenant", () => {
    expect(allow("Task", "User")).toBe(true);
    expect(allow("Project", "Organization")).toBe(true);
    expect(allow("Project", "Task")).toBe(true);
    expect(allow("Task", "Project")).toBe(true);
  });

  test("blocks hops from a shared entity into a scoped one", () => {
    expect(allow("User", "Task")).toBe(false);
    expect(allow("Organization", "Project")).toBe(false);
  });

  test("blocks hops between entities scoped by different keys", () => {
    const mixed: Entity[] = [
      { name: "Note", scopeBy: "userId" },
      { name: "Project", scopeBy: "organizationId" },
    ];
    expect(joinHopCheck(mixed, true)!("Project", "Note")).toBe(false);
  });

  test("treats an entity with unscoped reads as shared", () => {
    const openReads: Entity[] = [
      { name: "Project", scopeBy: "organizationId", scopeOptions: { enforceOn: ["create", "update", "delete"] } },
      { name: "Task", scopeBy: "organizationId" },
    ];
    expect(joinHopCheck(openReads, true)!("Project", "Task")).toBe(false);
  });

  test("is off without auth", () => {
    expect(joinHopCheck(entities, false)).toBeUndefined();
  });
});

describe("nested joins with scopeBy", () => {
  test("drop every path that leaves the tenant", () => {
    const unchecked = getNestedRelationships("Task", relationshipMap);
    expect(unchecked).toContain("assignee.projects");

    const checked = getNestedRelationships("Task", relationshipMap, undefined, joinHopCheck(entities, true));
    expect(checked).toContain("project.organization");
    expect(checked).toContain("project.owner");
    expect(checked.filter((p) => p.startsWith("assignee."))).toEqual([]);
    expect(checked.filter((p) => p.startsWith("project.owner."))).toEqual([]);
  });
});

describe("generated TypeScript controller", () => {
  const auth = { provider: "jwt", issuer: "https://issuer.example.com" } as any;
  const controller = async (name: string, withAuth: boolean) => {
    const generator = new TypeScriptGenerator({ rootFolder: "/tmp/scope-joins-test", entities, relationshipMap, apiType: "rest", language: "typescript" });
    const files = await generator.generateController({
      entity: entities.find((e) => e.name === name)!,
      relationships: relationshipMap[name],
      allEntities: entities,
      apiType: "rest",
      relationshipMap,
      auth: withAuth ? auth : undefined,
    });
    return files.find((f) => f.path.endsWith(".controller.ts"))!.content;
  };

  test("a shared root cannot join scoped rows", async () => {
    expect(await controller("Organization", true)).not.toMatch(/projects: { eager: false }/);
    expect(await controller("Organization", false)).toMatch(/projects: { eager: false }/);
  });

  test("a scoped root keeps joins inside its tenant", async () => {
    const ctrl = await controller("Task", true);
    expect(ctrl).toMatch(/assignee: { eager: false }/);
    expect(ctrl).toContain('"project.organization": { eager: false }');
    expect(ctrl).not.toContain('"assignee.projects"');
    expect(await controller("Task", false)).toContain('"assignee.projects": { eager: false }');
  });
});

const pythonGenerator = () =>
  new PythonGenerator({ rootFolder: "/tmp/scope-joins-test", entities, relationshipMap, apiType: "rest", language: "python" });

describe("generated Python service", () => {
  const auth = { provider: "jwt", issuer: "https://issuer.example.com" } as any;
  const generator = pythonGenerator;
  const opts = (name: string, withAuth: boolean) => ({
    entity: entities.find((e) => e.name === name)!,
    relationships: relationshipMap[name],
    allEntities: entities,
    apiType: "rest",
    relationshipMap,
    auth: withAuth ? auth : undefined,
  });

  test("never loads a relation into another tenant's rows", async () => {
    const [model] = await generator().generateEntity(opts("Organization", true));
    expect(model.content).toMatch(/projects: Mapped\[List\["Project"]] = relationship\([^)]*lazy="noload"/);
    const [open] = await generator().generateEntity(opts("Organization", false));
    expect(open.content).not.toContain('lazy="noload"');
  });

  test("joins only relations inside the tenant", async () => {
    const [org] = await generator().generateService(opts("Organization", true));
    expect(org.content).toContain("_ALLOWED_JOINS = frozenset([])");
    const [task] = await generator().generateService(opts("Task", true));
    expect(task.content).toContain('_ALLOWED_JOINS = frozenset(["project","assignee"])');
    const [open] = await generator().generateService(opts("Task", false));
    expect(open.content).not.toContain("_ALLOWED_JOINS");
  });
});
