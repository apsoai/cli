import { FieldType, Field, ComputedField, Entity } from "../types";
import { camelCase } from "./casing";

export const getJsTypeFromFieldType = (type: FieldType): string => {
  switch (type) {
    case "array":
      return "string[]";
    case "boolean":
      return "boolean";
    case "integer":
      return "number";
    case "float":
      return "number";
    case "text":
    case "enum":
    default:
      return "string";
  }
};

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
  fields.map((field: Field) => ({
    ...field,
    default: getDefaultValueForField(field),
    dataType:
      field.type === "enum"
        ? fieldToEnumType(field.name, entityName)
        : getJsTypeFromFieldType(field.type),
  }));

export const fieldToEnumType = (fieldName: string, entityName: string) =>
  `${camelCase(entityName, true)}${camelCase(fieldName, true)}Enum`;

export const typeExistsInEntity = (entity: Entity, type: string) =>
  entity?.fields
    ? entity?.fields.findIndex((field) => field.type === type)
    : -1;
