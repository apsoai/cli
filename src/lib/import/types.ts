/**
 * Database Import — intermediate model
 *
 * These types are the contract between the introspection layer (which reads a
 * live Postgres database) and the conversion layer (which turns that into a
 * `.apsorc`). Keeping the introspector behind the `Introspector` interface lets
 * the conversion logic and the command be unit-tested with a fake source,
 * without a real database connection.
 */

/** ON DELETE referential action of a foreign key. */
export type OnDeleteAction =
  | "CASCADE"
  | "RESTRICT"
  | "SET NULL"
  | "NO ACTION"
  | "SET DEFAULT";

/** A single introspected column. */
export interface IntrospectedColumn {
  name: string;
  /** pg_catalog udt_name, e.g. "int4", "varchar", "_text", "timestamptz". */
  udtName: string;
  /** information_schema.data_type, used to detect "USER-DEFINED" (enum) and "ARRAY". */
  dataType: string;
  nullable: boolean;
  /** Raw default expression, e.g. "nextval('...')", "now()", "'active'::text". */
  default: string | null;
  charMaxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  ordinal: number;
  /** The expression of a GENERATED ALWAYS AS (...) STORED column. */
  generated?: string;
  /** True when the column's type is a user-defined enum. */
  isEnum: boolean;
  /** Links to IntrospectedEnum.name when isEnum is true. */
  enumTypeName?: string;
}

/** A foreign key constraint (may be composite). */
export interface IntrospectedFk {
  /** The key is NOT VALID: existing rows were never checked against it. */
  notValid?: boolean;
  /** The constraint's name in the source database. */
  name?: string;
  /** Local column(s) participating in the FK. */
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: OnDeleteAction;
}

/** A unique constraint (may be composite). */
export interface IntrospectedUnique {
  name: string;
  columns: string[];
}

/** A secondary index (may be composite). */
export interface IntrospectedIndex {
  name: string;
  /** Plain columns only; an expression is flagged, not listed. */
  columns: string[];
  unique: boolean;
  /** The index has a WHERE clause. */
  partial?: boolean;
  /** The WHERE condition, as Postgres prints it. */
  predicate?: string;
  /** A column is sorted DESC, which .apsorc cannot express yet. */
  descending?: boolean;
  /** The index covers an expression, e.g. lower(email). */
  expression?: boolean;
  /** pg_get_indexdef, for the import report. */
  definition?: string;
}

/** A user-defined enum type and its labels (in sort order). */
export interface IntrospectedEnum {
  name: string;
  labels: string[];
}

/** A single introspected base table. */
export interface IntrospectedTable {
  name: string;
  columns: IntrospectedColumn[];
  /** Ordered primary-key column names ([] if the table has no primary key). */
  primaryKey: string[];
  /** The primary key constraint's name in the source database. */
  primaryKeyName?: string;
  /** CHECK constraints, with the expression as Postgres prints it. */
  checks?: Array<{ name: string; expression: string; notValid?: boolean }>;
  foreignKeys: IntrospectedFk[];
  uniqueConstraints: IntrospectedUnique[];
  indexes: IntrospectedIndex[];
}

/** The full result of introspecting one Postgres schema. */
export interface IntrospectedSchema {
  schema: string;
  tables: IntrospectedTable[];
  enums: IntrospectedEnum[];
  /** Objects intentionally not imported, surfaced in the summary report. */
  skipped: {
    views: string[];
    systemSchemas: string[];
  };
}

/**
 * The boundary the command depends on. The real implementation
 * (PgIntrospector) connects to Postgres; tests provide a fake.
 */
export interface Introspector {
  introspect(schema: string): Promise<IntrospectedSchema>;
}

/**
 * Everything the import couldn't represent losslessly, plus counts, used to
 * print a summary the user can review before/after writing the `.apsorc`.
 */
export interface ImportReport {
  tablesImported: string[];
  relationships: number;
  viewsSkipped: string[];
  systemSchemasSkipped: string[];
  warnings: {
    /** "table.column" arrays whose element type is unknown, imported as text[]. */
    arraysLossy: string[];
    /** "table.constraint" for CHECK constraints marked NOT VALID in the source. */
    checksNotValid: string[];
    /**
     * "table.column" for a created_at or updated_at with no default in the
     * source. TypeORM always gives these columns DEFAULT now().
     */
    timestampDefaultsAdded: string[];
    /**
     * "table.column = expression" for generated columns. .apsorc cannot
     * express one, so it is imported as a plain column the database no
     * longer computes.
     */
    generatedColumns: string[];
    /**
     * Foreign keys whose relationship could not take its natural name because
     * the table has a column of that name. The column itself is unchanged.
     */
    relationshipsRenamed: string[];
    /**
     * Indexes .apsorc cannot express, as Postgres defines them: an expression
     * or DESC index that is not a btree. They are left out.
     */
    indexesNotCarried: string[];
    /** Tables with composite primary keys (emitted as primary:true fields). */
    compositePks: string[];
    /** Tables with composite foreign keys (kept as scalar columns, no relationship). */
    compositeFks: string[];
    /** Tables whose single PK is not named "id" (emitted as a primary:true field). */
    nonStandardPks: string[];
    /** Tables with no primary key at all. */
    noPrimaryKey: string[];
    /** Columns whose type was unknown and defaulted to text. */
    typesDefaulted: Array<{ column: string; udt: string }>;
    /** "table.column" defaults that were dropped (unsupported expressions). */
    defaultsDropped: string[];
    /** Tables that look like pure join tables (candidates for manual ManyToMany). */
    joinTablesDetected: string[];
  };
}
