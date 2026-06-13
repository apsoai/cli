import { expect, describe, test } from "@jest/globals";
import {
  pgToApsorc,
  pgTypeToApsorcType,
  parseDefault,
  deriveToName,
  findUnknownEmittedTypes,
} from "../../../src/lib/import/pg-to-apsorc";
import {
  IntrospectedColumn,
  IntrospectedSchema,
  IntrospectedTable,
} from "../../../src/lib/import/types";
import { parseRelationships } from "../../../src/lib/utils/relationships";
import { ApsorcRelationship } from "../../../src/lib/types/relationship";

// ---- fixture helpers ----

function col(
  name: string,
  udtName: string,
  overrides: Partial<IntrospectedColumn> = {}
): IntrospectedColumn {
  return {
    name,
    udtName,
    dataType: overrides.dataType ?? "base",
    nullable: overrides.nullable ?? false,
    default: overrides.default ?? null,
    charMaxLength: overrides.charMaxLength ?? null,
    numericPrecision: overrides.numericPrecision ?? null,
    numericScale: overrides.numericScale ?? null,
    ordinal: overrides.ordinal ?? 1,
    isEnum: overrides.isEnum ?? false,
    enumTypeName: overrides.enumTypeName,
  };
}

function table(
  name: string,
  overrides: Partial<IntrospectedTable> = {}
): IntrospectedTable {
  return {
    name,
    columns: overrides.columns ?? [],
    primaryKey: overrides.primaryKey ?? [],
    foreignKeys: overrides.foreignKeys ?? [],
    uniqueConstraints: overrides.uniqueConstraints ?? [],
    indexes: overrides.indexes ?? [],
  };
}

function schema(
  tables: IntrospectedTable[],
  overrides: Partial<IntrospectedSchema> = {}
): IntrospectedSchema {
  return {
    schema: "public",
    tables,
    enums: overrides.enums ?? [],
    skipped: overrides.skipped ?? { views: [], systemSchemas: [] },
  };
}

function findEntity(out: ReturnType<typeof pgToApsorc>, name: string) {
  return out.apsorc.entities.find((e) => e.name === name)!;
}
function findField(entity: { fields?: any[] }, name: string) {
  return (entity.fields ?? []).find((f) => f.name === name);
}

// ---- reverse type map ----

describe("pgTypeToApsorcType", () => {
  const cases: Array<[string, string]> = [
    ["int2", "smallint"],
    ["int4", "integer"],
    ["int8", "bigint"],
    ["float4", "real"],
    ["float8", "double"],
    ["numeric", "numeric"],
    ["bool", "boolean"],
    ["varchar", "varchar"],
    ["bpchar", "char"],
    ["text", "text"],
    ["uuid", "uuid"],
    ["json", "json"],
    ["jsonb", "jsonb"],
    ["date", "date"],
    ["timestamp", "timestamp"],
    ["timestamptz", "timestamptz"],
    ["time", "time"],
    ["timetz", "timetz"],
    ["bytea", "bytea"],
    ["inet", "inet"],
    ["cidr", "inet"],
    ["interval", "interval"],
  ];
  test.each(cases)("maps udt %s -> %s", (udt, expected) => {
    expect(pgTypeToApsorcType(col("c", udt)).type).toBe(expected);
  });

  test("array udt is lossy and maps to array", () => {
    const r = pgTypeToApsorcType(col("tags", "_text", { dataType: "ARRAY" }));
    expect(r.type).toBe("array");
    expect(r.lossy).toBe("array");
  });

  test("enum column maps to enum", () => {
    const r = pgTypeToApsorcType(
      col("status", "order_status", {
        dataType: "USER-DEFINED",
        isEnum: true,
        enumTypeName: "order_status",
      })
    );
    expect(r.type).toBe("enum");
  });

  test("unknown udt defaults to text and is flagged lossy", () => {
    const r = pgTypeToApsorcType(col("weird", "tstzrange"));
    expect(r.type).toBe("text");
    expect(r.lossy).toBe("defaulted");
  });
});

// ---- defaults ----

describe("parseDefault", () => {
  test("drops sequence/uuid/now defaults", () => {
    expect(parseDefault("nextval('s'::regclass)", "integer").drop).toBe(true);
    expect(parseDefault("gen_random_uuid()", "uuid").drop).toBe(true);
    expect(parseDefault("now()", "timestamptz").drop).toBe(true);
  });
  test("strips ::type cast and quotes for string literal", () => {
    expect(parseDefault("'active'::text", "text").value).toBe("active");
  });
  test("parses booleans and numbers", () => {
    expect(parseDefault("true", "boolean").value).toBe(true);
    expect(parseDefault("0", "integer").value).toBe(0);
    expect(parseDefault("3.50", "numeric").value).toBe("3.50");
  });
  test("drops unknown function expressions", () => {
    expect(parseDefault("some_func(1)", "text").drop).toBe(true);
  });
});

// ---- FK reference-name matching ----

describe("deriveToName", () => {
  test("default column name needs no to_name", () => {
    expect(deriveToName("userId", "User")).toEqual({});
  });
  test("non-default column round-trips to a to_name", () => {
    // target User, column authorId -> referenceName "author" yields authorId
    expect(deriveToName("authorId", "User")).toEqual({ toName: "author" });
  });
  test("snake_case fk column round-trips", () => {
    expect(deriveToName("author_id", "User")).toEqual({ toName: "author" });
  });
  test("column that cannot round-trip is flagged unmapped", () => {
    const r = deriveToName("created_by", "User");
    expect(r.unmapped).toBe(true);
  });
});

// ---- primary key variants ----

describe("primary key handling", () => {
  test("uuid id -> primaryKeyType uuid, id field omitted", () => {
    const out = pgToApsorc(
      schema([
        table("Account", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("name", "text")],
        }),
      ])
    );
    const e = findEntity(out, "Account");
    expect(e.primaryKeyType).toBe("uuid");
    expect(findField(e, "id")).toBeUndefined();
    expect(findField(e, "name")).toBeDefined();
  });

  test("integer id -> default serial (no primaryKeyType), id omitted", () => {
    const out = pgToApsorc(
      schema([
        table("Widget", {
          primaryKey: ["id"],
          columns: [col("id", "int4"), col("label", "text")],
        }),
      ])
    );
    const e = findEntity(out, "Widget");
    expect(e.primaryKeyType).toBeUndefined();
    expect(findField(e, "id")).toBeUndefined();
  });

  test("text id -> primaryKeyType text", () => {
    const out = pgToApsorc(
      schema([
        table("Slug", { primaryKey: ["id"], columns: [col("id", "text")] }),
      ])
    );
    expect(findEntity(out, "Slug").primaryKeyType).toBe("text");
  });

  test("non-id single PK is emitted as a primary field + warning", () => {
    const out = pgToApsorc(
      schema([
        table("Country", {
          primaryKey: ["code"],
          columns: [col("code", "varchar"), col("name", "text")],
        }),
      ])
    );
    const e = findEntity(out, "Country");
    expect(findField(e, "code").primary).toBe(true);
    expect(out.report.warnings.nonStandardPks).toContain("Country");
  });

  test("composite PK -> each column primary:true + warning", () => {
    const out = pgToApsorc(
      schema([
        table("Membership", {
          primaryKey: ["orgId", "userId"],
          columns: [col("orgId", "int4"), col("userId", "int4")],
        }),
      ])
    );
    const e = findEntity(out, "Membership");
    expect(findField(e, "orgId").primary).toBe(true);
    expect(findField(e, "userId").primary).toBe(true);
    expect(out.report.warnings.compositePks).toContain("Membership");
  });

  test("no PK -> warning, all columns emitted", () => {
    const out = pgToApsorc(
      schema([table("Log", { columns: [col("message", "text")] })])
    );
    expect(out.report.warnings.noPrimaryKey).toContain("Log");
    expect(findField(findEntity(out, "Log"), "message")).toBeDefined();
  });
});

// ---- created_at / updated_at ----

describe("timestamp metadata columns", () => {
  test("created_at/updated_at timestamps become entity booleans and are omitted", () => {
    const out = pgToApsorc(
      schema([
        table("Post", {
          primaryKey: ["id"],
          columns: [
            col("id", "uuid"),
            col("created_at", "timestamptz"),
            col("updated_at", "timestamptz"),
            col("title", "text"),
          ],
        }),
      ])
    );
    const e = findEntity(out, "Post");
    expect(e.created_at).toBe(true);
    expect(e.updated_at).toBe(true);
    expect(findField(e, "created_at")).toBeUndefined();
    expect(findField(e, "updated_at")).toBeUndefined();
  });

  test("created_at that is not a timestamp stays a field", () => {
    const out = pgToApsorc(
      schema([
        table("Weird", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("created_at", "text")],
        }),
      ])
    );
    const e = findEntity(out, "Weird");
    expect(e.created_at).toBeUndefined();
    expect(findField(e, "created_at")).toBeDefined();
  });
});

// ---- foreign keys ----

describe("foreign keys", () => {
  test("FK -> ManyToOne with default column name (no to_name), column omitted", () => {
    const out = pgToApsorc(
      schema([
        table("User", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("Post", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("userId", "uuid", { nullable: true })],
          foreignKeys: [
            {
              columns: ["userId"],
              referencedTable: "User",
              referencedColumns: ["id"],
              onDelete: "CASCADE",
            },
          ],
        }),
      ])
    );
    const rel = out.apsorc.relationships[0];
    expect(rel).toMatchObject({
      from: "Post",
      to: "User",
      type: "ManyToOne",
      nullable: true,
      cascadeDelete: true,
    });
    expect(rel.to_name).toBeUndefined();
    // FK column is materialized by the relationship, not a scalar field.
    expect(findField(findEntity(out, "Post"), "userId")).toBeUndefined();
  });

  test("non-default FK column -> to_name", () => {
    const out = pgToApsorc(
      schema([
        table("User", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("Post", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("authorId", "uuid")],
          foreignKeys: [
            {
              columns: ["authorId"],
              referencedTable: "User",
              referencedColumns: ["id"],
              onDelete: "NO ACTION",
            },
          ],
        }),
      ])
    );
    expect(out.apsorc.relationships[0].to_name).toBe("author");
  });

  test("composite FK -> columns kept, no relationship, warning", () => {
    const out = pgToApsorc(
      schema([
        table("Order", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("aId", "int4"), col("bId", "int4")],
          foreignKeys: [
            {
              columns: ["aId", "bId"],
              referencedTable: "Pair",
              referencedColumns: ["a", "b"],
              onDelete: "NO ACTION",
            },
          ],
        }),
      ])
    );
    expect(out.apsorc.relationships).toHaveLength(0);
    expect(out.report.warnings.compositeFks).toContain("Order");
    expect(findField(findEntity(out, "Order"), "aId")).toBeDefined();
  });
});

// ---- join tables ----

describe("join tables", () => {
  test("pure join table -> entity + two ManyToOne + detected", () => {
    const out = pgToApsorc(
      schema([
        table("Student", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("Course", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("enrollment", {
          primaryKey: ["studentId", "courseId"],
          columns: [col("studentId", "uuid"), col("courseId", "uuid")],
          foreignKeys: [
            { columns: ["studentId"], referencedTable: "Student", referencedColumns: ["id"], onDelete: "CASCADE" },
            { columns: ["courseId"], referencedTable: "Course", referencedColumns: ["id"], onDelete: "CASCADE" },
          ],
        }),
      ])
    );
    expect(out.report.warnings.joinTablesDetected).toContain("enrollment");
    const rels = out.apsorc.relationships.filter((r) => r.from === "enrollment");
    expect(rels).toHaveLength(2);
  });
});

// ---- enums ----

function enumSchema(defaultExpr: string | null): IntrospectedSchema {
  return schema(
    [
      table("Order", {
        primaryKey: ["id"],
        columns: [
          col("id", "uuid"),
          col("status", "order_status", {
            dataType: "USER-DEFINED",
            isEnum: true,
            enumTypeName: "order_status",
            default: defaultExpr,
          }),
        ],
      }),
    ],
    { enums: [{ name: "order_status", labels: ["pending", "shipped"] }] }
  );
}

describe("enums", () => {
  test("enum column carries values", () => {
    const out = pgToApsorc(enumSchema(null));
    const f = findField(findEntity(out, "Order"), "status");
    expect(f.type).toBe("enum");
    expect(f.values).toEqual(["pending", "shipped"]);
  });

  test("valid enum default kept", () => {
    const out = pgToApsorc(enumSchema("'pending'::order_status"));
    expect(findField(findEntity(out, "Order"), "status").default).toBe("pending");
  });

  test("invalid enum default dropped + warned", () => {
    const out = pgToApsorc(enumSchema("'bogus'::order_status"));
    expect(findField(findEntity(out, "Order"), "status").default).toBeUndefined();
    expect(out.report.warnings.defaultsDropped).toContain("Order.status");
  });
});

// ---- unique / index ----

describe("unique and index", () => {
  test("single-col unique/index set on field; multi-col go to entity", () => {
    const out = pgToApsorc(
      schema([
        table("User", {
          primaryKey: ["id"],
          columns: [
            col("id", "uuid"),
            col("email", "varchar", { charMaxLength: 255 }),
            col("a", "int4"),
            col("b", "int4"),
          ],
          uniqueConstraints: [
            { name: "uq_email", columns: ["email"] },
            { name: "uq_ab", columns: ["a", "b"] },
          ],
          indexes: [
            { name: "ix_a", columns: ["a"], unique: false },
            { name: "ix_eb", columns: ["email", "b"], unique: false },
          ],
        }),
      ])
    );
    const e = findEntity(out, "User");
    expect(findField(e, "email").unique).toBe(true);
    expect(findField(e, "email").length).toBe(255);
    expect(findField(e, "a").index).toBe(true);
    expect(e.uniques).toEqual([{ fields: ["a", "b"], name: "uq_ab" }]);
    expect(e.indexes).toEqual([{ fields: ["email", "b"], unique: false }]);
  });

  test("index backing a unique constraint is not duplicated", () => {
    const out = pgToApsorc(
      schema([
        table("User", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("email", "varchar")],
          uniqueConstraints: [{ name: "uq_email", columns: ["email"] }],
          indexes: [{ name: "uq_email", columns: ["email"], unique: true }],
        }),
      ])
    );
    const e = findEntity(out, "User");
    expect(findField(e, "email").unique).toBe(true);
    expect(findField(e, "email").index).toBeUndefined();
  });
});

// ---- numeric precision/scale ----

test("numeric carries precision and scale", () => {
  const out = pgToApsorc(
    schema([
      table("Money", {
        primaryKey: ["id"],
        columns: [
          col("id", "uuid"),
          col("amount", "numeric", { numericPrecision: 12, numericScale: 4 }),
        ],
      }),
    ])
  );
  const f = findField(findEntity(out, "Money"), "amount");
  expect(f.precision).toBe(12);
  expect(f.scale).toBe(4);
});

// ---- invariants ----

describe("invariants", () => {
  const broadSchema = schema(
    [
      table("User", {
        primaryKey: ["id"],
        columns: [
          col("id", "uuid"),
          col("name", "varchar", { charMaxLength: 100 }),
          col("age", "int4", { nullable: true }),
          col("balance", "numeric", { numericPrecision: 10, numericScale: 2 }),
          col("active", "bool", { default: "true" }),
          col("tags", "_text", { dataType: "ARRAY", nullable: true }),
          col("created_at", "timestamptz"),
        ],
      }),
      table("Post", {
        primaryKey: ["id"],
        columns: [col("id", "uuid"), col("authorId", "uuid")],
        foreignKeys: [
          { columns: ["authorId"], referencedTable: "User", referencedColumns: ["id"], onDelete: "CASCADE" },
        ],
      }),
    ],
    { skipped: { views: ["active_users"], systemSchemas: ["auth", "storage"] } }
  );

  test("every emitted field type is a recognized column type", () => {
    const out = pgToApsorc(broadSchema);
    expect(findUnknownEmittedTypes(out.apsorc)).toEqual([]);
  });

  test("generated relationships parse cleanly", () => {
    const out = pgToApsorc(broadSchema);
    expect(() =>
      parseRelationships(out.apsorc.relationships as ApsorcRelationship[])
    ).not.toThrow();
  });

  test("top-level shape matches .apsorc v2", () => {
    const out = pgToApsorc(broadSchema);
    expect(out.apsorc).toMatchObject({
      version: 2,
      rootFolder: "src",
      apiType: "rest",
    });
    expect(out.report.viewsSkipped).toContain("active_users");
    expect(out.report.systemSchemasSkipped).toEqual(["auth", "storage"]);
  });
});
