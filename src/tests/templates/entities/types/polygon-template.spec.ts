import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Polygon Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-polygon";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic polygon field correctly",
      field: {
        name: "boundary",
        dataType: "{ coordinates: Array<Array<{ x: number, y: number }>> }",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: "@Column({" },
        { type: "contains", text: '"type": "polygon"' },
        { type: "contains", text: "transformer: {" },
        {
          type: "contains",
          text: "to: (polygon: { coordinates: Array<Array<{x: number, y: number}>> } | null) => {",
        },
        { type: "contains", text: "from: (pgPolygon: string | null) => {" },
        {
          type: "contains",
          text: "boundary: { coordinates: Array<Array<{ x: number, y: number }>> };",
        },
        { type: "notContains", text: "nullable: true" },
      ],
    },
    {
      name: "should render nullable polygon field correctly",
      field: {
        name: "optionalBoundary",
        dataType: "{ coordinates: Array<Array<{ x: number, y: number }>> }",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: "@Column({" },
        { type: "contains", text: '"type": "polygon"' },
        { type: "contains", text: "nullable: true" },
        {
          type: "contains",
          text: "optionalBoundary: { coordinates: Array<Array<{ x: number, y: number }>> };",
        },
      ],
    },
    {
      name: "should render indexed polygon field correctly",
      field: {
        name: "area",
        dataType: "{ coordinates: Array<Array<{ x: number, y: number }>> }",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: "@Index()" },
        {
          type: "contains",
          text: "area: { coordinates: Array<Array<{ x: number, y: number }>> };",
        },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
