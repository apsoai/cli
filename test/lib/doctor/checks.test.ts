import { expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  checkPkStrategy,
  checkUnusedImports,
  checkFieldTypeMismatch,
  checkRelationshipTarget,
} from "../../../src/lib/doctor/checks";
import { DiagnosticContext } from "../../../src/lib/doctor/types";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apso-doctor-test-"));
}

function writeEntityFile(
  tmpDir: string,
  rootFolder: string,
  entityName: string,
  content: string
): void {
  // Entity files live at <rootFolder>/autogen/<snake_case_name>/<Name>.entity.ts
  const snakeName = entityName
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  const dir = path.join(tmpDir, rootFolder, "autogen", snakeName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entityName}.entity.ts`), content);
}

function baseCtx(
  tmpDir: string,
  overrides?: Partial<DiagnosticContext>
): DiagnosticContext {
  return {
    entities: [],
    relationshipMap: {},
    rootFolder: "src",
    language: "typescript",
    projectRoot: tmpDir,
    ...overrides,
  };
}

describe("checkPkStrategy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("serial entity passes (no findings)", () => {
    writeEntityFile(
      tmpDir,
      "src",
      "User",
      `
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("user")
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  name: string;
}
`
    );

    const ctx = baseCtx(tmpDir, {
      entities: [
        {
          name: "User",
          primaryKeyType: "serial",
          fields: [{ name: "name", type: "text" }],
        },
      ],
    });

    const findings = checkPkStrategy(ctx);
    expect(findings).toHaveLength(0);
  });

  test("uuid entity with @PrimaryGeneratedColumn('uuid') passes", () => {
    writeEntityFile(
      tmpDir,
      "src",
      "Order",
      `
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("order")
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: "text" })
  status: string;
}
`
    );

    const ctx = baseCtx(tmpDir, {
      entities: [
        {
          name: "Order",
          primaryKeyType: "uuid",
          fields: [{ name: "status", type: "text" }],
        },
      ],
    });

    const findings = checkPkStrategy(ctx);
    expect(findings).toHaveLength(0);
  });

  test("uuid entity with @PrimaryColumn() errors", () => {
    writeEntityFile(
      tmpDir,
      "src",
      "Order",
      `
import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity("order")
export class Order {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ type: "text" })
  status: string;
}
`
    );

    const ctx = baseCtx(tmpDir, {
      entities: [
        {
          name: "Order",
          primaryKeyType: "uuid",
          fields: [{ name: "status", type: "text" }],
        },
      ],
    });

    const findings = checkPkStrategy(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("pk-strategy");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].entity).toBe("Order");
    expect(findings[0].message).toContain("@PrimaryColumn()");
  });

  test("entity with custom primary field is skipped", () => {
    const ctx = baseCtx(tmpDir, {
      entities: [
        {
          name: "Config",
          primaryKeyType: "uuid",
          fields: [{ name: "key", type: "text", primary: true }],
        },
      ],
    });

    const findings = checkPkStrategy(ctx);
    expect(findings).toHaveLength(0);
  });

  test("uuid entity with missing file warns", () => {
    const ctx = baseCtx(tmpDir, {
      entities: [
        {
          name: "Missing",
          primaryKeyType: "uuid",
          fields: [],
        },
      ],
    });

    const findings = checkPkStrategy(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("not found");
  });
});

describe("checkUnusedImports", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("entity with all imports used passes", () => {
    writeEntityFile(
      tmpDir,
      "src",
      "Item",
      `
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("item")
export class Item {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  name: string;
}
`
    );

    const ctx = baseCtx(tmpDir, {
      entities: [{ name: "Item", fields: [{ name: "name", type: "text" }] }],
    });

    const findings = checkUnusedImports(ctx);
    expect(findings).toHaveLength(0);
  });

  test("entity with unused Generated import warns", () => {
    writeEntityFile(
      tmpDir,
      "src",
      "Item",
      `
import { Entity, PrimaryGeneratedColumn, Column, Generated } from "typeorm";

@Entity("item")
export class Item {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  name: string;
}
`
    );

    const ctx = baseCtx(tmpDir, {
      entities: [{ name: "Item", fields: [{ name: "name", type: "text" }] }],
    });

    const findings = checkUnusedImports(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("unused-imports");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Generated");
  });

  test("non-typescript language is skipped", () => {
    const ctx = baseCtx(tmpDir, {
      language: "python",
      entities: [{ name: "Item", fields: [] }],
    });

    const findings = checkUnusedImports(ctx);
    expect(findings).toHaveLength(0);
  });
});

describe("checkFieldTypeMismatch", () => {
  test("valid types pass", () => {
    const ctx = baseCtx("", {
      entities: [
        {
          name: "Product",
          fields: [
            { name: "name", type: "text" },
            { name: "price", type: "decimal" },
            { name: "active", type: "boolean" },
            { name: "tags", type: "array" },
            { name: "status", type: "enum", values: ["active", "inactive"] },
          ],
        },
      ],
    });

    const findings = checkFieldTypeMismatch(ctx);
    expect(findings).toHaveLength(0);
  });

  test("instant-in-time types (timestamptz, timestamp, datetime) pass", () => {
    const ctx = baseCtx("", {
      entities: [
        {
          name: "Event",
          fields: [
            { name: "capturedAt", type: "timestamptz", nullable: true },
            { name: "occurredAt", type: "timestamp", nullable: false },
            { name: "loggedAt", type: "datetime", nullable: true },
          ],
        },
      ],
    });

    const findings = checkFieldTypeMismatch(ctx);
    expect(findings).toHaveLength(0);
  });

  test("unknown type errors", () => {
    const ctx = baseCtx("", {
      entities: [
        {
          name: "Product",
          fields: [{ name: "data", type: "blob" as any }],
        },
      ],
    });

    const findings = checkFieldTypeMismatch(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("field-type-mismatch");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("blob");
  });

  test("enum without values errors", () => {
    const ctx = baseCtx("", {
      entities: [
        {
          name: "Task",
          fields: [{ name: "status", type: "enum" }],
        },
      ],
    });

    const findings = checkFieldTypeMismatch(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("values");
  });
});

describe("checkRelationshipTarget", () => {
  test("valid relationships pass", () => {
    const ctx = baseCtx("", {
      entities: [{ name: "User" }, { name: "Post" }],
      relationshipMap: {
        User: [
          {
            name: "Post",
            type: "OneToMany",
            biDirectional: true,
            nullable: false,
          },
        ],
        Post: [
          {
            name: "User",
            type: "ManyToOne",
            biDirectional: true,
            nullable: false,
          },
        ],
      },
    });

    const findings = checkRelationshipTarget(ctx);
    expect(findings).toHaveLength(0);
  });

  test("non-existent target errors", () => {
    const ctx = baseCtx("", {
      entities: [{ name: "User" }],
      relationshipMap: {
        User: [
          {
            name: "Comment",
            type: "OneToMany",
            biDirectional: true,
            nullable: false,
          },
        ],
      },
    });

    const findings = checkRelationshipTarget(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("relationship-target");
    expect(findings[0].message).toContain("Comment");
  });

  test("non-existent source errors", () => {
    const ctx = baseCtx("", {
      entities: [{ name: "User" }],
      relationshipMap: {
        Ghost: [
          {
            name: "User",
            type: "ManyToOne",
            biDirectional: false,
            nullable: false,
          },
        ],
      },
    });

    const findings = checkRelationshipTarget(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("Ghost");
  });
});
