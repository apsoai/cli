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

describe("emitEvents / domain events manifest (issue #91)", () => {
  let generator: TypeScriptGenerator;

  beforeAll(() => {
    generator = new TypeScriptGenerator(createConfig([]));
  });

  test("entity with emitEvents:true emits a single event-emitting manifest", async () => {
    const entity: Entity = {
      name: "Product",
      primaryKeyType: "serial",
      emitEvents: true,
      fields: [{ name: "title", type: "text" }],
    };

    const files = await generator.generateDomainEvents([entity], "rest", {});

    // Exactly one file: the schema-derived manifest.
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("events/event-emitting.entities.ts");

    const content = files[0].content;
    // Imports the opted-in entity class from its generated entity path.
    expect(content).toContain(
      "import { Product } from '../Product/Product.entity';"
    );
    // Exports the manifest of classes and names.
    expect(content).toContain("export const EVENT_EMITTING_ENTITIES = [");
    expect(content).toContain("Product,");
    expect(content).toContain("export const EVENT_EMITTING_ENTITY_NAMES = [");
    expect(content).toContain("'Product',");

    // No engine code is generated under events/.
    expect(content).not.toContain("class DomainEvent");
    expect(content).not.toContain("DomainEventsModule");
    expect(content).not.toContain("DomainEventRelay");
    expect(content).not.toContain("destinations");
  });

  test("manifest lists exactly the opted-in entities (global default with opt-out)", async () => {
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

    expect(files).toHaveLength(1);
    const content = files[0].content;
    // entity without the flag IS included (inherits global true)
    expect(content).toContain(
      "import { Order } from '../Order/Order.entity';"
    );
    expect(content).toContain("Order,");
    expect(content).toContain("'Order',");
    // entity that opted out is NOT included
    expect(content).not.toContain("import { AuditLog }");
    expect(content).not.toContain("'AuditLog'");
  });

  test("no entity opted in returns [] and index barrel has no events import", async () => {
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
    expect(indexContent).not.toContain("./events");
  });

  test("index barrel never imports a generated DomainEventsModule, even when opted in", async () => {
    const entity: Entity = {
      name: "Widget",
      emitEvents: true,
      fields: [{ name: "name", type: "text" }],
    };

    const indexFiles = await generator.generateIndexModule([entity], "rest", {});
    const indexContent = findFileContent(indexFiles, "index");
    expect(indexContent).toBeDefined();
    // The module now comes from @apso/domain-events, wired by the skill.
    expect(indexContent).not.toContain("DomainEventsModule");
    expect(indexContent).not.toContain("./events");
    // entity-module wiring is intact
    expect(indexContent).toContain("WidgetModule");
  });
});
