import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("JSON Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-json";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic json field correctly",
      field: {
        name: "jsonData",
        dataType: "json",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: "@Column('jsonb'" },
        { type: "contains", text: "nullable: false" },
        { type: "contains", text: "jsonData: JSON;" },
      ],
    },
    {
      name: "should render nullable json field correctly",
      field: {
        name: "optionalJsonData",
        dataType: "json",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: "@Column('jsonb'" },
        { type: "contains", text: "nullable: true" },
        { type: "contains", text: "optionalJsonData: JSON;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
