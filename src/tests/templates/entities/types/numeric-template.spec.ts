import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Numeric Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-numeric";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic numeric field correctly",
      field: {
        name: "numericValue",
        dataType: "number",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "numeric"' },
        { type: "contains", text: "numericValue: number;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable numeric field correctly",
      field: {
        name: "optionalValue",
        dataType: "number",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "numeric"' },
        { type: "contains", text: "optionalValue: number;" },
      ],
    },
    {
      name: "should render numeric field with precision and scale correctly",
      field: {
        name: "preciseValue",
        dataType: "number",
        nullable: false,
        precision: 12,
        scale: 4,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "numeric"' },
        { type: "contains", text: "precision: 12" },
        { type: "contains", text: "scale: 4" },
        { type: "contains", text: "preciseValue: number;" },
      ],
    },
    {
      name: "should render numeric field with default value correctly",
      field: {
        name: "defaultValue",
        dataType: "number",
        nullable: false,
        default: 0,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "numeric"' },
        { type: "contains", text: "default:  0" },
        { type: "contains", text: "defaultValue: number;" },
      ],
    },
    {
      name: "should render indexed numeric field correctly",
      field: {
        name: "indexedValue",
        dataType: "number",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "numeric"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedValue: number;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
