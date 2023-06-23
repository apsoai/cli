import { expect } from "@jest/globals";
import { Entity } from "../../../../src/lib/types/entity";
import {
  Association,
  isInverseRelationshipDefined,
} from "../../../../src/lib/types/relationship";

describe("test isInverseRelationshipDefined", () => {
  test("test inverse relationship for many to many is not defined", () => {
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

  test("test inverse relationship for many to many is defined", () => {
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
            "name": "Application",
            "type": "OneToMany"
          }
        ]
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
});
