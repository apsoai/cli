import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Money Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-money";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic money field correctly",
      field: {
        name: "price",
        dataType: "string",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "money"' },
        { type: "contains", text: "price: string;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable money field correctly",
      field: {
        name: "optionalPrice",
        dataType: "string",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "money"' },
        { type: "contains", text: "optionalPrice: string;" },
      ],
    },
    {
      name: "should render money field with default value correctly",
      field: {
        name: "defaultPrice",
        dataType: "string",
        nullable: false,
        default: "0.00",
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "money"' },
        { type: "contains", text: "default:  0.00" },
        { type: "contains", text: "defaultPrice: string;" },
      ],
    },
    {
      name: "should render indexed money field correctly",
      field: {
        name: "indexedPrice",
        dataType: "string",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "money"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedPrice: string;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
