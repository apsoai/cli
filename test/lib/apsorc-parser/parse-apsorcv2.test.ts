/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { ApsorcType, parseApsorcV2 } from "../../../src/lib/apsorc-parser";
import apsorc from "../../apsorc-json/apsorc.v2.json";

describe("test parseApsorcV2", () => {
  test("version 2 apsorc returns", () => {
    const result = parseApsorcV2(apsorc as ApsorcType);
    const expectedResult = {
      entities: [
        {
          name: "User",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "cognito_id",
              type: "text",
              unique: true,
            },
            {
              name: "email",
              type: "text",
              length: 255,
              is_email: true,
            },
            {
              name: "fullName",
              type: "text",
              nullable: true,
            },
          ],
        },
        {
          name: "Workspace",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
          ],
        },
        {
          name: "WorkspaceUser",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "email",
              type: "text",
              length: 255,
              is_email: true,
            },
            {
              name: "invite_code",
              type: "text",
              length: 64,
            },
            {
              name: "role",
              type: "enum",
              values: ["User", "Admin"],
              default: "Admin",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Invited", "Inactive", "Deleted"],
            },
            {
              name: "activeAt",
              type: "date",
              nullable: true,
            },
          ],
        },
        {
          name: "Application",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Deleted"],
            },
          ],
        },
        {
          name: "ApplicationService",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Draft", "Archived"],
            },
            {
              name: "build_status",
              type: "enum",
              values: [
                "New",
                "ReadyToBuild",
                "Building",
                "BuildDone",
                "Scaffolding",
                "Ready",
              ],
              default: "New",
            },
            {
              name: "subdomain",
              type: "text",
              unique: true,
              nullable: true,
            },
            {
              name: "deployment_location",
              type: "text",
              default: "us-west-2",
            },
            {
              name: "service_type",
              type: "enum",
              values: ["Shared", "Standalone"],
            },
            {
              name: "stack_id",
              type: "text",
              nullable: true,
            },
            {
              name: "environment_name",
              type: "text",
              nullable: true,
            },
            {
              name: "infrastructure_details",
              type: "json",
              nullable: true,
            },
            {
              name: "apsorc",
              type: "json-plain",
              nullable: true,
            },
          ],
        },
        {
          name: "ApplicationServiceApiKey",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "access_rights",
              type: "enum",
              values: ["FullAccess", "ReadOnly"],
            },
            {
              name: "expires_at",
              type: "date",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Inactive"],
            },
            {
              name: "key",
              type: "text",
            },
          ],
        },
        {
          name: "ApplicationServiceMetric",
          created_at: true,
          fields: [
            {
              name: "metric_type",
              type: "enum",
              values: ["Bandwidth", "Request", "Error"],
            },
            {
              name: "date",
              type: "date",
            },
            {
              name: "value",
              type: "integer",
            },
          ],
          indexes: [
            {
              fields: ["applicationServiceId", "metric_type", "date"],
              unique: true,
            },
          ],
        },
        {
          name: "InfrastructureStack",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "stackId",
              type: "text",
            },
            {
              name: "stack_type",
              type: "enum",
              values: ["network", "database"],
            },
            {
              name: "status",
              type: "enum",
              values: [
                "new",
                "creating",
                "created",
                "active",
                "inactive",
                "destroyed",
              ],
            },
            {
              name: "details",
              type: "json",
              nullable: true,
            },
          ],
        },
        {
          name: "SchemaTemplate",
          created_at: true,
          updated_at: true,
          fields: [
            { name: "name", type: "text", nullable: false },
            { name: "description", type: "text", nullable: true },
            { name: "logoURL", type: "text", nullable: true },
            { name: "apsorc", type: "json-plain", nullable: false },
          ],
        },
      ],
      relationshipMap: {
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
      },
    };
    expect(result).toEqual(expectedResult);
  });
});
