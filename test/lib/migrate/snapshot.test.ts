import { expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  readSnapshot,
  writeSnapshot,
  hasChanges,
  resetSnapshot,
  ApsorcSnapshot,
  ComparableSchema,
} from "../../../src/lib/migrate/snapshot";

describe("snapshot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apso-snapshot-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readSnapshot", () => {
    test("returns null when no snapshot exists", () => {
      const result = readSnapshot(tmpDir);
      expect(result).toBeNull();
    });

    test("reads a valid snapshot", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [{ name: "User" }],
      };
      const sandboxDir = path.join(tmpDir, ".apso", "sandbox");
      fs.mkdirSync(sandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(sandboxDir, "schema-snapshot.json"),
        JSON.stringify(snapshot),
        "utf-8"
      );

      const result = readSnapshot(tmpDir);
      expect(result).toEqual(snapshot);
    });

    test("returns null for invalid JSON", () => {
      const sandboxDir = path.join(tmpDir, ".apso", "sandbox");
      fs.mkdirSync(sandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(sandboxDir, "schema-snapshot.json"),
        "not json",
        "utf-8"
      );

      const result = readSnapshot(tmpDir);
      expect(result).toBeNull();
    });
  });

  describe("writeSnapshot", () => {
    test("writes snapshot to disk", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [
          {
            name: "Product",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      };

      writeSnapshot(snapshot, tmpDir);

      const filePath = path.join(
        tmpDir,
        ".apso",
        "sandbox",
        "schema-snapshot.json"
      );
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.entities[0].name).toBe("Product");
    });

    test("creates directories if they do not exist", () => {
      const snapshot: ApsorcSnapshot = { entities: [] };
      writeSnapshot(snapshot, tmpDir);

      const sandboxDir = path.join(tmpDir, ".apso", "sandbox");
      expect(fs.existsSync(sandboxDir)).toBe(true);
    });
  });

  describe("resetSnapshot", () => {
    test("removes sandbox directory", () => {
      const sandboxDir = path.join(tmpDir, ".apso", "sandbox");
      fs.mkdirSync(sandboxDir, { recursive: true });
      fs.writeFileSync(
        path.join(sandboxDir, "schema-snapshot.json"),
        "{}",
        "utf-8"
      );

      resetSnapshot(tmpDir);
      expect(fs.existsSync(sandboxDir)).toBe(false);
    });

    test("handles non-existent sandbox directory", () => {
      expect(() => resetSnapshot(tmpDir)).not.toThrow();
    });
  });

  describe("hasChanges", () => {
    test("returns true when snapshot is null (first run)", () => {
      const current: ComparableSchema = {
        entities: [{ name: "User" }],
      };
      expect(hasChanges(current, null)).toBe(true);
    });

    test("returns false when schemas match", () => {
      const schema: ApsorcSnapshot = {
        entities: [
          {
            name: "User",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      };
      const current: ComparableSchema = {
        entities: [
          {
            name: "User",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      };
      expect(hasChanges(current, schema)).toBe(false);
    });

    test("detects added entity", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [{ name: "User" }],
      };
      const current: ComparableSchema = {
        entities: [{ name: "User" }, { name: "Post" }],
      };
      expect(hasChanges(current, snapshot)).toBe(true);
    });

    test("detects removed entity", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [{ name: "User" }, { name: "Post" }],
      };
      const current: ComparableSchema = {
        entities: [{ name: "User" }],
      };
      expect(hasChanges(current, snapshot)).toBe(true);
    });

    test("detects modified field", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [
          {
            name: "User",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      };
      const current: ComparableSchema = {
        entities: [
          {
            name: "User",
            fields: [{ name: "email", type: "text", unique: true }],
          },
        ],
      };
      expect(hasChanges(current, snapshot)).toBe(true);
    });

    test("detects added field", () => {
      const snapshot: ApsorcSnapshot = {
        entities: [
          {
            name: "User",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      };
      const current: ComparableSchema = {
        entities: [
          {
            name: "User",
            fields: [
              { name: "email", type: "text" },
              { name: "name", type: "text" },
            ],
          },
        ],
      };
      expect(hasChanges(current, snapshot)).toBe(true);
    });

    test("returns false for empty schemas", () => {
      const snapshot: ApsorcSnapshot = { entities: [] };
      const current: ComparableSchema = { entities: [] };
      expect(hasChanges(current, snapshot)).toBe(false);
    });
  });
});
