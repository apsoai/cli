import { camelCase } from "../util";
import { Entity } from "./entity";
import * as pluralize from "pluralize";

export type AssociationType =
  | "OneToMany"
  | "ManyToOne"
  | "ManyToMany"
  | "OneToOne";

export interface Association {
  name: string;
  type: AssociationType;
  /* eslint-disable-next-line  camelcase */
  join_table?: boolean;
  /* eslint-disable-next-line  camelcase */
  reference_name?: string;
  nested?: boolean;
  nullable?: boolean;
}

export interface ComputedAssociation extends Association {
  relationshipName: string;
  pluralizedRelationshipName: string;
  pluralizedName: string;
  camelCasedName: string;
  camelCasedId: string;
  entityName: string;
  joinTable: boolean;
  hasInverse: boolean;
}

const getRelationshipName = (association: Association): string => {
  if (association.reference_name) {
    return camelCase(association.reference_name);
  }
  return camelCase(association.name);
};

export const getRelationshipIdField = (association: Association): string => {
  return `${getRelationshipName(association)}Id`;
};

export const isInverseRelationshipDefined = (
  entityName: string,
  association: Association,
  entities: Entity[]
): boolean =>
  Boolean(
    entities
      .find((entity) => entity.name === association.name)
      ?.associations?.find((entity) => entity.name === entityName)
  );

export const getAssociationForTemplate = (
  entityName: string,
  associations: Association[],
  entities: Entity[]
): ComputedAssociation[] =>
  associations.map((association: Association) => ({
    ...association,
    relationshipName: getRelationshipName(association),
    pluralizedRelationshipName: pluralize(getRelationshipName(association)),
    pluralizedName: pluralize(camelCase(association.name)),
    camelCasedName: camelCase(association.name),
    camelCasedId: getRelationshipIdField(association),
    entityName: camelCase(entityName),
    joinTable: association.join_table || false,
    hasInverse: isInverseRelationshipDefined(entityName, association, entities),
  }));

export const getNestedRelationships = (
  entityName: string,
  entities: Entity[],
  associations?: Association[]
): (string | null | undefined)[] | null => {
  if (typeof associations === "undefined") {
    return null;
  }

  return associations.flatMap((association: Association) => {
    const { name: associationName, type } = association;
    const referenceName = getRelationshipName(association);

    const associatedModel = entities.find(
      (entity) => entity.name === associationName
    );
    return associatedModel?.associations
      ?.map((association: Association) => {
        const {
          name: childAssociationName,
          type: childType,
          nested,
        } = association;
        if (nested === false) {
          return null;
        }

        const childReferenceName = getRelationshipName(association);

        if (childAssociationName !== entityName) {
          const parent =
            type === "ManyToOne" || type === "OneToOne"
              ? camelCase(referenceName)
              : pluralize(camelCase(associationName));
          const child =
            childType === "ManyToOne" || childType === "OneToOne"
              ? camelCase(childReferenceName)
              : pluralize(camelCase(childAssociationName));
          return `${parent}.${child}`;
        }

        return null;
      })
      .filter((e) => e) || [];
  });
};
