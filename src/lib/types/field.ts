export type FieldType =
  | "text"
  | "boolean"
  | "array"
  | "enum"
  | "integer"
  | "float"
  | "decimal"
  | "numeric"
  | "date"
  | "timestamptz"
  | "timestamp"
  | "datetime"
  | "json"
  | "json-plain";

export interface Field {
  name: string;
  type: FieldType;
  values?: string[];
  nullable?: boolean;
  index?: boolean;
  primary?: boolean;
  unique?: boolean;
  /**
   * The column default: a literal, or { "sql": "<expression>" } for a SQL
   * expression such as now() or gen_random_uuid(). A json, jsonb or array
   * field also takes an object or array literal.
   */
  default?: string | null | { sql: string } | Record<string, unknown> | unknown[];
  /** The column has no database default (a boolean otherwise defaults to false). */
  noDefault?: boolean;
  /**
   * The SQL expression of a stored generated column: Postgres computes the
   * value, so the API never accepts one for it.
   */
  generated?: string;
  length?: number;
  precision?: number;
  scale?: number;
  /** Postgres element type of an "array" field; text when unset. */
  elementType?: string;
  /**
   * Name of the Postgres enum type of an "enum" field. Defaults to
   * `<table>_<column>_enum`. `apso import` sets it so an existing database
   * keeps its type name; two fields may share one type. TypeScript only.
   */
  enumName?: string;
  /* eslint-disable-next-line  camelcase */
  is_email?: boolean;
}

export interface ComputedField extends Omit<Field, "default"> {
  /** The literal default, null when there is none or it is a SQL expression. */
  default?: string | null;
  /** The default as SQL, when it is an expression or a JSON literal. */
  defaultSql?: string;
  dataType: string;
}
