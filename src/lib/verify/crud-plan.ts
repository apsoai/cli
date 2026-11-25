/**
 * What the smoke test creates, reads and deletes: one row per entity, built
 * from the .apsorc, in an order where every required parent exists first.
 */

import { randomUUID } from "crypto";
import { Entity } from "../types/entity";
import { Field } from "../types/field";
import { RelationshipMap } from "../types/relationship";
import { getRelationshipIdField } from "../utils/relationships";

const DATE = "2024-01-01T00:00:00.000Z";

/** A value for a required field, or undefined when its type can't be filled. */
export function sampleValue(field: Field): unknown {
  if (field.is_email) return "smoke@example.com";
  switch (field.type as string) {
    case "text":
    case "string":
    case "varchar":
      return "smoke".slice(0, Math.min(5, field.length ?? 5));
    case "integer":
    case "int":
    case "bigint":
      return 1;
    case "decimal":
    case "numeric":
    case "float":
      return 1.5;
    case "boolean":
      return true;
    case "date":
    case "timestamp":
    case "timestamptz":
    case "datetime":
      return DATE;
    case "enum":
      return field.values?.[0];
    case "uuid":
      return randomUUID();
    case "json":
    case "jsonb":
    case "json-plain":
      return {};
    default:
      return undefined;
  }
}

/**
 * Required = not nullable, no default, and not a key the database fills. A
 * uuid primary key is generated; any other primary field needs a value.
 */
const required = (field: Field) =>
  !field.nullable &&
  (field.default === undefined || field.default === null) &&
  !(field.primary && (field.type as string) === "uuid");

export interface PlannedEntity {
  name: string;
  /** The property that addresses a row: "id" unless the entity has its own key. */
  key: string;
  payload: Record<string, unknown>;
  /** Foreign keys to fill from parents created earlier: property -> parent entity. */
  parents: { property: string; entity: string }[];
  /** The uuid id has no default ("primaryKeyDefault": null): each create sends one. */
  suppliesId?: boolean;
}

export interface CrudPlan {
  /** Parents before children. */
  order: PlannedEntity[];
  skipped: { name: string; reason: string }[];
}

export function planCrud(
  entities: Entity[],
  relationships: RelationshipMap
): CrudPlan {
  const pending: PlannedEntity[] = [];
  const skipped: CrudPlan["skipped"] = [];
  for (const entity of entities) {
    const payload: Record<string, unknown> = {};
    const bad = (entity.fields || [])
      .filter((field) => required(field))
      .find((field) => {
        payload[field.name] = sampleValue(field);
        return payload[field.name] === undefined;
      });
    if (bad) {
      skipped.push({
        name: entity.name,
        reason: `required field "${bad.name}" has type "${bad.type}", which the smoke test can't fill`,
      });
      continue;
    }
    const manyToOne = (relationships[entity.name] || []).filter(
      (r) => r.type === "ManyToOne"
    );
    const parents = manyToOne
      .filter((r) => !r.nullable)
      .map((r) => ({ property: getRelationshipIdField(r), entity: r.name }));
    // The same rule as the generated controller's id parameter.
    const keys = [
      ...(entity.fields || []).filter((f) => f.primary).map((f) => f.name),
      ...manyToOne.filter((r) => r.primary).map((r) => getRelationshipIdField(r)),
    ];
    pending.push({
      name: entity.name,
      key: keys.length === 1 ? keys[0] : "id",
      payload,
      parents,
      ...(keys.length === 0 &&
        entity.primaryKeyType === "uuid" &&
        entity.primaryKeyDefault === null && { suppliesId: true }),
    });
  }

  // Topological order: take entities whose required parents are all planned.
  const order: PlannedEntity[] = [];
  const planned = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const p of pending) {
      if (planned.has(p.name)) continue;
      if (p.parents.every((parent) => planned.has(parent.entity))) {
        order.push(p);
        planned.add(p.name);
        progress = true;
      }
    }
  }
  for (const p of pending) {
    if (planned.has(p.name)) continue;
    const missing = p.parents
      .map((parent) => parent.entity)
      .filter((name) => !planned.has(name));
    skipped.push({
      name: p.name,
      reason: `needs a ${missing.join(
        ", "
      )} row first, which can't be created (a cycle of required relationships or a skipped entity)`,
    });
  }
  return { order, skipped };
}
