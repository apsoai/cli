import { createFile, camelCase, snakeCase } from "./util";
import * as Eta from "eta";
import * as path from "path";
import * as pluralize from "pluralize";

export type FieldType = "text" | "boolean" | "array" | "enum" | "integer";
export type AssociationType =
  | "OneToMany"
  | "ManyToOne"
  | "ManyToMany"
  | "OneToOne";

export interface Field {
  name: string;
  type: FieldType;
  values?: string[];
  nullable?: boolean;
  index?: boolean;
  primary?: boolean;
  unique?: boolean;
}

export interface ComputedField extends Field {
  dataType: string;
}

export interface Association {
  name: string;
  type: AssociationType;
  /* eslint-disable-next-line  camelcase */
  join_table: boolean;
}

interface Index {
  fields: string[];
  unique?: boolean;
}

export interface ComputedAssociation extends Association {
  camelCasedName: string;
  entityName: string;
  joinTable: boolean;
}

export interface Entity {
  name: string;
  /* eslint-disable-next-line  camelcase */
  created_at?: boolean;
  /* eslint-disable-next-line  camelcase */
  updated_at?: boolean;
  fields?: Field[];
  associations?: Association[];
  indexes?: Index[];
}

export const mapTypes = (type: FieldType): string => {
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

export const createEntity = async (
  apiBaseDir: string,
  entity: Entity
): Promise<void> => {
  const { name, fields = [], associations = [] } = entity;
  const File = path.join(apiBaseDir, `${name}.entity.ts`);

  const columns: ComputedField[] = fields.map((field: Field) => ({
    ...field,
    dataType: mapTypes(field.type),
  }));

  const createPrimaryKey =
    columns.filter((column: ComputedField) => column.primary === true)
      .length === 0;

  const createdAt = entity.created_at;
  const updatedAt = entity.updated_at;

  const relationships: ComputedAssociation[] = associations.map(
    (association: Association) => ({
      ...association,
      camelCasedName: camelCase(association.name),
      camelCasedId: `${camelCase(association.name)}Id`,
      entityName: camelCase(name),
      pluralizedName: pluralize(camelCase(association.name)),
      joinTable: association.join_table || false,
    })
  );

  const data = {
    name: entity.name,
    indexes: entity.indexes || [],
    createPrimaryKey,
    snakeCasedName: snakeCase(entity.name),
    createdAt,
    updatedAt,
    pluralizedName: pluralize(camelCase(entity.name)),
    columns,
    associations: relationships,
  };

  Eta.configure({
    // This tells Eta to look for templates
    // In the /templates directory
    views: path.join(__dirname, "templates"),
  });

  const content: any = await Eta.renderFileAsync("./entity", data);

  //   if (fs.existsSync(File)) {
  //     return
  //   }

  createFile(File, content);
};
