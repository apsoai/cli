/**
 * Render an answered migration plan as the SQL that moves a database from
 * the deployed .apsorc to the new one.
 *
 * Renames come first: the answered renames are applied to the deployed
 * schema and its model rebuilt. Both models are built the same way, so their
 * objects pair up by position and every name that differs becomes a RENAME
 * (tables, columns, sequences, constraints, indexes, enum types). The renamed
 * model is then diffed against the new one by identity, and the plan's
 * answers supply the data steps. Statements run in a fixed order so data is
 * moved before anything it lives in is dropped.
 */
import { parseApsorcV2 } from "../apsorc-parser";
import { ApsorcType } from "../apsorc-parser";
import { openQuestions, Plan, planMigration, Question } from "../plan";
import {
  Model,
  ModelColumn,
  ModelConstraint,
  addConstraintSql,
  createIndexSql,
  createTableSql,
  createTypeSql,
  literal,
  q,
  schemaModel,
  tableName,
} from ".";

const answered = (plan: Plan, kind: Question["kind"]) =>
  plan.questions.filter((x) => x.kind === kind && x.answer);
/** "field:Contact.phone" -> ["Contact", "phone"]; "enum:Contact.status:archived" -> [..., "archived"]. */
const subject = (id: string) => {
  const [entity, rest = ""] = id.slice(id.indexOf(":") + 1).split(".");
  const [field, value] = rest.split(":");
  return { entity, field, value };
};

/** The deployed .apsorc with every answered rename applied. */
function applyRenames(
  before: ApsorcType,
  after: ApsorcType,
  plan: Plan
): ApsorcType {
  const copy: ApsorcType = JSON.parse(JSON.stringify(before));
  for (const x of answered(plan, "removedField")) {
    if (!x.answer!.startsWith("rename:")) continue;
    const { entity, field } = subject(x.id);
    const f = copy.entities
      .find((e) => e.name === entity)
      ?.fields?.find((g) => g.name === field);
    if (f) f.name = x.answer!.slice("rename:".length);
  }
  for (const x of answered(plan, "removedEntity")) {
    if (!x.answer!.startsWith("rename:")) continue;
    const from = subject(x.id).entity;
    const to = x.answer!.slice("rename:".length);
    const e = copy.entities.find((y) => y.name === from);
    if (!e) continue;
    e.name = to;
    const target = after.entities.find((y) => y.name === to);
    if (target?.table) e.table = target.table;
    else delete e.table;
    for (const r of copy.relationships ?? []) {
      if (r.from === from) r.from = to;
      if (r.to === from) r.to = to;
    }
  }
  return copy;
}

function renames(was: Model, now: Model): string[] {
  const same = (k: keyof Model) => was[k].length === now[k].length;
  if (
    !same("tables") ||
    !same("constraints") ||
    !same("indexes") ||
    !same("enums")
  )
    throw new Error(
      "Renaming changed the schema's shape; this rename can't be rendered."
    );
  const out: string[] = [];
  was.tables.forEach((t, i) => {
    const n = now.tables[i];
    if (t.name !== n.name)
      out.push(`ALTER TABLE ${q(t.name)} RENAME TO ${q(n.name)}`);
    t.columns.forEach((c, j) => {
      const nc = n.columns[j];
      if (c.name !== nc.name)
        out.push(
          `ALTER TABLE ${q(n.name)} RENAME COLUMN ${q(c.name)} TO ${q(nc.name)}`
        );
      if (c.serial && t.name !== n.name)
        out.push(
          `ALTER SEQUENCE ${q(`${t.name}_${c.name}_seq`)} RENAME TO ${q(
            `${n.name}_${nc.name}_seq`
          )}`
        );
    });
  });
  was.constraints.forEach((c, i) => {
    const n = now.constraints[i];
    if (c.name !== n.name)
      out.push(
        `ALTER TABLE ${q(n.table)} RENAME CONSTRAINT ${q(c.name)} TO ${q(
          n.name
        )}`
      );
  });
  was.indexes.forEach((x, i) => {
    if (x.name !== now.indexes[i].name)
      out.push(
        `ALTER INDEX "public".${q(x.name)} RENAME TO ${q(now.indexes[i].name)}`
      );
  });
  was.enums.forEach((e, i) => {
    if (e.name !== now.enums[i].name)
      out.push(
        `ALTER TYPE "public".${q(e.name)} RENAME TO ${q(now.enums[i].name)}`
      );
  });
  return out;
}

const nullableSql = (c: ModelColumn) =>
  `${q(c.name)} ${c.type}${
    c.default === undefined ? "" : ` DEFAULT ${c.default}`
  }`;

type Named = { name: string; body?: string; unique?: boolean };
/** Missing from the other model, or present under another name or definition. */
const changed = (x: Named, y?: Named) =>
  !y || x.name !== y.name || x.body !== y.body || x.unique !== y.unique;
/** The enum type name in a column type like "public"."contact_status_enum". */
const typeOf = (t: string) => (t.match(/^"public"\."(.+)"$/) ?? [])[1];

export interface ChangeDdl {
  up: string[];
}

export function changeDdl(
  before: ApsorcType,
  after: ApsorcType,
  plan: Plan
): ChangeDdl {
  const renamed = applyRenames(before, after, plan);
  const was = schemaModel(parseApsorcV2(before));
  const R = schemaModel(parseApsorcV2(renamed));
  const A = schemaModel(parseApsorcV2(after));
  const table = (entity: string, schema: ApsorcType = after) => {
    const e = schema.entities.find((x) => x.name === entity);
    if (!e) throw new Error(`No entity ${entity}`);
    return tableName(e);
  };

  const up: string[] = renames(was, R);
  const later: string[] = [];

  const rTables = new Map(R.tables.map((t) => [t.name, t]));
  const aTables = new Map(A.tables.map((t) => [t.name, t]));
  const rCons = new Map(R.constraints.map((c) => [c.key, c]));
  const aCons = new Map(A.constraints.map((c) => [c.key, c]));
  const rIdx = new Map(R.indexes.map((i) => [i.key, i]));
  const aIdx = new Map(A.indexes.map((i) => [i.key, i]));
  // Drop keys and indexes that go away or change. Foreign keys first.
  for (const c of [...R.constraints].sort(
    (a, b) => (a.kind === "fk" ? -1 : 0) - (b.kind === "fk" ? -1 : 0)
  ))
    if (
      changed(c, aCons.get(c.key)) &&
      (c.kind === "fk" || aTables.has(c.table))
    )
      up.push(`ALTER TABLE ${q(c.table)} DROP CONSTRAINT ${q(c.name)}`);
  for (const i of R.indexes)
    if (changed(i, aIdx.get(i.key)) && aTables.has(i.table))
      up.push(`DROP INDEX "public".${q(i.name)}`);

  // Enum types: create new ones; swap changed ones through <name>_old.
  const rEnums = new Map(R.enums.map((e) => [e.name, e]));
  const swapped = new Set<string>();
  for (const e of A.enums) {
    const old = rEnums.get(e.name);
    if (!old) up.push(createTypeSql(e));
    else if (old.values.join(",") !== e.values.join(",")) {
      up.push(
        `ALTER TYPE "public".${q(e.name)} RENAME TO ${q(`${e.name}_old`)}`,
        createTypeSql(e)
      );
      swapped.add(e.name);
      later.push(`DROP TYPE "public".${q(`${e.name}_old`)}`);
    }
  }

  // New tables, with their own primary and unique keys inline.
  const createdInline = new Set<string>();
  for (const t of A.tables)
    if (!rTables.has(t.name)) {
      up.push(createTableSql(t, A.constraints));
      for (const c of A.constraints)
        if (c.table === t.name && c.kind !== "fk") createdInline.add(c.key);
    }

  // Columns on tables that stay.
  const setNotNull: string[] = [];
  const enumMap = new Map<string, Map<string, string>>();
  for (const x of answered(plan, "enumValue")) {
    const { entity, field, value } = subject(x.id);
    const key = `${table(entity)}.${field}`;
    if (!enumMap.has(key)) enumMap.set(key, new Map());
    enumMap.get(key)!.set(value!, x.answer!);
  }
  const casts = new Map(
    answered(plan, "cast").map((x) => {
      const { entity, field } = subject(x.id);
      return [`${table(entity)}.${field}`, x] as const;
    })
  );
  for (const t of A.tables) {
    const old = rTables.get(t.name);
    if (!old) continue;
    for (const c of t.columns) {
      const o = old.columns.find((x) => x.name === c.name);
      const at = `ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(c.name)}`;
      if (!o) {
        const needsData = c.notNull && c.default === undefined && !c.serial;
        up.push(
          `ALTER TABLE ${q(t.name)} ADD ${needsData ? nullableSql(c) : c.sql}`
        );
        if (needsData) setNotNull.push(`${at} SET NOT NULL`);
        continue;
      }
      const enumName = typeOf(c.type);
      const retype = o.type !== c.type || (enumName && swapped.has(enumName));
      if (retype) {
        let using = `${q(c.name)}::${c.type}`;
        const map = enumMap.get(`${t.name}.${c.name}`);
        const cast = casts.get(`${t.name}.${c.name}`);
        if (enumName && map?.size)
          using = `(CASE ${q(c.name)}::text ${[...map]
            .map(([v, to]) => `WHEN ${literal(v)} THEN ${literal(to)}`)
            .join(" ")} ELSE ${q(c.name)}::text END)::${c.type}`;
        else if (enumName) using = `${q(c.name)}::text::${c.type}`;
        else if (cast?.answer === "sql") using = `(${cast.sql})`;
        if (o.default !== undefined) up.push(`${at} DROP DEFAULT`);
        up.push(`${at} TYPE ${c.type} USING ${using}`);
        if (c.default !== undefined)
          setNotNull.push(`${at} SET DEFAULT ${c.default}`);
      } else if (o.default !== c.default) {
        setNotNull.push(
          c.default === undefined
            ? `${at} DROP DEFAULT`
            : `${at} SET DEFAULT ${c.default}`
        );
      }
      if (!o.notNull && c.notNull) setNotNull.push(`${at} SET NOT NULL`);
      if (o.notNull && !c.notNull) up.push(`${at} DROP NOT NULL`);
    }
  }

  // Data: split, move, copied links, backfills.
  for (const x of answered(plan, "removedField")) {
    const { entity, field } = subject(x.id);
    const t = table(entity);
    if (x.answer!.startsWith("split:") && typeof x.sql === "object") {
      const sets = x
        .answer!.slice("split:".length)
        .split(",")
        .map((f) => `${q(f)} = (${(x.sql as Record<string, string>)[f]})`);
      up.push(`UPDATE ${q(t)} SET ${sets.join(", ")}`);
    }
    if (x.answer!.startsWith("move:")) {
      const [toEntity, toField] = x.answer!.slice("move:".length).split(".");
      const target = table(toEntity);
      const fk = A.constraints.find(
        (c) => c.kind === "fk" && c.table === target && c.references === t
      );
      if (!fk)
        throw new Error(
          `${toEntity} has no foreign key to ${entity}, so ${field} can't move there.`
        );
      up.push(
        `INSERT INTO ${q(target)} (${q(toField)}, ${q(
          fk.columns[0]
        )}) SELECT ${q(field)}, "id" FROM ${q(t)} WHERE ${q(field)} IS NOT NULL`
      );
    }
  }
  for (const x of answered(plan, "relation")) {
    if (x.answer !== "copy-links") continue;
    const { entity, field: target } = subject(x.id);
    const from = table(entity);
    const to = table(target);
    const fk = R.constraints.find(
      (c) => c.kind === "fk" && c.table === from && c.references === to
    );
    const joinFks = A.constraints.filter(
      (c) => c.kind === "fk" && !rTables.has(c.table)
    );
    const join = joinFks.find(
      (c) =>
        c.references === from &&
        joinFks.some((d) => d.table === c.table && d.references === to)
    );
    const other =
      join &&
      joinFks.find((d) => d.table === join.table && d.references === to);
    if (!fk || !join || !other)
      throw new Error(`Can't find where ${entity}'s links to ${target} go.`);
    up.push(
      `INSERT INTO ${q(join.table)} (${q(join.columns[0])}, ${q(
        other.columns[0]
      )}) SELECT "id", ${q(fk.columns[0])} FROM ${q(from)} WHERE ${q(
        fk.columns[0]
      )} IS NOT NULL`
    );
  }
  for (const x of answered(plan, "backfill")) {
    const { entity, field } = subject(x.id);
    const value = x.answer === "sql" ? `(${x.sql})` : literal(x.answer!);
    up.push(
      `UPDATE ${q(table(entity))} SET ${q(field)} = ${value} WHERE ${q(
        field
      )} IS NULL`
    );
  }
  up.push(...setNotNull);

  // Drop what is gone: columns, tables, enum types.
  for (const t of R.tables) {
    const now = aTables.get(t.name);
    if (!now) continue;
    for (const c of t.columns)
      if (!now.columns.some((x) => x.name === c.name))
        up.push(`ALTER TABLE ${q(t.name)} DROP COLUMN ${q(c.name)}`);
  }
  for (const t of R.tables)
    if (!aTables.has(t.name)) up.push(`DROP TABLE ${q(t.name)}`);
  up.push(...later);
  for (const e of R.enums)
    if (!A.enums.some((x) => x.name === e.name))
      up.push(`DROP TYPE "public".${q(e.name)}`);

  // New keys and indexes, foreign keys last.
  const add = (c: ModelConstraint) =>
    changed(c, rCons.get(c.key)) && !createdInline.has(c.key);
  for (const c of A.constraints)
    if (c.kind !== "fk" && add(c)) up.push(addConstraintSql(c));
  for (const i of A.indexes)
    if (changed(i, rIdx.get(i.key))) up.push(createIndexSql(i));
  for (const c of A.constraints)
    if (c.kind === "fk" && add(c)) up.push(addConstraintSql(c));

  return { up };
}

export type DownDdl = { down: string[] } | { irreversible: string[] };

/**
 * The reverse migration: the plan from the new schema back to the deployed
 * one, answered from the forward answers. Renames invert, added fields drop,
 * removed enum values map back, a split rejoins, and data that moved (to a
 * new table, or into many-to-many links) is copied back. Anything left
 * unanswered is reported instead of guessed.
 */
export function downDdl(
  before: ApsorcType,
  after: ApsorcType,
  plan: Plan
): DownDdl {
  const fwd = new Map(
    plan.questions.filter((x) => x.answer).map((x) => [x.id, x])
  );
  const entityRenamedFrom = new Map(
    answered(plan, "removedEntity")
      .filter((x) => x.answer!.startsWith("rename:"))
      .map((x) => [x.answer!.slice("rename:".length), subject(x.id).entity])
  );
  const forwardEntity = (name: string) =>
    [...entityRenamedFrom].find(([, old]) => old === name)?.[0] ?? name;
  const nowTable = (entity: string) =>
    tableName(after.entities.find((e) => e.name === entity)!);
  const A = schemaModel(parseApsorcV2(after));
  const B = schemaModel(parseApsorcV2(before));

  const answer = (x: Question): Partial<Question> | undefined => {
    const { entity, field, value } = subject(x.id);
    if (x.kind === "removedEntity") {
      const old = entityRenamedFrom.get(entity);
      return { answer: old ? `rename:${old}` : "drop" };
    }
    if (x.kind === "removedField") {
      const renamedFrom = [...fwd.values()].find(
        (f) =>
          f.kind === "removedField" &&
          f.answer === `rename:${field}` &&
          forwardEntity(subject(f.id).entity) === entity
      );
      return {
        answer: renamedFrom
          ? `rename:${subject(renamedFrom.id).field}`
          : "drop",
      };
    }
    if (x.kind === "enumValue") {
      const from = [...fwd.values()].find(
        (f) =>
          f.kind === "enumValue" &&
          f.answer === value &&
          subject(f.id).field === field
      );
      return from && { answer: subject(from.id).value };
    }
    if (x.kind === "cast") return { answer: "cast" };
    if (x.kind === "relation") return { answer: "drop-links" };
    if (x.kind === "backfill") {
      const split = fwd.get(`field:${forwardEntity(entity)}.${field}`);
      if (split?.answer?.startsWith("split:")) {
        const parts = split.answer
          .slice("split:".length)
          .split(",")
          .map((p) => q(p));
        return { answer: "sql", sql: `concat_ws(' ', ${parts.join(", ")})` };
      }
    }
    return undefined;
  };

  let rev = planMigration(after, before);
  for (let round = 0; round < 3; round++) {
    for (const x of rev.questions) if (!x.answer) Object.assign(x, answer(x));
    rev = planMigration(after, before, rev);
  }

  // Data the forward migration moved out of a column comes back from where it went.
  const extra: Question[] = [];
  for (const x of answered(plan, "removedField")) {
    if (!x.answer!.startsWith("move:")) continue;
    const { entity, field } = subject(x.id);
    const [toEntity, toField] = x.answer!.slice("move:".length).split(".");
    const from = nowTable(entity);
    const to = nowTable(toEntity);
    const fk = A.constraints.find(
      (c) => c.kind === "fk" && c.table === to && c.references === from
    )!;
    extra.push({
      id: `backfill:${entity}.${field}`,
      kind: "backfill",
      subject: `restore ${field} from ${toEntity}`,
      options: ["sql"],
      answer: "sql",
      sql: `SELECT ${q(toField)} FROM ${q(to)} x WHERE x.${q(
        fk.columns[0]
      )} = ${q(from)}."id" ORDER BY x."id" LIMIT 1`,
    });
  }
  for (const x of answered(plan, "relation")) {
    if (x.answer !== "copy-links") continue;
    const { entity, field: target } = subject(x.id);
    const from = nowTable(entity);
    const to = nowTable(target);
    const fk = B.constraints.find(
      (c) => c.kind === "fk" && c.table === from && c.references === to
    )!;
    const joinFks = A.constraints.filter(
      (c) => c.kind === "fk" && !B.tables.some((t) => t.name === c.table)
    );
    const own = joinFks.find(
      (c) =>
        c.references === from &&
        joinFks.some((d) => d.table === c.table && d.references === to)
    )!;
    const other = joinFks.find(
      (d) => d.table === own.table && d.references === to
    )!;
    extra.push({
      id: `backfill:${entity}.${fk.columns[0]}`,
      kind: "backfill",
      subject: `restore ${fk.columns[0]} from ${own.table}`,
      options: ["sql"],
      answer: "sql",
      sql: `SELECT j.${q(other.columns[0])} FROM ${q(own.table)} j WHERE j.${q(
        own.columns[0]
      )} = ${q(from)}."id" LIMIT 1`,
    });
  }

  const open = openQuestions(rev);
  if (open.length > 0)
    return { irreversible: open.map((x) => `${x.id}: ${x.subject}`) };
  return {
    down: changeDdl(after, before, {
      ...rev,
      questions: [...rev.questions, ...extra],
    }).up,
  };
}
