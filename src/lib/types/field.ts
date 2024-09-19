export type FieldType =
  | "text"
  | "boolean"
  | "array"
  | "enum"
  | "integer"
  | "float"
  | "date"
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
  default?: string | null;
  length?: number;
  /* eslint-disable-next-line  camelcase */
  is_email?: boolean;
}

export interface ComputedField extends Field {
  dataType: string;
}
