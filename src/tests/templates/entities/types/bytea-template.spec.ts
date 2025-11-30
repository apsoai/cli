import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Bytea Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-bytea";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic bytea field correctly",
      field: {
        name: "binaryData",
        dataType: "Buffer",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bytea"' },
        { type: "contains", text: "binaryData: Buffer;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable bytea field correctly",
      field: {
        name: "optionalData",
        dataType: "Buffer",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bytea"' },
        { type: "contains", text: "optionalData: Buffer;" },
      ],
    },
    {
      name: "should render indexed bytea field correctly",
      field: {
        name: "indexedData",
        dataType: "Buffer",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bytea"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedData: Buffer;" },
      ],
    },
    {
      name: "should render primary key bytea field correctly",
      field: {
        name: "id",
        dataType: "Buffer",
        nullable: false,
        primary: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "bytea"' },
        { type: "contains", text: "@PrimaryColumn()" },
        { type: "contains", text: "id: Buffer;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
