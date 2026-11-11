import { describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { buildModel } from "../../../src/lib/access/cases";
import { LANGUAGES, RULES, createReport, ruleIdsOf } from "../../../src/lib/access/report";
import { setClaim } from "../../../src/lib/access/tokens";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";

const root = path.join(__dirname, "..", "..", "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
// Where cases are written.
const SUITE = ["scripts/auth-smoke.mjs", "src/lib/access/cases.ts"];
const tagged = SUITE.flatMap((file) =>
  [...read(file).matchAll(/["'`]\[(R\d+(?:,\s*R\d+)*)]/g)].flatMap((m) => m[1].split(/,\s*/))
);

describe("the access rule list (rules.json)", () => {
  const known = new Set(RULES.map((r) => r.id));

  it("has unique ids, a status per language, and an issue for every pending rule", () => {
    expect(known.size).toBe(RULES.length);
    for (const rule of RULES) {
      for (const language of LANGUAGES)
        expect(["enforced", "refused", "pending", "na"]).toContain(rule.status[language]);
      if (LANGUAGES.some((l) => rule.status[l] === "pending")) expect(rule.issue).toBeTruthy();
    }
  });

  it("every case in the suite names a rule on the list", () => {
    expect(tagged.filter((id) => !known.has(id))).toEqual([]);
  });

  it("every case label written in the suite starts with its rule", () => {
    const untagged = SUITE.flatMap((file) =>
      [...read(file).matchAll(/\bt\.(?:expect|assert)\(\s*(["'`])(?!\[R\d|\[\${rule}]|\${label})([^"'`]*)/g)].map(
        (m) => `${file}: ${m[2]}`
      )
    );
    expect(untagged).toEqual([]);
  });

  it("every rule marked enforced or refused has a case", () => {
    const missing = RULES.filter(
      (rule) =>
        LANGUAGES.some((l) => rule.status[l] === "enforced" || rule.status[l] === "refused") &&
        !tagged.includes(rule.id)
    ).map((rule) => rule.id);
    expect(missing).toEqual([]);
  });

  it("every rule TypeScript enforces has a removal in the break-each-rule job, or a reason it has none", () => {
    const source = read("scripts/access-mutations.mjs");
    const removed = [...source.matchAll(/rules: \[([^\]]+)]/g)].flatMap((m) => m[1].match(/R\d+/g) ?? []);
    const reasons = [...source.matchAll(/^ {2}(R\d+): "/gm)].map((m) => m[1]);
    for (const id of [...removed, ...reasons]) expect(known.has(id)).toBe(true);
    const bare = RULES.filter(
      (rule) => rule.status.typescript === "enforced" && !removed.includes(rule.id) && !reasons.includes(rule.id)
    ).map((rule) => rule.id);
    expect(bare).toEqual([]);
  });
});

describe("a run's record", () => {
  it("reads the rules a label names", () => {
    expect(ruleIdsOf("[R6] own rows only")).toEqual(["R6"]);
    expect(ruleIdsOf("[R11, R12] grants")).toEqual(["R11", "R12"]);
    expect(ruleIdsOf("no rule")).toEqual([]);
  });

  it("reports per rule, and flags untagged cases, unknown rules and rules with no case", () => {
    const report = createReport("python", () => null);
    const t = report.checker("leg");
    t.assert("[R6] passes", true);
    t.expect("[R7] fails", { status: 200, text: "leak" }, 403);
    t.assert("names no rule", true);
    t.assert("[R99] unknown", true);
    const row = (id: string) => report.rows().find((r) => r.id === id)!;
    expect(row("R6").result).toBe("pass");
    expect(row("R7").result).toBe("FAIL");
    expect(row("R8").result).toBe("no case");
    expect(row("R19").result).toBe("-");
    expect(report.uncovered()).toContain("R8");
    expect(report.uncovered()).not.toContain("R6");
    expect(report.problems()).toEqual([
      'case names no rule: "names no rule"',
      'case names unknown rule R99: "[R99] unknown"',
    ]);
    expect(t.failures).toHaveLength(1);
    expect(report.table()).toMatch(/R7 +enforced +FAIL/);
  });
});

describe("test tokens", () => {
  it("sets a claim by exact name for namespaced URLs and by path otherwise", () => {
    const payload: Record<string, any> = {};
    setClaim(payload, "https://apso.test/org_id", "1");
    setClaim(payload, "app_metadata.org_id", "2");
    setClaim(payload, "custom:org_id", "3");
    expect(payload).toEqual({
      "https://apso.test/org_id": "1",
      // eslint-disable-next-line camelcase
      app_metadata: { org_id: "2" },
      "custom:org_id": "3",
    });
  });
});

describe("the schema as the cases see it", () => {
  const { entities, relationshipMap } = parseApsorcV2({
    version: 2,
    rootFolder: "src",
    entities: [
      { name: "Organization", fields: [{ name: "name", type: "text" }] },
      { name: "Project", scopeBy: "organizationId", scopeOptions: { bypassRoles: ["support"] }, mcp: ["read"], fields: [{ name: "title", type: "text" }] },
      { name: "Task", scopeBy: "project.organizationId", fields: [{ name: "title", type: "text" }] },
    ],
    relationships: [
      { from: "Organization", to: "Project", type: "OneToMany" },
      { from: "Project", to: "Task", type: "OneToMany" },
    ],
  } as any);

  it("finds the tenant, each entity's scope column, its joins and its tools", () => {
    const model = buildModel(entities, relationshipMap, "typescript", {});
    expect(model.tenantRoot).toBe("Organization");
    const by = (name: string) => model.entities.find((e) => e.name === name)!;
    expect(by("Project").scope).toEqual({ field: "organizationId", bypassRoles: ["support"] });
    expect(by("Task").scope).toMatchObject({ field: "projectId", parent: "Project" });
    expect(by("Organization").relations).toEqual([{ property: "projects", entity: "Project" }]);
    expect(by("Project").tools).toEqual({ list: "list_projects", get: "get_project" });
    expect(by("Project").route).toBe("/Projects");
  });

  it("has no tenant scope without sign-in, and no path scope outside TypeScript", () => {
    expect(buildModel(entities, relationshipMap, "typescript").entities.every((e) => !e.scope)).toBe(true);
    const go = buildModel(entities, relationshipMap, "go", {});
    expect(go.entities.find((e) => e.name === "Task")!.scope).toBeUndefined();
    expect(go.entities.find((e) => e.name === "Project")!.route).toBe("/api/projects");
  });
});
