import * as Eta from "eta";
import * as path from "path";
import * as fs from "fs";
import { createFile } from "./utils/file-system";
import { Entity, ScopeOptions } from "./types";
import pluralize from "pluralize";

/**
 * Represents a scope field configuration for template rendering
 */
interface ScopeFieldConfig {
  field: string;
  contextKey: string;
  direct: boolean;
  path?: string;
}

/**
 * Represents a scoped entity configuration for template rendering
 */
interface ScopedEntityConfig {
  name: string;
  routeName: string;
  repoName: string;
  scopes: ScopeFieldConfig[];
  injectOnCreate: boolean;
  enforceOn: string[];
  bypassRoles: string[];
}

/**
 * Default scope options when not specified
 */
const DEFAULT_SCOPE_OPTIONS: Required<ScopeOptions> = {
  injectOnCreate: true,
  enforceOn: ['find', 'get', 'create', 'update', 'delete'],
  bypassRoles: [],
};

/**
 * Parses scopeBy configuration and returns structured scope fields.
 *
 * @param scopeBy The scope configuration - either a single field/path string or an array of them.
 * @returns An array of scope field configurations.
 */
function parseScopeBy(scopeBy: string | string[]): ScopeFieldConfig[] {
  const scopes = Array.isArray(scopeBy) ? scopeBy : [scopeBy];

  return scopes.map(scope => {
    const isDirect = !scope.includes('.');
    const field = isDirect ? scope : scope.split('.')[0];

    // For direct fields, contextKey is the same as field
    // For nested paths like 'task.workspaceId', we extract 'workspaceId' as contextKey
    const contextKey = isDirect ? scope : scope.split('.').pop()!;

    return {
      field,
      contextKey,
      direct: isDirect,
      path: isDirect ? undefined : scope,
    };
  });
}

/**
 * Converts entity name to lowercase pluralized route name.
 * e.g., "Project" -> "projects", "DiscoverySession" -> "discoverysessions"
 *
 * @param entityName The entity name in PascalCase.
 * @returns The lowercase pluralized route name.
 */
function toRouteName(entityName: string): string {
  return pluralize(entityName).toLowerCase();
}

/**
 * Converts entity name to repository variable name.
 * e.g., "Project" -> "projectRepository", "DiscoverySession" -> "discoverySessionRepository"
 *
 * @param entityName The entity name in PascalCase.
 * @returns The camelCase repository variable name.
 */
function toRepoName(entityName: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  return `${camelCase}Repository`;
}

/**
 * Extracts scoped entity configurations from all entities.
 *
 * @param entities Array of all entities from the parsed .apsorc.
 * @returns Array of scoped entity configurations for entities that have scopeBy defined.
 */
export function getScopedEntities(entities: Entity[]): ScopedEntityConfig[] {
  return entities
    .filter(entity => entity.scopeBy)
    .map(entity => {
      const options = { ...DEFAULT_SCOPE_OPTIONS, ...entity.scopeOptions };

      return {
        name: entity.name,
        routeName: toRouteName(entity.name),
        repoName: toRepoName(entity.name),
        scopes: parseScopeBy(entity.scopeBy!),
        injectOnCreate: options.injectOnCreate,
        enforceOn: options.enforceOn,
        bypassRoles: options.bypassRoles,
      };
    });
}

/**
 * Checks if any entities have scopeBy configured.
 *
 * @param entities Array of all entities from the parsed .apsorc.
 * @returns True if at least one entity has scopeBy defined.
 */
export function hasScopedEntities(entities: Entity[]): boolean {
  return entities.some(entity => entity.scopeBy);
}

/**
 * Generates the guards module directory and files.
 * Creates scope.guard.ts, guards.module.ts, and index.ts in the guards directory.
 *
 * @param rootPath The root path of the generated source (e.g., 'src').
 * @param entities All entities from the parsed .apsorc.
 * @returns {Promise<void>} A promise that resolves when the guard files are created.
 */
export const createGuards = async (
  rootPath: string,
  entities: Entity[]
): Promise<void> => {
  // Only generate guards if there are scoped entities
  if (!hasScopedEntities(entities)) {
    console.log('[apso] No scopeBy configurations found, skipping guards generation');
    return;
  }

  const guardsDir = path.join(rootPath, 'guards');

  // Ensure guards directory exists
  if (!fs.existsSync(guardsDir)) {
    fs.mkdirSync(guardsDir, { recursive: true });
  }

  const scopedEntities = getScopedEntities(entities);

  // Common template data
  const templateData = {
    scopedEntities,
    generatedAt: new Date().toISOString(),
    generatedBy: 'Apso CLI',
  };

  // Generate scope.guard.ts
  const scopeGuardPath = path.join(guardsDir, 'scope.guard.ts');
  const scopeGuardContent = await Eta.renderFileAsync('./guards/scope.guard', templateData);
  await createFile(scopeGuardPath, scopeGuardContent as string);
  console.log(`[apso] Generated ${scopeGuardPath}`);

  // Generate guards.module.ts
  const guardsModulePath = path.join(guardsDir, 'guards.module.ts');
  const guardsModuleContent = await Eta.renderFileAsync('./guards/guards.module', templateData);
  await createFile(guardsModulePath, guardsModuleContent as string);
  console.log(`[apso] Generated ${guardsModulePath}`);

  // Generate index.ts
  const indexPath = path.join(guardsDir, 'index.ts');
  const indexContent = await Eta.renderFileAsync('./guards/index', templateData);
  await createFile(indexPath, indexContent as string);
  console.log(`[apso] Generated ${indexPath}`);

  console.log(`[apso] Generated guards for ${scopedEntities.length} scoped entities`);
};
