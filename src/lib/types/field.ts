export type FieldType =
  | "text"
  | "boolean"
  | "array"
  | "enum"
  | "integer"
  | "date";

export interface Field {
  name: string;
  type: FieldType;
  values?: string[];
  nullable?: boolean;
  index?: boolean;
  primary?: boolean;
  unique?: boolean;
  default?: string | null;
  length?: number;
  /* eslint-disable-next-line  camelcase */
  is_email?: boolean;
}

export interface ComputedField extends Field {
  dataType: string;
}

export const getJsTypeFromFieldType = (type: FieldType): string => {
  switch (type) {
    case "array":
      return "string[]";
    case "boolean":
      return "boolean";
    case "integer":
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

export const getFieldForTemplate = (fields: Field[]): ComputedField[] =>
  fields.map((field: Field) => ({
    ...field,
    default: getDefaultValueForField(field),
    dataType: getJsTypeFromFieldType(field.type),
  }));
