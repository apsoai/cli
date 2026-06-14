import { expect, describe, test } from "@jest/globals";
import { createHmac } from "crypto";
import {
  isEmitEventsEnabled,
  getEventEmittingEntities,
  hasEventEmittingEntities,
  resolveDeliveryDestinations,
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
      const result = getEventEmittingEntities(entities, true).map(
        (e) => e.name
      );
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

describe("resolveDeliveryDestinations (issue #88)", () => {
  test("returns [] when no eventDelivery", () => {
    expect(resolveDeliveryDestinations()).toEqual([]);
    expect(resolveDeliveryDestinations({})).toEqual([]);
    expect(resolveDeliveryDestinations({ destinations: [] })).toEqual([]);
  });

  test("returns the configured set", () => {
    expect(resolveDeliveryDestinations({ destinations: ["webhook"] })).toEqual([
      "webhook",
    ]);
    expect(
      resolveDeliveryDestinations({ destinations: ["kafka", "sqs"] })
    ).toEqual(["kafka", "sqs"]);
  });

  test("normalizes to canonical order regardless of config order", () => {
    expect(
      resolveDeliveryDestinations({
        destinations: ["eventbridge", "webhook", "sqs", "kafka"],
      })
    ).toEqual(["webhook", "kafka", "sqs", "eventbridge"]);
  });

  test("de-duplicates repeated entries", () => {
    expect(
      resolveDeliveryDestinations({
        destinations: ["webhook", "webhook", "kafka"],
      })
    ).toEqual(["webhook", "kafka"]);
  });

  test("drops unknown destination names", () => {
    const config = {
      destinations: ["webhook", "bogus"],
    } as unknown as Parameters<typeof resolveDeliveryDestinations>[0];
    expect(resolveDeliveryDestinations(config)).toEqual(["webhook"]);
  });
});

// Mirrors the exact algorithm emitted in webhook.destination.ts so the
// canonical Standard Webhooks (standardwebhooks.com) test vector is locked in.
function signWebhook(
  id: string,
  timestamp: number,
  body: string,
  secret: string
): string {
  const signedContent = `${id}.${timestamp}.${body}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  return `v1,${signature}`;
}

describe("Standard Webhooks signing algorithm (issue #88)", () => {
  test("matches the official reference test vector", () => {
    const sig = signWebhook(
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      1_614_265_330,
      '{"test": 2432232314}',
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
    );
    expect(sig).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  test("is deterministic and v1-prefixed", () => {
    const args: [string, number, string, string] = [
      "evt_1",
      1_700_000_000,
      '{"a":1}',
      "whsec_dGVzdHNlY3JldA==",
    ];
    const a = signWebhook(...args);
    const b = signWebhook(...args);
    expect(a).toBe(b);
    expect(a.startsWith("v1,")).toBe(true);
  });
});
