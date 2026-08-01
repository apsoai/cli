import { expect, describe, test, beforeAll } from "@jest/globals";
import { PythonGenerator } from "../../../src/lib/generators/python";
import { GeneratorConfig, Entity, Relationship } from "../../../src/lib/types";

// Helper to create generator config
function createConfig(entities: Entity[], relationshipMap: { [key: string]: Relationship[] } = {}): GeneratorConfig {
  return {
    rootFolder: "/tmp/python-test-output",
    entities,
    relationshipMap,
    apiType: "rest",
    language: "python",
  };
}

// Helper to find content in generated files
function findFileContent(files: { path: string; content: string }[], filename: string): string | undefined {
  const file = files.find(f => f.path.includes(filename));
  return file?.content;
}

describe("PythonGenerator", () => {
  let generator: PythonGenerator;

  beforeAll(() => {
    const config = createConfig([]);
    generator = new PythonGenerator(config);
  });

  describe("datetime type support", () => {
    test("generates DateTime column for datetime field", async () => {
      const entity: Entity = {
        name: "Event",
        fields: [
          { name: "title", type: "text", nullable: false },
          { name: "startTime", type: "datetime" as any, nullable: false },
          { name: "endTime", type: "datetime" as any, nullable: true },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "event.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("DateTime");
      expect(modelContent).toContain("startTime: Mapped[datetime]");
      expect(modelContent).toContain("endTime: Mapped[Optional[datetime]]");
    });

    test("generates datetime type in Pydantic schema", async () => {
      const entity: Entity = {
        name: "Event",
        fields: [
          { name: "startTime", type: "datetime" as any, nullable: false },
        ],
      };

      const files = await generator.generateDto({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const schemaContent = findFileContent(files, "schemas");
      expect(schemaContent).toBeDefined();
      expect(schemaContent).toContain("datetime");
    });
  });

  describe("table name override (cli#107)", () => {
    test("honors an explicit per-entity table override", async () => {
      const entity: Entity = {
        name: "Order",
        table: "order_record",
        fields: [{ name: "total", type: "integer", nullable: false }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "order.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain('__tablename__ = "order_record"');
      // must NOT fall back to the reserved-word snake_case name
      expect(modelContent).not.toContain('__tablename__ = "order"');
    });

    test("falls back to snake_case of the name when no override is set", async () => {
      const entity: Entity = {
        name: "Order",
        fields: [{ name: "total", type: "integer", nullable: false }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "order.py");
      expect(modelContent).toContain('__tablename__ = "order"');
    });
  });

  describe("default value handling", () => {
    test("string defaults render without HTML encoding", async () => {
      const entity: Entity = {
        name: "Task",
        fields: [
          { name: "status", type: "text", nullable: true, default: "pending" },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "task.py");
      expect(modelContent).toBeDefined();
      // Should be "pending" not &quot;pending&quot;
      expect(modelContent).toContain('default="pending"');
      expect(modelContent).not.toContain("&quot;");
    });

    test("integer defaults render correctly", async () => {
      const entity: Entity = {
        name: "Counter",
        fields: [
          { name: "count", type: "integer", nullable: true, default: "0" },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "counter.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("default=0");
    });

    test("boolean defaults render as True/False", async () => {
      const entity: Entity = {
        name: "Setting",
        fields: [
          { name: "isActive", type: "boolean", nullable: true, default: "true" },
          { name: "isArchived", type: "boolean", nullable: true, default: "false" },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "setting.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("default=True");
      expect(modelContent).toContain("default=False");
    });

    test("optional fields without defaults do not generate default=null", async () => {
      const entity: Entity = {
        name: "Item",
        fields: [
          { name: "description", type: "text", nullable: true },
          { name: "quantity", type: "integer", nullable: true },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "item.py");
      expect(modelContent).toBeDefined();
      // Should NOT contain default=null (JavaScript null)
      expect(modelContent).not.toContain("default=null");
      // Fields without defaults should just have nullable=True
      expect(modelContent).toContain("nullable=True");
    });
  });

  describe("primary key handling", () => {
    test("generates primary key with autoincrement for serial type", async () => {
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

      const modelContent = findFileContent(files, "user.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("primary_key=True");
      expect(modelContent).toContain("autoincrement=True");
    });

    test("generates UUID primary key correctly", async () => {
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

      const modelContent = findFileContent(files, "document.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("PGUUID(as_uuid=True)");
      expect(modelContent).toContain("primary_key=True");
    });
  });

  describe("relationship generation", () => {
    test("generates OneToMany relationship", async () => {
      const parentEntity: Entity = {
        name: "Author",
        fields: [{ name: "name", type: "text", nullable: false }],
      };

      const childEntity: Entity = {
        name: "Book",
        fields: [{ name: "title", type: "text", nullable: false }],
      };

      const relationships: Relationship[] = [
        {
          type: "OneToMany",
          name: "Book",
          referenceName: "books",
          biDirectional: true,
          inverseReferenceName: "author",
        },
      ];

      const files = await generator.generateEntity({
        entity: parentEntity,
        relationships,
        allEntities: [parentEntity, childEntity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "author.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("relationship(");
      expect(modelContent).toContain("back_populates");
    });

    test("generates ManyToOne relationship with FK column", async () => {
      const parentEntity: Entity = {
        name: "Author",
        fields: [{ name: "name", type: "text", nullable: false }],
      };

      const childEntity: Entity = {
        name: "Book",
        fields: [{ name: "title", type: "text", nullable: false }],
      };

      const relationships: Relationship[] = [
        {
          type: "ManyToOne",
          name: "Author",
          referenceName: "author",
          biDirectional: true,
          inverseReferenceName: "books",
        },
      ];

      const files = await generator.generateEntity({
        entity: childEntity,
        relationships,
        allEntities: [parentEntity, childEntity],
        apiType: "rest",
      });

      const modelContent = findFileContent(files, "book.py");
      expect(modelContent).toBeDefined();
      expect(modelContent).toContain("ForeignKey(");
      expect(modelContent).toContain("relationship(");
    });
  });

  describe("validation", () => {
    test("datetime is in supported types", () => {
      const config = createConfig([
        {
          name: "TestEntity",
          fields: [{ name: "createdAt", type: "datetime" as any }],
        },
      ]);

      const result = generator.validateConfig(config);
      // datetime should not produce a warning about unsupported type
      expect(result.warnings.some(w => w.includes("datetime") && w.includes("not be fully supported"))).toBe(false);
    });

    test("unsupported type produces warning", () => {
      const config = createConfig([
        {
          name: "TestEntity",
          fields: [{ name: "data", type: "bytea" as any }],
        },
      ]);

      const result = generator.validateConfig(config);
      expect(result.warnings.some(w => w.includes("bytea") && w.includes("not be fully supported"))).toBe(true);
    });
  });

  describe("emitEvents / domain events manifest (cli#81)", () => {
    test("entity with emitEvents:true emits a single event-emitting manifest", async () => {
      const entity: Entity = {
        name: "Product",
        emitEvents: true,
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateDomainEvents([entity], "rest", {});

      // Exactly one file: the schema-derived manifest.
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("events/event_emitting_entities.py");

      const content = files[0].content;
      // Imports the opted-in model class using the Python convention.
      expect(content).toContain("from ..models.product import Product");
      // Exports the manifest of classes and names.
      expect(content).toContain("EVENT_EMITTING_ENTITIES = [");
      expect(content).toContain("Product,");
      expect(content).toContain("EVENT_EMITTING_ENTITY_NAMES = [");
      expect(content).toContain('"Product",');

      // No engine code is generated (engine lives in the library).
      expect(content).not.toContain("class DomainEvent");
      expect(content).not.toContain("before_flush");
      expect(content).not.toContain("SessionEvents");
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
      expect(content).toContain("from ..models.order import Order");
      expect(content).toContain("Order,");
      expect(content).toContain('"Order",');
      // entity that opted out is NOT included
      expect(content).not.toContain("AuditLog");
    });

    test("no entity opted in returns []", async () => {
      const entity: Entity = {
        name: "Product",
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateDomainEvents([entity], "rest", {});
      expect(files).toEqual([]);
    });
  });
});
