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
  /** True when the column's type is a user-defined enum. */
  isEnum: boolean;
  /** Links to IntrospectedEnum.name when isEnum is true. */
  enumTypeName?: string;
}

/** A foreign key constraint (may be composite). */
export interface IntrospectedFk {
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
  columns: string[];
  unique: boolean;
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
    /** "table.column" whose Postgres array type was reduced to text. */
    arraysLossy: string[];
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
    /** FK columns whose name could not be round-tripped to a relationship name. */
    fkColumnNameUnmapped: string[];
    /** "table.column" defaults that were dropped (unsupported expressions). */
    defaultsDropped: string[];
    /** Tables that look like pure join tables (candidates for manual ManyToMany). */
    joinTablesDetected: string[];
  };
}
