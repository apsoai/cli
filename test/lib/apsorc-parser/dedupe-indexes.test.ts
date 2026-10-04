import { expect, test } from "@jest/globals";
import { dedupeIndexes } from "../../../src/lib/apsorc-parser";

// Prod svc 52: a plain and a unique index on Warehouse.manager_email got one
// TypeORM name, so the second CREATE INDEX failed and schema:sync rolled back.
test("keeps the unique index where a plain one covers the same columns, and drops duplicates", () => {
  const entity = {
    name: "Warehouse",
    fields: [],
    indexes: [
      { fields: ["name"], unique: false },
      { fields: ["manager_email"], unique: false },
      { fields: ["manager_email"], unique: true },
      { fields: ["name"], unique: false },
      { fields: ["city", "name"], unique: false },
    ],
  };
  expect(dedupeIndexes(entity as any).indexes).toEqual([
    { fields: ["name"], unique: false },
    { fields: ["manager_email"], unique: true },
    { fields: ["city", "name"], unique: false },
  ]);
  const clean = {
    name: "Tag",
    fields: [],
    indexes: [{ fields: ["label"], unique: true }],
  };
  expect(dedupeIndexes(clean as any)).toBe(clean);
});
