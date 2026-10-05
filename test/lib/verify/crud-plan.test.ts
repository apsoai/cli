import { expect, describe, test } from "@jest/globals";
import { planCrud, sampleValue } from "../../../src/lib/verify/crud-plan";
import { entityRoute, readDotEnv } from "../../../src/lib/verify";
import { parseRelationships } from "../../../src/lib/utils/relationships";
import { Entity } from "../../../src/lib/types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("sampleValue", () => {
  test("fills each supported type", () => {
    expect(sampleValue({ name: "a", type: "text" })).toBe("smoke");
    expect(sampleValue({ name: "a", type: "text", length: 3 })).toBe("smo");
    expect(sampleValue({ name: "a", type: "text", is_email: true })).toBe("smoke@example.com");
    expect(sampleValue({ name: "a", type: "integer" })).toBe(1);
    expect(sampleValue({ name: "a", type: "decimal" })).toBe(1.5);
    expect(sampleValue({ name: "a", type: "boolean" })).toBe(true);
    expect(sampleValue({ name: "a", type: "timestamptz" })).toBe("2024-01-01T00:00:00.000Z");
    expect(sampleValue({ name: "a", type: "enum", values: ["gold", "silver"] })).toBe("gold");
    expect(sampleValue({ name: "a", type: "json" })).toEqual({});
    expect(sampleValue({ name: "a", type: "uuid" as never })).toMatch(/^[\da-f-]{36}$/);
  });

  test("returns undefined for a type it can't fill", () => {
    expect(sampleValue({ name: "a", type: "array" })).toBeUndefined();
  });
});

describe("planCrud", () => {
  const customer: Entity = {
    name: "Customer",
    fields: [
      { name: "name", type: "text" },
      { name: "nickname", type: "text", nullable: true },
      { name: "score", type: "integer", default: "0" },
    ],
  };
  const order: Entity = { name: "Order", fields: [{ name: "total", type: "decimal" }] };
  const lineItem: Entity = { name: "LineItem", fields: [{ name: "qty", type: "integer" }] };

  test("sends only required fields", () => {
    const { order: planned } = planCrud([customer], {});
    expect(planned[0].payload).toEqual({ name: "smoke" });
  });

  test("orders parents before children and names the foreign keys", () => {
    const relationships = parseRelationships([
      { from: "LineItem", to: "Order", type: "ManyToOne" },
      { from: "Customer", to: "Order", type: "OneToMany", to_name: "purchases" },
    ]);
    const plan = planCrud([lineItem, order, customer], relationships);
    expect(plan.order.map((p) => p.name)).toEqual(["Customer", "Order", "LineItem"]);
    expect(plan.order[1].parents).toEqual([{ property: "customerId", entity: "Customer" }]);
    expect(plan.order[2].parents).toEqual([{ property: "orderId", entity: "Order" }]);
    expect(plan.skipped).toEqual([]);
  });

  test("uses to_name for the foreign key and ignores nullable parents", () => {
    const relationships = parseRelationships([
      { from: "Order", to: "Customer", type: "ManyToOne", to_name: "buyer" },
      { from: "LineItem", to: "Order", type: "ManyToOne", nullable: true },
    ]);
    const plan = planCrud([customer, order, lineItem], relationships);
    expect(plan.order.find((p) => p.name === "Order")?.parents).toEqual([
      { property: "buyerId", entity: "Customer" },
    ]);
    expect(plan.order.find((p) => p.name === "LineItem")?.parents).toEqual([]);
  });

  test("skips cycles, unsupported types, and their children", () => {
    const tags: Entity = { name: "Tagged", fields: [{ name: "tags", type: "array" }] };
    const note: Entity = { name: "Note", fields: [] };
    const a: Entity = { name: "A", fields: [] };
    const b: Entity = { name: "B", fields: [] };
    const relationships = parseRelationships([
      { from: "Note", to: "Tagged", type: "ManyToOne" },
      { from: "A", to: "B", type: "ManyToOne", bi_directional: false },
      { from: "B", to: "A", type: "ManyToOne", bi_directional: false },
    ]);
    const plan = planCrud([tags, note, a, b, customer], relationships);
    expect(plan.order.map((p) => p.name)).toEqual(["Customer"]);
    expect(plan.skipped.map((s) => s.name).sort()).toEqual(["A", "B", "Note", "Tagged"]);
    expect(plan.skipped.find((s) => s.name === "Tagged")?.reason).toContain('"array"');
    expect(plan.skipped.find((s) => s.name === "Note")?.reason).toContain("Tagged");
  });
});

describe("entityRoute", () => {
  test("matches each language's generated controller", () => {
    expect(entityRoute("typescript", "LineItem")).toBe("/LineItems");
    expect(entityRoute("python", "LineItem")).toBe("/api/lineitems");
    expect(entityRoute("go", "LineItem")).toBe("/api/line-items");
  });
});

describe("readDotEnv", () => {
  test("reads KEY=value lines and strips quotes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-env-"));
    fs.writeFileSync(path.join(dir, ".env"), '# db\nDATABASE_URL="postgres://u:p@h:5433/d"\nPORT=3000\n');
    expect(readDotEnv(dir)).toEqual({ DATABASE_URL: "postgres://u:p@h:5433/d", PORT: "3000" });
    expect(readDotEnv(path.join(dir, "missing"))).toEqual({});
  });
});
