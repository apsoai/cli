import * as fs from "fs";
import * as path from "path";

/**
 * Runtime packages the generated TypeScript code imports (entities, services,
 * controllers, guards). Versions match the pinned service-template-ts tag
 * (see TEMPLATE_REFS in ./template.ts); bump both together.
 */
export const APSO_CRUD_DEPS: Record<string, string> = {
  "@apso/crud": "^1.0.1",
  "@apso/crud-core": "^1.0.1",
  "@apso/crud-request": "^1.0.1",
  "@apso/crud-typeorm": "^1.0.1",
};

/**
 * Add any missing @apso/crud runtime packages to the project's package.json.
 *
 * Projects created from the v1 template (@nestjsx/crud) don't declare them, so
 * freshly generated code fails `nest build` with TS2307 "Cannot find module
 * '@apso/crud'" on every entity. Existing @nestjsx deps are left alone because
 * hand-written code may still import them.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @returns {string[]} Names added (empty when nothing changed or no package.json).
 */
export function ensureCrudDeps(projectDir: string): string[] {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const declared = { ...pkg.devDependencies, ...pkg.dependencies };
  const missing = Object.keys(APSO_CRUD_DEPS).filter((name) => !declared[name]);
  if (missing.length === 0) return [];

  pkg.dependencies = pkg.dependencies ?? {};
  for (const name of missing) pkg.dependencies[name] = APSO_CRUD_DEPS[name];
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  return missing;
}
