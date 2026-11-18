export type RelationshipType =
  | "OneToMany"
  | "ManyToOne"
  | "ManyToMany"
  | "OneToOne";

/** A foreign key's ON DELETE rule. "cascadeDelete": true is "CASCADE". */
export type OnDelete = "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";

/**
 * The ON DELETE rule of a ManyToOne's foreign key, undefined for the
 * database default (NO ACTION).
 *
 * @param {object} r - A relationship's "onDelete" and "cascadeDelete".
 * @returns {OnDelete | undefined} The rule to write, if any.
 */
export const onDeleteOf = (r: {
  onDelete?: OnDelete;
  cascadeDelete?: boolean;
}): OnDelete | undefined => {
  const rule = r.onDelete || (r.cascadeDelete ? "CASCADE" : undefined);
  return rule === "NO ACTION" ? undefined : rule;
};

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
  onDelete?: OnDelete;
  /** Name of the foreign key constraint; defaults to the name TypeORM derives. */
  foreignKeyName?: string;
  /** The foreign key column is (part of) the entity's primary key. */
  primary?: boolean;
  /**
   * false keeps a foreign key NOT VALID: enforced for new rows, never checked
   * against the rows already there. Only migrations can create it that way.
   */
  validate?: boolean;
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
  onDelete?: OnDelete;
  /** Name of the foreign key constraint; defaults to the name TypeORM derives. */
  foreignKeyName?: string;
  /** The foreign key column is (part of) the entity's primary key. */
  primary?: boolean;
  /**
   * false keeps a foreign key NOT VALID: enforced for new rows, never checked
   * against the rows already there. Only migrations can create it that way.
   */
  validate?: boolean;
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
  referencedEntityPrimaryKeyType?: "serial" | "uuid";
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
