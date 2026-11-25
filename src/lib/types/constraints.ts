import { Deferrable, OnDelete } from "./relationship";

export interface Unique {
  fields: string[];
  name?: string;
}

/** A CHECK constraint: a rule every row must satisfy, whatever writes it. */
export interface Check {
  /** The constraint's name. Defaults to the name TypeORM derives. */
  name?: string;
  /** The SQL condition, written against column names. */
  expression: string;
  /**
   * False keeps the constraint NOT VALID in migrations: new and changed rows
   * are checked, rows already there are not. TypeORM's own schema sync
   * creates it validated, which only differs on a database that has rows.
   */
  validate?: boolean;
}

/**
 * A foreign key beyond the one a relationship makes, for a column that has
 * more than one. It is a database constraint only: no relation property.
 */
export interface ExtraForeignKey {
  name: string;
  /** The column's database name. */
  column: string;
  /** The entity it references, by its primary key. */
  to: string;
  onDelete?: OnDelete;
  /** The key's ON UPDATE rule. Defaults to NO ACTION. */
  onUpdate?: OnDelete;
  /** Makes the key DEFERRABLE, checked as the value says. */
  deferrable?: Deferrable;
  /** False keeps the key NOT VALID in migrations, as on a relationship. */
  validate?: boolean;
}
