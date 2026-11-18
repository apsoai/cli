export interface Index {
  fields: string[];
  unique?: boolean;
  /** The index's name. Defaults to the name TypeORM derives. */
  name?: string;
  /**
   * A partial index: the SQL condition after WHERE, written against column
   * names, for example "deleted_at IS NULL". Postgres only.
   */
  where?: string;
}
