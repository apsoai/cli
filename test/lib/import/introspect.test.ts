/* eslint-disable camelcase -- fixtures mirror raw Postgres catalog row shapes */
import { expect, describe, test } from "@jest/globals";
import {
  buildSchema,
  redactConnectionString,
} from "../../../src/lib/import/introspect";

describe("redactConnectionString", () => {
  test("masks the password in a connection string", () => {
    const redacted = redactConnectionString(
      "postgresql://postgres:s3cr3t@db.ref.supabase.co:5432/postgres"
    );
    expect(redacted).toBe(
      "postgresql://postgres:****@db.ref.supabase.co:5432/postgres"
    );
    expect(redacted).not.toContain("s3cr3t");
  });

  test("leaves strings without credentials unchanged", () => {
    expect(redactConnectionString("no creds here")).toBe("no creds here");
  });
});

describe("buildSchema", () => {
  test("assembles tables, columns, PKs, FKs, uniques, indexes, and enums", () => {
    const result = buildSchema("public", {
      tableRows: [
        { table_name: "users", table_type: "BASE TABLE" },
        { table_name: "posts", table_type: "BASE TABLE" },
        { table_name: "active_users", table_type: "VIEW" },
      ],
      columnRows: [
        {
          table_name: "users",
          column_name: "id",
          udt_name: "uuid",
          data_type: "uuid",
          is_nullable: "NO",
          column_default: "gen_random_uuid()",
          character_maximum_length: null,
          numeric_precision: null,
          numeric_scale: null,
          ordinal_position: 1,
        },
        {
          table_name: "users",
          column_name: "role",
          udt_name: "user_role",
          data_type: "USER-DEFINED",
          is_nullable: "NO",
          column_default: null,
          character_maximum_length: null,
          numeric_precision: null,
          numeric_scale: null,
          ordinal_position: 2,
        },
        {
          table_name: "posts",
          column_name: "author_id",
          udt_name: "uuid",
          data_type: "uuid",
          is_nullable: "YES",
          column_default: null,
          character_maximum_length: null,
          numeric_precision: null,
          numeric_scale: null,
          ordinal_position: 2,
        },
      ],
      pkRows: [{ table_name: "users", column_name: "id", key_index: 1 }],
      fkRows: [
        {
          conname: "posts_author_fkey",
          table_name: "posts",
          column_name: "author_id",
          referenced_table: "users",
          referenced_column: "id",
          confdeltype: "c",
          key_index: 1,
        },
      ],
      uniqueRows: [
        {
          conname: "users_email_key",
          table_name: "users",
          column_name: "email",
          key_index: 1,
        },
      ],
      indexRows: [
        {
          table_name: "posts",
          index_name: "posts_author_idx",
          column_name: "author_id",
          indisunique: false,
          ord: 1,
        },
      ],
      enumRows: [
        { enum_name: "user_role", label: "admin" },
        { enum_name: "user_role", label: "member" },
      ],
      schemaRows: [
        { schema_name: "public" },
        { schema_name: "auth" },
        { schema_name: "storage" },
      ],
    });

    // Views excluded from tables, surfaced in skipped.
    expect(result.tables.map((t) => t.name)).toEqual(["users", "posts"]);
    expect(result.skipped.views).toEqual(["active_users"]);
    expect(result.skipped.systemSchemas).toEqual(["auth", "storage"]);

    // Enum detection links column -> enum type.
    const users = result.tables.find((t) => t.name === "users")!;
    expect(users.primaryKey).toEqual(["id"]);
    const role = users.columns.find((c) => c.name === "role")!;
    expect(role.isEnum).toBe(true);
    expect(role.enumTypeName).toBe("user_role");
    expect(result.enums).toEqual([
      { name: "user_role", labels: ["admin", "member"] },
    ]);

    // FK with cascade + nullability.
    const posts = result.tables.find((t) => t.name === "posts")!;
    expect(posts.foreignKeys).toEqual([
      {
        columns: ["author_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "CASCADE",
      },
    ]);
    expect(posts.columns.find((c) => c.name === "author_id")!.nullable).toBe(true);
    expect(posts.indexes).toEqual([
      { name: "posts_author_idx", columns: ["author_id"], unique: false },
    ]);
  });

  test("groups composite foreign keys by constraint name in key order", () => {
    const result = buildSchema("public", {
      tableRows: [{ table_name: "memberships", table_type: "BASE TABLE" }],
      columnRows: [],
      pkRows: [],
      fkRows: [
        {
          conname: "fk_pair",
          table_name: "memberships",
          column_name: "org_id",
          referenced_table: "pairs",
          referenced_column: "a",
          confdeltype: "a",
          key_index: 1,
        },
        {
          conname: "fk_pair",
          table_name: "memberships",
          column_name: "user_id",
          referenced_table: "pairs",
          referenced_column: "b",
          confdeltype: "a",
          key_index: 2,
        },
      ],
      uniqueRows: [],
      indexRows: [],
      enumRows: [],
      schemaRows: [],
    });
    expect(result.tables[0].foreignKeys).toEqual([
      {
        columns: ["org_id", "user_id"],
        referencedTable: "pairs",
        referencedColumns: ["a", "b"],
        onDelete: "NO ACTION",
      },
    ]);
  });
});
