import { FieldType, Field, ComputedField, Entity } from "../types";
import { pascalCase } from "./casing";

/**
 * Canonical mapping from .apsorc field types to Postgres column types.
 * This is the single source of truth -- sandbox, entity-generator, and
 * templates should all derive from this map.
 */
export const fieldTypeToColumnType: Record<string, string> = {
  text: "text",
  string: "varchar",
  varchar: "varchar",
  char: "char",
  boolean: "boolean",
  integer: "integer",
  int: "integer",
  smallint: "smallint",
  bigint: "bigint",
  float: "float",
  real: "real",
  double: "double precision",
  decimal: "decimal",
  numeric: "numeric",
  serial: "integer",
  bigserial: "bigint",
  smallserial: "smallint",
  date: "date",
  timestamp: "timestamp",
  timestamptz: "timestamptz",
  datetime: "timestamp",
  time: "time",
  timetz: "timetz",
  json: "json",
  jsonb: "jsonb",
  "json-plain": "json",
  uuid: "uuid",
  money: "money",
  bytea: "bytea",
  xml: "xml",
  inet: "inet",
  interval: "interval",
  tsvector: "tsvector",
  enum: "enum",
  array: "text",
  point: "point",
  geometry: "geometry",
  geography: "geography",
  linestring: "geometry",
  polygon: "geometry",
  multipoint: "geometry",
  multilinestring: "geometry",
  multipolygon: "geometry",
  geometrycollection: "geometry",
  int4range: "int4range",
};

/**
 * Normalize PostgreSQL field types that have spaces or variants to their
 * template-compatible names. This ensures field types like "double precision"
 * map to the corresponding template file (entity-col-double.eta).
 */
const fieldTypeNormalizationMap: Record<string, string> = {
  "double precision": "double",
  "character varying": "varchar",
  "bit varying": "varbit",
  "time without time zone": "time",
  "time with time zone": "timetz",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamptz",
  // `datetime` is a user-facing alias for a naive timestamp (instant-in-time).
  datetime: "timestamp",
};

/**
 * Normalize a field type to its template-compatible name.
 * PostgreSQL has some types with spaces (e.g., "double precision")
 * that need to be mapped to simpler names for template lookup.
 */
export const normalizeFieldType = (type: string): string => {
  return fieldTypeNormalizationMap[type.toLowerCase()] || type;
};

const typeToJsType: Record<string, string> = {
  array: "string[]", // getFieldForTemplate uses the elementType's type
  boolean: "boolean",
  integer: "number",
  int: "number",
  float8: "number",
  float: "number",
  real: "number",
  double: "number",
  "double precision": "number", // PostgreSQL alias for double
  decimal: "number",
  numeric: "number",
  smallint: "number",
  serial: "number",
  bigserial: "number",
  smallserial: "number",
  bigint: "string",
  text: "string",
  varchar: "string",
  char: "string",
  uuid: "string",
  xml: "string",
  inet: "string",
  interval: "string",
  money: "string",
  date: "string",
  timestamp: "string",
  timestamptz: "string",
  datetime: "string",
  timetz: "string",
  tsvector: "string",
  string: "string",
  json: "any",
  jsonb: "any",
  "json-plain": "any",
  bytea: "Buffer",
  point: "{ x: number, y: number }",
  int4range:
    "{ lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean }",
  enum: "string", // handled elsewhere for custom enums
  // PostGIS data types
  geometry: "any",
  geography: "any",
  linestring: "{ coordinates: Array<{ x: number, y: number }> }",
  polygon: "{ coordinates: Array<Array<{ x: number, y: number }>> }",
  multipoint: "{ coordinates: Array<{ x: number, y: number }> }",
  multilinestring: "{ coordinates: Array<Array<{ x: number, y: number }>> }",
  multipolygon:
    "{ coordinates: Array<Array<Array<{ x: number, y: number }>>> }",
  geometrycollection: "{ geometries: Array<any> }",
};

export const getJsTypeFromFieldType = (type: FieldType | string): string =>
  typeToJsType[type] ?? "string";

/**
 * Postgres element type of an "array" field, as the DDL writer reads it.
 * Python read `arrayType` and Go `arrayItemType` before `elementType`; both
 * still work so older schemas generate the same code.
 *
 * @param {Field} field - An "array" field from .apsorc.
 * @returns {string} The element type, "text" when none is set.
 */
export const arrayElementType = (
  field: Field & { arrayType?: string; arrayItemType?: string }
): string =>
  field.elementType || field.arrayType || field.arrayItemType || "text";

/**
 * A default that has to be written as SQL: { "sql": ... }, or an object or
 * array literal on a json or array field.
 *
 * @param {Field} field - A field from .apsorc.
 * @returns {string | undefined} The SQL text, or undefined for a plain literal.
 */
export const defaultSqlOf = (field: Field): string | undefined => {
  const d = field.default;
  if (d === null || typeof d !== "object") return undefined;
  if (!Array.isArray(d) && typeof d.sql === "string") return d.sql;
  return `'${JSON.stringify(d).replace(/'/g, "''")}'`;
};

/** A default Postgres itself fills with a new uuid. */
export const isUuidGenerator = (sql?: string | null): boolean =>
  /^(gen_random_uuid|uuid_generate_v\d)\(\)$/.test(sql ?? "");

// TypeORM reads a column default back through the first pattern before it
// compares it with the entity's. The second is the same thing limited to real
// type casts: TypeORM's also swallows what follows a cast, as in "::integer - 1".
const TYPEORM_CAST = /::[\s\w".[\]-]+/g;
const TYPE_CAST =
  /::"?[_a-z]\w*"?(?: varying| precision| with(?:out)? time zone)?(?:\(\d+(?:,\d+)?\))?(?:\[])?/gi;

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * A SQL default as a TypeORM entity has to spell it. TypeORM strips type
 * casts from the default it reads out of Postgres, so an entity that keeps
 * `'[]'::jsonb` never compares equal and the default is set again on every
 * schema sync and reported as drift. Postgres puts the cast back when the
 * column is created, so the database is the same either way.
 *
 * @param {string} sql - The default as the source database prints it.
 * @returns {string} The cast-free text, or the original when removing the
 * casts would remove more than casts or leave an untyped empty array.
 */
export const typeormDefault = (sql: string): string => {
  const stripped = sql.replace(TYPEORM_CAST, "");
  const onlyCasts = squash(stripped) === squash(sql.replace(TYPE_CAST, ""));
  return onlyCasts && !/array\[\s*]/i.test(stripped) ? stripped : sql;
};

export const getDefaultValueForField = (field: Field): string | null => {
  if (defaultSqlOf(field) !== undefined) return null;
  const literal = { ...field, default: field.default as string | null | undefined };
  return literalDefault(literal);
};

const literalDefault = (
  field: Omit<Field, "default"> & { default?: string | null }
): string | null => {
  switch (field.type) {
    case "enum":
      if (field.default === null) {
        return null;
      }

      if (typeof field.default !== "undefined") {
        if (!field.values?.includes(field.default)) {
          throw new Error(
            `${field.name}: Invalid default value '${
              field.default
            }' (Valid options are: '${field.values?.join("', '")}')`
          );
        }
        return field.default;
      }
      if (typeof field.values !== "undefined") {
        return field.values[0];
      }
      return null;
    case "boolean":
      if (typeof field.default !== "undefined") {
        return field.default;
      }
      return "false";
    default:
      if (typeof field.default !== "undefined") {
        return field.default;
      }
      return null;
  }
};

export const getFieldForTemplate = (
  fields: Field[],
  entityName: string
): ComputedField[] =>
  fields.map((field: Field) => {
    // Validate decimal/numeric fields
    validateDecimalField(field);
    if (field.generated !== undefined) {
      const clash =
        (field.primary && "primary") ||
        (field.default !== undefined && field.default !== null && "default");
      if (clash)
        throw new Error(
          `${entityName}.${field.name} sets "generated" and "${clash}". Postgres computes a generated column, so it cannot have a default or be the primary key.`
        );
    }

    // Normalize field type for template lookup (e.g., "double precision" -> "double")
    const normalizedType = normalizeFieldType(field.type);

    return {
      ...field,
      // Use normalized type for template lookup
      type: normalizedType as FieldType,
      // Resolved here so every template and the DDL writer read one key.
      ...(field.type === "array" && { elementType: arrayElementType(field) }),
      // A generated column has no default (a boolean would otherwise get false).
      default: field.generated ? null : getDefaultValueForField(field),
      ...(field.generated && { noDefault: true }),
      ...(defaultSqlOf(field) !== undefined && {
        defaultSql: defaultSqlOf(field),
      }),
      dataType:
        field.type === "enum"
          ? fieldToEnumType(field.name, entityName)
          : field.type === "array"
          ? `${getJsTypeFromFieldType(arrayElementType(field))}[]`
          : getJsTypeFromFieldType(field.type),
    };
  });

export const fieldToEnumType = (fieldName: string, entityName: string) =>
  `${pascalCase(entityName)}${pascalCase(fieldName)}Enum`;

export const typeExistsInEntity = (entity: Entity, type: string) =>
  entity?.fields
    ? entity?.fields.findIndex((field) => field.type === type)
    : -1;

export const validateDecimalField = (field: Field): void => {
  if (field.type !== "decimal" && field.type !== "numeric") {
    return;
  }

  // Validate precision
  if (
    field.precision !== undefined &&
    (field.precision < 1 || field.precision > 131_072)
  ) {
    throw new Error(
      `${field.name}: Invalid precision value ${field.precision}. Must be between 1 and 131072.`
    );
  }

  // Validate scale
  if (field.scale !== undefined) {
    if (field.scale < 0 || field.scale > 16_383) {
      throw new Error(
        `${field.name}: Invalid scale value ${field.scale}. Must be between 0 and 16383.`
      );
    }

    // Validate that scale doesn't exceed precision
    if (field.precision !== undefined && field.scale > field.precision) {
      throw new Error(
        `${field.name}: Scale (${field.scale}) cannot be greater than precision (${field.precision}).`
      );
    }
  }
};
