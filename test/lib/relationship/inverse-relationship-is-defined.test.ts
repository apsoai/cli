/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { Association, Entity } from "../../../src/lib/types";
import { isInverseRelationshipDefined } from "../../../src/lib/utils/relationships/parse-v1";

describe("test isInverseRelationshipDefined", () => {
  test("test inverse relationship for many to one is not defined", () => {
    const entityName = "Application";
    const association: Association = {
      name: "User",
      type: "ManyToOne",
      reference_name: "owner",
    };
    const entities: Entity[] = [
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
            name: "firstName",
            type: "text",
          },
          {
            name: "lastName",
            type: "text",
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
        associations: [
          {
            name: "Application",
            type: "OneToMany",
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
        associations: [
          {
            name: "Workspace",
            type: "ManyToOne",
          },
          {
            name: "ApplicationService",
            type: "OneToMany",
          },
          {
            name: "User",
            type: "ManyToOne",
            reference_name: "owner",
          },
        ],
      },
    ];

    const inverseRelationshipIsDefined = isInverseRelationshipDefined(
      entityName,
      association,
      entities
    );

    expect(inverseRelationshipIsDefined).toBe(false);
  });

  test("test inverse relationship for many to one is defined", () => {
    const entityName = "Application";
    const association: Association = {
      name: "User",
      type: "ManyToOne",
      reference_name: "owner",
    };
    const entities: Entity[] = [
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
            name: "firstName",
            type: "text",
          },
          {
            name: "lastName",
            type: "text",
          },
        ],
        associations: [
          {
            name: "Application",
            type: "OneToMany",
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
        associations: [
          {
            name: "Application",
            type: "OneToMany",
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
        associations: [
          {
            name: "Workspace",
            type: "ManyToOne",
          },
          {
            name: "ApplicationService",
            type: "OneToMany",
          },
          {
            name: "User",
            type: "ManyToOne",
            reference_name: "owner",
          },
        ],
      },
    ];

    const inverseRelationshipIsDefined = isInverseRelationshipDefined(
      entityName,
      association,
      entities
    );

    expect(inverseRelationshipIsDefined).toBe(true);
  });

  test("test inverse relationship for many to one for self join is false", () => {
    const entityName = "InfrastructureStack";
    const association: Association = {
      name: "InfrastructureStack",
      type: "ManyToOne",
      reference_name: "networkStack",
      nullable: true,
    };

    const entities: Entity[] = [
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
        associations: [
          {
            name: "WorkspaceUser",
            type: "OneToMany",
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
        associations: [
          {
            name: "WorkspaceUser",
            type: "OneToMany",
          },
          {
            name: "Application",
            type: "OneToMany",
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
            values: ["Active", "Invited", "Inactive"],
          },
          {
            name: "activeAt",
            type: "date",
            nullable: true,
          },
        ],
        associations: [
          {
            name: "Workspace",
            type: "ManyToOne",
          },
          {
            name: "User",
            type: "ManyToOne",
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
        associations: [
          {
            name: "Workspace",
            type: "ManyToOne",
          },
          {
            name: "ApplicationService",
            type: "OneToMany",
          },
          {
            name: "User",
            type: "ManyToOne",
            reference_name: "owner",
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
        ],
        associations: [
          {
            name: "Application",
            type: "ManyToOne",
          },
          {
            name: "ApplicationServiceApiKey",
            type: "OneToMany",
          },
          {
            name: "ApplicationServiceMetric",
            type: "OneToMany",
          },
          {
            name: "InfrastructureStack",
            type: "ManyToOne",
            reference_name: "networkStack",
            nullable: true,
          },
          {
            name: "InfrastructureStack",
            type: "ManyToOne",
            reference_name: "databaseStack",
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
        associations: [
          {
            name: "ApplicationService",
            type: "ManyToOne",
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
        associations: [
          {
            name: "ApplicationService",
            type: "ManyToOne",
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
        associations: [
          {
            name: "InfrastructureStack",
            type: "ManyToOne",
            reference_name: "networkStack",
            nullable: true,
          },
        ],
      },
    ];

    const inverseRelationshipIsDefined = isInverseRelationshipDefined(
      entityName,
      association,
      entities
    );

    expect(inverseRelationshipIsDefined).toBe(false);
  });
});
