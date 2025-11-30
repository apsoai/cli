import { FieldType, Field, ComputedField, Entity } from "../types";
import { pascalCase } from "./casing";

const typeToJsType: Record<string, string> = {
  array: "string[]", // or handle elementType elsewhere
  boolean: "boolean",
  integer: "number",
  float: "number",
  real: "number",
  double: "number",
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

export const getDefaultValueForField = (field: Field): string | null => {
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

    return {
      ...field,
      default: getDefaultValueForField(field),
      dataType:
        field.type === "enum"
          ? fieldToEnumType(field.name, entityName)
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
