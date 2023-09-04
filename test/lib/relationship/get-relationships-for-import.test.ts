/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { Association } from "../../../src/lib/types";
import { getRelationshipsForImport } from "../../../src/lib/utils/relationships";

describe("test getRelationshipForImport", () => {
  test("undefined relationships returns empty list", () => {
    const relationships = undefined;
    const entityName = "User";

    const result = getRelationshipsForImport(entityName, relationships);
    expect(result).toEqual([]);
  });

  test("empty list relationships returns empty list", () => {
    const relationships: Association[] = [];
    const entityName = "User";

    const result = getRelationshipsForImport(entityName, relationships);
    expect(result).toEqual([]);
  });

  test("list of relationships does not include self-joins or duplicates", () => {
    const relationships: Association[] = [
      {
        name: "User",
        type: "ManyToMany",
      },
      {
        name: "Workspace",
        type: "OneToMany",
      },
      {
        name: "Workspace2",
        type: "OneToMany",
      },
      {
        name: "Application",
        type: "ManyToOne",
      },
      {
        name: "InfrastructureStack",
        type: "ManyToOne",
        reference_name: "networkStack",
      },
      {
        name: "InfrastructureStack",
        type: "ManyToOne",
        reference_name: "databaseStack",
      },
    ];
    const entityName = "Workspace2";

    const result = getRelationshipsForImport(entityName, relationships);
    expect(result).toEqual([
      "User",
      "Workspace",
      "Application",
      "InfrastructureStack",
    ]);
  });
});
