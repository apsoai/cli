import { expect, describe, test, beforeAll } from "@jest/globals";
import { TypeScriptGenerator } from "../../../src/lib/generators/typescript";
import { GeneratorConfig, Entity, Relationship, Field } from "../../../src/lib/types";

// Helper to create generator config
function createConfig(entities: Entity[], relationshipMap: { [key: string]: Relationship[] } = {}): GeneratorConfig {
  return {
    rootFolder: "/tmp/typescript-test-output",
    entities,
    relationshipMap,
    apiType: "rest",
    language: "typescript",
  };
}

// Helper to find content in generated files
function findFileContent(files: { path: string; content: string }[], filename: string): string | undefined {
  const file = files.find(f => f.path.includes(filename));
  return file?.content;
}

// Helper to list generated file paths
function filePathsOf(files: { path: string }[]): string[] {
  return files.map(f => f.path);
}

describe("TypeScriptGenerator", () => {
  let generator: TypeScriptGenerator;

  beforeAll(() => {
    const config = createConfig([]);
    generator = new TypeScriptGenerator(config);
  });

  describe("primary key handling", () => {
    test("generates @PrimaryGeneratedColumn() for serial type", async () => {
      const entity: Entity = {
        name: "User",
        primaryKeyType: "serial",
        fields: [
          { name: "email", type: "text", nullable: false },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "User.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("@PrimaryGeneratedColumn()");
      expect(entityContent).not.toContain("@PrimaryColumn()");
    });

    test("generates @PrimaryGeneratedColumn('uuid') for uuid type", async () => {
      const entity: Entity = {
        name: "Document",
        primaryKeyType: "uuid",
        fields: [
          { name: "title", type: "text", nullable: false },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Document.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("@PrimaryGeneratedColumn('uuid')");
      expect(entityContent).not.toContain("@PrimaryColumn()");
      expect(entityContent).toContain("id: string;");
    });

    test("uuid primary key does not use bare @Column({ type: 'uuid' })", async () => {
      const entity: Entity = {
        name: "Token",
        primaryKeyType: "uuid",
        fields: [],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Token.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("@PrimaryGeneratedColumn('uuid')");
      // Should NOT have a separate @Column for the primary key
      expect(entityContent).not.toContain("@Column({ type: 'uuid' })");
    });
  });

  describe("nullable scalar numeric fields (issue #61)", () => {
    test("nullable integer with default keeps nullable: true", async () => {
      const entity: Entity = {
        name: "Subscription",
        primaryKeyType: "serial",
        fields: [
          { name: "recurringIntervalCount", type: "integer", nullable: true, default: "1" },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Subscription.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain('@Column({ "type": "int", nullable: true, default:  1 })');
    });

    test("non-nullable integer is emitted with nullable: false", async () => {
      const entity: Entity = {
        name: "Counter",
        primaryKeyType: "serial",
        fields: [
          { name: "count", type: "integer", nullable: false },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Counter.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain('@Column({ "type": "int", nullable: false })');
    });

    test("nullable float, decimal, and numeric keep nullable: true", async () => {
      const entity: Entity = {
        name: "Measurement",
        primaryKeyType: "serial",
        fields: [
          { name: "ratio", type: "float", nullable: true },
          { name: "price", type: "decimal", nullable: true },
          { name: "weight", type: "numeric", nullable: true },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Measurement.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain('@Column({ "type": "decimal", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "decimal", precision: 10, scale: 2, nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "numeric", precision: 10, scale: 2, nullable: true })');
    });

    test("nullable bigint, smallint, double, real, and money keep nullable: true", async () => {
      const entity: Entity = {
        name: "Metric",
        primaryKeyType: "serial",
        // These types are dispatched to templates by raw string (entity.eta)
        // even though they are not in the FieldType union yet.
        fields: [
          { name: "total", type: "bigint", nullable: true },
          { name: "rank", type: "smallint", nullable: true },
          { name: "average", type: "double", nullable: true },
          { name: "sample", type: "real", nullable: true },
          { name: "cost", type: "money", nullable: true },
        ] as unknown as Field[],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Metric.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain('@Column({ "type": "bigint", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "smallint", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "float8", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "real", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "money", nullable: true })');
    });

    test("nullable boolean, enum, and other scalar types keep nullable: true", async () => {
      const entity: Entity = {
        name: "Profile",
        primaryKeyType: "serial",
        fields: [
          { name: "active", type: "boolean", nullable: true },
          { name: "tier", type: "enum", nullable: true, values: ["free", "pro"] },
          { name: "avatar", type: "bytea", nullable: true },
          { name: "sessionLength", type: "interval", nullable: true },
          { name: "checkIn", type: "time", nullable: true },
          { name: "checkOut", type: "timetz", nullable: true },
          { name: "externalId", type: "uuid", nullable: true },
        ] as unknown as Field[],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Profile.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("type: 'boolean', nullable: true");
      expect(entityContent).toContain("nullable: true,\n    enum:");
      expect(entityContent).toContain('@Column({ "type": "bytea", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "interval", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "time", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "timetz", nullable: true })');
      expect(entityContent).toContain('@Column({ "type": "uuid", nullable: true })');
    });

    test("timestamptz, timestamp, and datetime generate instant-in-time columns honoring nullable", async () => {
      const entity: Entity = {
        name: "Event",
        primaryKeyType: "serial",
        fields: [
          { name: "capturedAt", type: "timestamptz", nullable: true },
          { name: "occurredAt", type: "timestamp", nullable: false },
          { name: "loggedAt", type: "datetime", nullable: true },
        ] as unknown as Field[],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Event.entity");
      expect(entityContent).toBeDefined();
      // timestamptz (tz-aware) keeps its own column type
      expect(entityContent).toContain(
        "@Column({ type: 'timestamptz', nullable: true })"
      );
      expect(entityContent).toContain("capturedAt: Date;");
      // timestamp (naive) honors nullable: false
      expect(entityContent).toContain(
        "@Column({ type: 'timestamp', nullable: false })"
      );
      expect(entityContent).toContain("occurredAt: Date;");
      // datetime is an alias for a naive timestamp column
      expect(entityContent).toContain(
        "@Column({ type: 'timestamp', nullable: true })"
      );
      expect(entityContent).toContain("loggedAt: Date;");
    });

    test("nullable enum with explicit null default omits the default option", async () => {
      const entity: Entity = {
        name: "Foo",
        primaryKeyType: "serial",
        fields: [
          { name: "tier", type: "enum", values: ["free", "pro"], nullable: true, default: null },
        ] as unknown as Field[],
      };

      let files: { path: string; content: string }[] | undefined;
      await expect(
        (async () => {
          files = await generator.generateEntity({
            entity,
            relationships: [],
            allEntities: [entity],
            apiType: "rest",
          });
        })()
      ).resolves.not.toThrow();

      const entityContent = findFileContent(files!, "Foo.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("nullable: true");
      expect(entityContent).toContain("enum: enums.FooTierEnum");
      expect(entityContent).not.toContain("default:");
    });
  });
});

describe("emitEvents / domain events (issue #79)", () => {
  let generator: TypeScriptGenerator;

  beforeAll(() => {
    generator = new TypeScriptGenerator(createConfig([]));
  });

  test("entity with emitEvents:true generates the full domain-event spine", async () => {
    const entity: Entity = {
      name: "Product",
      primaryKeyType: "serial",
      emitEvents: true,
      fields: [{ name: "title", type: "text" }],
    };

    const files = await generator.generateDomainEvents([entity], "rest", {});

    // DomainEvent entity
    const entityContent = findFileContent(files, "domain-event.entity");
    expect(entityContent).toBeDefined();
    expect(entityContent).toContain("@Entity('events')");
    expect(entityContent).toContain("export class DomainEvent");
    expect(entityContent).toContain("@PrimaryGeneratedColumn('uuid')");
    expect(entityContent).toContain("@Column({ type: 'jsonb' })");
    expect(entityContent).toContain("@Column({ type: 'varchar', default: 'pending' })");
    expect(entityContent).toContain("@Column({ type: 'int', default: 0 })");
    expect(entityContent).toContain("@CreateDateColumn({ type: 'timestamptz' })");
    expect(entityContent).toContain("@Index(['status', 'created_at'])");
    // No public artifact is named "outbox"
    expect(entityContent).not.toMatch(/class\s+\w*Outbox/);

    // Subscriber
    const subscriberContent = findFileContent(files, "domain-event.subscriber");
    expect(subscriberContent).toBeDefined();
    expect(subscriberContent).toContain("@EventSubscriber()");
    expect(subscriberContent).toContain("export class DomainEventSubscriber");
    // imports the opted-in entity class
    expect(subscriberContent).toContain("import { Product } from '../Product/Product.entity'");
    // shares the active transaction via event.manager
    expect(subscriberContent).toContain("event.manager");
    // recursion guard against DomainEvent itself
    expect(subscriberContent).toContain("target === DomainEvent");
    // multi-datasource robust registration
    expect(subscriberContent).toContain("dataSource?.subscribers?.push(this)");

    // Mapper: interface + default + token
    const mapperContent = findFileContent(files, "domain-event.mapper");
    expect(mapperContent).toBeDefined();
    expect(mapperContent).toContain("export const DOMAIN_EVENT_MAPPER");
    expect(mapperContent).toContain("export interface DomainEventMapper");
    expect(mapperContent).toContain("export class DefaultDomainEventMapper");

    // Relay: publish() is the extension point that throws
    const relayContent = findFileContent(files, "domain-event.relay");
    expect(relayContent).toBeDefined();
    expect(relayContent).toContain("export class DomainEventRelay");
    expect(relayContent).toContain("processPending");
    expect(relayContent).toContain(
      "DomainEventRelay.publish() not implemented"
    );
    // commented-out scheduler example only — no real (uncommented) import of @nestjs/schedule
    expect(relayContent).not.toMatch(/^\s*import .*@nestjs\/schedule/m);

    // @Global() module
    const moduleContent = findFileContent(files, "domain-events.module");
    expect(moduleContent).toBeDefined();
    expect(moduleContent).toContain("@Global()");
    expect(moduleContent).toContain("export class DomainEventsModule");
    expect(moduleContent).toContain("TypeOrmModule.forFeature([DomainEvent])");
    expect(moduleContent).toContain("useClass: DefaultDomainEventMapper");

    // barrel
    const indexContent = findFileContent(files, "events/index");
    expect(indexContent).toBeDefined();
    expect(indexContent).toContain("./domain-events.module");
  });

  test("global emitEvents:true with per-entity opt-out excludes that entity", async () => {
    const optedOut: Entity = {
      name: "AuditLog",
      emitEvents: false,
      fields: [{ name: "msg", type: "text" }],
    };
    const noFlag: Entity = {
      name: "Order",
      fields: [{ name: "total", type: "integer" }],
    };

    const files = await generator.generateDomainEvents(
      [optedOut, noFlag],
      "rest",
      { emitEvents: true }
    );

    const subscriberContent = findFileContent(files, "domain-event.subscriber");
    expect(subscriberContent).toBeDefined();
    // entity without the flag IS included (inherits global true)
    expect(subscriberContent).toContain("import { Order }");
    expect(subscriberContent).toContain("Order,");
    // entity that opted out is NOT included
    expect(subscriberContent).not.toContain("import { AuditLog }");
  });

  test("no entity opted in returns [] and index barrel omits DomainEventsModule", async () => {
    const entity: Entity = {
      name: "Widget",
      fields: [{ name: "name", type: "text" }],
    };

    const files = await generator.generateDomainEvents([entity], "rest", {});
    expect(files).toEqual([]);

    const indexFiles = await generator.generateIndexModule([entity], "rest", {});
    const indexContent = findFileContent(indexFiles, "index");
    expect(indexContent).toBeDefined();
    expect(indexContent).not.toContain("DomainEventsModule");
  });

  test("index barrel includes DomainEventsModule when an entity opts in", async () => {
    const entity: Entity = {
      name: "Widget",
      emitEvents: true,
      fields: [{ name: "name", type: "text" }],
    };

    const indexFiles = await generator.generateIndexModule([entity], "rest", {});
    const indexContent = findFileContent(indexFiles, "index");
    expect(indexContent).toBeDefined();
    expect(indexContent).toContain("import { DomainEventsModule } from './events'");
    expect(indexContent).toContain("DomainEventsModule,");
  });

  test("DomainEvent entity is excluded from emission via recursion guard", async () => {
    const entity: Entity = {
      name: "Product",
      emitEvents: true,
      fields: [{ name: "title", type: "text" }],
    };
    const files = await generator.generateDomainEvents([entity], "rest", {});
    const subscriberContent = findFileContent(files, "domain-event.subscriber");
    expect(subscriberContent).toContain("target === DomainEvent");
    expect(subscriberContent).toContain("target === 'DomainEvent'");
  });
});

describe("event delivery destinations (issue #88)", () => {
  let generator: TypeScriptGenerator;

  beforeAll(() => {
    generator = new TypeScriptGenerator(createConfig([]));
  });

  const optedIn: Entity = {
    name: "Product",
    emitEvents: true,
    fields: [{ name: "title", type: "text" }],
  };

  test("webhook destination generates the seam, factory, adapter, and rewires relay/module", async () => {
    const files = await generator.generateDomainEvents([optedIn], "rest", {
      eventDelivery: { destinations: ["webhook"] },
    });
    const filePaths = filePathsOf(files);

    // Seam interface + token
    const seam = findFileContent(files, "destinations/delivery-destination");
    expect(seam).toContain("export interface DeliveryDestination");
    expect(seam).toContain(
      "export const DOMAIN_EVENT_DESTINATIONS = 'DOMAIN_EVENT_DESTINATIONS'"
    );

    // Factory (destinations/index.ts) reads EVENTS_DESTINATION and builds
    const factory = findFileContent(files, "destinations/index");
    expect(factory).toContain("export function buildDestinations()");
    expect(factory).toContain("process.env.EVENTS_DESTINATION");
    expect(factory).toContain("WebhookDestination");
    expect(factory).toContain("is not generated; add it to .apsorc");

    // Webhook adapter with Standard Webhooks signing
    const webhook = findFileContent(files, "destinations/webhook.destination");
    expect(webhook).toContain("class WebhookDestination");
    expect(webhook).toContain("implements DeliveryDestination");
    expect(webhook).toContain("name = 'webhook'");
    expect(webhook).toContain("createHmac('sha256'");
    expect(webhook).toContain("'webhook-id'");
    expect(webhook).toContain("'webhook-timestamp'");
    expect(webhook).toContain("'webhook-signature'");
    expect(webhook).toContain("return `v1,");
    expect(webhook).toContain("EVENTS_WEBHOOK_URL");
    expect(webhook).toContain("EVENTS_WEBHOOK_SECRET");
    expect(webhook).toContain("if (!response.ok)");

    // Relay delegates to destinations
    const relay = findFileContent(files, "domain-event.relay");
    expect(relay).toContain("DOMAIN_EVENT_DESTINATIONS");
    expect(relay).toContain("@Optional()");
    expect(relay).toContain("this.destinations.map((d) => d.send(event))");
    expect(relay).not.toContain(
      "DomainEventRelay.publish() not implemented"
    );

    // Module provides the destinations token
    const moduleContent = findFileContent(files, "domain-events.module");
    expect(moduleContent).toContain("DOMAIN_EVENT_DESTINATIONS");
    expect(moduleContent).toContain("useFactory: () => buildDestinations()");

    // Barrel re-exports destinations
    const indexContent = findFileContent(files, "events/index");
    expect(indexContent).toContain("export * from './destinations'");

    // .env.example documents the vars
    const env = findFileContent(files, "EVENTS.env.example");
    expect(env).toContain("EVENTS_DESTINATION=webhook");
    expect(env).toContain("EVENTS_WEBHOOK_URL");
    expect(env).toContain("EVENTS_WEBHOOK_SECRET");

    // No other adapters, and NO registry / WebhookEndpoint table
    expect(filePaths).not.toContain(
      "events/destinations/kafka.destination.ts"
    );
    expect(filePaths).not.toContain("events/destinations/sqs.destination.ts");
    expect(filePaths).not.toContain(
      "events/destinations/eventbridge.destination.ts"
    );
    const all = files.map((f) => f.content).join("\n");
    expect(all).not.toContain("WebhookEndpoint");
    expect(all).not.toContain("subscriptions");
  });

  test("kafka + sqs generates only those two adapters", async () => {
    const files = await generator.generateDomainEvents([optedIn], "rest", {
      eventDelivery: { destinations: ["kafka", "sqs"] },
    });
    const filePaths = filePathsOf(files);

    expect(filePaths).toContain("events/destinations/kafka.destination.ts");
    expect(filePaths).toContain("events/destinations/sqs.destination.ts");
    expect(filePaths).not.toContain(
      "events/destinations/webhook.destination.ts"
    );
    expect(filePaths).not.toContain(
      "events/destinations/eventbridge.destination.ts"
    );

    const kafka = findFileContent(files, "destinations/kafka.destination");
    expect(kafka).toContain("@nestjs/microservices");
    expect(kafka).toContain("Transport.KAFKA");
    expect(kafka).toContain("EVENTS_KAFKA_BROKERS");
    expect(kafka).toContain("EVENTS_KAFKA_TOPIC");

    const sqs = findFileContent(files, "destinations/sqs.destination");
    expect(sqs).toContain("@aws-sdk/client-sqs");
    expect(sqs).toContain("SendMessageCommand");
    expect(sqs).toContain("EVENTS_SQS_QUEUE_URL");

    // env.example lists install lines for the brokers
    const env = findFileContent(files, "EVENTS.env.example");
    expect(env).toContain("npm install @nestjs/microservices");
    expect(env).toContain("npm install @aws-sdk/client-sqs");
  });

  test("eventbridge generates its adapter with the apso source", async () => {
    const files = await generator.generateDomainEvents([optedIn], "rest", {
      eventDelivery: { destinations: ["eventbridge"] },
    });
    const eb = findFileContent(files, "destinations/eventbridge.destination");
    expect(eb).toContain("@aws-sdk/client-eventbridge");
    expect(eb).toContain("PutEventsCommand");
    expect(eb).toContain("Source: 'apso.domain-events'");
    expect(eb).toContain("EVENTS_EVENTBRIDGE_BUS");
  });

  test("no eventDelivery: no destinations dir, relay keeps #80 throw", async () => {
    const files = await generator.generateDomainEvents([optedIn], "rest", {});
    const filePaths = filePathsOf(files);

    expect(
      filePaths.some((p) => p.startsWith("events/destinations/"))
    ).toBe(false);
    expect(filePaths).not.toContain("events/EVENTS.env.example");

    const relay = findFileContent(files, "domain-event.relay");
    expect(relay).toContain("DomainEventRelay.publish() not implemented");
    expect(relay).not.toContain("DOMAIN_EVENT_DESTINATIONS");

    const moduleContent = findFileContent(files, "domain-events.module");
    expect(moduleContent).not.toContain("DOMAIN_EVENT_DESTINATIONS");

    const indexContent = findFileContent(files, "events/index");
    expect(indexContent).not.toContain("export * from './destinations'");
  });

  test("empty destinations behaves like no eventDelivery", async () => {
    const files = await generator.generateDomainEvents([optedIn], "rest", {
      eventDelivery: { destinations: [] },
    });
    expect(
      filePathsOf(files).some((p) => p.startsWith("events/destinations/"))
    ).toBe(false);
    const relay = findFileContent(files, "domain-event.relay");
    expect(relay).toContain("DomainEventRelay.publish() not implemented");
  });

  test("destinations are not generated when no entity opts in", async () => {
    const noOptIn: Entity = {
      name: "Widget",
      fields: [{ name: "name", type: "text" }],
    };
    const files = await generator.generateDomainEvents([noOptIn], "rest", {
      eventDelivery: { destinations: ["webhook"] },
    });
    expect(files).toEqual([]);
  });
});
