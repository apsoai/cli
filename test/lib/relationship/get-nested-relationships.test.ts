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
      "workspaces.applications.workspace",
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
        "workspaceUsers.workspace.workspaceUsers",
        "workspaceUsers.workspace.applications",
        "workspaceUsers.workspace.applications.workspace",
        "workspaceUsers.workspace.applications.applicationServices",
        "workspaceUsers.workspace.applications.applicationServices.application",
        "workspaceUsers.workspace.applications.applicationServices.applicationServiceApiKeys",
        "workspaceUsers.workspace.applications.applicationServices.applicationServiceApiKeys.applicationService",
        "workspaceUsers.workspace.applications.applicationServices.applicationServiceMetrics",
        "workspaceUsers.workspace.applications.applicationServices.applicationServiceMetrics.applicationService",
        "workspaceUsers.workspace.applications.applicationServices.networkStack",
        "workspaceUsers.workspace.applications.applicationServices.networkStack.networkStack",
        "workspaceUsers.workspace.applications.applicationServices.databaseStack",
        "workspaceUsers.workspace.applications.applicationServices.databaseStack.networkStack",
        "workspaceUsers.workspace.applications.owner",
      ],
      Workspace: [
        "workspaceUsers.user",
        "workspaceUsers.user.workspaceUsers",
        "workspaceUsers.workspace",
        "applications.workspace",
        "applications.applicationServices",
        "applications.applicationServices.application",
        "applications.applicationServices.applicationServiceApiKeys",
        "applications.applicationServices.applicationServiceApiKeys.applicationService",
        "applications.applicationServices.applicationServiceMetrics",
        "applications.applicationServices.applicationServiceMetrics.applicationService",
        "applications.applicationServices.networkStack",
        "applications.applicationServices.networkStack.networkStack",
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
        "workspace.applications.workspace",
        "workspace.applications.applicationServices",
        "workspace.applications.applicationServices.application",
        "workspace.applications.applicationServices.applicationServiceApiKeys",
        "workspace.applications.applicationServices.applicationServiceApiKeys.applicationService",
        "workspace.applications.applicationServices.applicationServiceMetrics",
        "workspace.applications.applicationServices.applicationServiceMetrics.applicationService",
        "workspace.applications.applicationServices.networkStack",
        "workspace.applications.applicationServices.networkStack.networkStack",
        "workspace.applications.applicationServices.databaseStack",
        "workspace.applications.applicationServices.databaseStack.networkStack",
        "workspace.applications.owner",
        "workspace.applications.owner.workspaceUsers",
      ],
      Application: [
        "workspace.workspaceUsers",
        "workspace.workspaceUsers.user",
        "workspace.workspaceUsers.user.workspaceUsers",
        "workspace.workspaceUsers.workspace",
        "workspace.applications",
        "applicationServices.application",
        "applicationServices.applicationServiceApiKeys",
        "applicationServices.applicationServiceApiKeys.applicationService",
        "applicationServices.applicationServiceMetrics",
        "applicationServices.applicationServiceMetrics.applicationService",
        "applicationServices.networkStack",
        "applicationServices.networkStack.networkStack",
        "applicationServices.databaseStack",
        "applicationServices.databaseStack.networkStack",
        "owner.workspaceUsers",
        "owner.workspaceUsers.user",
        "owner.workspaceUsers.workspace",
        "owner.workspaceUsers.workspace.workspaceUsers",
        "owner.workspaceUsers.workspace.applications",
      ],
      ApplicationService: [
        "application.workspace",
        "application.workspace.workspaceUsers",
        "application.workspace.workspaceUsers.user",
        "application.workspace.workspaceUsers.user.workspaceUsers",
        "application.workspace.workspaceUsers.workspace",
        "application.workspace.applications",
        "application.applicationServices",
        "application.owner",
        "application.owner.workspaceUsers",
        "application.owner.workspaceUsers.user",
        "application.owner.workspaceUsers.workspace",
        "application.owner.workspaceUsers.workspace.workspaceUsers",
        "application.owner.workspaceUsers.workspace.applications",
        "applicationServiceApiKeys.applicationService",
        "applicationServiceMetrics.applicationService",
        "networkStack.networkStack",
        "databaseStack.networkStack",
      ],
      ApplicationServiceApiKey: [
        "applicationService.application",
        "applicationService.application.workspace",
        "applicationService.application.workspace.workspaceUsers",
        "applicationService.application.workspace.workspaceUsers.user",
        "applicationService.application.workspace.workspaceUsers.user.workspaceUsers",
        "applicationService.application.workspace.workspaceUsers.workspace",
        "applicationService.application.workspace.applications",
        "applicationService.application.applicationServices",
        "applicationService.application.owner",
        "applicationService.application.owner.workspaceUsers",
        "applicationService.application.owner.workspaceUsers.user",
        "applicationService.application.owner.workspaceUsers.workspace",
        "applicationService.application.owner.workspaceUsers.workspace.workspaceUsers",
        "applicationService.application.owner.workspaceUsers.workspace.applications",
        "applicationService.applicationServiceApiKeys",
        "applicationService.applicationServiceMetrics",
        "applicationService.applicationServiceMetrics.applicationService",
        "applicationService.networkStack",
        "applicationService.networkStack.networkStack",
        "applicationService.databaseStack",
        "applicationService.databaseStack.networkStack",
      ],
      ApplicationServiceMetric: [
        "applicationService.application",
        "applicationService.application.workspace",
        "applicationService.application.workspace.workspaceUsers",
        "applicationService.application.workspace.workspaceUsers.user",
        "applicationService.application.workspace.workspaceUsers.user.workspaceUsers",
        "applicationService.application.workspace.workspaceUsers.workspace",
        "applicationService.application.workspace.applications",
        "applicationService.application.applicationServices",
        "applicationService.application.owner",
        "applicationService.application.owner.workspaceUsers",
        "applicationService.application.owner.workspaceUsers.user",
        "applicationService.application.owner.workspaceUsers.workspace",
        "applicationService.application.owner.workspaceUsers.workspace.workspaceUsers",
        "applicationService.application.owner.workspaceUsers.workspace.applications",
        "applicationService.applicationServiceApiKeys",
        "applicationService.applicationServiceApiKeys.applicationService",
        "applicationService.applicationServiceMetrics",
        "applicationService.networkStack",
        "applicationService.networkStack.networkStack",
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
      "workspaces.applications.workspace",
      "workspaces.applications.owner",
      "workspaces.applications.deeperEntities",
      "workspaces.applications.deeperEntities.application",
      "workspaces.applications.deeperEntities.deepy",
      "workspaces.applications.deeperEntities.deepy.doop",
      "workspaces.applications.deeperEntities.derpy",
      "workspaces.applications.deeperEntities.derpy.doop",
    ];

    expect(nestedRelationships).toEqual(expectedNestedRelationships);
  });
});
