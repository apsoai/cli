import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("UUID Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-uuid";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic uuid field correctly",
      field: {
        name: "id",
        dataType: "string",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "uuid"' },
        { type: "contains", text: "id: string;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable uuid field correctly",
      field: {
        name: "optionalId",
        dataType: "string",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "uuid"' },
        { type: "contains", text: "optionalId: string;" },
      ],
    },
    {
      name: "should render uuid field with default value correctly",
      field: {
        name: "defaultId",
        dataType: "string",
        nullable: false,
        default: "uuid_generate_v4()",
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "uuid"' },
        { type: "contains", text: "default:  uuid_generate_v4()" },
        { type: "contains", text: "defaultId: string;" },
      ],
    },
    {
      name: "should render indexed uuid field correctly",
      field: {
        name: "indexedId",
        dataType: "string",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "uuid"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedId: string;" },
      ],
    },
    {
      name: "should render primary key uuid field correctly",
      field: {
        name: "primaryId",
        dataType: "string",
        nullable: false,
        primary: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "uuid"' },
        { type: "contains", text: "@PrimaryColumn()" },
        { type: "contains", text: "primaryId: string;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
