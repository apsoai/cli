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
        "workspaceUsers.workspace",
        "workspaceUsers.workspace.applications",
        "workspaceUsers.workspace.applications.applicationServices",
        // Beyond max depth of 4, we don't include these
        // "workspaceUsers.workspace.applications.applicationServices.applicationServiceApiKeys",
        // "workspaceUsers.workspace.applications.applicationServices.applicationServiceMetrics",
        // "workspaceUsers.workspace.applications.applicationServices.networkStack",
        // "workspaceUsers.workspace.applications.applicationServices.databaseStack",
        // "workspaceUsers.workspace.applications.applicationServices.databaseStack.networkStack",
        "workspaceUsers.workspace.applications.owner",

      ],
      Workspace: [
           "workspaceUsers.user",
           "applications.applicationServices",
           "applications.applicationServices.applicationServiceApiKeys",
           "applications.applicationServices.applicationServiceMetrics",
           "applications.applicationServices.networkStack",
           "applications.applicationServices.databaseStack",
           "applications.applicationServices.databaseStack.networkStack",
           "applications.owner",
           "applications.owner.workspaceUsers",
          "applications.owner.workspaceUsers.user"
      ],
    };

    entities.forEach((entity: Entity) => {
      const { name: entityName } = entity;
      const expectedNestedRelationship =
        entityToNestedRelationshipnMap[
          entityName as keyof typeof entityToNestedRelationshipnMap
        ];

      if (!expectedNestedRelationship) {
        return;
      }

      const nestedRelationships = getNestedRelationships(
        entityName,
        relationshipMap
      );

      console.log(entityName, JSON.stringify(nestedRelationships, null, 2));

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
      "workspaces.applications",
      "workspaces.applications.owner",
      "workspaces.applications.deeperEntities",
      "workspaces.applications.deeperEntities.deepy",
      "workspaces.applications.deeperEntities.derpy",
    ];

    expect(nestedRelationships).toEqual(expectedNestedRelationships);
  });
});

describe("getNestedRelationships requirements", () => {
  test("No cycles on the same (entity, property) pair", () => {
    const map: RelationshipMap = {
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
        }
      ],
    };
    const result = getNestedRelationships("User", map);
    expect(result).toEqual([
      "workspaces.applications",
      "workspaces.applications.owner",
    ]); // Only one join allowed, no cycles
  });

  test("No cycles on the same entity in the same path", () => {
    const map: RelationshipMap = {
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
        }
      ],
    };
    const result = getNestedRelationships("User", map);
    expect(result).toEqual([
      "workspaces.applications",
      "workspaces.applications.owner",
    ]); // Both allowed, but not owner.owner or assignee.owner
  });

  test("Allow different aliases to the same entity in different branches", () => {
    const map: RelationshipMap = {
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
        }
      ],
    };
    const result = getNestedRelationships("User", map);
    expect(result).toEqual([
      "workspaces.applications",
      "workspaces.applications.owner",
    ]);
  });

  test("Never return to the base entity", () => {
    const map: RelationshipMap = {
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
        }
      ],
    };
    const result = getNestedRelationships("User", map);
    expect(result).not.toContain("workspaces.users");
  });

  // test("Allow nested joins to other entities", () => {
  //   const map: RelationshipMap = {
  //     User: [
  //       { type: "ManyToMany", name: "Workspace" },
  //     ],
  //     Workspace: [
  //       { type: "OneToMany", name: "Application" },
  //     ],
  //   };
  //   const result = getNestedRelationships("User", map);
  //   expect(result).toContain("workspaces.applications");
  // });

  // test("Respect aliases (to_name/referenceName)", () => {
  //   const map: RelationshipMap = {
  //     Application: [
  //       { type: "ManyToOne", name: "User", referenceName: "owner" },
  //       { type: "ManyToOne", name: "User", referenceName: "assignee" },
  //     ],
  //   };
  //   const result = getNestedRelationships("Application", map);
  //   expect(result.sort()).toEqual(["owner", "assignee"].sort());
  // });

  // test("No redundant paths", () => {
  //   const map: RelationshipMap = {
  //     User: [
  //       { type: "ManyToOne", name: "User", referenceName: "owner" },
  //     ],
  //   };
  //   const result = getNestedRelationships("User", map);
  //   expect(result).toEqual(["owner"]); // No owner.owner
  // });
});
