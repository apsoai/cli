import { expect, describe, test } from "@jest/globals";
import {
  isEmitEventsEnabled,
  getEventEmittingEntities,
  hasEventEmittingEntities,
} from "../../src/lib/events";
import { Entity } from "../../src/lib/types";

const entity = (name: string, emitEvents?: boolean): Entity => ({
  name,
  ...(emitEvents === undefined ? {} : { emitEvents }),
});

describe("emitEvents flag resolution (issue #79)", () => {
  describe("isEmitEventsEnabled", () => {
    test("defaults to false with no flags", () => {
      expect(isEmitEventsEnabled(entity("A"))).toBe(false);
    });

    test("per-entity true wins", () => {
      expect(isEmitEventsEnabled(entity("A", true))).toBe(true);
    });

    test("global true applies when entity has no flag", () => {
      expect(isEmitEventsEnabled(entity("A"), true)).toBe(true);
    });

    test("per-entity false opts out of global true", () => {
      expect(isEmitEventsEnabled(entity("A", false), true)).toBe(false);
    });

    test("per-entity true opts in despite global false", () => {
      expect(isEmitEventsEnabled(entity("A", true), false)).toBe(true);
    });
  });

  describe("getEventEmittingEntities", () => {
    test("returns only opted-in entities under global default with opt-out", () => {
      const entities = [
        entity("OptedIn"), // inherits global true
        entity("OptedOut", false), // explicit opt-out
        entity("Explicit", true),
      ];
      const result = getEventEmittingEntities(entities, true).map((e) => e.name);
      expect(result).toEqual(["OptedIn", "Explicit"]);
    });

    test("returns [] when nothing is opted in", () => {
      const entities = [entity("A"), entity("B", false)];
      expect(getEventEmittingEntities(entities)).toEqual([]);
    });
  });

  describe("hasEventEmittingEntities", () => {
    test("true when at least one entity opts in", () => {
      expect(hasEventEmittingEntities([entity("A", true)])).toBe(true);
    });

    test("false when none opt in", () => {
      expect(hasEventEmittingEntities([entity("A")])).toBe(false);
    });
  });
});
