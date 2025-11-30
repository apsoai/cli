import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Boolean Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-boolean";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic boolean field correctly",
      field: {
        name: "isActive",
        dataType: "boolean",
        nullable: false,
      },
      assertions: [
        { type: "contains", text: "@IsOptional({ groups: [CREATE, UPDATE] })" },
        { type: "contains", text: "@IsBoolean({ always: true })" },
        { type: "contains", text: "@Column({ type: 'boolean'" },
        { type: "contains", text: "default: false" },
        { type: "contains", text: "isActive!: boolean;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable boolean field correctly",
      field: {
        name: "optionalFlag",
        dataType: "boolean",
        nullable: true,
      },
      assertions: [
        { type: "contains", text: "@IsOptional({ groups: [CREATE, UPDATE] })" },
        { type: "contains", text: "@IsBoolean({ always: true })" },
        { type: "contains", text: "@Column({ type: 'boolean'" },
        { type: "contains", text: "optionalFlag!: boolean;" },
      ],
    },
    {
      name: "should render boolean field with default value correctly",
      field: {
        name: "defaultFlag",
        dataType: "boolean",
        nullable: false,
        default: "true",
      },
      assertions: [
        { type: "contains", text: "@IsOptional({ groups: [CREATE, UPDATE] })" },
        { type: "contains", text: "@IsBoolean({ always: true })" },
        { type: "contains", text: "@Column({ type: 'boolean'" },
        { type: "contains", text: "default: true" },
        { type: "contains", text: "defaultFlag!: boolean;" },
      ],
    },
    {
      name: "should render indexed boolean field correctly",
      field: {
        name: "indexedFlag",
        dataType: "boolean",
        nullable: false,
        index: true,
      },
      assertions: [
        { type: "contains", text: "@IsOptional({ groups: [CREATE, UPDATE] })" },
        { type: "contains", text: "@IsBoolean({ always: true })" },
        { type: "contains", text: "@Column({ type: 'boolean'" },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedFlag!: boolean;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
