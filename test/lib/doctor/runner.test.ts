import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DiagnosticContext } from "../../../src/lib/doctor/types";
import { runDiagnostics, formatFindings } from "../../../src/lib/doctor/runner";

// Mock the migration sandbox to avoid PGlite dependency in unit tests
jest.mock("../../../src/lib/migrate/sandbox", () => ({
  runMigrationSandbox: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    needed: false,
    success: true,
    upSql: [],
    downSql: [],
  }),
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apso-doctor-runner-test-"));
}

function writeEntityFile(
  tmpDir: string,
  entityName: string,
  content: string
): void {
  const snakeName = entityName
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  const dir = path.join(tmpDir, "src", "autogen", snakeName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entityName}.entity.ts`), content);
}

describe("runDiagnostics", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty findings for a clean project", async () => {
    writeEntityFile(
      tmpDir,
      "User",
      `
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("user")
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  email: string;
}
`
    );

    const ctx: DiagnosticContext = {
      entities: [
        {
          name: "User",
          primaryKeyType: "serial",
          fields: [{ name: "email", type: "text" }],
        },
      ],
      relationshipMap: {},
      rootFolder: "src",
      language: "typescript",
      projectRoot: tmpDir,
    };

    const findings = await runDiagnostics(ctx);
    expect(findings).toHaveLength(0);
  });

  test("aggregates findings from multiple checks", async () => {
    writeEntityFile(
      tmpDir,
      "Order",
      `
import { Entity, PrimaryColumn, Column, Generated } from "typeorm";

@Entity("order")
export class Order {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ type: "text" })
  status: string;
}
`
    );

    const ctx: DiagnosticContext = {
      entities: [
        {
          name: "Order",
          primaryKeyType: "uuid",
          fields: [
            { name: "status", type: "text" },
            { name: "data", type: "blob" as any },
          ],
        },
      ],
      relationshipMap: {
        Order: [
          {
            name: "Ghost",
            type: "ManyToOne",
            biDirectional: false,
            nullable: false,
          },
        ],
      },
      rootFolder: "src",
      language: "typescript",
      projectRoot: tmpDir,
    };

    const findings = await runDiagnostics(ctx);

    // Should have findings from multiple checks:
    // - field-type-mismatch for "blob"
    // - relationship-target for "Ghost"
    // - pk-strategy for uuid + @PrimaryColumn
    // - unused-imports for "Generated"
    expect(findings.length).toBeGreaterThanOrEqual(4);

    const checks = findings.map((f) => f.check);
    expect(checks).toContain("field-type-mismatch");
    expect(checks).toContain("relationship-target");
    expect(checks).toContain("pk-strategy");
    expect(checks).toContain("unused-imports");
  });
});

describe("formatFindings", () => {
  test("empty findings returns no issues message", () => {
    expect(formatFindings([])).toBe("No issues found.");
  });

  test("formats errors and warnings with severity headers", () => {
    const output = formatFindings([
      {
        check: "pk-strategy",
        severity: "error",
        message: "Bad PK",
        entity: "Order",
        file: "src/autogen/order/Order.entity.ts",
        suggestion: "Fix it",
      },
      {
        check: "unused-imports",
        severity: "warning",
        message: "Unused import",
        entity: "Order",
      },
    ]);

    expect(output).toContain("1 error(s):");
    expect(output).toContain("1 warning(s):");
    expect(output).toContain("[ERROR] Bad PK");
    expect(output).toContain("[WARNING] Unused import");
    expect(output).toContain("File: src/autogen/order/Order.entity.ts");
    expect(output).toContain("Fix: Fix it");
  });
});
