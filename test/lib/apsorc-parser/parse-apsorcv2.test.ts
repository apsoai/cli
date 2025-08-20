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
        Application: [
          {
            biDirectional: true,
            cascadeDelete: false,
            index: true,
            inverseReferenceName: "Application",
            name: "Workspace",
            nullable: false,
            referenceName: "Workspace",
            type: "ManyToOne",
          },
          {
            biDirectional: true,
            inverseReferenceName: "Application",
            name: "ApplicationService",
            referenceName: "ApplicationService",
            type: "OneToMany",
          },
          {
            index: false,
            name: "User",
            nullable: false,
            referenceName: "owner",
            type: "ManyToOne",
          },
        ],
        ApplicationService: [
          {
            biDirectional: true,
            cascadeDelete: false,
            index: false,
            inverseReferenceName: "ApplicationService",
            name: "Application",
            nullable: false,
            referenceName: "Application",
            type: "ManyToOne",
          },
          {
            biDirectional: true,
            inverseReferenceName: "ApplicationService",
            name: "ApplicationServiceApiKey",
            referenceName: "ApplicationServiceApiKey",
            type: "OneToMany",
          },
          {
            biDirectional: true,
            inverseReferenceName: "ApplicationService",
            name: "ApplicationServiceMetric",
            referenceName: "ApplicationServiceMetric",
            type: "OneToMany",
          },
          {
            index: false,
            name: "InfrastructureStack",
            nullable: true,
            referenceName: "networkStack",
            type: "ManyToOne",
          },
          {
            index: false,
            name: "InfrastructureStack",
            nullable: true,
            referenceName: "databaseStack",
            type: "ManyToOne",
          },
        ],
        ApplicationServiceApiKey: [
          {
            biDirectional: true,
            cascadeDelete: false,
            index: false,
            inverseReferenceName: "ApplicationServiceApiKey",
            name: "ApplicationService",
            nullable: false,
            referenceName: "ApplicationService",
            type: "ManyToOne",
          },
        ],
        ApplicationServiceMetric: [
          {
            biDirectional: true,
            cascadeDelete: false,
            index: false,
            inverseReferenceName: "ApplicationServiceMetric",
            name: "ApplicationService",
            nullable: false,
            referenceName: "ApplicationService",
            type: "ManyToOne",
          },
        ],
        InfrastructureStack: [
          {
            index: false,
            name: "InfrastructureStack",
            nullable: true,
            referenceName: "networkStack",
            type: "ManyToOne",
          },
        ],
        User: [
          {
            biDirectional: true,
            inverseReferenceName: "User",
            name: "WorkspaceUser",
            referenceName: "WorkspaceUser",
            type: "OneToMany",
          },
        ],
        Workspace: [
          {
            biDirectional: true,
            inverseReferenceName: "Workspace",
            name: "WorkspaceUser",
            referenceName: "WorkspaceUser",
            type: "OneToMany",
          },
          {
            biDirectional: true,
            inverseReferenceName: "Workspace",
            name: "Application",
            referenceName: "Application",
            type: "OneToMany",
          },
        ],
        WorkspaceUser: [
          {
            biDirectional: true,
            cascadeDelete: false,
            index: false,
            inverseReferenceName: "WorkspaceUser",
            name: "User",
            nullable: true,
            referenceName: "User",
            type: "ManyToOne",
          },
          {
            biDirectional: true,
            cascadeDelete: false,
            index: false,
            inverseReferenceName: "WorkspaceUser",
            name: "Workspace",
            nullable: false,
            referenceName: "Workspace",
            type: "ManyToOne",
          },
        ],
      },
    };
    expect(result).toEqual(expectedResult);
  });
});
