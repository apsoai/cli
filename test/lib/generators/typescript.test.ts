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
