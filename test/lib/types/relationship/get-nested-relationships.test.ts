/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { Entity } from "../../../../src/lib/types/entity";
import {
  getNestedRelationships,
  Association,
} from "../../../../src/lib/types/relationship";

describe("test getNestedRelationships", () => {
  test("basic test case", () => {
    const entityName = "User";
    const entities: Entity[] = [
      {
        name: "User",
        created_at: true,
        updated_at: true,
        fields: [
          {
            name: "email",
            type: "text",
            length: 255,
            is_email: true,
          },
        ],
        associations: [
          {
            name: "Workspace",
            type: "ManyToMany",
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
          {
            name: "User",
            type: "ManyToMany",
            join_table: true,
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
            name: "User",
            type: "ManyToOne",
            reference_name: "owner",
          },
        ],
      },
    ];
    const associations: Association[] = [
      {
        name: "Workspace",
        type: "ManyToMany",
      },
    ];

    const nestedRelationships = getNestedRelationships(
      entityName,
      entities,
      associations
    );
    const expectedNestedRelationships = ["workspaces.applications"];

    expect(nestedRelationships).toEqual(expectedNestedRelationships);
  });

  test("full case", () => {
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
            name: "infrastructure_details",
            type: "json",
            nullable: true,
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
            name: "vpc_id",
            type: "text",
            nullable: true,
          },
          {
            name: "db_credentials_secret_arn",
            type: "text",
            nullable: true,
          },
          {
            name: "code_commit_url",
            type: "text",
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
          },
          {
            name: "InfrastructureStack",
            type: "ManyToOne",
            reference_name: "databaseStack",
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
            values: ["network", "db"],
          },
          {
            name: "status",
            type: "enum",
            values: ["new", "creating", "created", "destroyed"],
          },
          {
            name: "details",
            type: "json",
            nullable: true,
          },
        ],
      },
    ];

    const entityToNestedRelationshipnMap = {
      User: ["workspaceUsers.workspace"],
      Workspace: [
        "workspaceUsers.user",
        "applications.applicationServices",
        "applications.owner",
      ],
      WorkspaceUser: ["workspace.applications"],
      Application: [
        "workspace.workspaceUsers",
        "applicationServices.applicationServiceApiKeys",
        "applicationServices.applicationServiceMetrics",
        "applicationServices.networkStack",
        "applicationServices.databaseStack",
        "owner.workspaceUsers",
      ],
      ApplicationService: ["application.workspace", "application.owner"],
      ApplicationServiceApiKey: [
        "applicationService.application",
        "applicationService.applicationServiceMetrics",
        "applicationService.networkStack",
        "applicationService.databaseStack",
      ],
      ApplicationServiceMetric: [
        "applicationService.application",
        "applicationService.applicationServiceApiKeys",
        "applicationService.networkStack",
        "applicationService.databaseStack",
      ],
    };

    entities.forEach((entity: Entity) => {
      const { name, associations = [] } = entity;
      const expectedNestedRelationship =
        entityToNestedRelationshipnMap[
          name as keyof typeof entityToNestedRelationshipnMap
        ] || [];

      const nestedRelationships = getNestedRelationships(
        name,
        entities,
        associations
      );
      expect(nestedRelationships).toEqual(expectedNestedRelationship);
    });
  });
});
