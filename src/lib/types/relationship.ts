export type RelationshipType =
  | "OneToMany"
  | "ManyToOne"
  | "ManyToMany"
  | "OneToOne";

/** A foreign key's ON DELETE rule. "cascadeDelete": true is "CASCADE". */
export type OnDelete =
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT"
  | "RESTRICT"
  | "NO ACTION";

/** When a DEFERRABLE foreign key is checked: per statement, or at commit. */
export type Deferrable = "INITIALLY IMMEDIATE" | "INITIALLY DEFERRED";

/** The rules of a foreign key beyond the column and the table it references. */
export interface KeyRules {
  /** The key's ON UPDATE rule. Defaults to NO ACTION. */
  onUpdate?: OnDelete;
  /** Makes the key DEFERRABLE, checked as the value says. */
  deferrable?: Deferrable;
  /** false keeps the key NOT VALID. Only migrations can create it that way. */
  validate?: boolean;
}

/**
 * A foreign key's rules as SQL writes them after REFERENCES.
 *
 * @param {OnDelete | undefined} onDelete - The ON DELETE rule, if not the default.
 * @param {KeyRules} k - The key's other rules.
 * @returns {string} "ON DELETE ... ON UPDATE ..." and what follows.
 */
export const keyRulesSql = (onDelete: OnDelete | undefined, k: KeyRules) =>
  `ON DELETE ${onDelete ?? "NO ACTION"} ON UPDATE ${k.onUpdate ?? "NO ACTION"}${
    k.deferrable ? ` DEFERRABLE ${k.deferrable}` : ""
  }${k.validate === false ? " NOT VALID" : ""}`;

/**
 * A foreign key's rules as TypeORM options, without the braces.
 *
 * @param {OnDelete | undefined} onDelete - The ON DELETE rule, if not the default.
 * @param {KeyRules} k - The key's other rules.
 * @returns {string} For example `onDelete: "CASCADE", onUpdate: "CASCADE"`.
 */
export const keyRuleOptions = (onDelete: OnDelete | undefined, k: KeyRules) => {
  // TypeORM types the rule "DEFAULT" and writes whatever it is given into
  // the SQL, where Postgres needs "SET DEFAULT".
  const rule = (r: OnDelete) =>
    r === "SET DEFAULT" ? '"SET DEFAULT" as never' : JSON.stringify(r);
  const onUpdate = k.onUpdate === "NO ACTION" ? undefined : k.onUpdate;
  return [
    onDelete && `onDelete: ${rule(onDelete)}`,
    onUpdate && `onUpdate: ${rule(onUpdate)}`,
    k.deferrable && `deferrable: ${JSON.stringify(k.deferrable)}`,
  ]
    .filter(Boolean)
    .join(", ");
};

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
  /** The foreign key's ON UPDATE rule. Defaults to NO ACTION. */
  onUpdate?: OnDelete;
  /** Makes the foreign key DEFERRABLE, checked as the value says. */
  deferrable?: Deferrable;
  /** The foreign key column's DEFAULT, as a SQL expression. */
  joinColumnDefault?: string;
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
  /** The foreign key's ON UPDATE rule. Defaults to NO ACTION. */
  onUpdate?: OnDelete;
  /** Makes the foreign key DEFERRABLE, checked as the value says. */
  deferrable?: Deferrable;
  /** The foreign key column's DEFAULT, as a SQL expression. */
  joinColumnDefault?: string;
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
