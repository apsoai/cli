import { Entity } from "./types";

/**
 * Helpers for the opt-in DomainEvent ("emitEvents") feature.
 *
 * This implements the standard transactional-outbox pattern for durability, but
 * is surfaced with generic "domain event" naming (the user found "outbox"
 * unintuitive). No public artifact is named "outbox".
 *
 * Flag resolution: the effective per-entity value is
 *   `entity.emitEvents ?? globalEmitEvents ?? false`
 * so a top-level `emitEvents: true` enables it for every entity, while an
 * individual entity can opt out with `emitEvents: false` (global default WITH
 * per-entity opt-out).
 */

/**
 * Computes whether a single entity has domain events enabled, given the
 * top-level (global) default.
 */
export function isEmitEventsEnabled(
  entity: Entity,
  globalEmitEvents?: boolean
): boolean {
  return entity.emitEvents ?? globalEmitEvents ?? false;
}

/**
 * Computes the set of entities that have opted in to domain-event emission.
 * This is the single source of truth used everywhere (generator, wiring,
 * subscriber scoping).
 */
export function getEventEmittingEntities(
  entities: Entity[],
  globalEmitEvents?: boolean
): Entity[] {
  return entities.filter((entity) =>
    isEmitEventsEnabled(entity, globalEmitEvents)
  );
}

/**
 * Returns true when at least one entity has domain events enabled, meaning the
 * DomainEvent spine (entity, subscriber, mapper, relay, module) should be
 * generated.
 */
export function hasEventEmittingEntities(
  entities: Entity[],
  globalEmitEvents?: boolean
): boolean {
  return entities.some((entity) =>
    isEmitEventsEnabled(entity, globalEmitEvents)
  );
}
