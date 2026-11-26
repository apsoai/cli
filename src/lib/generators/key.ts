import { Entity, Relationship, RelationshipMap } from "../types";
import { ModelColumn, schemaModel, tableName } from "../ddl";

/**
 * An entity's primary key as the DDL writer builds it: its columns in key
 * order (the primary fields as declared, then the id column of each primary
 * relationship), each with its SQL type. The Python and Go generators build
 * one path segment per column from this, so a route addresses a row by the
 * same key the table has.
 *
 * @param {Entity} entity - The entity.
 * @param {Relationship[]} relationships - The entity's own relationships.
 * @param {Entity[]} allEntities - Every entity in the schema.
 * @param {RelationshipMap} relationshipMap - Every entity's relationships.
 * @returns {ModelColumn[]} The key columns, in key order.
 */
export function keyColumns(
  entity: Entity,
  relationships: Relationship[],
  allEntities: Entity[] = [],
  relationshipMap: RelationshipMap = {}
): ModelColumn[] {
  const model = schemaModel({
    entities: allEntities.some((e) => e.name === entity.name)
      ? allEntities
      : [...allEntities, entity],
    relationshipMap: { ...relationshipMap, [entity.name]: relationships },
  });
  const table = tableName(entity);
  const columns = model.tables.find((t) => t.name === table)!.columns;
  return model.constraints
    .find((c) => c.kind === "pk" && c.table === table)!
    .columns.map((name) => columns.find((c) => c.name === name)!);
}

/**
 * True when a row is not addressed by one "id" segment: the key is several
 * columns, or one column with its own name.
 *
 * @param {ModelColumn[]} key - The key columns.
 * @returns {boolean} Whether the entity has its own key.
 */
export const hasOwnKey = (key: ModelColumn[]): boolean =>
  key.length !== 1 || key[0].name !== "id";
