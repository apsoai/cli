import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Serial Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  describe("serial", () => {
    const templatePath = "./entities/entity-col-serial";

    const testCases: TemplateTestCase[] = [
      {
        name: "should render basic serial field correctly",
        field: {
          name: "id",
          dataType: "number",
          nullable: false,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "int" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "id: number;" },
          { type: "notContains", text: "default:" },
        ],
      },
      {
        name: "should render indexed serial field correctly",
        field: {
          name: "recordId",
          dataType: "number",
          nullable: false,
          index: true,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "int" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "@Index()" },
          { type: "contains", text: "recordId: number;" },
        ],
      },
      {
        name: "should render primary key serial field correctly",
        field: {
          name: "id",
          dataType: "number",
          nullable: false,
          primary: true,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "int" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "@PrimaryColumn()" },
          { type: "contains", text: "id: number;" },
        ],
      },
    ];

    runTemplateTests(templatePath, testCases);
  });

  describe("bigserial", () => {
    const templatePath = "./entities/entity-col-bigserial";

    const testCases: TemplateTestCase[] = [
      {
        name: "should render basic bigserial field correctly",
        field: {
          name: "id",
          dataType: "string",
          nullable: false,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "bigint" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "id: string;" },
        ],
      },
      {
        name: "should render primary key bigserial field correctly",
        field: {
          name: "id",
          dataType: "string",
          nullable: false,
          primary: true,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "bigint" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "@PrimaryColumn()" },
          { type: "contains", text: "id: string;" },
        ],
      },
    ];

    runTemplateTests(templatePath, testCases);
  });

  describe("smallserial", () => {
    const templatePath = "./entities/entity-col-smallserial";

    const testCases: TemplateTestCase[] = [
      {
        name: "should render basic smallserial field correctly",
        field: {
          name: "id",
          dataType: "number",
          nullable: false,
        },
        assertions: [
          { type: "contains", text: '@Column({ "type": "smallint" })' },
          { type: "contains", text: '@Generated("increment")' },
          { type: "contains", text: "id: number;" },
        ],
      },
    ];

    runTemplateTests(templatePath, testCases);
  });
});
