/* eslint-disable  camelcase */
import { expect } from "@jest/globals";
import { ApsorcRelationship, Relationship } from "../../../src/lib/types";
import {
  parseOneToMany,
  parseManytoOne,
  parseManyToMany,
  parseOneToOne,
  parseRelationships,
} from "../../../src/lib/utils/relationships/parse";

describe("test parseRelationships", () => {
  test("relationships are parsed", () => {
    const relationships: ApsorcRelationship[] = [
      { from: "User", to: "WorkspaceUser", type: "OneToMany", nullable: true },
      { from: "Workspace", to: "WorkspaceUser", type: "OneToMany" },
      { from: "Workspace", to: "Application", type: "OneToMany" },
      { from: "Application", to: "ApplicationService", type: "OneToMany" },
      { from: "Application", to: "User", type: "ManyToOne", to_name: "owner" },
      {
        from: "ApplicationService",
        to: "ApplicationServiceApiKey",
        type: "OneToMany",
      },
      {
        from: "ApplicationService",
        to: "ApplicationServiceMetric",
        type: "OneToMany",
      },
      {
        from: "ApplicationService",
        to: "InfrastructureStack",
        type: "ManyToOne",
        to_name: "networkStack",
        nullable: true,
      },
      {
        from: "ApplicationService",
        to: "InfrastructureStack",
        type: "ManyToOne",
        to_name: "databaseStack",
        nullable: true,
      },
      {
        from: "InfrastructureStack",
        to: "InfrastructureStack",
        type: "ManyToOne",
        to_name: "networkStack",
        nullable: true,
      },
    ];

    const expectedParsedRelationships = {
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

    const resultParsedRelationships = parseRelationships(relationships);
    expect(resultParsedRelationships).toEqual(expectedParsedRelationships);
  });
});

describe("test parseOneToMany", () => {
  test("OneToMany returns both relationships", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "WorkspaceUser",
      type: "OneToMany",
      nullable: true,
    };
    const expectedResult = {
      User: [{ name: "WorkspaceUser", type: "OneToMany", biDirectional: true }],
      WorkspaceUser: [
        {
          name: "User",
          type: "ManyToOne",
          nullable: true,
          biDirectional: true,
        },
      ],
    };
    const result = parseOneToMany(relationship);
    expect(result).toEqual(expectedResult);
  });
});

describe("test parseManyToOne", () => {
  test("ManyToOne returns one relationship", () => {
    const relationship: ApsorcRelationship = {
      from: "ApplicationService",
      to: "InfrastructureStack",
      type: "ManyToOne",
      to_name: "networkStack",
      nullable: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      ApplicationService: [
        {
          name: "InfrastructureStack",
          type: "ManyToOne",
          nullable: true,
          referenceName: "networkStack",
        },
      ],
    };
    const result = parseManytoOne(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("ManyToOne self-join returns relationship", () => {
    const relationship: ApsorcRelationship = {
      from: "InfrastructureStack",
      to: "InfrastructureStack",
      type: "ManyToOne",
      to_name: "networkStack",
      nullable: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      InfrastructureStack: [
        {
          name: "InfrastructureStack",
          type: "ManyToOne",
          nullable: true,
          referenceName: "networkStack",
        },
      ],
    };

    const result = parseManytoOne(relationship);
    expect(result).toEqual(expectedResult);
  });
});

describe("test parseManyToMany", () => {
  test("ManyToMany without bi_directional returns one relationship", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "ManyToMany",
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        {
          name: "Account",
          type: "ManyToMany",
          join: true,
          biDirectional: false,
        },
      ],
    };
    const result = parseManyToMany(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("ManyToMany with bi_directional returns both relationships", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "ManyToMany",
      bi_directional: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        {
          name: "Account",
          type: "ManyToMany",
          join: true,
          biDirectional: true,
        },
      ],
      Account: [{ name: "User", type: "ManyToMany", biDirectional: true }],
    };
    const result = parseManyToMany(relationship);
    expect(result).toEqual(expectedResult);
  });
});

describe("test parseOneToOne", () => {
  test("OneToOne returns both relationships", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "OneToOne",
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        { name: "Account", type: "OneToOne", join: true, nullable: false },
      ],
      Account: [{ name: "User", type: "OneToOne" }],
    };
    const result = parseOneToOne(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("OneToOne returns both relationships with nullable", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "OneToOne",
      nullable: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [{ name: "Account", type: "OneToOne", join: true, nullable: true }],
      Account: [{ name: "User", type: "OneToOne" }],
    };
    const result = parseOneToOne(relationship);
    expect(result).toEqual(expectedResult);
  });
});
