import { expect } from "@jest/globals";
import { getNestedRelationships } from "../../../src/lib/utils/relationships";
import { ApsorcType, parseApsorcV1 } from "../../../src/lib/apsorc-parser";
import apsorcNonBidirectional from "../../apsorc-json/apsorc-many-to-many-non-bidirectional.v1.json";
import apsorcBidirectional from "../../apsorc-json/apsorc-many-to-many-bidirectional.v1.json";

describe("test getNestedRelationships", () => {
  test("v1 apso with many to many", () => {
    const { relationshipMap } = parseApsorcV1(apsorcBidirectional as ApsorcType);
    
    const entityName = 'Commodity';
    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );

    const expectedNestedRelationship = [
      'user.customer',
      'user.facilities',
      'user.facilityBins',
      'user.scales',
      'user.machines',
      'user.machineTypes',
      'user.hoppers',
      'facilityBins.user',
      'facilityBins.facility',
      'facilityBins.hoppers',
    ]
    expect(nestedRelationships).toEqual(expectedNestedRelationship);
  });

  test("v1 apso with many to many - non-bidirectional", () => {
    const { relationshipMap } = parseApsorcV1(apsorcNonBidirectional as ApsorcType);
    
    const entityName = 'Commodity';
    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );

    const expectedNestedRelationship = [
      'user.customer',
      'user.facilities',
      'user.facilityBins',
      'user.scales',
      'user.machines',
      'user.machineTypes',
      'user.hoppers',
      'facilityBins.user',
      'facilityBins.facility',
      'facilityBins.hoppers',
    ]
    expect(nestedRelationships).toEqual(expectedNestedRelationship);
  })

});