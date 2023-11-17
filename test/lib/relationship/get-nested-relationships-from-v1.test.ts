import { expect } from "@jest/globals";
import { getNestedRelationships } from "../../../src/lib/utils/relationships";
import { ApsorcType, parseApsorcV1 } from "../../../src/lib/apsorc-parser";
import apsorcNonBidirectional from "../../apsorc-json/apsorc-many-to-many-non-bidirectional.v1.json";
import apsorcBidirectional from "../../apsorc-json/apsorc-many-to-many-bidirectional.v1.json";

const expectedNestedRelationship = [
  "user.customer",
  "user.customer.facilities",
  "user.customer.facilities.machines",
  "user.customer.facilities.scales",
  "user.customer.facilities.facilityBins",
  "user.customer.hoppers",
  "user.customer.hoppers.machines",
  "user.customer.hoppers.facilityBins",
  "user.facilities",
  "user.facilities.customer",
  "user.facilities.customer.hoppers",
  "user.facilities.machines",
  "user.facilities.machines.scales",
  "user.facilities.machines.hoppers",
  "user.facilities.machines.machineType",
  "user.facilities.scales",
  "user.facilities.scales.machines",
  "user.facilities.facilityBins",
  "user.facilities.facilityBins.hoppers",
  "user.facilities.facilityBins.commodity",
  "user.facilityBins",
  "user.facilityBins.facility",
  "user.facilityBins.facility.customer",
  "user.facilityBins.facility.machines",
  "user.facilityBins.facility.scales",
  "user.facilityBins.hoppers",
  "user.facilityBins.hoppers.customer",
  "user.facilityBins.hoppers.machines",
  "user.facilityBins.commodity",
  "user.scales",
  "user.scales.facility",
  "user.scales.facility.customer",
  "user.scales.facility.machines",
  "user.scales.facility.facilityBins",
  "user.scales.machines",
  "user.scales.machines.facility",
  "user.scales.machines.hoppers",
  "user.scales.machines.machineType",
  "user.machines",
  "user.machines.facility",
  "user.machines.facility.customer",
  "user.machines.facility.scales",
  "user.machines.facility.facilityBins",
  "user.machines.scales",
  "user.machines.scales.facility",
  "user.machines.hoppers",
  "user.machines.hoppers.customer",
  "user.machines.hoppers.facilityBins",
  "user.machines.machineType",
  "user.machineTypes",
  "user.machineTypes.machines",
  "user.machineTypes.machines.facility",
  "user.machineTypes.machines.scales",
  "user.machineTypes.machines.hoppers",
  "user.commodities",
  "user.hoppers",
  "user.hoppers.customer",
  "user.hoppers.customer.facilities",
  "user.hoppers.machines",
  "user.hoppers.machines.facility",
  "user.hoppers.machines.scales",
  "user.hoppers.machines.machineType",
  "user.hoppers.facilityBins",
  "user.hoppers.facilityBins.facility",
  "user.hoppers.facilityBins.commodity",
  "facilityBins.user",
  "facilityBins.user.customer",
  "facilityBins.user.customer.facilities",
  "facilityBins.user.customer.hoppers",
  "facilityBins.user.facilities",
  "facilityBins.user.facilities.customer",
  "facilityBins.user.facilities.machines",
  "facilityBins.user.facilities.scales",
  "facilityBins.user.scales",
  "facilityBins.user.scales.facility",
  "facilityBins.user.scales.machines",
  "facilityBins.user.machines",
  "facilityBins.user.machines.facility",
  "facilityBins.user.machines.scales",
  "facilityBins.user.machines.hoppers",
  "facilityBins.user.machines.machineType",
  "facilityBins.user.machineTypes",
  "facilityBins.user.machineTypes.machines",
  "facilityBins.user.commodities",
  "facilityBins.user.hoppers",
  "facilityBins.user.hoppers.customer",
  "facilityBins.user.hoppers.machines",
  "facilityBins.facility",
  "facilityBins.facility.customer",
  "facilityBins.facility.customer.users",
  "facilityBins.facility.customer.hoppers",
  "facilityBins.facility.user",
  "facilityBins.facility.user.customer",
  "facilityBins.facility.user.scales",
  "facilityBins.facility.user.machines",
  "facilityBins.facility.user.machineTypes",
  "facilityBins.facility.user.commodities",
  "facilityBins.facility.user.hoppers",
  "facilityBins.facility.machines",
  "facilityBins.facility.machines.user",
  "facilityBins.facility.machines.scales",
  "facilityBins.facility.machines.hoppers",
  "facilityBins.facility.machines.machineType",
  "facilityBins.facility.scales",
  "facilityBins.facility.scales.user",
  "facilityBins.facility.scales.machines",
  "facilityBins.hoppers",
  "facilityBins.hoppers.customer",
  "facilityBins.hoppers.customer.users",
  "facilityBins.hoppers.customer.facilities",
  "facilityBins.hoppers.user",
  "facilityBins.hoppers.user.customer",
  "facilityBins.hoppers.user.facilities",
  "facilityBins.hoppers.user.scales",
  "facilityBins.hoppers.user.machines",
  "facilityBins.hoppers.user.machineTypes",
  "facilityBins.hoppers.user.commodities",
  "facilityBins.hoppers.machines",
  "facilityBins.hoppers.machines.user",
  "facilityBins.hoppers.machines.facility",
  "facilityBins.hoppers.machines.scales",
  "facilityBins.hoppers.machines.machineType",
  "facilityBins.commodity",
];
describe("test getNestedRelationships", () => {
  test("v1 apso with many to many", () => {
    const { relationshipMap } = parseApsorcV1(
      apsorcBidirectional as ApsorcType
    );
    const entityName = "Commodity";
    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );

    expect(nestedRelationships).toEqual(expectedNestedRelationship);
  });

  test("v1 apso with many to many - non-bidirectional", () => {
    const { relationshipMap } = parseApsorcV1(
      apsorcNonBidirectional as ApsorcType
    );
    const entityName = "Commodity";
    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );

    expect(nestedRelationships).toEqual(expectedNestedRelationship);
  });
});
