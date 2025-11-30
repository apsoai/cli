import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("BigInt Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-bigint";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic bigint field correctly",
      field: {
        name: "largeCounter",
        dataType: "number",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bigint"' },
        { type: "contains", text: "largeCounter: string;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable bigint field correctly",
      field: {
        name: "optionalCounter",
        dataType: "number",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bigint"' },
        { type: "contains", text: "optionalCounter: string;" },
      ],
    },
    {
      name: "should render bigint field with default value correctly",
      field: {
        name: "defaultCounter",
        dataType: "number",
        nullable: false,
        default: 0,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bigint"' },
        { type: "contains", text: "default:  0" },
        { type: "contains", text: "defaultCounter: string;" },
      ],
    },
    {
      name: "should render indexed bigint field correctly",
      field: {
        name: "indexedCounter",
        dataType: "number",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bigint"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedCounter: string;" },
      ],
    },
    {
      name: "should render primary key bigint field correctly",
      field: {
        name: "id",
        dataType: "number",
        nullable: false,
        primary: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bigint"' },
        { type: "contains", text: "@PrimaryColumn()" },
        { type: "contains", text: "id: string;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
