import { createFile, camelCase } from "./util";
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
}

export interface ComputedField extends Field {
  dataType: string;
}

interface Association {
  name: string;
  type: AssociationType;
}

interface ComputedAssociation extends Association {
  camelCasedName: string;
  entityName: string;
}

export interface Entity {
  name: string;
  fields?: Field[];
  associations?: Association[];
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
  const Dir = path.join(apiBaseDir, "entities");
  const File = path.join(Dir, `${name}.ts`);

  const columns: ComputedField[] = fields.map((field: Field) => ({
    ...field,
    dataType: mapTypes(field.type),
  }));

  const relationships: ComputedAssociation[] = associations.map(
    (association: Association) => ({
      ...association,
      camelCasedName: camelCase(association.name),
      entityName: camelCase(name),
    })
  );

  const data = {
    name: entity.name,
    pluralizedName: pluralize(entity.name.toLowerCase()),
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
