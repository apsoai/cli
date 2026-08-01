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

  describe("PostgREST/Supabase dialect (parity with TS #36/#56-#60)", () => {
    test("query utils emit both dialect parsers and detection", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py");
      expect(query).toBeDefined();

      // Both parser paths + the unified entrypoint exist.
      expect(query).toContain("def parse_nestjsx_params");
      expect(query).toContain("def parse_postgrest_params");
      expect(query).toContain("def detect_dialect");
      expect(query).toContain("def parse_query_params");
      // Unified entrypoint takes the X-Crud-Dialect header.
      expect(query).toContain("def parse_query_params(params: Any, dialect_header");
    });

    test("dialect detection mirrors dialect.ts key sets", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      // nestjsx-only, postgrest-only, neutral key sets.
      expect(query).toContain('_NESTJSX_KEYS = frozenset(["fields", "filter", "or", "join", "sort", "s", "per_page"])');
      expect(query).toContain('_POSTGREST_KEYS = frozenset(["select", "order"])');
      expect(query).toContain('_NEUTRAL_KEYS = frozenset(["limit", "offset", "page", "cache"])');
      // Header wins; invalid header is a parse error (=> 400 in the router).
      expect(query).toContain("Invalid X-Crud-Dialect header");
      // Both families present => refuse to guess.
      expect(query).toContain("Ambiguous query:");
    });

    test("postgrest operator mapping matches the TS core", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      // Core operator map (eq/neq/gt/gte/lt/lte/like/ilike/in).
      expect(query).toContain('"eq": "$eq"');
      expect(query).toContain('"neq": "$ne"');
      expect(query).toContain('"gte": "$gte"');
      expect(query).toContain('"like": "$like"');
      expect(query).toContain('"ilike": "$ilike"');
      expect(query).toContain('"in": "$in"');
      // not.<op> negation map.
      expect(query).toContain("_PG_NOT_MAP");
      // is.null / is.true handling.
      expect(query).toContain('if op == "is"');
      // * -> % wildcard for like/ilike.
      expect(query).toContain('rest.replace("*", "%")');
    });

    test("or=()/and=() groups and order/nulls are parsed", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      expect(query).toContain("def _parse_pg_logical");
      expect(query).toContain("def _parse_pg_order");
      expect(query).toContain('"NULLS FIRST"');
      expect(query).toContain('"NULLS LAST"');
      // select alias rename (#57).
      expect(query).toContain("field_aliases");
    });

    test("deferred operators (cs/cd/ov/fts) are rejected, not silently accepted", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      expect(query).toContain("_PG_DEFERRED_OPS");
      expect(query).toContain('"cs"');
      expect(query).toContain('"fts"');
      expect(query).toContain("is not supported yet");
    });

    test("bare-array pagination (#58) and unknown-column 400 (#60)", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      // PostgREST path returns a bare list; nestjsx keeps the envelope.
      expect(query).toContain("async def get_many_list");
      expect(query).toContain("async def get_many");
      // Unknown column => QueryParseError (mapped to 400 in the router).
      expect(query).toContain("Unknown column '");
      expect(query).toContain("class QueryParseError");
    });

    test("router detects dialect and shapes the response", async () => {
      const widget: Entity = { name: "Widget", fields: [{ name: "title", type: "text" }] };
      const files = await generator.generateController({
        entity: widget,
        relationships: [],
        relationshipMap: {},
        allEntities: [widget],
        apiType: "rest",
      });
      const router = findFileContent(files, "widget.py");
      expect(router).toBeDefined();

      // Reads the header, passes it to the parser.
      expect(router).toContain('alias="X-Crud-Dialect"');
      expect(router).toContain("parse_query_params(request.query_params, x_crud_dialect)");
      // postgrest branch returns a bare JSON array; nestjsx keeps the envelope.
      expect(router).toContain('if options.dialect == "postgrest"');
      expect(router).toContain("get_many_list");
      expect(router).toContain("JSONResponse");
      expect(router).toContain("WidgetList(");
      // Parse errors => 400.
      expect(router).toContain("HTTP_400_BAD_REQUEST");
      expect(router).toContain("QueryParseError");
    });

    test("service exposes both envelope and bare-list retrieval", async () => {
      const widget: Entity = { name: "Widget", fields: [{ name: "title", type: "text" }] };
      const files = await generator.generateService({
        entity: widget,
        relationships: [],
        relationshipMap: {},
        allEntities: [widget],
        apiType: "rest",
      });
      const service = findFileContent(files, "widget.py");
      expect(service).toBeDefined();
      expect(service).toContain("async def get_many(");
      expect(service).toContain("async def get_many_list(");
    });

    test("nestjsx parser surface is preserved (byte-compatible entry points)", async () => {
      const files = await generator.generateQueryUtils([], "rest");
      const query = findFileContent(files, "query.py")!;

      // The original nestjsx helpers and pipe-delimited filter format remain.
      expect(query).toContain('parts = raw.split("||")');
      expect(query).toContain("def _parse_filter_param");
      expect(query).toContain("def _parse_sort_param");
      expect(query).toContain("def _parse_join_param");
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
