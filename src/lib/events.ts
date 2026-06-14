import { Entity, DeliveryDestinationName, EventDeliveryConfig } from "./types";

/**
 * The full, ordered set of supported delivery-destination adapter names.
 * Used to validate/normalize the `eventDelivery.destinations` config.
 */
export const SUPPORTED_DELIVERY_DESTINATIONS: DeliveryDestinationName[] = [
  "webhook",
  "kafka",
  "sqs",
  "eventbridge",
];

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

/**
 * Resolves the set of delivery-destination adapters to GENERATE for issue #88.
 *
 * Returns a de-duplicated, validated, order-stable list. Unknown destination
 * names are silently dropped (validation surfaces elsewhere); the canonical
 * order of {@link SUPPORTED_DELIVERY_DESTINATIONS} is preserved so generated
 * output is deterministic regardless of how the config orders entries.
 *
 * This is a pure, build-time concern: it decides which adapter FILES are
 * emitted. The runtime `EVENTS_DESTINATION` env var (a comma list) selects and
 * activates among the generated set at deploy time.
 */
export function resolveDeliveryDestinations(
  eventDelivery?: EventDeliveryConfig
): DeliveryDestinationName[] {
  const requested = eventDelivery?.destinations ?? [];
  const requestedSet = new Set(requested);
  return SUPPORTED_DELIVERY_DESTINATIONS.filter((name) =>
    requestedSet.has(name)
  );
}
