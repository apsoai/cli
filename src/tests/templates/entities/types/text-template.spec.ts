import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Text Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-text";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic text field correctly",
      field: {
        name: "content",
        dataType: "string",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ type: "text"' },
        { type: "contains", text: "@IsOptional({ groups: [UPDATE] })" },
        { type: "contains", text: "@IsNotEmpty({ groups: [CREATE] })" },
        { type: "contains", text: "content: string;" },
        { type: "notContains", text: "@Index()" },
      ],
    },
    {
      name: "should render nullable text field correctly",
      field: {
        name: "optionalContent",
        dataType: "string",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ type: "text"' },
        { type: "contains", text: "nullable: true" },
        { type: "contains", text: "@IsOptional({ groups: [UPDATE] })" },
        { type: "contains", text: "optionalContent: string;" },
      ],
    },
    {
      name: "should render text field with default value correctly",
      field: {
        name: "defaultContent",
        dataType: "string",
        nullable: false,
        default: "'empty'",
      },
      assertions: [
        { type: "contains", text: '@Column({ type: "text"' },
        { type: "contains", text: "defaultContent: string;" },
      ],
    },
    {
      name: "should render indexed text field correctly",
      field: {
        name: "indexedContent",
        dataType: "string",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ type: "text"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedContent: string;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
