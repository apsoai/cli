import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("XML Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-xml";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic xml field correctly",
      field: {
        name: "xmlContent",
        dataType: "string",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "xml"' },
        { type: "contains", text: "xmlContent: string;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable xml field correctly",
      field: {
        name: "optionalXml",
        dataType: "string",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "xml"' },
        { type: "contains", text: "nullable: true" },
        { type: "contains", text: "optionalXml: string;" },
      ],
    },
    {
      name: "should render indexed xml field correctly",
      field: {
        name: "indexedXml",
        dataType: "string",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "xml"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedXml: string;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
