import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Enum Entity Template Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  const templatePath = "./entities/entity-col-enum";

  const testCases: TemplateTestCase[] = [
    {
      name: "should render basic enum field correctly",
      field: {
        name: "status",
        dataType: "enum",
        nullable: false,
        // eslint-disable-next-line camelcase
        enum_name: "UserStatus",
        // eslint-disable-next-line camelcase
        enum_values: ["ACTIVE", "INACTIVE", "PENDING"],
      },
      assertions: [
        { type: "contains", text: "type: 'enum'" },
        { type: "contains", text: "enum: enums.enum" },
        { type: "contains", text: "status!: enums.enum;" },
        { type: "notContains", text: "@Index()" },
        { type: "notContains", text: "@PrimaryColumn()" },
      ],
    },
    {
      name: "should render nullable enum field correctly",
      field: {
        name: "optionalStatus",
        dataType: "enum",
        nullable: true,
        // eslint-disable-next-line camelcase
        enum_name: "UserStatus",
        // eslint-disable-next-line camelcase
        enum_values: ["ACTIVE", "INACTIVE", "PENDING"],
      },
      assertions: [
        { type: "contains", text: "type: 'enum'" },
        { type: "contains", text: "optionalStatus!: enums.enum;" },
      ],
    },
    {
      name: "should render enum field with default value correctly",
      field: {
        name: "defaultStatus",
        dataType: "enum",
        nullable: false,
        // eslint-disable-next-line camelcase
        enum_name: "UserStatus",
        // eslint-disable-next-line camelcase
        enum_values: ["ACTIVE", "INACTIVE", "PENDING"],
        default: "UserStatus.INACTIVE",
      },
      assertions: [
        { type: "contains", text: "type: 'enum'" },
        { type: "contains", text: "default: enums.enum.UserStatus.INACTIVE" },
        { type: "contains", text: "defaultStatus!: enums.enum;" },
      ],
    },
    {
      name: "should render indexed enum field correctly",
      field: {
        name: "indexedStatus",
        dataType: "enum",
        nullable: false,
        // eslint-disable-next-line camelcase
        enum_name: "UserStatus",
        // eslint-disable-next-line camelcase
        enum_values: ["ACTIVE", "INACTIVE", "PENDING"],
        index: true,
      },
      assertions: [
        { type: "contains", text: "type: 'enum'" },
        { type: "contains", text: "@Index()" },
        { type: "contains", text: "indexedStatus!: enums.enum;" },
      ],
    },
  ];

  runTemplateTests(templatePath, testCases);
});
