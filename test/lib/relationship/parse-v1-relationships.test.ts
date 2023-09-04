import { expect } from "@jest/globals";
import { Entity } from "../../../src/lib/types/entity";
import { parseV1Relationships } from "../../../src/lib/utils/relationships/parse-v1";
import apsorc from "../../apsorc-json/apsorc.v1.json";

describe("test parseV1Relationships", () => {
  test("full example", () => {
    const result = parseV1Relationships(apsorc.entities as Entity[]);
    const expectedResult = {
      User: [
        {
          type: "OneToMany",
          name: "WorkspaceUser",
          biDirectional: true,
        },
      ],
      WorkspaceUser: [
        {
          type: "ManyToOne",
          name: "User",
          nullable: true,
          biDirectional: true,
        },
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
          biDirectional: true,
        },
      ],
      Workspace: [
        {
          type: "OneToMany",
          name: "WorkspaceUser",
          biDirectional: true,
        },
        {
          type: "OneToMany",
          name: "Application",
          biDirectional: true,
        },
      ],
      Application: [
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
          biDirectional: true,
        },
        {
          type: "OneToMany",
          name: "ApplicationService",
          biDirectional: true,
        },
        {
          type: "ManyToOne",
          name: "User",
          referenceName: "owner",
          nullable: false,
        },
      ],
      ApplicationService: [
        {
          type: "ManyToOne",
          name: "Application",
          nullable: false,
          biDirectional: true,
        },
        {
          type: "OneToMany",
          name: "ApplicationServiceApiKey",
          biDirectional: true,
        },
        {
          type: "OneToMany",
          name: "ApplicationServiceMetric",
          biDirectional: true,
        },
        {
          type: "ManyToOne",
          name: "InfrastructureStack",
          referenceName: "networkStack",
          nullable: true,
        },
        {
          type: "ManyToOne",
          name: "InfrastructureStack",
          referenceName: "databaseStack",
          nullable: true,
        },
      ],
      ApplicationServiceApiKey: [
        {
          type: "ManyToOne",
          name: "ApplicationService",
          nullable: false,
          biDirectional: true,
        },
      ],
      ApplicationServiceMetric: [
        {
          type: "ManyToOne",
          name: "ApplicationService",
          nullable: false,
          biDirectional: true,
        },
      ],
      InfrastructureStack: [
        {
          type: "ManyToOne",
          name: "InfrastructureStack",
          referenceName: "networkStack",
          nullable: true,
        },
      ],
    };
    expect(result).toEqual(expectedResult);
  });
});
