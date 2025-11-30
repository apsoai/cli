import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Double Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-double";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic double field correctly",
      field: {
        name: "doubleValue",
        dataType: "number",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "float8"' },
        { type: "contains", text: "doubleValue: number;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable double field correctly",
      field: {
        name: "optionalDouble",
        dataType: "number",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "float8"' },
        { type: "contains", text: "optionalDouble: number;" },
      ],
    },
    {
      name: "should render double field with default value correctly",
      field: {
        name: "defaultDouble",
        dataType: "number",
        nullable: false,
        default: 0,
      },
      assertions: [
        {
          type: "contains",
          text: '@Column({ "type": "float8", default:  0 })',
        },
        { type: "contains", text: "defaultDouble: number;" },
      ],
    },
    {
      name: "should render indexed double field correctly",
      field: {
        name: "indexedDouble",
        dataType: "number",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "float8"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedDouble: number;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
