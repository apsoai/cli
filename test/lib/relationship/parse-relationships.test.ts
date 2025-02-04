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
          index: false,
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
          index: false,
        },
      ],
    };
    const result = parseOneToMany(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("OneToMany with cascadeDelete returns both relationships with cascadeDelete", () => {
    const relationship: ApsorcRelationship = {
      from: "BinLoad",
      to: "HopperLoad",
      type: "OneToMany",
      cascadeDelete: true,
    };
    const expectedResult = {
      BinLoad: [{ 
        name: "HopperLoad", 
        type: "OneToMany", 
        biDirectional: true,
        cascadeDelete: true 
      }],
      HopperLoad: [
        {
          name: "BinLoad",
          type: "ManyToOne",
          nullable: false,
          biDirectional: true,
          index: false,
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
          index: false,
        },
      ],
    };
    const result = parseManytoOne(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("ManyToOne returns one relationship with index", () => {
    const relationship: ApsorcRelationship = {
      from: "ApplicationService",
      to: "InfrastructureStack",
      type: "ManyToOne",
      to_name: "networkStack",
      nullable: true,
      index: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      ApplicationService: [
        {
          name: "InfrastructureStack",
          type: "ManyToOne",
          nullable: true,
          referenceName: "networkStack",
          index: true,
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
          index: false,
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
          referenceName: null,
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
          referenceName: null,
          join: true,
          biDirectional: true,
        },
      ],
      Account: [{ name: "User", type: "ManyToMany", biDirectional: true }],
    };
    const result = parseManyToMany(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("test ManyToMany with to_name, returns reference name", () => {
    const relationship: ApsorcRelationship = {
      from: "FacilityBin",
      to: "User",
      type: "ManyToMany",
      to_name: "NotifyUser",
      bi_directional: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      FacilityBin: [
        {
          name: "User",
          type: "ManyToMany",
          referenceName: "NotifyUser",
          join: true,
          biDirectional: true,
        },
      ],
      User: [{ name: "FacilityBin", type: "ManyToMany", biDirectional: true }],
    };
    const result = parseManyToMany(relationship);
    expect(result).toEqual(expectedResult);
  });
});

describe("test parseOneToOne", () => {
  test("OneToOne returns one relationship if bidirectional", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "OneToOne",
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        {
          name: "Account",
          type: "OneToOne",
          join: true,
          nullable: false,
          biDirectional: false,
          referenceName: null,
        },
      ],
    };
    const result = parseOneToOne(relationship);
    expect(result).toEqual(expectedResult);
  });

  test("OneToOne returns both relationships if bi-directional", () => {
    const relationship: ApsorcRelationship = {
      from: "User",
      to: "Account",
      type: "OneToOne",
      to_name: "AccountOwner",
      bi_directional: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        {
          name: "Account",
          type: "OneToOne",
          join: true,
          nullable: false,
          biDirectional: true,
          referenceName: "AccountOwner",
        },
      ],
      Account: [{ name: "User", type: "OneToOne", biDirectional: true }],
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
      bi_directional: true,
    };
    const expectedResult: { [key: string]: Relationship[] } = {
      User: [
        {
          name: "Account",
          type: "OneToOne",
          join: true,
          nullable: true,
          biDirectional: true,
          referenceName: null,
        },
      ],
      Account: [{ name: "User", type: "OneToOne", biDirectional: true }],
    };
    const result = parseOneToOne(relationship);
    expect(result).toEqual(expectedResult);
  });
});
