import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Geometry Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-geometry";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic geometry field correctly",
      field: {
        name: "shape",
        dataType: "any",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: "@Column({" },
        { type: "contains", text: '"type": "geometry"' },
        { type: "contains", text: "transformer: {" },
        { type: "contains", text: "to: (geometry: any) => {" },
        { type: "contains", text: "from: (pgGeometry: any) => {" },
        { type: "contains", text: "shape: any;" },
        { type: "notContains", text: "nullable: true" },
      ],
    },
    {
      name: "should render nullable geometry field correctly",
      field: {
        name: "optionalShape",
        dataType: "any",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: "@Column({" },
        { type: "contains", text: '"type": "geometry"' },
        { type: "contains", text: "nullable: true" },
        { type: "contains", text: "optionalShape: any;" },
      ],
    },
    {
      name: "should render indexed geometry field correctly",
      field: {
        name: "spatialData",
        dataType: "any",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "spatialData: any;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
