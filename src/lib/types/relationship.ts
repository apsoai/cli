export type RelationshipType =
  | "OneToMany"
  | "ManyToOne"
  | "ManyToMany"
  | "OneToOne";

export interface ApsorcRelationship {
  from: string;
  to: string;
  type: RelationshipType;
  /* eslint-disable-next-line  camelcase */
  to_name?: string;
  nullable?: boolean;
  /* eslint-disable-next-line  camelcase */
  bi_directional?: boolean;
  cascadeDelete?: boolean;
  index?: boolean;
  joinTableName?: string;
  joinColumnName?: string;
  inverseJoinColumnName?: string;
}

export interface Relationship {
  name: string;
  type: RelationshipType;
  referenceName?: string | null;
  nullable?: boolean;
  join?: boolean;
  biDirectional?: boolean;
  cascadeDelete?: boolean;
  index?: boolean;
  joinTableName?: string;
  joinColumnName?: string;
  inverseJoinColumnName?: string;
  inverseReferenceName?: string;
}

export interface RelationshipForTemplate extends Relationship {
  relationshipName: string;
  pluralizedRelationshipName: string;
  pluralizedName: string;
  camelCasedName: string;
  camelCasedId: string;
  entityName: string;
  joinTable: boolean;
  biDirectional: boolean;
  inversePropertyName?: string;
}

export type RelationshipMap = { [key: string]: Relationship[] };

// Only used for v1
export interface Association {
  name: string;
  type: RelationshipType;
  /* eslint-disable-next-line  camelcase */
  join_table?: boolean;
  /* eslint-disable-next-line  camelcase */
  reference_name?: string;
  nested?: boolean;
  nullable?: boolean;
  index?: boolean;
}
