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

/**
 * An index whose column list TypeORM cannot declare: an expression such as
 * lower(email), or a column sorted DESC. Apso's own DDL creates it, in
 * migrations and after a schema sync, and TypeORM is told to leave it alone.
 */
export interface SqlIndex {
  /** Required: TypeORM is told about the index by name. */
  name: string;
  /** The column list as SQL, for example "user_id, created_at DESC". */
  columns: string;
  unique?: boolean;
  /** The condition of a partial index. */
  where?: string;
}
