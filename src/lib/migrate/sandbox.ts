/**
 * Migration Sandbox
 *
 * The core migration testing engine. Uses PGlite (in-process Postgres) to:
 * 1. Establish a baseline schema from the previous snapshot
 * 2. Compute the diff against the current schema
 * 3. Generate and test migration SQL locally
 *
 * This validates migrations before anything touches a remote database.
 */

/* eslint-disable new-cap -- TypeORM decorator factories (Entity, Column, ...) are applied programmatically */

import * as fs from "fs";
import * as path from "path";
import { getProjectConfigDir } from "../config/paths";
import { readSnapshot, writeSnapshot, resetSnapshot, ApsorcSnapshot } from "./snapshot";
import { EntityGeneratorInput } from "./entity-generator";
import { Entity as EntityDef } from "../types/entity";
import { RelationshipMap } from "../types/relationship";
import { normalizeFieldType, fieldTypeToColumnType } from "../utils/field";
import { snakeCase } from "../utils/casing";
import { getRelationshipForTemplate } from "../utils/relationships";

/** Constructor type for entity classes built at runtime. */
type EntityCtor = new () => unknown;

/**
 * Result of a migration sandbox run.
 */
export interface MigrationResult {
  /** Whether the migration was needed (schema changed) */
  needed: boolean;
  /** Whether the migration executed without errors */
  success: boolean;
  /** Generated SQL statements (up direction) */
  upSql: string[];
  /** Generated SQL statements (down direction) */
  downSql: string[];
  /** Error message if migration failed */
  error?: string;
}

/**
 * Get the sandbox data directory for PGlite persistence.
 */
function getSandboxDataDir(projectDir?: string): string {
  return path.join(getProjectConfigDir(projectDir), "sandbox", "pgdata");
}

/**
 * Clear TypeORM's global metadata storage.
 * Required between sandbox runs to prevent metadata from previous
 * entity classes leaking into subsequent DataSource instances.
 */
function clearTypeOrmMetadata(): void {
  const typeorm = require("typeorm");
  const storage = typeorm.getMetadataArgsStorage();
  for (const key of Object.keys(storage)) {
    if (Array.isArray(storage[key])) {
      storage[key].length = 0;
    }
  }
}

/**
 * Reset the PGlite singleton so a fresh instance is created on next use.
 */
async function resetPGliteSingleton(): Promise<void> {
  try {
    const { PGliteInstance } = require("typeorm-pglite/dist/pglite-instance");
    await PGliteInstance.close();
  } catch {
    // ignore -- singleton may not exist yet
  }
}

/**
 * Build TypeORM entity classes programmatically from parsed entity definitions.
 * Uses TypeORM decorators applied at runtime, so no file I/O or compilation needed.
 *
 * Clears TypeORM's global metadata storage first to prevent cross-contamination
 * between runs.
 */
function buildEntityClasses(
  entities: EntityDef[],
  relationshipMap: RelationshipMap = {}
): EntityCtor[] {
  clearTypeOrmMetadata();
  const typeorm = require("typeorm");
  const classes: EntityCtor[] = [];
  const classMap = new Map<string, EntityCtor>();

  for (const entityDef of entities) {
    const className = entityDef.name;
    // Honor an explicit per-entity `table` override so local migration tests
    // match the generated entity's table name. See apsoai/cli#98.
    const tableName = entityDef.table || snakeCase(entityDef.name);

    const EntityClass = { [className]: class {} }[className];
    typeorm.Entity(tableName)(EntityClass);

    const hasCustomPk = entityDef.fields?.some((f) => f.primary) ?? false;
    const pkType: string = entityDef.primaryKeyType || "serial";

    if (!hasCustomPk) {
      if (pkType === "uuid") {
        typeorm.PrimaryColumn({ type: "uuid" })(EntityClass.prototype, "id");
      } else if (pkType === "text") {
        typeorm.PrimaryColumn({ type: "text" })(EntityClass.prototype, "id");
      } else {
        typeorm.PrimaryGeneratedColumn()(EntityClass.prototype, "id");
      }
    }

    if (entityDef.created_at) {
      typeorm.CreateDateColumn()(EntityClass.prototype, "created_at");
    }
    if (entityDef.updated_at) {
      typeorm.UpdateDateColumn()(EntityClass.prototype, "updated_at");
    }

    const fields = entityDef.fields || [];
    for (const field of fields) {
      if (!hasCustomPk && field.name === "id") continue;
      if (entityDef.created_at && field.name === "created_at") continue;
      if (entityDef.updated_at && field.name === "updated_at") continue;

      const normalizedType = normalizeFieldType(field.type);
      const colType = fieldTypeToColumnType[normalizedType] || "varchar";

      const colOpts: Record<string, any> = { type: colType };

      if (field.nullable) colOpts.nullable = true;
      if (field.unique) colOpts.unique = true;
      if (field.default !== undefined && field.default !== null) {
        colOpts.default = field.default;
      }
      if (field.type === "enum" && field.values) {
        colOpts.enum = field.values;
      }
      if ((field.length ?? 0) > 0) colOpts.length = field.length;
      if (field.precision) colOpts.precision = field.precision;
      if (field.scale !== undefined) colOpts.scale = field.scale;

      if (field.primary) {
        typeorm.PrimaryColumn(colOpts)(EntityClass.prototype, field.name);
      } else {
        typeorm.Column(colOpts)(EntityClass.prototype, field.name);
      }
    }

    classes.push(EntityClass);
    classMap.set(entityDef.name, EntityClass);
  }

  for (const entityDef of entities) {
    const EntityClass = classMap.get(entityDef.name);
    if (!EntityClass) continue;

    const relationships = getRelationshipForTemplate(
      entityDef.name,
      relationshipMap[entityDef.name] || [],
      entities
    );

    for (const relationship of relationships) {
      const targetClass = classMap.get(relationship.name);
      if (!targetClass) continue;
      const inversePropertyName =
        (relationship as any).inverseSidePropertyName ||
        relationship.inversePropertyName ||
        entityDef.name;

      const relationOptions: Record<string, unknown> = {};
      if (relationship.nullable !== undefined) {
        relationOptions.nullable = relationship.nullable;
      }
      if (relationship.cascadeDelete) {
        relationOptions.onDelete = "CASCADE";
      }

      if (relationship.type === "ManyToOne") {
        if (relationship.index) {
          typeorm.Index()(EntityClass.prototype, relationship.relationshipName);
        }

        const inverseSide = relationship.biDirectional
          ? (target: Record<string, unknown>) => target[inversePropertyName]
          : undefined;

        typeorm.ManyToOne(
          () => targetClass,
          inverseSide,
          relationOptions
        )(EntityClass.prototype, relationship.relationshipName);
        typeorm.JoinColumn({ name: relationship.camelCasedId })(
          EntityClass.prototype,
          relationship.relationshipName
        );
      }

      if (relationship.type === "OneToMany" && relationship.biDirectional) {
        typeorm.OneToMany(
          () => targetClass,
          (target: Record<string, unknown>) => target[inversePropertyName]
        )(EntityClass.prototype, relationship.pluralizedRelationshipName);
      }

      if (relationship.type === "ManyToMany") {
        const inverseSide = relationship.biDirectional
          ? (target: Record<string, unknown>) => target[inversePropertyName]
          : undefined;
        typeorm.ManyToMany(
          () => targetClass,
          inverseSide
        )(EntityClass.prototype, relationship.pluralizedRelationshipName);

        if (relationship.joinTable) {
          const joinTableOptions: Record<string, unknown> = {};
          if (relationship.joinTableName) {
            joinTableOptions.name = relationship.joinTableName;
          }
          if (relationship.joinColumnName) {
            joinTableOptions.joinColumn = {
              name: relationship.joinColumnName,
              referencedColumnName: "id",
            };
          }
          if (relationship.inverseJoinColumnName) {
            joinTableOptions.inverseJoinColumn = {
              name: relationship.inverseJoinColumnName,
              referencedColumnName: "id",
            };
          }

          typeorm.JoinTable(
            Object.keys(joinTableOptions).length > 0
              ? joinTableOptions
              : undefined
          )(EntityClass.prototype, relationship.pluralizedRelationshipName);
        }
      }

      if (relationship.type === "OneToOne") {
        const inverseSide = relationship.biDirectional
          ? (target: Record<string, unknown>) => target[inversePropertyName]
          : undefined;
        typeorm.OneToOne(
          () => targetClass,
          inverseSide,
          relationOptions
        )(EntityClass.prototype, relationship.relationshipName);

        if (relationship.joinTable) {
          typeorm.JoinColumn()(EntityClass.prototype, relationship.relationshipName);
        }
      }
    }
  }

  return classes;
}

function snapshotRelationships(relationshipMap: RelationshipMap) {
  return Object.entries(relationshipMap)
    .flatMap(([from, relationships]) =>
      relationships.map((relationship) => ({
        from,
        to: relationship.name,
        type: relationship.type,
        to_name: relationship.referenceName ?? undefined,
        nullable: relationship.nullable,
        bi_directional: relationship.biDirectional,
        cascadeDelete: relationship.cascadeDelete,
        index: relationship.index,
        join: relationship.join,
        joinTableName: relationship.joinTableName,
        joinColumnName: relationship.joinColumnName,
        inverseJoinColumnName: relationship.inverseJoinColumnName,
        inverseReferenceName: relationship.inverseReferenceName,
      }))
    )
    .sort((a, b) =>
      `${a.from}:${a.to}:${a.type}:${a.to_name || ""}`.localeCompare(
        `${b.from}:${b.to}:${b.type}:${b.to_name || ""}`
      )
    );
}

function relationshipMapFromSnapshot(
  relationships: ReturnType<typeof snapshotRelationships> = []
): RelationshipMap {
  const relationshipMap: RelationshipMap = {};
  for (const relationship of relationships) {
    relationshipMap[relationship.from] = [
      ...(relationshipMap[relationship.from] || []),
      {
        name: relationship.to,
        type: relationship.type as any,
        referenceName: relationship.to_name,
        nullable: relationship.nullable,
        biDirectional: relationship.bi_directional,
        cascadeDelete: relationship.cascadeDelete,
        index: relationship.index,
        join: relationship.join,
        joinTableName: relationship.joinTableName,
        joinColumnName: relationship.joinColumnName,
        inverseJoinColumnName: relationship.inverseJoinColumnName,
        inverseReferenceName: relationship.inverseReferenceName,
      },
    ];
  }
  return relationshipMap;
}

/**
 * Create a TypeORM DataSource configured for PGlite with in-memory entity classes.
 */
async function createPGliteDataSource(
  entityClasses: EntityCtor[]
): Promise<any> {
  const { DataSource } = await import("typeorm");

  let PGliteDriver: any;
  try {
    const pgliteModule = await import("typeorm-pglite");
    PGliteDriver = pgliteModule.PGliteDriver;
  } catch (error) {
    throw new Error(
      "Migration sandbox requires typeorm-pglite and @electric-sql/pglite.\n" +
        "Install them with: npm install typeorm @electric-sql/pglite typeorm-pglite\n" +
        `Original error: ${error instanceof Error ? error.message : error}`
    );
  }

  // Create a driver. typeorm-pglite uses a singleton PGliteInstance
  // so multiple DataSources share the same in-process database.
  const _driver = new PGliteDriver();

  const dataSource = new DataSource({
    type: "postgres" as any,
    driver: _driver.driver,
    entities: entityClasses,
    synchronize: false,
    logging: false,
  });

  return dataSource;
}

/**
 * Run the migration sandbox: detect changes, generate SQL, test execution.
 *
 * Uses PGlite's singleton pattern: all DataSources within a single
 * runMigrationSandbox call share the same in-process Postgres instance.
 * We reset the singleton at the start of each run for isolation.
 */
export async function runMigrationSandbox(
  current: EntityGeneratorInput,
  projectDir?: string
): Promise<MigrationResult> {
  const snapshot = readSnapshot(projectDir);

  // Build a comparable representation of current schema for snapshot
  const currentSnapshot: ApsorcSnapshot = {
    entities: current.entities.map((e) => ({
      name: e.name,
      fields: e.fields?.map((f) => ({
        name: f.name,
        type: f.type,
        nullable: f.nullable,
        unique: f.unique,
        default: f.default ?? undefined,
        index: f.index,
      })),
      primaryKeyType: e.primaryKeyType,
      created_at: e.created_at,
      updated_at: e.updated_at,
      scopeBy: e.scopeBy,
    })),
    relationships: snapshotRelationships(current.relationshipMap),
  };

  // Quick check: has anything changed?
  if (snapshot && !schemaChanged(currentSnapshot, snapshot)) {
    return {
      needed: false,
      success: true,
      upSql: [],
      downSql: [],
    };
  }

  try {
    // Reset PGlite singleton to get a fresh in-memory database
    await resetPGliteSingleton();

    // Build previous entities from snapshot
    const previousEntities: EntityDef[] = snapshot?.entities?.length
      ? snapshot.entities.map((se) => ({
          name: se.name,
          fields: se.fields?.map((f) => ({
            name: f.name,
            type: f.type as any,
            nullable: f.nullable,
            unique: f.unique,
            default: f.default as string | null | undefined,
            index: f.index,
          })),
          primaryKeyType: se.primaryKeyType as "serial" | "uuid" | undefined,
          created_at: se.created_at,
          updated_at: se.updated_at,
          scopeBy: se.scopeBy,
        }))
      : [];

    // Step 1: Establish baseline with previous schema
    if (previousEntities.length > 0) {
      const prevClasses = buildEntityClasses(
        previousEntities,
        relationshipMapFromSnapshot(snapshot?.relationships as any)
      );
      const prevDs = await createPGliteDataSource(prevClasses);
      await prevDs.initialize();
      await prevDs.synchronize();
      // Don't call prevDs.destroy() -- it closes the PGlite singleton.
      // Just disconnect TypeORM's connection manager.
      // The PGlite in-memory database persists in the singleton.
    }

    // Step 2: Compute diff with current schema
    const currentClasses = buildEntityClasses(
      current.entities,
      current.relationshipMap
    );
    const currentDs = await createPGliteDataSource(currentClasses);
    await currentDs.initialize();

    try {
      const sqlInMemory = await currentDs.driver.createSchemaBuilder().log();
      const upQueries = sqlInMemory.upQueries || [];
      const downQueries = sqlInMemory.downQueries || [];

      const upSql = upQueries.map(
        (q: { query: string; parameters?: any[] }) => q.query
      );
      const downSql = downQueries.map(
        (q: { query: string; parameters?: any[] }) => q.query
      );

      if (upSql.length === 0) {
        await resetPGliteSingleton();
        return {
          needed: false,
          success: true,
          upSql: [],
          downSql: [],
        };
      }

      // Step 3: Execute the migration to verify it works
      await currentDs.synchronize();
      await resetPGliteSingleton();

      return {
        needed: true,
        success: true,
        upSql,
        downSql,
      };
    } catch (execError) {
      await resetPGliteSingleton();

      return {
        needed: true,
        success: false,
        upSql: [],
        downSql: [],
        error:
          execError instanceof Error
            ? execError.message
            : String(execError),
      };
    }
  } catch (outerError) {
    try {
      await resetPGliteSingleton();
    } catch {
      /* ignore */
    }

    return {
      needed: true,
      success: false,
      upSql: [],
      downSql: [],
      error:
        outerError instanceof Error
          ? outerError.message
          : String(outerError),
    };
  }
}

/**
 * Apply a successful migration: update the snapshot to current state.
 */
export function applyMigration(
  current: EntityGeneratorInput,
  projectDir?: string
): void {
  const snapshot: ApsorcSnapshot = {
    entities: current.entities.map((e) => ({
      name: e.name,
      fields: e.fields?.map((f) => ({
        name: f.name,
        type: f.type,
        nullable: f.nullable,
        unique: f.unique,
        default: f.default ?? undefined,
        index: f.index,
      })),
      primaryKeyType: e.primaryKeyType,
      created_at: e.created_at,
      updated_at: e.updated_at,
      scopeBy: e.scopeBy,
    })),
    relationships: snapshotRelationships(current.relationshipMap),
  };
  writeSnapshot(snapshot, projectDir);
}

/**
 * Reset the sandbox: remove snapshot and PGlite data.
 */
export function resetSandbox(projectDir?: string): void {
  resetSnapshot(projectDir);
  const dataDir = getSandboxDataDir(projectDir);
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/**
 * Simple deep comparison between current and snapshot schemas.
 */
function schemaChanged(
  current: ApsorcSnapshot,
  snapshot: ApsorcSnapshot
): boolean {
  return (
    JSON.stringify(current.entities) !== JSON.stringify(snapshot.entities) ||
    JSON.stringify(current.relationships || []) !==
      JSON.stringify(snapshot.relationships || [])
  );
}
