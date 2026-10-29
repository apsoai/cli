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
  return addMissingDeps(projectDir, APSO_CRUD_DEPS);
}

/**
 * Add the given dependencies to package.json where it doesn't declare them.
 *
 * @param {string} projectDir - Directory holding the project's package.json.
 * @param {Record<string, string>} deps - Package names and version ranges.
 * @returns {string[]} Names added (empty when nothing changed or no package.json).
 */
export function addMissingDeps(
  projectDir: string,
  deps: Record<string, string>
): string[] {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const declared = { ...pkg.devDependencies, ...pkg.dependencies };
  const missing = Object.keys(deps).filter((name) => !declared[name]);
  if (missing.length === 0) return [];

  pkg.dependencies = pkg.dependencies ?? {};
  for (const name of missing) pkg.dependencies[name] = deps[name];
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(pkg, null, 2) + (raw.endsWith("\n") ? "\n" : "")
  );
  return missing;
}

/** JWT verification library the generated TypeScript JWT guard imports. */
export const JOSE_DEP: Record<string, string> = { jose: "^5.10.0" };

/** JWT verification library the generated Python auth module imports. */
export const PYJWT_DEP = "PyJWT[crypto]>=2.8.0";

/**
 * Add a requirement to pyproject.toml's [project] dependencies list unless a
 * requirement for the same package is already there.
 *
 * @param {string} projectDir - Directory holding pyproject.toml.
 * @param {string} requirement - A PEP 508 requirement, e.g. "PyJWT[crypto]>=2.8.0".
 * @returns {boolean} True when pyproject.toml was changed.
 */
export function addMissingPythonDep(
  projectDir: string,
  requirement: string
): boolean {
  const file = path.join(projectDir, "pyproject.toml");
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  const name = requirement.split(/[ !<=>[~]/)[0].toLowerCase();
  // The list's closing bracket sits on its own line, or ends a one-line list;
  // brackets inside requirements ("uvicorn[standard]") are not the end.
  const list =
    /^dependencies\s*=\s*\[(.*)][^\S\n]*$/m.exec(text) ??
    /^dependencies\s*=\s*\[([\S\s]*?)^]/m.exec(text);
  if (!list) return false;
  const declared = [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) =>
    m[1].split(/[ !<=>[~]/)[0].toLowerCase()
  );
  if (declared.includes(name)) return false;
  const body = list[1].replace(/\s*$/, "");
  const sep = body.trim() === "" || body.trim().endsWith(",") ? "" : ",";
  const updated =
    text.slice(0, list.index) +
    `dependencies = [${body}${sep}\n    "${requirement}",\n]` +
    text.slice(list.index + list[0].length);
  fs.writeFileSync(file, updated);
  return true;
}
