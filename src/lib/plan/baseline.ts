/**
 * Find the deployed schema without being told. Every migration
 * `apso migrate generate` writes is committed with its plan, and the plan
 * records the schema before and after it, so the newest one says what the
 * database looks like once the migrations run. A service whose migrations
 * predate this falls back to the .apsorc from the last commit that touched
 * its migrations.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ApsorcType } from "../apsorc-parser";

export interface SavedPlan {
  before: ApsorcType;
  after: ApsorcType;
}

export interface Baseline {
  schema: ApsorcType;
  /** Where the schema came from, for messages. */
  source: string;
}

/** Where each language's migrations live, and the extension of one. */
export const migrationsDir = (projectDir: string, apsorc?: ApsorcType) =>
  apsorc?.language === "python"
    ? path.join(projectDir, "alembic", "versions")
    : apsorc?.language === "go"
    ? path.join(projectDir, "migrations")
    : path.join(projectDir, apsorc?.rootFolder || "src", "migrations");
export const migrationExtension = (apsorc?: ApsorcType) =>
  apsorc?.language === "python"
    ? ".py"
    : apsorc?.language === "go"
    ? ".sql"
    : ".ts";

/** The newest migration with a saved plan, by its timestamp prefix. */
export function latestPlannedMigration(
  projectDir: string,
  apsorc?: ApsorcType
): { file: string; planFile: string; saved: SavedPlan } | undefined {
  const dir = migrationsDir(projectDir, apsorc);
  if (!fs.existsSync(dir)) return undefined;
  const plans = fs
    .readdirSync(dir)
    .filter((f) => /^\d+[_-].+\.plan\.json$/.test(f))
    .sort((a, b) => Number(b.split(/[_-]/)[0]) - Number(a.split(/[_-]/)[0]));
  for (const planFile of plans) {
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, planFile)).toString()
    );
    if (!saved.before || !saved.after) continue;
    const file = planFile.replace(/\.plan\.json$/, migrationExtension(apsorc));
    return {
      file: path.relative(projectDir, path.join(dir, file)),
      planFile: path.relative(projectDir, path.join(dir, planFile)),
      saved,
    };
  }
  return undefined;
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

export function resolveBaseline(
  projectDir: string,
  apsorc: ApsorcType,
  explicit?: string,
  planPath?: string
): Baseline {
  if (explicit)
    return {
      schema: JSON.parse(fs.readFileSync(path.resolve(explicit)).toString()),
      source: explicit,
    };

  // A plan in progress remembers the baseline it was started from.
  if (planPath && fs.existsSync(planPath)) {
    const working = JSON.parse(fs.readFileSync(planPath).toString());
    if (working.before)
      return {
        schema: working.before,
        source: path.relative(projectDir, planPath),
      };
  }

  const latest = latestPlannedMigration(projectDir, apsorc);
  if (latest) return { schema: latest.saved.after, source: latest.planFile };

  try {
    const dir = path.relative(projectDir, migrationsDir(projectDir, apsorc));
    const sha = git(projectDir, ["log", "-1", "--format=%H", "--", dir]).trim();
    if (sha) {
      // "<sha>:./.apsorc" is relative to cwd, so symlinked paths don't matter.
      const schema = JSON.parse(git(projectDir, ["show", `${sha}:./.apsorc`]));
      return {
        schema,
        source: `.apsorc at ${sha.slice(
          0,
          7
        )}, the last commit that changed ${dir}`,
      };
    }
  } catch {
    // No git, no history for the migrations, or no .apsorc in that commit.
  }
  throw new Error(
    "Can't tell which schema is deployed: no migration from apso migrate generate yet, and no git history for the migrations folder. Pass the deployed .apsorc once with --baseline; later runs find it on their own."
  );
}

/** A baseline as a file, for steps that scaffold it into a project copy. */
export function baselineFile(baseline: Baseline): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "apso-baseline-")),
    ".apsorc"
  );
  fs.writeFileSync(file, JSON.stringify(baseline.schema, null, 2));
  return file;
}
