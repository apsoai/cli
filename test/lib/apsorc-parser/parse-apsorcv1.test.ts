/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { ApsorcType, parseApsorcV1 } from "../../../src/lib/apsorc-parser";
import { getInverseRelationship } from "../../../src/lib/utils/relationships/parse-v1";
import apsorc from "../../apsorc-json/apsorc.v1.json";
import apsorcNonBidirectional from "../../apsorc-json/apsorc-many-to-many-non-bidirectional.v1.json";
import apsorcBidirectional from "../../apsorc-json/apsorc-many-to-many-bidirectional.v1.json";
import { Association, Entity } from "../../../src/lib/types";

describe("test parseApsorcV1", () => {
  test("version 1 apsorc returns", () => {
    const result = parseApsorcV1(apsorc as ApsorcType);
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
            index: false,
          },
          {
            type: "ManyToOne",
            name: "Workspace",
            nullable: false,
            biDirectional: true,
            index: false,
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
            index: true,
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
            index: false,
          },
        ],
        ApplicationService: [
          {
            type: "ManyToOne",
            name: "Application",
            nullable: false,
            biDirectional: true,
            index: false,
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
            index: false,
          },
          {
            type: "ManyToOne",
            name: "InfrastructureStack",
            referenceName: "databaseStack",
            nullable: true,
            index: false,
          },
        ],
        ApplicationServiceApiKey: [
          {
            type: "ManyToOne",
            name: "ApplicationService",
            nullable: false,
            biDirectional: true,
            index: false,
          },
        ],
        ApplicationServiceMetric: [
          {
            type: "ManyToOne",
            name: "ApplicationService",
            nullable: false,
            biDirectional: true,
            index: false,
          },
        ],
        InfrastructureStack: [
          {
            type: "ManyToOne",
            name: "InfrastructureStack",
            referenceName: "networkStack",
            nullable: true,
            index: false,
          },
        ],
      },
    };
    expect(result).toEqual(expectedResult);
  });

  test("version 1 apsorc with many to many returns - non-directional ManyToMany", () => {
    const result = parseApsorcV1(apsorcNonBidirectional as ApsorcType);
    const expectedResult = {
      entities: [
        {
          name: "Customer",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "country",
              type: "text",
            },
            {
              name: "streetAddress1",
              type: "text",
            },
            {
              name: "streetAddress2",
              type: "text",
            },
            {
              name: "city",
              type: "text",
            },
            {
              name: "state",
              type: "text",
            },
            {
              name: "zipCode",
              type: "text",
            },
            {
              name: "createdBy",
              type: "text",
              nullable: true,
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "User",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "cognito_id",
              type: "text",
              unique: true,
              nullable: true,
            },
            {
              name: "email",
              type: "text",
              length: "255",
              is_email: true,
              unique: true,
            },
            {
              name: "firstName",
              type: "text",
              nullable: true,
            },
            {
              name: "lastName",
              type: "text",
              nullable: true,
            },
            {
              name: "name",
              type: "text",
              nullable: true,
            },
            {
              name: "inviteStatus",
              type: "text",
              default: "Invited",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Inactive", "Delete"],
            },
            {
              name: "role",
              type: "enum",
              values: ["linusAdmin", "admin", "user"],
            },
            {
              name: "createdBy",
              type: "text",
              nullable: "true",
            },
          ],
        },
        {
          name: "Facility",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "streetAddress1",
              type: "text",
            },
            {
              name: "streetAddress2",
              type: "text",
            },
            {
              name: "city",
              type: "text",
            },
            {
              name: "state",
              type: "text",
            },
            {
              name: "country",
              type: "text",
            },
            {
              name: "zipCode",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
            {
              name: "weight",
              type: "text",
            },
          ],
        },
        {
          name: "Machine",
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
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "MachineType",
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
              values: ["Active", "Delete"],
            },
          ],
        },
        {
          name: "Scale",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "ID",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "FacilityBin",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "color",
              type: "text",
            },
            {
              name: "capacity",
              type: "text",
            },
            {
              name: "threshold",
              type: "text",
            },
            {
              name: "isPickedUp",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "Hopper",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "ID",
              type: "text",
            },
            {
              name: "name",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "Commodity",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "value",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Delete"],
            },
          ],
        },
      ],
      relationshipMap: {
        Customer: [
          { name: "User", type: "OneToMany", biDirectional: true },
          { name: "Facility", type: "OneToMany", biDirectional: true },
          { name: "Hopper", type: "OneToMany", biDirectional: true },
        ],
        User: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Facility", type: "OneToMany", biDirectional: true },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
          { name: "Scale", type: "OneToMany", biDirectional: true },
          { name: "Machine", type: "OneToMany", biDirectional: true },
          { name: "MachineType", type: "OneToMany", biDirectional: true },
          { name: "Commodity", type: "OneToMany", biDirectional: true },
          { name: "Hopper", type: "OneToMany", biDirectional: true },
        ],
        Facility: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "OneToMany", biDirectional: true },
          { name: "Scale", type: "OneToMany", biDirectional: true },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
        ],
        Hopper: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Machine",
            type: "ManyToMany",
            join: true,
            biDirectional: false,
          },
          {
            name: "FacilityBin",
            type: "ManyToMany",
            join: true,
            biDirectional: true,
          },
        ],
        FacilityBin: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Hopper", type: "ManyToMany", biDirectional: true },
          {
            name: "Commodity",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
        ],
        Scale: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "ManyToMany", biDirectional: true },
        ],
        Machine: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Scale",
            type: "ManyToMany",
            join: true,
            biDirectional: true,
          },
          {
            name: "Hopper",
            type: "ManyToMany",
            join: true,
            biDirectional: false,
          },
          {
            name: "MachineType",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
        ],
        MachineType: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "OneToMany", biDirectional: true },
        ],
        Commodity: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
        ],
      },
    };

    expect(result).toEqual(expectedResult);
  });

  test("version 1 apsorc with many to many returns - only directional ManyToMany", () => {
    const result = parseApsorcV1(apsorcBidirectional as ApsorcType);
    const expectedResult = {
      entities: [
        {
          name: "Customer",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "country",
              type: "text",
            },
            {
              name: "streetAddress1",
              type: "text",
            },
            {
              name: "streetAddress2",
              type: "text",
            },
            {
              name: "city",
              type: "text",
            },
            {
              name: "state",
              type: "text",
            },
            {
              name: "zipCode",
              type: "text",
            },
            {
              name: "createdBy",
              type: "text",
              nullable: true,
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "User",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "cognito_id",
              type: "text",
              unique: true,
              nullable: true,
            },
            {
              name: "email",
              type: "text",
              length: "255",
              is_email: true,
              unique: true,
            },
            {
              name: "firstName",
              type: "text",
              nullable: true,
            },
            {
              name: "lastName",
              type: "text",
              nullable: true,
            },
            {
              name: "name",
              type: "text",
              nullable: true,
            },
            {
              name: "inviteStatus",
              type: "text",
              default: "Invited",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Inactive", "Delete"],
            },
            {
              name: "role",
              type: "enum",
              values: ["linusAdmin", "admin", "user"],
            },
            {
              name: "createdBy",
              type: "text",
              nullable: "true",
            },
          ],
        },
        {
          name: "Facility",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "streetAddress1",
              type: "text",
            },
            {
              name: "streetAddress2",
              type: "text",
            },
            {
              name: "city",
              type: "text",
            },
            {
              name: "state",
              type: "text",
            },
            {
              name: "country",
              type: "text",
            },
            {
              name: "zipCode",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
            {
              name: "weight",
              type: "text",
            },
          ],
        },
        {
          name: "Machine",
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
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "MachineType",
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
              values: ["Active", "Delete"],
            },
          ],
        },
        {
          name: "Scale",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "ID",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "FacilityBin",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "color",
              type: "text",
            },
            {
              name: "capacity",
              type: "text",
            },
            {
              name: "threshold",
              type: "text",
            },
            {
              name: "isPickedUp",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "Hopper",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "ID",
              type: "text",
            },
            {
              name: "name",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Archived", "Delete"],
            },
          ],
        },
        {
          name: "Commodity",
          created_at: true,
          updated_at: true,
          fields: [
            {
              name: "name",
              type: "text",
            },
            {
              name: "value",
              type: "text",
            },
            {
              name: "status",
              type: "enum",
              values: ["Active", "Delete"],
            },
          ],
        },
      ],
      relationshipMap: {
        Customer: [
          { name: "User", type: "OneToMany", biDirectional: true },
          { name: "Facility", type: "OneToMany", biDirectional: true },
          { name: "Hopper", type: "OneToMany", biDirectional: true },
        ],
        User: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Facility", type: "OneToMany", biDirectional: true },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
          { name: "Scale", type: "OneToMany", biDirectional: true },
          { name: "Machine", type: "OneToMany", biDirectional: true },
          { name: "MachineType", type: "OneToMany", biDirectional: true },
          { name: "Commodity", type: "OneToMany", biDirectional: true },
          { name: "Hopper", type: "OneToMany", biDirectional: true },
        ],
        Facility: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "OneToMany", biDirectional: true },
          { name: "Scale", type: "OneToMany", biDirectional: true },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
        ],
        Hopper: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Machine",
            type: "ManyToMany",
            biDirectional: true,
          },
          {
            name: "FacilityBin",
            type: "ManyToMany",
            join: true,
            biDirectional: true,
          },
        ],
        FacilityBin: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Hopper", type: "ManyToMany", biDirectional: true },
          {
            name: "Commodity",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
        ],
        Scale: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "ManyToMany", biDirectional: true },
        ],
        Machine: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Facility",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          {
            name: "Scale",
            type: "ManyToMany",
            join: true,
            biDirectional: true,
          },
          {
            name: "Hopper",
            type: "ManyToMany",
            join: true,
            biDirectional: true,
          },
          {
            name: "MachineType",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
        ],
        MachineType: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "Machine", type: "OneToMany", biDirectional: true },
        ],
        Commodity: [
          {
            name: "User",
            type: "ManyToOne",
            nullable: true,
            biDirectional: true,
            index: false,
          },
          { name: "FacilityBin", type: "OneToMany", biDirectional: true },
        ],
      },
    };

    expect(result).toEqual(expectedResult);
  });
});

describe("test getInverseRelationship", () => {
  test("returns when inverse found", () => {
    const entities: Entity[] = [
      {
        name: "Customer",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "name",
            type: "text",
          },
        ],
        associations: [
          {
            name: "User",
            type: "OneToMany",
          },
          {
            name: "Facility",
            type: "OneToMany",
          },
          {
            name: "Hopper",
            type: "OneToMany",
          },
        ],
      },
      {
        name: "User",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "cognito_id",
            type: "text",
            unique: true,
            nullable: true,
          },
        ],
        associations: [
          {
            name: "Customer",
            type: "ManyToOne",
            nullable: true,
          },
          {
            name: "Facility",
            type: "OneToMany",
          },
        ],
      },
    ];

    const association: Association = {
      name: "User",
      type: "OneToMany",
    };

    const entityName = "Customer";

    const expectedResult = {
      name: "Customer",
      type: "ManyToOne",
      nullable: true,
    };

    const result = getInverseRelationship(entityName, association, entities);
    expect(result).toEqual(expectedResult);
  });

  test("returns null when no inverse found", () => {
    const entities: Entity[] = [
      {
        name: "Customer",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "name",
            type: "text",
          },
        ],
        associations: [
          {
            name: "User",
            type: "OneToMany",
          },
          {
            name: "Facility",
            type: "OneToMany",
          },
          {
            name: "Hopper",
            type: "OneToMany",
          },
        ],
      },
      {
        name: "User",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "cognito_id",
            type: "text",
            unique: true,
            nullable: true,
          },
        ],
        associations: [
          {
            name: "Facility",
            type: "OneToMany",
          },
        ],
      },
    ];

    const association: Association = {
      name: "User",
      type: "OneToMany",
    };

    const entityName = "Customer";

    const expectedResult = null;

    const result = getInverseRelationship(entityName, association, entities);
    expect(result).toEqual(expectedResult);
  });

  test("returns null when association is a self-join", () => {
    const entities: Entity[] = [
      {
        name: "Customer",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "name",
            type: "text",
          },
        ],
        associations: [
          {
            name: "Customer",
            type: "OneToOne",
            reference_name: "parent",
          },
          {
            name: "Facility",
            type: "OneToMany",
          },
          {
            name: "Hopper",
            type: "OneToMany",
          },
        ],
      },
      {
        name: "User",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "cognito_id",
            type: "text",
            unique: true,
            nullable: true,
          },
        ],
        associations: [
          {
            name: "Facility",
            type: "OneToMany",
          },
        ],
      },
    ];

    const association: Association = {
      name: "Customer",
      type: "OneToOne",
      reference_name: "parent",
    };

    const entityName = "Customer";

    const expectedResult = null;

    const result = getInverseRelationship(entityName, association, entities);
    expect(result).toEqual(expectedResult);
  });
});
