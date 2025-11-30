import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Decimal Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-decimal";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic decimal field correctly",
      field: {
        name: "price",
        dataType: "number",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "decimal"' },
        { type: "contains", text: "precision: 10" },
        { type: "contains", text: "scale: 2" },
        { type: "contains", text: "price: number;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable decimal field correctly",
      field: {
        name: "optionalPrice",
        dataType: "number",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "decimal"' },
        { type: "contains", text: "optionalPrice: number;" },
      ],
    },
    {
      name: "should render decimal field with custom precision and scale",
      field: {
        name: "amount",
        dataType: "number",
        nullable: false,
        precision: 16,
        scale: 6,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "decimal"' },
        { type: "contains", text: "precision: 16" },
        { type: "contains", text: "scale: 6" },
        { type: "contains", text: "amount: number;" },
      ],
    },
    {
      name: "should render decimal field with default value correctly",
      field: {
        name: "defaultPrice",
        dataType: "number",
        nullable: false,
        default: "0.00",
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "decimal"' },
        { type: "contains", text: "default:  0.00" },
        { type: "contains", text: "defaultPrice: number;" },
      ],
    },
    {
      name: "should render indexed decimal field correctly",
      field: {
        name: "indexedPrice",
        dataType: "number",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: '@Column({ "type": "decimal"' },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedPrice: number;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
