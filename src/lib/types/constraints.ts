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
}
