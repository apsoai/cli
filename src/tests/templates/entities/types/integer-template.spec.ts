import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Integer Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-integer";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic integer field correctly",
      field: {
        name: "count",
        dataType: "number",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "int"' },
        { type: "contains", text: "count: number;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable integer field correctly",
      field: {
        name: "optionalCount",
        dataType: "number",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "int"' },
        { type: "contains", text: "optionalCount: number;" },
      ],
    },
    {
      name: "should render integer field with default value correctly",
      field: {
        name: "quantity",
        dataType: "number",
        nullable: false,
        default: 0,
      },
      assertions: [
        { type: "contains", text: "default:  0" },
        { type: "contains", text: "quantity: number;" },
      ],
    },
    {
      name: "should render indexed integer field correctly",
      field: {
        name: "userId",
        dataType: "number",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "userId: number;" },
      ],
    },
    {
      name: "should render primary key integer field correctly",
      field: {
        name: "id",
        dataType: "number",
        nullable: false,
        primary: true,
      },
      assertions: [
        { type: "contains", text: "@PrimaryColumn()" },
        { type: "contains", text: "id: number;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
