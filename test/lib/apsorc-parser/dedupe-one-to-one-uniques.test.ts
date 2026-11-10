import { expect, test } from "@jest/globals";
import { parseApsorcV2 } from "../../../src/lib/apsorc-parser";

// Setting OneToOne Workspace puts a UNIQUE workspaceId on setting already, so
// a "uniques" entry on exactly that column is dropped; composites are kept.
test("drops a unique on a OneToOne's own FK column and keeps composites", () => {
  const apsorc = {
    version: 2,
    rootFolder: "src",
    apiType: "Rest",
    entities: [
      { name: "Workspace", fields: [{ name: "name", type: "text" }] },
      {
        name: "Setting",
        fields: [{ name: "tz", type: "text" }],
        uniques: [{ fields: ["workspaceId"] }, { fields: ["workspaceId", "tz"] }],
      },
    ],
    relationships: [{ from: "Setting", to: "Workspace", type: "OneToOne" }],
  };
  const { entities } = parseApsorcV2(apsorc as any);
  expect(entities.find((e) => e.name === "Setting")?.uniques).toEqual([
    { fields: ["workspaceId", "tz"] },
  ]);
});

test("keeps the same unique when the relationship is ManyToOne", () => {
  const apsorc = {
    version: 2,
    rootFolder: "src",
    apiType: "Rest",
    entities: [
      { name: "Workspace", fields: [{ name: "name", type: "text" }] },
      { name: "Setting", fields: [{ name: "tz", type: "text" }], uniques: [{ fields: ["workspaceId"] }] },
    ],
    relationships: [{ from: "Setting", to: "Workspace", type: "ManyToOne" }],
  };
  const { entities } = parseApsorcV2(apsorc as any);
  expect(entities.find((e) => e.name === "Setting")?.uniques).toEqual([{ fields: ["workspaceId"] }]);
});
