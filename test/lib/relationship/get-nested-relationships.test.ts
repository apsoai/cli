/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { Entity, RelationshipMap } from "../../../src/lib/types";
import { getNestedRelationships } from "../../../src/lib/utils/relationships";

describe("test getNestedRelationships", () => {
  test("basic test case", () => {
    const entityName = "User";
    const relationshipMap: RelationshipMap = {
      User: [
        {
          type: "ManyToMany",
          name: "Workspace",
        },
      ],
      Workspace: [
        {
          type: "ManyToMany",
          name: "User",
          join: true,
        },
        {
          type: "OneToMany",
          name: "Application",
        },
      ],
      Application: [
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
        },
        {
          type: "ManyToOne",
          name: "User",
          referenceName: "owner",
          nullable: false,
        },
      ],
    };

    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );
    const expectedNestedRelationships = [
      "workspaces.users",
      "workspaces.applications",
      "workspaces.applications.owner",
    ];

    expect(nestedRelationships).toEqual(expectedNestedRelationships);
  });

  test("full case", () => {
    const relationshipMap: RelationshipMap = {
      User: [
        {
          type: "OneToMany",
          name: "WorkspaceUser",
        },
      ],
      WorkspaceUser: [
        {
          type: "ManyToOne",
          name: "User",
          nullable: true,
        },
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
        },
      ],
      Workspace: [
        {
          type: "OneToMany",
          name: "WorkspaceUser",
        },
        {
          type: "OneToMany",
          name: "Application",
        },
      ],
      Application: [
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
        },
        {
          type: "OneToMany",
          name: "ApplicationService",
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
        },
        {
          type: "OneToMany",
          name: "ApplicationServiceApiKey",
        },
        {
          type: "OneToMany",
          name: "ApplicationServiceMetric",
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
        },
      ],
      ApplicationServiceMetric: [
        {
          type: "ManyToOne",
          name: "ApplicationService",
          nullable: false,
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
      User: [
        "workspaceUsers.user",
        "workspaceUsers.workspace",
        "workspaceUsers.workspace.applications",
        "workspaceUsers.workspace.applications.applicationServices",
        "workspaceUsers.workspace.applications.owner",
      ],
      Workspace: [
        "workspaceUsers.user",
        "workspaceUsers.workspace",
        "applications.workspace",
        "applications.applicationServices",
        "applications.applicationServices.applicationServiceApiKeys",
        "applications.applicationServices.applicationServiceMetrics",
        "applications.applicationServices.networkStack",
        "applications.applicationServices.databaseStack",
        "applications.applicationServices.databaseStack.networkStack",
        "applications.owner",
        "applications.owner.workspaceUsers",
        "applications.owner.workspaceUsers.user",
        "applications.owner.workspaceUsers.workspace",
      ],
      WorkspaceUser: [
        "user.workspaceUsers",
        "workspace.workspaceUsers",
        "workspace.applications",
        "workspace.applications.applicationServices",
        "workspace.applications.applicationServices.applicationServiceApiKeys",
        "workspace.applications.applicationServices.applicationServiceMetrics",
        "workspace.applications.applicationServices.networkStack",
        "workspace.applications.applicationServices.databaseStack",
        "workspace.applications.owner",
        "workspace.applications.owner.workspaceUsers",
      ],
      Application: [
        "workspace.workspaceUsers",
        "workspace.workspaceUsers.user",
        "workspace.applications",
        "applicationServices.application",
        "applicationServices.applicationServiceApiKeys",
        "applicationServices.applicationServiceMetrics",
        "applicationServices.networkStack",
        "applicationServices.databaseStack",
        "applicationServices.databaseStack.networkStack",
        "owner.workspaceUsers",
        "owner.workspaceUsers.user",
        "owner.workspaceUsers.workspace",
        "owner.workspaceUsers.workspace.applications",
      ],
      ApplicationService: [
        "application.workspace",
        "application.workspace.workspaceUsers",
        "application.workspace.workspaceUsers.user",
        "application.applicationServices",
        "application.owner",
        "application.owner.workspaceUsers",
        "application.owner.workspaceUsers.user",
        "application.owner.workspaceUsers.workspace",
        "applicationServiceApiKeys.applicationService",
        "applicationServiceMetrics.applicationService",
        "databaseStack.networkStack",
      ],
      ApplicationServiceApiKey: [
        "applicationService.application",
        "applicationService.application.workspace",
        "applicationService.application.workspace.workspaceUsers",
        "applicationService.application.owner",
        "applicationService.application.owner.workspaceUsers",
        "applicationService.applicationServiceApiKeys",
        "applicationService.applicationServiceMetrics",
        "applicationService.networkStack",
        "applicationService.databaseStack",
        "applicationService.databaseStack.networkStack",
      ],
      ApplicationServiceMetric: [
        "applicationService.application",
        "applicationService.application.workspace",
        "applicationService.application.workspace.workspaceUsers",
        "applicationService.application.owner",
        "applicationService.application.owner.workspaceUsers",
        "applicationService.applicationServiceApiKeys",
        "applicationService.applicationServiceMetrics",
        "applicationService.networkStack",
        "applicationService.databaseStack",
        "applicationService.databaseStack.networkStack",
      ],
    };

    entities.forEach((entity: Entity) => {
      const { name: entityName } = entity;
      const expectedNestedRelationship =
        entityToNestedRelationshipnMap[
          entityName as keyof typeof entityToNestedRelationshipnMap
        ] || [];

      const nestedRelationships = getNestedRelationships(
        entityName,
        relationshipMap
      );
      expect(nestedRelationships).toEqual(expectedNestedRelationship);
    });
  });

  test("basic test case - deep", () => {
    const entityName = "User";
    const relationshipMap: RelationshipMap = {
      User: [
        {
          type: "ManyToMany",
          name: "Workspace",
        },
      ],
      Workspace: [
        {
          type: "ManyToMany",
          name: "User",
          join: true,
        },
        {
          type: "OneToMany",
          name: "Application",
        },
      ],
      DeeperEntity: [
        {
          type: "ManyToOne",
          name: "Application",
          nullable: false,
        },
        {
          type: "ManyToOne",
          name: "EvenDeeperEntity",
          referenceName: "deepy",
        },
        {
          type: "ManyToOne",
          name: "EvenDeeperEntity",
          referenceName: "derpy",
        },
      ],
      EvenDeeperEntity: [
        {
          type: "ManyToOne",
          name: "EvenDeeperEntity",
          referenceName: "doop",
          nullable: false,
        },
      ],
      Application: [
        {
          type: "ManyToOne",
          name: "Workspace",
          nullable: false,
        },
        {
          type: "ManyToOne",
          name: "User",
          referenceName: "owner",
          nullable: false,
        },
        {
          type: "OneToMany",
          name: "DeeperEntity",
        },
      ],
    };

    const nestedRelationships = getNestedRelationships(
      entityName,
      relationshipMap
    );
    const expectedNestedRelationships = [
      "workspaces.users",
      "workspaces.applications",
      "workspaces.applications.owner",
      "workspaces.applications.deeperEntities",
      "workspaces.applications.deeperEntities.deepy",
      "workspaces.applications.deeperEntities.derpy",
    ];

    expect(nestedRelationships).toEqual(expectedNestedRelationships);
  });
});
