import * as fs from "fs";
import * as path from "path";
import { DiagnosticFinding, DiagnosticContext } from "./types";
import { fieldTypeToColumnType } from "../utils/field";
import { snakeCase } from "../utils/casing";

/**
 * Check that UUID primary keys use @PrimaryGeneratedColumn('uuid')
 * instead of @PrimaryColumn() in generated entity files.
 *
 * Issue #59: uuid PK generated with no generation strategy causes
 * runtime errors because the database never generates a value.
 */
export function checkPkStrategy(ctx: DiagnosticContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const entity of ctx.entities) {
    if (entity.primaryKeyType !== "uuid") continue;

    // Check if any field is explicitly marked as primary (custom PK)
    const hasCustomPk = entity.fields?.some((f) => f.primary) ?? false;
    if (hasCustomPk) continue;

    // Look for the generated entity file
    const entityFileName = `${entity.name}.entity.ts`;
    const entityDir = snakeCase(entity.name);
    const entityPath = path.join(
      ctx.projectRoot,
      ctx.rootFolder,
      "autogen",
      entityDir,
      entityFileName
    );

    if (!fs.existsSync(entityPath)) {
      findings.push({
        check: "pk-strategy",
        severity: "warning",
        message: `Entity "${entity.name}" has primaryKeyType "uuid" but generated file not found`,
        entity: entity.name,
        file: path.relative(ctx.projectRoot, entityPath),
        suggestion: "Run `apso generate` to create entity files",
      });
      continue;
    }

    const content = fs.readFileSync(entityPath, "utf-8");

    // The correct pattern is @PrimaryGeneratedColumn('uuid')
    const hasPrimaryGenerated = /PrimaryGeneratedColumn\s*\(\s*['"]uuid['"]\s*\)/.test(content);

    // Wrong patterns: @PrimaryColumn() or @PrimaryColumn({ type: 'uuid' }) without generation
    const hasPrimaryColumnOnly = /PrimaryColumn\s*\(/.test(content) && !hasPrimaryGenerated;

    if (hasPrimaryColumnOnly) {
      findings.push({
        check: "pk-strategy",
        severity: "error",
        message: `Entity "${entity.name}" uses @PrimaryColumn() for UUID PK instead of @PrimaryGeneratedColumn('uuid'). The database will not auto-generate IDs.`,
        entity: entity.name,
        file: path.relative(ctx.projectRoot, entityPath),
        suggestion: `Replace @PrimaryColumn() with @PrimaryGeneratedColumn('uuid') in the entity file, or regenerate with \`apso generate\``,
      });
    } else if (!hasPrimaryGenerated) {
      findings.push({
        check: "pk-strategy",
        severity: "warning",
        message: `Entity "${entity.name}" has primaryKeyType "uuid" but no @PrimaryGeneratedColumn('uuid') found in generated code`,
        entity: entity.name,
        file: path.relative(ctx.projectRoot, entityPath),
        suggestion: "Regenerate with `apso generate`",
      });
    }
  }

  return findings;
}

/**
 * Check for unused imports in generated entity files.
 *
 * The code generator sometimes imports symbols (like Generated, Index)
 * that aren't used in the entity body.
 */
export function checkUnusedImports(ctx: DiagnosticContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  if (ctx.language !== "typescript") return findings;

  for (const entity of ctx.entities) {
    const entityFileName = `${entity.name}.entity.ts`;
    const entityDir = snakeCase(entity.name);
    const entityPath = path.join(
      ctx.projectRoot,
      ctx.rootFolder,
      "autogen",
      entityDir,
      entityFileName
    );

    if (!fs.existsSync(entityPath)) continue;

    const content = fs.readFileSync(entityPath, "utf-8");
    const lines = content.split("\n");

    // Find import lines from typeorm
    for (const line of lines) {
      const importMatch = line.match(
        /import\s*\{([^}]+)\}\s*from\s*['"]typeorm['"]/
      );
      if (!importMatch) continue;

      const imports = importMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Check each imported symbol against the rest of the file
      // (excluding the import line itself)
      const restOfFile = content.replace(line, "");
      for (const sym of imports) {
        // Count usages: decorators appear as @Symbol or Symbol( or Symbol<
        const usagePattern = new RegExp(`(?:@${sym}\\b|${sym}\\s*[(<])`, "g");
        const usages = restOfFile.match(usagePattern);
        if (!usages || usages.length === 0) {
          findings.push({
            check: "unused-imports",
            severity: "warning",
            message: `Entity "${entity.name}" imports "${sym}" from typeorm but never uses it`,
            entity: entity.name,
            file: path.relative(ctx.projectRoot, entityPath),
            suggestion: `Remove "${sym}" from the import statement`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Check that each field type in the schema is recognized by the generator.
 *
 * Uses the canonical fieldTypeToColumnType map as the source of truth.
 */
export function checkFieldTypeMismatch(ctx: DiagnosticContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const validTypes = new Set(Object.keys(fieldTypeToColumnType));

  for (const entity of ctx.entities) {
    for (const field of entity.fields || []) {
      if (!validTypes.has(field.type)) {
        findings.push({
          check: "field-type-mismatch",
          severity: "error",
          message: `Entity "${entity.name}", field "${field.name}": type "${field.type}" is not recognized by the generator`,
          entity: entity.name,
          suggestion: `Valid types: text, integer, float, decimal, numeric, boolean, date, enum, json, json-plain, array, uuid`,
        });
      }

      // Enum fields must have values
      if (field.type === "enum" && (!field.values || field.values.length === 0)) {
        findings.push({
          check: "field-type-mismatch",
          severity: "error",
          message: `Entity "${entity.name}", field "${field.name}": enum type requires a "values" array`,
          entity: entity.name,
          suggestion: `Add "values": ["option1", "option2"] to the field definition`,
        });
      }
    }
  }

  return findings;
}

/**
 * Check that relationship targets reference existing entities.
 *
 * This overlaps with validate_schema but is included for completeness
 * in the diagnostic suite.
 */
export function checkRelationshipTarget(ctx: DiagnosticContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const entityNames = new Set(ctx.entities.map((e) => e.name));

  for (const [entityName, relationships] of Object.entries(ctx.relationshipMap)) {
    if (!entityNames.has(entityName)) {
      findings.push({
        check: "relationship-target",
        severity: "error",
        message: `Relationship source "${entityName}" does not match any entity`,
        entity: entityName,
        suggestion: `Check spelling or add an entity named "${entityName}"`,
      });
      continue;
    }

    for (const rel of relationships) {
      if (!entityNames.has(rel.name)) {
        findings.push({
          check: "relationship-target",
          severity: "error",
          message: `Entity "${entityName}": relationship target "${rel.name}" does not exist`,
          entity: entityName,
          suggestion: `Check spelling or add an entity named "${rel.name}"`,
        });
      }
    }
  }

  return findings;
}

/**
 * Check that generated schema can sync in PGlite without errors.
 *
 * This is an async check that imports and runs the migration sandbox.
 */
export async function checkMigrationSandbox(
  ctx: DiagnosticContext
): Promise<DiagnosticFinding[]> {
  const findings: DiagnosticFinding[] = [];

  try {
    const { runMigrationSandbox } = await import("../migrate/sandbox");
    const result = await runMigrationSandbox({
      entities: ctx.entities,
      relationshipMap: ctx.relationshipMap,
    });

    if (!result.success) {
      findings.push({
        check: "migration-sandbox",
        severity: "error",
        message: `Migration sandbox failed: ${result.error || "unknown error"}`,
        suggestion: "Fix schema issues and run `apso migrate` to debug",
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    findings.push({
      check: "migration-sandbox",
      severity: "warning",
      message: `Could not run migration sandbox: ${msg}`,
      suggestion:
        "Ensure @electric-sql/pglite and typeorm-pglite are installed",
    });
  }

  return findings;
}
