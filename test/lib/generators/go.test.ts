import { expect, describe, test, beforeAll } from "@jest/globals";
import { GoGenerator } from "../../../src/lib/generators/go";
import { GeneratorConfig, Entity, Relationship } from "../../../src/lib/types";

function createConfig(
  entities: Entity[],
  relationshipMap: { [key: string]: Relationship[] } = {}
): GeneratorConfig {
  return {
    rootFolder: "/tmp/go-test-output",
    entities,
    relationshipMap,
    apiType: "rest",
    language: "go",
  };
}

function findFileContent(
  files: { path: string; content: string }[],
  filename: string
): string | undefined {
  const file = files.find((f) => f.path.includes(filename));
  return file?.content;
}

describe("GoGenerator", () => {
  let generator: GoGenerator;

  beforeAll(() => {
    const config = createConfig([]);
    generator = new GoGenerator(config);
  });

  describe("entity generation", () => {
    test("generates GORM struct with correct package and imports", async () => {
      const entity: Entity = {
        name: "User",
        fields: [{ name: "email", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "user.go");
      expect(content).toBeDefined();
      expect(content).toContain("package models");
      expect(content).toContain(`"time"`);
      // gorm.io/gorm is no longer imported (unused imports are Go compile errors)
      expect(content).not.toContain(`"gorm.io/gorm"`);
      expect(content).toContain("type User struct {");
    });

    test("generates TableName method with snake_case", async () => {
      const entity: Entity = {
        name: "BlogPost",
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "blog_post.go");
      expect(content).toBeDefined();
      expect(content).toContain('return "blog_post"');
    });

    test("honors an explicit per-entity table override (cli#107)", async () => {
      const entity: Entity = {
        name: "Order",
        table: "order_record",
        fields: [{ name: "total", type: "integer" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "order.go");
      expect(content).toBeDefined();
      expect(content).toContain('return "order_record"');
      // must NOT fall back to the reserved-word snake_case name
      expect(content).not.toContain('return "order"');
    });

    test("falls back to snake_case of the name when no override is set (cli#107)", async () => {
      const entity: Entity = {
        name: "Order",
        fields: [{ name: "total", type: "integer" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "order.go");
      expect(content).toContain('return "order"');
    });

    test("output path uses snake_case filename", async () => {
      const entity: Entity = {
        name: "UserProfile",
        fields: [{ name: "bio", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      expect(files[0].path).toBe("models/user_profile.go");
    });
  });

  describe("primary key handling", () => {
    test("generates serial primary key with autoIncrement", async () => {
      const entity: Entity = {
        name: "Item",
        primaryKeyType: "serial",
        fields: [{ name: "name", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "item.go");
      expect(content).toBeDefined();
      expect(content).toContain("ID        uint");
      expect(content).toContain("primaryKey;autoIncrement");
    });

    test("generates UUID primary key with gen_random_uuid", async () => {
      const entity: Entity = {
        name: "Document",
        primaryKeyType: "uuid",
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "document.go");
      expect(content).toBeDefined();
      expect(content).toContain("ID        string");
      expect(content).toContain(
        "type:uuid;primaryKey;default:gen_random_uuid()"
      );
    });
  });

  describe("field type mapping", () => {
    test("text field maps to *string (nullable by default)", async () => {
      const entity: Entity = {
        name: "Note",
        fields: [{ name: "body", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "note.go")!;
      expect(content).toContain("Body *string");
      expect(content).toContain("type:text");
    });

    test("nullable field uses pointer type with default:null", async () => {
      const entity: Entity = {
        name: "Profile",
        fields: [{ name: "bio", type: "text", nullable: true }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "profile.go")!;
      expect(content).toContain("Bio *string");
      expect(content).toContain("default:null");
      expect(content).toContain("omitempty");
    });

    test("integer field maps to *int", async () => {
      const entity: Entity = {
        name: "Counter",
        fields: [{ name: "count", type: "integer" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "counter.go")!;
      expect(content).toContain("Count *int");
      expect(content).toContain("type:integer");
    });

    test("boolean field maps to *bool", async () => {
      const entity: Entity = {
        name: "Setting",
        fields: [{ name: "isActive", type: "boolean" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "setting.go")!;
      expect(content).toContain("IsActive *bool");
      expect(content).toContain("type:boolean");
    });

    test("float field maps to *float64", async () => {
      const entity: Entity = {
        name: "Metric",
        fields: [{ name: "value", type: "float" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "metric.go")!;
      expect(content).toContain("Value *float64");
    });

    test("decimal field maps to *float64 with precision", async () => {
      const entity: Entity = {
        name: "Price",
        fields: [{ name: "amount", type: "decimal" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "price.go")!;
      expect(content).toContain("Amount *float64");
      expect(content).toContain("decimal");
    });

    test("date field maps to *time.Time", async () => {
      const entity: Entity = {
        name: "Event",
        fields: [{ name: "startDate", type: "date" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "event.go")!;
      expect(content).toContain("StartDate *time.Time");
    });

    test("json field generates correct gorm tag", async () => {
      const entity: Entity = {
        name: "Config",
        fields: [{ name: "settings", type: "json" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "config.go")!;
      expect(content).toContain("Settings");
    });

    test("enum field imports enums package", async () => {
      const entity: Entity = {
        name: "Order",
        fields: [
          { name: "status", type: "enum", values: ["pending", "shipped"] },
        ],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "order.go")!;
      expect(content).toContain(`"app/autogen/models/enums"`);
    });
  });

  describe("created_at and updated_at", () => {
    test("generates timestamp fields with auto time tags", async () => {
      const entity: Entity = {
        name: "Post",
        created_at: true,
        updated_at: true,
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "post.go")!;
      expect(content).toContain("CreatedAt time.Time");
      expect(content).toContain("autoCreateTime");
      expect(content).toContain("UpdatedAt time.Time");
      expect(content).toContain("autoUpdateTime");
    });

    test("omits timestamp fields when not requested", async () => {
      const entity: Entity = {
        name: "Lookup",
        fields: [{ name: "code", type: "text" }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "lookup.go")!;
      expect(content).not.toContain("CreatedAt");
      expect(content).not.toContain("UpdatedAt");
    });
  });

  describe("relationship generation", () => {
    test("generates ManyToOne with FK field and pointer reference", async () => {
      const entity: Entity = {
        name: "Book",
        fields: [{ name: "title", type: "text" }],
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
        entity,
        relationships,
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "book.go")!;
      expect(content).toContain("authorID uint");
      expect(content).toContain("author *Author");
      expect(content).toContain("foreignKey:authorID");
    });
  });

  describe("handler generation", () => {
    test("generates Gin handler with CRUD operations", async () => {
      const entity: Entity = {
        name: "Product",
        fields: [{ name: "name", type: "text" }],
      };

      const files = await generator.generateController({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
        relationshipMap: {},
      });

      expect(files[0].path).toBe("handlers/product.go");
      const content = files[0].content;
      expect(content).toContain("package handlers");
      expect(content).toContain("gin.Context");
      expect(content).toContain("FindAll");
      expect(content).toContain("FindOne");
      expect(content).toContain("Create");
      expect(content).toContain("Update");
      expect(content).toContain("Delete");
    });
  });

  describe("service generation", () => {
    test("generates service with GORM operations", async () => {
      const entity: Entity = {
        name: "Order",
        fields: [{ name: "total", type: "decimal" }],
      };

      const files = await generator.generateService({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
        relationshipMap: {},
      });

      expect(files[0].path).toBe("services/order.go");
      const content = files[0].content;
      expect(content).toContain("package services");
      expect(content).toContain("gorm.DB");
    });
  });

  describe("DTO generation", () => {
    test("generates response, create, and update structs", async () => {
      const entity: Entity = {
        name: "Task",
        fields: [
          { name: "title", type: "text" },
          { name: "description", type: "text", nullable: true },
        ],
      };

      const files = await generator.generateDto({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      expect(files[0].path).toBe("dto/task.go");
      const content = files[0].content;
      expect(content).toContain("package dto");
      expect(content).toContain("TaskResponse");
      expect(content).toContain("TaskCreate");
      expect(content).toContain("TaskUpdate");
    });
  });

  describe("enum generation", () => {
    test("generates Go enum type with const block", async () => {
      const entities: Entity[] = [
        {
          name: "Order",
          fields: [
            {
              name: "status",
              type: "enum",
              values: ["pending", "shipped", "delivered"],
            },
          ],
        },
      ];

      const files = await generator.generateEnums(entities, "rest");

      expect(files[0].path).toBe("models/enums/enums.go");
      const content = files[0].content;
      expect(content).toContain("package enums");
      expect(content).toContain("Pending");
      expect(content).toContain("Shipped");
      expect(content).toContain("Delivered");
    });

    test("returns empty array when no enums exist", async () => {
      const entities: Entity[] = [
        {
          name: "User",
          fields: [{ name: "email", type: "text" }],
        },
      ];

      const files = await generator.generateEnums(entities, "rest");
      expect(files).toHaveLength(0);
    });
  });

  describe("index module generation", () => {
    test("generates route registration file", async () => {
      const entities: Entity[] = [
        { name: "User", fields: [{ name: "email", type: "text" }] },
        { name: "Post", fields: [{ name: "title", type: "text" }] },
      ];

      const files = await generator.generateIndexModule(entities, "rest");

      expect(files[0].path).toBe("routes/routes.go");
      const content = files[0].content;
      expect(content).toContain("package routes");
    });

    describe("http flag suppression (cli#95)", () => {
      test("http:false skips handler + route registration but keeps service and model", async () => {
        const entities: Entity[] = [
          { name: "User", http: false, fields: [{ name: "email", type: "text" }] },
          { name: "Post", fields: [{ name: "title", type: "text" }] },
        ];

        const files = await generator.generateIndexModule(entities, "rest");
        const routes = files.find((f) => f.path === "routes/routes.go")!.content;
        const registry = files.find((f) => f.path === "models/registry.go")!.content;

        // User is suppressed from all handler/route wiring
        expect(routes).not.toContain("UserHandler");
        expect(routes).not.toContain("NewUserHandler");
        // Post keeps its route registration (local var is camelCase)
        expect(routes).toContain("postHandler.RegisterRoutes(r)");
        expect(routes).toContain("handlers.NewPostHandler");
        // User service is still wired (model + service are always generated)
        expect(routes).toContain("UserService");
        expect(routes).toContain("NewUserService(db)");
        // User model is still registered for AutoMigrate
        expect(registry).toContain("&User{}");
        expect(registry).toContain("&Post{}");
      });

      test("all entities http:false drops the unused handlers import", async () => {
        const entities: Entity[] = [
          { name: "User", http: false, fields: [{ name: "email", type: "text" }] },
        ];

        const files = await generator.generateIndexModule(entities, "rest");
        const routes = files.find((f) => f.path === "routes/routes.go")!.content;

        expect(routes).not.toContain('"app/autogen/handlers"');
        expect(routes).toContain('"app/autogen/services"');
        // no handler construction or route registration at all
        expect(routes).not.toContain("handlers.New");
        expect(routes).not.toContain(".RegisterRoutes");
      });

      test("top-level http default is honored via opts, entity override wins", async () => {
        const entities: Entity[] = [
          { name: "User", fields: [{ name: "email", type: "text" }] },
          { name: "Post", http: true, fields: [{ name: "title", type: "text" }] },
        ];

        // default http:false suppresses User; Post overrides back to true
        const files = await generator.generateIndexModule(entities, "rest", {
          http: false,
        });
        const routes = files.find((f) => f.path === "routes/routes.go")!.content;

        expect(routes).not.toContain("UserHandler");
        expect(routes).toContain("postHandler.RegisterRoutes(r)");
      });
    });
  });

  describe("validation", () => {
    test("supported types do not produce warnings", () => {
      const config = createConfig([
        {
          name: "Test",
          fields: [
            { name: "a", type: "text" },
            { name: "b", type: "integer" },
            { name: "c", type: "boolean" },
            { name: "d", type: "date" },
            { name: "e", type: "json" },
            { name: "f", type: "float" },
          ],
        },
      ]);

      const result = generator.validateConfig(config);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    test("unsupported type produces warning", () => {
      const config = createConfig([
        {
          name: "Test",
          fields: [{ name: "data", type: "bytea" as any }],
        },
      ]);

      const result = generator.validateConfig(config);
      expect(
        result.warnings.some(
          (w) => w.includes("bytea") && w.includes("not be fully supported")
        )
      ).toBe(true);
    });

    test("graphql apiType produces warning for Go", () => {
      const config: GeneratorConfig = {
        ...createConfig([
          { name: "Test", fields: [{ name: "a", type: "text" }] },
        ]),
        apiType: "graphql",
      };

      const result = generator.validateConfig(config);
      expect(
        result.warnings.some((w) => w.includes("GraphQL") && w.includes("Go"))
      ).toBe(true);
    });

    test("empty entities produces error", () => {
      const config = createConfig([]);
      const result = generator.validateConfig(config);
      expect(
        result.errors.some((e) => e.includes("No entities defined"))
      ).toBe(true);
    });
  });

  describe("emitEvents / domain events manifest (cli#82)", () => {
    test("entity with emitEvents:true emits a single event-emitting manifest", async () => {
      const entity: Entity = {
        name: "Product",
        emitEvents: true,
        fields: [{ name: "title", type: "text" }],
      };

      const files = await generator.generateDomainEvents([entity], "rest", {});

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("events/event_emitting_entities.go");

      const content = files[0].content;
      expect(content).toContain("package events");
      expect(content).toContain('import "app/autogen/models"');
      expect(content).toContain("var EventEmittingModels = []interface{}{");
      expect(content).toContain("models.Product{},");
      expect(content).toContain("var EventEmittingEntityNames = []string{");
      expect(content).toContain('"Product",');

      // No engine code is generated (engine lives in the library).
      expect(content).not.toContain("AfterCreate");
      expect(content).not.toContain("type DomainEvent");
      expect(content).not.toContain("func RegisterHooks");
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
      expect(content).toContain("models.Order{},");
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
