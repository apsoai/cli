import {
  configureEta,
  runTemplateTests,
  TemplateTestCase,
} from "../utils/template-test-utils";
import { describe, beforeAll } from "@jest/globals";

describe("Timestamp Templates Tests", () => {
  // Setup Eta configuration once before all tests
  beforeAll(() => {
    configureEta();
  });

  describe("Timestamp Entity Template Tests", () => {
    const templatePath = "./entities/entity-col-timestamp";

    const testCases: TemplateTestCase[] = [
      {
        name: "should render basic timestamp field correctly",
        field: {
          name: "createdAt",
          dataType: "Date",
          nullable: false,
        },
        assertions: [
          { type: "contains", text: "@Column({ type: 'timestamp'" },
          { type: "contains", text: "nullable: false" },
          { type: "contains", text: "createdAt: Date;" },
        ],
      },
      {
        name: "should render nullable timestamp field correctly",
        field: {
          name: "optionalTimestamp",
          dataType: "Date",
          nullable: true,
        },
        assertions: [
          { type: "contains", text: "@Column({ type: 'timestamp'" },
          { type: "contains", text: "nullable: true" },
          { type: "contains", text: "optionalTimestamp: Date;" },
        ],
      },
    ];

    runTemplateTests(templatePath, testCases);
  });

  describe("TimestampWithTimeZone Entity Template Tests", () => {
    const templatePath = "./entities/entity-col-timestamptz";

    const testCases: TemplateTestCase[] = [
      {
        name: "should render basic timestamptz field correctly",
        field: {
          name: "createdAtUtc",
          dataType: "Date",
          nullable: false,
        },
        assertions: [
          { type: "contains", text: "@Column({ type: 'timestamptz'" },
          { type: "contains", text: "nullable: false" },
          { type: "contains", text: "createdAtUtc: Date;" },
        ],
      },
      {
        name: "should render nullable timestamptz field correctly",
        field: {
          name: "optionalTimestamptz",
          dataType: "Date",
          nullable: true,
        },
        assertions: [
          { type: "contains", text: "@Column({ type: 'timestamptz'" },
          { type: "contains", text: "nullable: true" },
          { type: "contains", text: "optionalTimestamptz: Date;" },
        ],
      },
    ];

    runTemplateTests(templatePath, testCases);
  });
});
