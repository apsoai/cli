import { expect, describe, test } from "@jest/globals";
import {
  targetTableName,
  buildColumnMapping,
  topoSortTables,
  planCopy,
  coerceValue,
  buildInsertSql,
  executeCopy,
  targetColumnsFromSchema,
  SourceReader,
  TargetWriter,
} from "../../../src/lib/import/copy-data";
import {
  IntrospectedSchema,
  IntrospectedTable,
} from "../../../src/lib/import/types";

function col(name: string, udtName = "text", ordinal = 1) {
  return {
    name,
    udtName,
    dataType: "base",
    nullable: false,
    default: null,
    charMaxLength: null,
    numericPrecision: null,
    numericScale: null,
    ordinal,
    isEnum: false,
  };
}

function table(
  name: string,
  o: Partial<IntrospectedTable> = {}
): IntrospectedTable {
  return {
    name,
    columns: o.columns ?? [],
    primaryKey: o.primaryKey ?? [],
    foreignKeys: o.foreignKeys ?? [],
    uniqueConstraints: o.uniqueConstraints ?? [],
    indexes: o.indexes ?? [],
  };
}

function schema(tables: IntrospectedTable[]): IntrospectedSchema {
  return { schema: "public", tables, enums: [], skipped: { views: [], systemSchemas: [] } };
}

describe("targetTableName", () => {
  test("snake_case source tables are unchanged", () => {
    expect(targetTableName("blog_posts")).toBe("blog_posts");
  });
  test("PascalCase entity names fold to snake_case", () => {
    expect(targetTableName("User")).toBe("user");
    expect(targetTableName("BlogPost")).toBe("blog_post");
  });
});

describe("buildColumnMapping", () => {
  test("scalar columns map to themselves; single FK renamed to camelCase Id", () => {
    const t = table("posts", {
      columns: [col("id", "uuid", 1), col("title", "text", 2), col("user_id", "uuid", 3)],
      foreignKeys: [
        { columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "CASCADE" },
      ],
    });
    const mapping = buildColumnMapping(t);
    expect(mapping).toEqual([
      { sourceColumn: "id", targetColumn: "id" },
      { sourceColumn: "title", targetColumn: "title" },
      { sourceColumn: "user_id", targetColumn: "userId" },
    ]);
  });

  test("non-default FK column maps via derived reference name", () => {
    const t = table("posts", {
      columns: [col("id", "uuid", 1), col("author_id", "uuid", 2)],
      foreignKeys: [
        { columns: ["author_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "NO ACTION" },
      ],
    });
    expect(buildColumnMapping(t)[1]).toEqual({
      sourceColumn: "author_id",
      targetColumn: "authorId",
    });
  });
});

describe("topoSortTables", () => {
  test("parents are ordered before children", () => {
    const tables = [
      table("posts", {
        foreignKeys: [{ columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "NO ACTION" }],
      }),
      table("users"),
    ];
    const { order, cyclic } = topoSortTables(tables);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("posts"));
    expect(cyclic).toEqual([]);
  });

  test("self-references do not create a cycle", () => {
    const tables = [
      table("nodes", {
        foreignKeys: [{ columns: ["parent_id"], referencedTable: "nodes", referencedColumns: ["id"], onDelete: "NO ACTION" }],
      }),
    ];
    const { order, cyclic } = topoSortTables(tables);
    expect(order).toEqual(["nodes"]);
    expect(cyclic).toEqual([]);
  });

  test("mutual FK cycle is reported and still ordered best-effort", () => {
    const tables = [
      table("a", { foreignKeys: [{ columns: ["b_id"], referencedTable: "b", referencedColumns: ["id"], onDelete: "NO ACTION" }] }),
      table("b", { foreignKeys: [{ columns: ["a_id"], referencedTable: "a", referencedColumns: ["id"], onDelete: "NO ACTION" }] }),
    ];
    const { order, cyclic } = topoSortTables(tables);
    expect(order).toHaveLength(2);
    expect(cyclic.sort()).toEqual(["a", "b"]);
  });
});

describe("planCopy", () => {
  const source = schema([
    table("users", {
      primaryKey: ["id"],
      columns: [col("id", "int4", 1), col("email", "text", 2), col("secret", "text", 3)],
    }),
    table("posts", {
      primaryKey: ["id"],
      columns: [col("id", "uuid", 1), col("user_id", "uuid", 2)],
      foreignKeys: [{ columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "CASCADE" }],
    }),
    table("legacy", { primaryKey: ["id"], columns: [col("id", "uuid", 1)] }),
  ]);

  const targetColumns = new Map<string, Set<string>>([
    ["users", new Set(["id", "email"])], // note: "secret" missing in target
    ["posts", new Set(["id", "userId"])], // snakeCase("posts") === "posts"; FK renamed
    // "legacy" intentionally absent from target
  ]);

  test("orders tables, maps FK columns, and verifies against the target", () => {
    const plan = planCopy(source, targetColumns);
    const names = plan.tables.map((t) => t.sourceTable);
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("posts"));

    const users = plan.tables.find((t) => t.sourceTable === "users")!;
    expect(users.targetTable).toBe("users");
    expect(users.sourceColumns).toEqual(["id", "email"]);
    // serial (int4) single-id PK => sequence reset target column
    expect(users.serialPkColumn).toBe("id");
    expect(users.orderBy).toBe("id");

    const posts = plan.tables.find((t) => t.sourceTable === "posts")!;
    expect(posts.targetTable).toBe("posts");
    expect(posts.sourceColumns).toEqual(["id", "user_id"]);
    expect(posts.targetColumns).toEqual(["id", "userId"]);
    expect(posts.serialPkColumn).toBeNull(); // uuid PK

    // "secret" dropped (missing in target); "legacy" table skipped entirely.
    expect(plan.skippedColumns).toContainEqual({
      table: "users",
      column: "secret",
      reason: 'target column "secret" not found in users',
    });
    expect(plan.missingTargetTables).toEqual(["legacy"]);
  });

  test("table filter limits the plan", () => {
    const plan = planCopy(source, targetColumns, ["posts"]);
    expect(plan.tables.map((t) => t.sourceTable)).toEqual(["posts"]);
  });
});

describe("coerceValue", () => {
  test("stringifies objects/arrays, passes primitives/Date/Buffer/null", () => {
    expect(coerceValue({ a: 1 })).toBe('{"a":1}');
    expect(coerceValue([1, 2])).toBe("[1,2]");
    expect(coerceValue(null)).toBeNull();
    // eslint-disable-next-line unicorn/no-useless-undefined -- exercising the undefined branch
    expect(coerceValue(undefined)).toBeNull();
    expect(coerceValue(5)).toBe(5);
    expect(coerceValue("x")).toBe("x");
    const d = new Date();
    expect(coerceValue(d)).toBe(d);
    const b = Buffer.from("x");
    expect(coerceValue(b)).toBe(b);
  });
});

describe("buildInsertSql", () => {
  test("builds parameterized multi-row insert with schema qualification", () => {
    const { text, values } = buildInsertSql(
      "post",
      ["id", "userId"],
      [
        ["a", "u1"],
        ["b", null],
      ],
      "public"
    );
    expect(text).toBe(
      'INSERT INTO "public"."post" ("id", "userId") VALUES ($1, $2), ($3, $4)'
    );
    expect(values).toEqual(["a", "u1", "b", null]);
  });
});

// ---- executor with fakes ----

class FakeSource implements SourceReader {
  private data: Record<string, unknown[][]>;

  constructor(data: Record<string, unknown[][]>) {
    this.data = data;
  }

  async totalRows(t: string): Promise<number> {
    return (this.data[t] ?? []).length;
  }

  async readBatch(
    t: string,
    _columns: string[],
    _orderBy: string | null,
    offset: number,
    limit: number
  ): Promise<unknown[][]> {
    return (this.data[t] ?? []).slice(offset, offset + limit);
  }
}

class FakeTarget implements TargetWriter {
  inserts: Array<{ table: string; columns: string[]; rows: unknown[][] }> = [];

  sequencesReset: Array<{ table: string; column: string }> = [];

  began = false;

  committed = false;

  rolledBack = false;

  private counts: Record<string, number>;

  constructor(counts: Record<string, number> = {}) {
    this.counts = counts;
  }

  async rowCount(t: string): Promise<number> {
    return this.counts[t] ?? 0;
  }

  async insertBatch(table: string, columns: string[], rows: unknown[][]): Promise<void> {
    this.inserts.push({ table, columns, rows });
  }

  async resetSequence(table: string, column: string): Promise<void> {
    this.sequencesReset.push({ table, column });
  }

  async begin(): Promise<void> {
    this.began = true;
  }

  async commit(): Promise<void> {
    this.committed = true;
  }

  async rollback(): Promise<void> {
    this.rolledBack = true;
  }
}

const twoTablePlan = {
  tables: [
    {
      sourceTable: "users",
      targetTable: "users",
      sourceColumns: ["id", "email"],
      targetColumns: ["id", "email"],
      orderBy: "id",
      serialPkColumn: "id",
    },
    {
      sourceTable: "posts",
      targetTable: "post",
      sourceColumns: ["id", "user_id"],
      targetColumns: ["id", "userId"],
      orderBy: "id",
      serialPkColumn: null,
    },
  ],
  skippedColumns: [],
  missingTargetTables: [],
  cyclicTables: [],
};

describe("executeCopy", () => {
  test("copies in batches, resets serial sequences, commits", async () => {
    const source = new FakeSource({
      users: [
        [1, "a@x.com"],
        [2, "b@x.com"],
        [3, "c@x.com"],
      ],
      posts: [["p1", 1]],
    });
    const target = new FakeTarget();
    const result = await executeCopy(twoTablePlan, source, target, {
      batchSize: 2,
    });

    expect(target.began).toBe(true);
    expect(target.committed).toBe(true);
    // users: 3 rows in batches of 2 => 2 insert calls; posts: 1 call.
    expect(target.inserts.filter((i) => i.table === "users")).toHaveLength(2);
    expect(target.inserts.find((i) => i.table === "post")!.columns).toEqual([
      "id",
      "userId",
    ]);
    expect(target.sequencesReset).toEqual([{ table: "users", column: "id" }]);
    expect(result.perTable).toEqual([
      { table: "users", rows: 3 },
      { table: "post", rows: 1 },
    ]);
  });

  test("aborts before writing when a target table is non-empty", async () => {
    const source = new FakeSource({ users: [[1, "a"]], posts: [] });
    const target = new FakeTarget({ users: 5 });
    await expect(
      executeCopy(twoTablePlan, source, target, {})
    ).rejects.toThrow(/already contain rows/);
    expect(target.began).toBe(false);
    expect(target.inserts).toHaveLength(0);
  });

  test("dry run reports source counts and would-block tables without writing", async () => {
    const source = new FakeSource({ users: [[1, "a"], [2, "b"]], posts: [["p", 1]] });
    const target = new FakeTarget({ users: 9 });
    const result = await executeCopy(twoTablePlan, source, target, {
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.perTable).toEqual([
      { table: "users", rows: 2 },
      { table: "post", rows: 1 },
    ]);
    expect(result.blockedTables).toEqual(["users"]);
    expect(target.began).toBe(false);
    expect(target.inserts).toHaveLength(0);
  });

  test("rolls back if an insert fails mid-run", async () => {
    const source = new FakeSource({ users: [[1, "a"]], posts: [["p", 1]] });
    const target = new FakeTarget();
    target.insertBatch = async () => {
      throw new Error("boom");
    };
    await expect(executeCopy(twoTablePlan, source, target, {})).rejects.toThrow(
      "boom"
    );
    expect(target.rolledBack).toBe(true);
    expect(target.committed).toBe(false);
  });
});

describe("targetColumnsFromSchema", () => {
  test("builds a table -> column-set map", () => {
    const map = targetColumnsFromSchema(
      schema([table("users", { columns: [col("id"), col("email", "text", 2)] })])
    );
    expect(map.get("users")).toEqual(new Set(["id", "email"]));
  });
});
