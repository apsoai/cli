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
    primaryKeyName: overrides.primaryKeyName,
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

  test("an array keeps its element type, and is lossy only when that type is unknown", () => {
    expect(pgTypeToApsorcType(col("tags", "_text", { dataType: "ARRAY" }))).toEqual({ type: "array" });
    expect(pgTypeToApsorcType(col("ids", "_uuid", { dataType: "ARRAY" }))).toEqual({ type: "array", elementType: "uuid" });
    expect(pgTypeToApsorcType(col("shapes", "_polygon_thing", { dataType: "ARRAY" }))).toEqual({ type: "array", lossy: "array" });
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

const fk = (column: string, referencedTable: string) => ({
  columns: [column],
  referencedTable,
  referencedColumns: ["id"],
  onDelete: "NO ACTION" as const,
});

const second = (name: string, more: object) => ({ ...fk("patient_id", "patients"), name, ...more });

const importedRule = (onDelete: string) =>
  pgToApsorc(
    schema([
      table("User", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
      table("Post", {
        primaryKey: ["id"],
        columns: [col("id", "uuid"), col("userId", "uuid", { nullable: true })],
        foreignKeys: [{ columns: ["userId"], referencedTable: "User", referencedColumns: ["id"], onDelete: onDelete as any }],
      }),
    ])
  ).apsorc.relationships[0];

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

  // apsoai/cli#243: the default stays timestamp; an import keeps what the
  // source database uses.
  test("timestamptz source columns set timestampType, timestamp ones do not", () => {
    const out = pgToApsorc(
      schema([
        table("Zoned", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("created_at", "timestamptz"), col("updated_at", "timestamptz")],
        }),
        table("Plain", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("created_at", "timestamp"), col("updated_at", "timestamp")],
        }),
        table("OnlyCreated", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("created_at", "timestamptz")],
        }),
      ])
    );
    expect(findEntity(out, "Zoned").timestampType).toBe("timestamptz");
    expect(findEntity(out, "Plain").timestampType).toBeUndefined();
    expect(findEntity(out, "OnlyCreated").timestampType).toBe("timestamptz");
  });

  test("a table that mixes timestamp and timestamptz keeps one type per column", () => {
    const out = pgToApsorc(
      schema([
        table("Mixed", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("created_at", "timestamptz"), col("updated_at", "timestamp")],
        }),
      ])
    );
    expect(findEntity(out, "Mixed").timestampType).toEqual({ created_at: "timestamptz", updated_at: "timestamp" });
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

  // apsoai/cli#241: an import never renames a foreign key column.
  test("a snake_case FK column keeps its name, and indexes on it name the relationship", () => {
    const out = pgToApsorc(
      schema([
        table("organizations", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("patients", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("enrollments", {
          primaryKey: ["id"],
          columns: [
            col("id", "uuid"),
            col("organization_id", "uuid"),
            col("patient_id", "uuid"),
            col("year", "int4"),
          ],
          foreignKeys: [fk("organization_id", "organizations"), fk("patient_id", "patients")],
          uniqueConstraints: [{ name: "enrollments_patient_year_uq", columns: ["patient_id", "year"] }],
          indexes: [
            { name: "enrollments_org_patient_idx", columns: ["organization_id", "patient_id"], unique: false },
            { name: "enrollments_patient_idx", columns: ["patient_id"], unique: false },
          ],
        }),
      ])
    );
    const rels = out.apsorc.relationships.filter((r) => r.from === "enrollments");
    expect(rels).toEqual([
      { from: "enrollments", to: "organizations", type: "ManyToOne", to_name: "organization", joinColumnName: "organization_id" },
      { from: "enrollments", to: "patients", type: "ManyToOne", to_name: "patient", joinColumnName: "patient_id" },
    ]);
    const e = findEntity(out, "enrollments");
    expect(e.uniques).toEqual([{ fields: ["patient", "year"], name: "enrollments_patient_year_uq" }]);
    // Every index is an entry with the source's name, a single-column one too.
    expect(e.indexes).toEqual([
      { fields: ["organization", "patient"], name: "enrollments_org_patient_idx" },
      { fields: ["patient"], name: "enrollments_patient_idx" },
    ]);
  });

  test("ON DELETE SET NULL and RESTRICT are kept, CASCADE stays cascadeDelete", () => {
    expect(importedRule("SET NULL")).toMatchObject({ onDelete: "SET NULL", nullable: true });
    expect(importedRule("RESTRICT").onDelete).toBe("RESTRICT");
    expect(importedRule("CASCADE")).toMatchObject({ cascadeDelete: true });
    expect(importedRule("CASCADE").onDelete).toBeUndefined();
    expect(importedRule("NO ACTION").onDelete).toBeUndefined();
  });

  test("a varchar(n) id is kept as a primary field with its length", () => {
    const out = pgToApsorc(
      schema([table("orgs", { primaryKey: ["id"], columns: [col("id", "varchar", { charMaxLength: 100 })] })])
    );
    const orgs = findEntity(out, "orgs");
    expect(orgs.primaryKeyType).toBeUndefined();
    expect(findField(orgs, "id")).toMatchObject({ type: "varchar", length: 100, primary: true });
  });


  test("a NOT VALID foreign key keeps validate: false; a timestamp with no default is reported", () => {
    const out = pgToApsorc(
      schema([
        table("patients", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("screenings", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("patient_id", "uuid"), col("updated_at", "timestamptz")],
          foreignKeys: [{ ...fk("patient_id", "patients"), notValid: true }],
        }),
      ])
    );
    expect(out.apsorc.relationships[0].validate).toBe(false);
    expect(out.report.warnings.timestampDefaultsAdded).toEqual(["screenings.updated_at"]);
    expect(out.apsorc.entities[1].timestampDefault).toBe(false);
  });

  test("a second foreign key on one column is kept as a constraint", () => {
    const out = pgToApsorc(
      schema([
        table("patients", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("vitals", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("patient_id", "uuid")],
          foreignKeys: [
            { ...fk("patient_id", "patients"), name: "vitals_patient_id_fk" },
            { ...fk("patient_id", "patients"), name: "vitals_patient_id_fkey" },
          ],
        }),
      ])
    );
    expect(out.apsorc.relationships.map((r) => r.foreignKeyName)).toEqual(["vitals_patient_id_fk"]);
    expect(out.apsorc.entities.find((e) => e.name === "vitals")?.foreignKeys).toEqual([
      { name: "vitals_patient_id_fkey", column: "patient_id", to: "patients" },
    ]);
  });

  test("a second foreign key an entry cannot state exactly is reported and left out", () => {
    const out = pgToApsorc(
      schema([
        table("patients", { primaryKey: ["id"], columns: [col("id", "uuid"), col("mrn", "uuid")] }),
        table("vitals", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("patient_id", "uuid")],
          foreignKeys: [
            second("first", {}),
            second("to_a_table_not_imported", { referencedTable: "users" }),
            second("to_a_column_that_is_not_the_key", { referencedColumns: ["mrn"] }),
            second("set_default", { onDelete: "SET DEFAULT" }),
            second("on_update_or_deferrable", { otherActions: true }),
            second("kept", { onDelete: "RESTRICT" }),
          ],
        }),
      ])
    );
    expect(findEntity(out, "vitals").foreignKeys).toEqual([
      { name: "kept", column: "patient_id", to: "patients", onDelete: "RESTRICT" },
    ]);
    expect(out.report.warnings.foreignKeysNotCarried).toEqual([
      "vitals.to_a_table_not_imported (patient_id -> users)",
      "vitals.to_a_column_that_is_not_the_key (patient_id -> patients)",
      "vitals.set_default (patient_id -> patients)",
      "vitals.on_update_or_deferrable (patient_id -> patients)",
    ]);
  });

  test("a primary key that is also a foreign key stays the key, on the relationship", () => {
    const out = pgToApsorc(
      schema([
        table("patients", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("patient_flags", {
          primaryKey: ["patient_id"],
          primaryKeyName: "patient_flags_pkey",
          columns: [col("patient_id", "uuid"), col("flag", "text")],
          foreignKeys: [fk("patient_id", "patients")],
        }),
      ])
    );
    expect(out.apsorc.relationships).toEqual([
      { from: "patient_flags", to: "patients", type: "ManyToOne", to_name: "patient", joinColumnName: "patient_id", primary: true },
    ]);
    expect(findEntity(out, "patient_flags").primaryKeyName).toBe("patient_flags_pkey");
    expect(out.report.warnings.nonStandardPks).toEqual([]);
  });

  // apsoai/cli#250: never rename a column to make room for a relationship.
  test("a relationship that would take a column's name is renamed, and the column kept", () => {
    const out = pgToApsorc(
      schema([
        table("facilities", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("notes", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("facility", "text"), col("facility_id", "uuid")],
          foreignKeys: [fk("facility_id", "facilities")],
          indexes: [{ name: "notes_facility_idx", columns: ["facility_id", "facility"], unique: false }],
        }),
      ])
    );
    expect(out.apsorc.relationships).toEqual([
      { from: "notes", to: "facilities", type: "ManyToOne", to_name: "facilityRecord", joinColumnName: "facility_id" },
    ]);
    const notes = findEntity(out, "notes");
    expect(findField(notes, "facility")).toBeDefined();
    expect(notes.indexes).toEqual([{ fields: ["facilityRecord", "facility"], name: "notes_facility_idx" }]);
    expect(out.report.warnings.relationshipsRenamed).toEqual(['notes.facility_id is relationship "facilityRecord"']);
  });

  test("a FK column the default name already generates gets no joinColumnName", () => {
    const out = pgToApsorc(
      schema([
        table("User", { primaryKey: ["id"], columns: [col("id", "uuid")] }),
        table("Post", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("userId", "uuid")],
          foreignKeys: [{ columns: ["userId"], referencedTable: "User", referencedColumns: ["id"], onDelete: "NO ACTION" }],
        }),
      ])
    );
    expect(out.apsorc.relationships).toEqual([{ from: "Post", to: "User", type: "ManyToOne" }]);
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
  test("indexes and uniques go to the entity with their names", () => {
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
    // A field's "unique": true would rename the constraint, so a named
    // single-column unique is an entity-level entry too.
    expect(findField(e, "email").unique).toBeUndefined();
    expect(findField(e, "email").length).toBe(255);
    expect(findField(e, "a").index).toBeUndefined();
    expect(e.uniques).toEqual([
      { fields: ["email"], name: "uq_email" },
      { fields: ["a", "b"], name: "uq_ab" },
    ]);
    expect(e.indexes).toEqual([
      { fields: ["a"], name: "ix_a" },
      { fields: ["email", "b"], name: "ix_eb" },
    ]);
  });

  // apsoai/cli#245
  test("a partial index keeps its WHERE; expression and DESC indexes become sqlIndexes", () => {
    const out = pgToApsorc(
      schema([
        table("jobs", {
          primaryKey: ["id"],
          columns: [col("id", "uuid"), col("status", "text"), col("email", "text"), col("at", "timestamptz")],
          indexes: [
            { name: "jobs_one_live_uq", columns: ["status"], unique: true, partial: true, predicate: "(status <> 'done'::text)" },
            { name: "jobs_lower_email_uq", columns: [], unique: true, expression: true, definition: "CREATE UNIQUE INDEX jobs_lower_email_uq ON public.jobs USING btree (lower(email))" },
            { name: "jobs_recent_idx", columns: ["at"], unique: false, descending: true, definition: "CREATE INDEX jobs_recent_idx ON public.jobs USING btree (status, at DESC) WHERE (status <> 'done'::text)", predicate: "(status <> 'done'::text)" },
            { name: "jobs_gin_idx", columns: [], unique: false, expression: true, definition: "CREATE INDEX jobs_gin_idx ON public.jobs USING gin (to_tsvector('english'::regconfig, email))" },
          ],
        }),
      ])
    );
    const jobs = findEntity(out, "jobs");
    expect(jobs.indexes).toEqual([
      { fields: ["status"], unique: true, name: "jobs_one_live_uq", where: "(status <> 'done'::text)" },
    ]);
    expect(jobs.sqlIndexes).toEqual([
      { name: "jobs_lower_email_uq", columns: "lower(email)", unique: true },
      { name: "jobs_recent_idx", columns: "status, at DESC", where: "(status <> 'done'::text)" },
    ]);
    // Another index method cannot be expressed, so it is reported.
    expect(out.report.warnings.indexesNotCarried).toEqual([
      "CREATE INDEX jobs_gin_idx ON public.jobs USING gin (to_tsvector('english'::regconfig, email)) (not imported)",
    ]);
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
    expect(e.uniques).toEqual([{ fields: ["email"], name: "uq_email" }]);
    expect(e.indexes).toBeUndefined();
    expect(findField(e, "email").index).toBeUndefined();
  });
});

// apsoai/cli#247
test("defaults are kept: SQL expressions as { sql }, booleans without one as noDefault", () => {
  const out = pgToApsorc(
    schema([
      table("audits", {
        primaryKey: ["id"],
        columns: [
          col("id", "uuid", { default: "gen_random_uuid()" }),
          col("retention_until", "timestamptz", { default: "(now() + '6 years'::interval)" }),
          col("tags", "jsonb", { default: "'[]'::jsonb" }),
          col("living_will", "bool", { nullable: true }),
          col("active", "bool", { default: "true" }),
          col("status", "varchar", { default: "'open'::character varying" }),
          col("seq", "int4", { default: "nextval('audits_seq'::regclass)" }),
        ],
      }),
    ])
  );
  const e = findEntity(out, "audits");
  expect(e.primaryKeyDefault).toBe("gen_random_uuid()");
  expect(findField(e, "retention_until").default).toEqual({ sql: "(now() + '6 years'::interval)" });
  expect(findField(e, "tags").default).toEqual({ sql: "'[]'::jsonb" });
  expect(findField(e, "living_will").noDefault).toBe(true);
  expect(findField(e, "active").default).toBe(true);
  expect(findField(e, "status").default).toBe("open");
  expect(out.report.warnings.defaultsDropped).toEqual(["audits.seq"]);
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
