/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import {
  getAssociationForTemplate,
  Association,
  ComputedAssociation,
} from "../../../../src/lib/types/relationship";

describe("test getAssociationForTemplate", () => {
  test("relationship to template data", () => {
    const entityName = "Application";
    const relationship1: Association = {
      name: "ApplicationService",
      type: "OneToMany",
    };

    const computedRelationships = getAssociationForTemplate(
      entityName,
      [relationship1],
      []
    );
    const expectedComputedRelationship1: ComputedAssociation = {
      entityName: "application",

      name: "ApplicationService",
      type: "OneToMany",
      relationshipName: "applicationService",
      pluralizedRelationshipName: "applicationServices",
      pluralizedName: "applicationServices",
      camelCasedName: "applicationService",
      camelCasedId: "applicationServiceId",
      joinTable: false,
      hasInverse: false,
    };

    expect(computedRelationships.length).toBe(1);
    expect(computedRelationships[0]).toEqual(expectedComputedRelationship1);
  });

  test("relationship to template data with reference name", () => {
    const entityName = "Application";
    const relationship1: Association = {
      name: "User",
      type: "ManyToOne",
      reference_name: "owner",
      nullable: true
    };

    const computedRelationships = getAssociationForTemplate(
      entityName,
      [relationship1],
      []
    );
    const expectedComputedRelationship1: ComputedAssociation = {
      entityName: "application",

      name: "User",
      type: "ManyToOne",
      relationshipName: "owner",
      pluralizedRelationshipName: "owners",
      pluralizedName: "users",
      camelCasedName: "user",
      camelCasedId: "ownerId",
      joinTable: false,
      hasInverse: false,
      reference_name: "owner",
      nullable: true
    };

    expect(computedRelationships.length).toBe(1);
    expect(computedRelationships[0]).toEqual(expectedComputedRelationship1);
  });
});
