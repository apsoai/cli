import { expect, describe, test, beforeAll } from "@jest/globals";
import { parseRelationships } from "../../../src/lib/utils/relationships";
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

    test("boolean defaults are false unless the default is true", async () => {
      const entity: Entity = {
        name: "Flag",
        primaryKeyType: "serial",
        fields: [
          { name: "noDefault", type: "boolean" },
          { name: "falseString", type: "boolean", default: "false" },
          { name: "falseBool", type: "boolean", default: false },
          { name: "trueString", type: "boolean", default: "true" },
          { name: "trueBool", type: "boolean", default: true },
        ] as unknown as Field[],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const content = findFileContent(files, "Flag.entity")!;
      const defaultOf = (name: string) =>
        content
          .split("@Column(")
          .find((c) => c.includes(`${name}!:`))
          ?.match(/default: (\w+)/)?.[1];
      expect(defaultOf("noDefault")).toBe("false");
      expect(defaultOf("falseString")).toBe("false");
      expect(defaultOf("falseBool")).toBe("false");
      expect(defaultOf("trueString")).toBe("true");
      expect(defaultOf("trueBool")).toBe("true");
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

describe("http controller suppression (issue #93)", () => {
  let generator: TypeScriptGenerator;

  beforeAll(() => {
    generator = new TypeScriptGenerator(createConfig([]));
  });

  const entity: Entity = {
    name: "Product",
    primaryKeyType: "serial",
    fields: [{ name: "name", type: "text", nullable: false }],
  };

  test("default (http on): module wires the controller", async () => {
    const files = await generator.generateModule({
      entity,
      relationships: [],
      allEntities: [entity],
      apiType: "rest",
    });
    const moduleContent = findFileContent(files, "Product.module");
    expect(moduleContent).toBeDefined();
    expect(moduleContent).toContain(
      'import {ProductController} from "./Product.controller"'
    );
    expect(moduleContent).toContain("controllers: [ProductController]");
    // data layer intact
    expect(moduleContent).toContain("TypeOrmModule.forFeature([Product])");
    expect(moduleContent).toContain("providers: [ProductService]");
  });

  test("http=false: module omits the controller but keeps entity/service wiring", async () => {
    const files = await generator.generateModule({
      entity,
      relationships: [],
      allEntities: [entity],
      apiType: "rest",
      includeController: false,
    });
    const moduleContent = findFileContent(files, "Product.module");
    expect(moduleContent).toBeDefined();
    // no controller import, no controllers array
    expect(moduleContent).not.toContain("Product.controller");
    expect(moduleContent).not.toContain("controllers:");
    expect(moduleContent).not.toContain("ProductController");
    // service + repository wiring preserved
    expect(moduleContent).toContain("TypeOrmModule.forFeature([Product])");
    expect(moduleContent).toContain("providers: [ProductService]");
    expect(moduleContent).toContain("exports: [ProductService]");
    expect(moduleContent).toContain("export class ProductModule");
  });

  describe("table name override (cli#98)", () => {
    test("honors an explicit per-entity table override", async () => {
      const entity: Entity = {
        name: "Order",
        table: "order_record",
        primaryKeyType: "uuid",
        fields: [{ name: "total", type: "integer", nullable: false }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Order.entity");
      expect(entityContent).toBeDefined();
      expect(entityContent).toContain("@Entity('order_record')");
      // must NOT fall back to the reserved-word snake_case name
      expect(entityContent).not.toContain("@Entity('order')");
    });

    test("falls back to snake_case of the name when no override is set", async () => {
      const entity: Entity = {
        name: "Order",
        primaryKeyType: "uuid",
        fields: [{ name: "total", type: "integer", nullable: false }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "Order.entity");
      expect(entityContent).toContain("@Entity('order')");
    });

    test("compound names still snake_case correctly without an override", async () => {
      const entity: Entity = {
        name: "OrderItem",
        primaryKeyType: "uuid",
        fields: [{ name: "quantity", type: "integer", nullable: false }],
      };

      const files = await generator.generateEntity({
        entity,
        relationships: [],
        allEntities: [entity],
        apiType: "rest",
      });

      const entityContent = findFileContent(files, "OrderItem.entity");
      expect(entityContent).toContain("@Entity('order_item')");
    });
  });
});

describe("guard regeneration (cli#129)", () => {
  test("renders the same guard files when nothing changed", async () => {
    const generator = new TypeScriptGenerator(createConfig([]));
    const entities: Entity[] = [
      {
        name: "Project",
        fields: [{ name: "name", type: "text" }],
        scopeBy: "workspaceId",
      },
    ];
    const auth = { provider: "better-auth" as const, url: "https://app.example.com/api/auth" };

    const first = await generator.generateGuards(entities, auth);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    const second = await generator.generateGuards(entities, auth);

    expect(first.map((f) => f.path)).toContain("guards/auth.guard.ts");
    expect(second).toEqual(first);
  });
  test("a OneToOne FK column in uniques/indexes names the relation property", async () => {
    const workspace: Entity = { name: "Workspace", fields: [{ name: "name", type: "text" }] };
    const setting: Entity = {
      name: "Setting",
      fields: [{ name: "tz", type: "text" }],
      uniques: [{ fields: ["workspaceId", "tz"] }],
      indexes: [{ fields: ["workspaceId"] }],
    };
    const files = await new TypeScriptGenerator(createConfig([workspace, setting])).generateEntity({
      entity: setting,
      relationships: [{ name: "Workspace", type: "OneToOne", join: true, referenceName: "Workspace" }],
      allEntities: [workspace, setting],
      apiType: "rest",
    });
    const content = findFileContent(files, "Setting.entity");
    // TypeORM has no "workspaceId" property here; "workspace" resolves to its join column.
    expect(content).toContain('@Unique(["workspace", "tz"])');
    expect(content).toContain('@Index(["workspace"])');
  });
});

const renderEntity = async (entity: Entity) => {
  const generator = new TypeScriptGenerator(createConfig([entity]));
  const files = await generator.generateEntity({ entity, relationships: [], allEntities: [entity], apiType: "rest" });
  return findFileContent(files, `${entity.name}.entity`)!;
};

// apsoai/cli#241
describe("joinColumnName on a foreign key", () => {
  const patient: Entity = { name: "Patient", primaryKeyType: "uuid" };
  const enrollment: Entity = {
    name: "Enrollment",
    fields: [{ name: "year", type: "integer" }],
    uniques: [{ fields: ["patient_id", "year"] }],
    indexes: [{ fields: ["patient", "year"] }],
  };
  const render = async (joinColumnName?: string) => {
    // Parsed without the linter: @apso/schema-tools accepts the column name
    // in "uniques" only after its own release (apsoai/cli#244).
    const relationshipMap = parseRelationships([
      { from: "Enrollment", to: "Patient", type: "ManyToOne", joinColumnName },
    ]);
    const generator = new TypeScriptGenerator(createConfig([patient, enrollment], relationshipMap));
    const files = await generator.generateEntity({
      entity: enrollment,
      relationships: relationshipMap.Enrollment,
      allEntities: [patient, enrollment],
      apiType: "rest",
    });
    return findFileContent(files, "Enrollment.entity")!.replace(/\s+/g, " ");
  };

  test("names the column and keeps the camelCase property", async () => {
    const content = await render("patient_id");
    expect(content).toContain("@JoinColumn({ name: 'patient_id' }) patient: Patient;");
    expect(content).toContain(`@Column({ name: 'patient_id', type: "uuid", }) patientId: string;`);
    // @Unique takes the property, not the database column.
    expect(content).toContain(`@Unique(["patientId", "year"])`);
  });

  test("onDelete writes the foreign key's delete rule", async () => {
    const relationshipMap = parseRelationships([
      { from: "Enrollment", to: "Patient", type: "ManyToOne", nullable: true, onDelete: "SET NULL" },
    ]);
    const generator = new TypeScriptGenerator(createConfig([patient, enrollment], relationshipMap));
    const files = await generator.generateEntity({
      entity: { name: "Enrollment" },
      relationships: relationshipMap.Enrollment,
      allEntities: [patient, enrollment],
      apiType: "rest",
    });
    expect(findFileContent(files, "Enrollment.entity")).toContain('{ onDelete: "SET NULL" }');
  });

  test("without it the generated column is unchanged", async () => {
    const content = await render();
    expect(content).toContain("@JoinColumn({ name: 'patientId' }) patient: Patient;");
    expect(content).toContain(`@Column({ type: "uuid", }) patientId: string;`);
  });
});

describe("a key declared as a field keeps its type and length", () => {
  const org: Entity = { name: "Org", fields: [{ name: "id", type: "varchar" as any, length: 100, primary: true }] };
  const member: Entity = { name: "Member", fields: [{ name: "label", type: "text" }] };
  const relationshipMap = parseRelationships([{ from: "Member", to: "Org", type: "ManyToOne" }]);
  const render = async (entity: Entity) => {
    const generator = new TypeScriptGenerator(createConfig([org, member], relationshipMap));
    const files = await generator.generateEntity({
      entity,
      relationships: relationshipMap[entity.name] || [],
      allEntities: [org, member],
      apiType: "rest",
    });
    return findFileContent(files, `${entity.name}.entity`)!.replace(/\s+/g, " ");
  };

  test("on the key itself", async () => {
    const content = await render(org);
    expect(content).toContain('@PrimaryColumn({ type: "varchar", length: 100 }) id: string;');
    expect(content).not.toContain("@PrimaryColumn()");
  });

  test("primaryKeyName and foreignKeyName keep an existing database's constraint names", async () => {
    const named = parseRelationships([{ from: "Member", to: "Org", type: "ManyToOne", foreignKeyName: "members_org_fkey" }]);
    const generator = new TypeScriptGenerator(createConfig([org, member], named));
    const entity = async (e: Entity) =>
      findFileContent(
        await generator.generateEntity({ entity: e, relationships: named[e.name] || [], allEntities: [org, member], apiType: "rest" }),
        `${e.name}.entity`
      )!.replace(/\s+/g, " ");
    expect(await entity({ ...org, primaryKeyName: "orgs_pkey" })).toContain(
      `@PrimaryColumn({ type: "varchar", length: 100, primaryKeyConstraintName: 'orgs_pkey' }) id: string;`
    );
    const m = await entity({ ...member, primaryKeyName: "members_pkey" });
    expect(m).toContain("@PrimaryGeneratedColumn({ primaryKeyConstraintName: 'members_pkey' }) id!: number;");
    expect(m).toContain("@JoinColumn({ name: 'orgId', foreignKeyConstraintName: 'members_org_fkey' })");
  });

  test("a foreign key can be the primary key: no id is generated", async () => {
    const setting: Entity = { name: "Setting", primaryKeyName: "settings_pkey", fields: [{ name: "theme", type: "text" }] };
    const keyed = parseRelationships([{ from: "Setting", to: "Org", type: "ManyToOne", joinColumnName: "org_id", primary: true }]);
    const generator = new TypeScriptGenerator(createConfig([org, setting], keyed));
    const files = await generator.generateEntity({ entity: setting, relationships: keyed.Setting, allEntities: [org, setting], apiType: "rest" });
    const content = findFileContent(files, "Setting.entity")!.replace(/\s+/g, " ");
    expect(content).toContain(
      `@PrimaryColumn({ name: 'org_id', type: "varchar", length: 100, primaryKeyConstraintName: 'settings_pkey', }) orgId: string;`
    );
    expect(content).not.toContain("@PrimaryGeneratedColumn()");
  });

  test("a timestamptz field can be part of the primary key", async () => {
    const counter: Entity = {
      name: "Counter",
      primaryKeyName: "counters_pkey",
      fields: [
        { name: "bucket", type: "text", primary: true },
        { name: "window_start", type: "timestamptz", primary: true },
      ],
    };
    const rendered = await renderEntity(counter);
    const content = rendered.replace(/\s+/g, " ");
    expect(content).toContain(`@PrimaryColumn({ type: "text", primaryKeyConstraintName: 'counters_pkey' }) bucket: string;`);
    expect(content).toContain("@PrimaryColumn({ type: 'timestamptz', primaryKeyConstraintName: 'counters_pkey' }) window_start: Date;");
  });

  test("the controller's id parameter maps to the entity's own key", async () => {
    const keyed = parseRelationships([{ from: "Setting", to: "Org", type: "ManyToOne", joinColumnName: "org_id", primary: true }]);
    const setting: Entity = { name: "Setting", fields: [{ name: "theme", type: "text" }] };
    const code: Entity = { name: "Code", fields: [{ name: "icd10_code", type: "text", primary: true }] };
    const generator = new TypeScriptGenerator(createConfig([org, member, setting, code], keyed));
    const controller = async (entity: Entity) => {
      const files = await generator.generateController({
        entity,
        relationships: keyed[entity.name] || [],
        relationshipMap: keyed,
        allEntities: [org, member, setting, code],
        apiType: "rest",
      });
      return files.find((f) => f.path.endsWith(".controller.ts"))!.content;
    };
    expect(await controller(member)).toContain("field: 'id',");
    expect(await controller(code)).toContain("field: 'icd10_code',");
    expect(await controller(setting)).toContain("field: 'orgId',");
  });

  test("on a foreign key that references it", async () => {
    expect(await render(member)).toContain('@Column({ type: "varchar", length: 100, }) orgId: string;');
  });
});

// apsoai/cli#245, #248
describe("indexes", () => {
  test("an index keeps its name and WHERE condition", async () => {
    const content = await renderEntity({
      name: "Job",
      fields: [{ name: "status", type: "text" }],
      indexes: [
        { fields: ["status"], unique: true, name: "jobs_one_live_uq", where: "status <> 'done'" },
        { fields: ["status"], name: "jobs_status_idx" },
        { fields: ["status"] },
      ],
    });
    expect(content).toContain(`@Index("jobs_one_live_uq", ["status"], { unique: true, where: "status <> 'done'" } )`);
    expect(content).toContain(`@Index("jobs_status_idx", ["status"])`);
    expect(content).toContain(`@Index(["status"])`);
  });

  test("timestamp, date and uuid fields honor index and unique", async () => {
    const rendered = await renderEntity({
      name: "Event",
      fields: [
        { name: "expires_at", type: "timestamptz", nullable: true, index: true },
        { name: "seen_on", type: "date", nullable: true, unique: true },
        { name: "correlation_id", type: "uuid" as any, nullable: true, unique: true },
      ],
    });
    const content = rendered.replace(/\s+/g, " ");
    expect(content).toContain("@Index() @Column({ type: 'timestamptz', nullable: true }) expires_at: Date;");
    expect(content).toContain("@Column({ type: 'date', nullable: true, unique: true }) seen_on: string;");
    expect(content).toContain('@Column({ "type": "uuid", nullable: true, unique: true })');
  });
});

// apsoai/cli#246
test("checks become @Check decorators, named or not", async () => {
  const content = await renderEntity({
    name: "Stay",
    fields: [{ name: "start_date", type: "date" }, { name: "end_date", type: "date", nullable: true }],
    checks: [
      { name: "stays_end_after_start", expression: "end_date IS NULL OR end_date >= start_date" },
      { expression: "start_date > '2000-01-01'" },
    ],
  });
  expect(content).toContain(`@Check("stays_end_after_start", "end_date IS NULL OR end_date >= start_date")`);
  expect(content).toContain(`@Check("start_date > '2000-01-01'")`);
});

// apsoai/cli#243
describe("created_at and updated_at column type", () => {
  test("timestampType timestamptz keeps the time zone", async () => {
    const content = await renderEntity({ name: "Zoned", created_at: true, updated_at: true, timestampType: "timestamptz" });
    expect(content).toContain("@CreateDateColumn({ type: 'timestamptz' })");
    expect(content).toContain("@UpdateDateColumn({ type: 'timestamptz' })");
  });

  test("one type per column", async () => {
    const content = await renderEntity({
      name: "Mixed",
      created_at: true,
      updated_at: true,
      timestampType: { updated_at: "timestamptz" },
    });
    expect(content).toContain("@CreateDateColumn()");
    expect(content).toContain("@UpdateDateColumn({ type: 'timestamptz' })");
  });

  test("timestampNullable drops NOT NULL, for both or per column", async () => {
    const both = await renderEntity({ name: "Loose", created_at: true, updated_at: true, timestampNullable: true });
    expect(both).toContain("@CreateDateColumn({ nullable: true })");
    expect(both).toContain("@UpdateDateColumn({ nullable: true })");
    const one = await renderEntity({
      name: "Half",
      created_at: true,
      updated_at: true,
      timestampType: "timestamptz",
      timestampNullable: { created_at: true },
    });
    expect(one).toContain("@CreateDateColumn({ type: 'timestamptz', nullable: true })");
    expect(one).toContain("@UpdateDateColumn({ type: 'timestamptz' })");
  });

  test("timestamp stays the default", async () => {
    const content = await renderEntity({ name: "Plain", created_at: true, updated_at: true });
    expect(content).toContain("@CreateDateColumn()");
    expect(content).toContain("@UpdateDateColumn()");
  });
});

describe("array element types", () => {
  test("an integer or boolean elementType gives number[] or boolean[]", async () => {
    const entity: Entity = {
      name: "Email",
      fields: [
        { name: "to", type: "array" },
        { name: "ids", type: "array", elementType: "integer" },
        { name: "flags", type: "array", elementType: "boolean" },
      ],
    };
    const generator = new TypeScriptGenerator(createConfig([entity]));
    const options = { entity, relationships: [], allEntities: [entity], apiType: "rest" };
    const files = [
      ...(await generator.generateEntity(options)),
      ...(await generator.generateDto(options)),
    ];
    const entityFile = findFileContent(files, "Email.entity")!;
    expect(entityFile).toContain("to: string[];");
    expect(entityFile).toContain("ids: number[];");
    expect(entityFile).toContain("flags: boolean[];");
    expect(files.find((f) => f.path.includes("dto"))!.content).toContain(": number[];");
  });
});
