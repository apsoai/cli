/**
 * The migration plan: compare the deployed .apsorc with the new one and list
 * every change whose intent the schema alone can't settle (a removed field
 * might be renamed, split, moved or dropped). Each becomes a question; the
 * user's own agent answers it, and the answers are kept in the plan file so
 * the same plan always renders the same migration.
 *
 * Question ids come from the change itself, so re-planning after another
 * .apsorc edit keeps every answer whose question still exists.
 */
import { createHash } from "crypto";
import { normalizeFieldType } from "../utils/field";

interface PlanField {
  name: string;
  type: string;
  values?: string[];
  nullable?: boolean;
  default?: string | null;
}

interface PlanEntity {
  name: string;
  fields?: PlanField[];
}

interface PlanRelationship {
  from: string;
  to: string;
  type: string;
}

export interface PlanSchema {
  entities: PlanEntity[];
  relationships?: PlanRelationship[];
}

export type QuestionKind =
  | "removedField"
  | "removedEntity"
  | "enumValue"
  | "backfill"
  | "cast"
  | "relation";

export interface Question {
  id: string;
  kind: QuestionKind;
  /** What changed, in words, for the agent and the person reading the plan. */
  subject: string;
  /** Allowed answers. "sql" and "split:..." also need `sql`. */
  options: string[];
  /** Set only when exactly one reading fits; still needs an answer. */
  suggested?: string;
  answer?: string;
  /** A SQL expression, or one per target field for a split. */
  sql?: string | Record<string, string>;
}

export interface Plan {
  version: 1;
  from: string;
  to: string;
  questions: Question[];
}

export const hashSchema = (s: PlanSchema): string =>
  "sha256:" +
  createHash("sha256")
    .update(
      JSON.stringify({
        entities: s.entities,
        relationships: s.relationships ?? [],
      })
    )
    .digest("hex");

const STRING_TYPES = new Set(["text", "varchar", "char", "string"]);
const sameType = (a: PlanField, b: PlanField) => {
  const ta = normalizeFieldType(a.type);
  const tb = normalizeFieldType(b.type);
  return ta === tb || (STRING_TYPES.has(ta) && STRING_TYPES.has(tb));
};

const fieldsOf = (e?: PlanEntity) => e?.fields ?? [];
const byName = <T extends { name: string }>(list: T[], name: string) =>
  list.find((x) => x.name === name);
const fieldSignature = (e: PlanEntity) =>
  fieldsOf(e)
    .map((f) => `${f.name}:${normalizeFieldType(f.type)}`)
    .sort()
    .join(",");
const relates = (rels: PlanRelationship[], a: string, b: string) =>
  rels.some(
    (r) => (r.from === a && r.to === b) || (r.from === b && r.to === a)
  );

/** Every answer this question will accept is valid; anything else stays open. */
export function isAnswered(q: Question): boolean {
  if (!q.answer || !q.options.includes(q.answer)) return false;
  if (q.answer === "sql")
    return typeof q.sql === "string" && q.sql.trim() !== "";
  if (q.answer.startsWith("split:")) {
    const targets = q.answer.slice("split:".length).split(",");
    const sql = q.sql;
    return (
      typeof sql === "object" &&
      sql !== null &&
      targets.every((t) => typeof sql[t] === "string" && sql[t].trim() !== "")
    );
  }
  return true;
}

export const openQuestions = (plan: Plan): Question[] =>
  plan.questions.filter((q) => !isAnswered(q));

/** Added fields an answer already accounts for (a rename, split or move target). */
function claimedTargets(questions: Question[]): Set<string> {
  const claimed = new Set<string>();
  for (const q of questions) {
    if (!q.answer) continue;
    const entity = q.id.slice(q.id.indexOf(":") + 1).split(".")[0];
    if (q.answer.startsWith("rename:"))
      claimed.add(`${entity}.${q.answer.slice(7)}`);
    if (q.answer.startsWith("split:"))
      for (const t of q.answer.slice(6).split(","))
        claimed.add(`${entity}.${t}`);
    if (q.answer.startsWith("move:")) claimed.add(q.answer.slice(5));
  }
  return claimed;
}

/** Added fields some still-open question may yet claim. */
function pendingTargets(questions: Question[]): Set<string> {
  const pending = new Set<string>();
  for (const q of questions) {
    if (q.answer || q.kind !== "removedField") continue;
    const entity = q.id.slice(q.id.indexOf(":") + 1).split(".")[0];
    for (const o of q.options) {
      if (o.startsWith("rename:")) pending.add(`${entity}.${o.slice(7)}`);
      if (o.startsWith("split:"))
        for (const t of o.slice(6).split(",")) pending.add(`${entity}.${t}`);
      if (o.startsWith("move:")) pending.add(o.slice(5));
    }
  }
  return pending;
}

export function planMigration(
  before: PlanSchema,
  after: PlanSchema,
  previous?: Plan
): Plan {
  const questions: Question[] = [];
  const beforeRels = before.relationships ?? [];
  const afterRels = after.relationships ?? [];
  const added = after.entities.filter((e) => !byName(before.entities, e.name));

  // Removed entities: rename to an added entity with the same fields, or drop.
  for (const old of before.entities.filter(
    (e) => !byName(after.entities, e.name)
  )) {
    const matches = added.filter(
      (e) => fieldSignature(e) === fieldSignature(old)
    );
    questions.push({
      id: `entity:${old.name}`,
      kind: "removedEntity",
      subject: `Entity ${old.name} is gone`,
      options: [...matches.map((e) => `rename:${e.name}`), "drop"],
      ...(matches.length === 1
        ? { suggested: `rename:${matches[0].name}` }
        : {}),
    });
  }

  for (const now of after.entities) {
    const was = byName(before.entities, now.name);
    if (!was) continue;
    const addedFields = fieldsOf(now).filter(
      (f) => !byName(fieldsOf(was), f.name)
    );

    for (const old of fieldsOf(was)) {
      const cur = byName(fieldsOf(now), old.name);
      if (!cur) {
        // Removed field: rename, split, move to a new related entity, or drop.
        const same = addedFields.filter((f) => sameType(f, old));
        const moves = added
          .filter((e) => relates(afterRels, e.name, now.name))
          .flatMap((e) =>
            fieldsOf(e)
              .filter((f) => sameType(f, old))
              .map((f) => `move:${e.name}.${f.name}`)
          );
        const options = [
          ...same.map((f) => `rename:${f.name}`),
          ...(same.length > 1
            ? [`split:${same.map((f) => f.name).join(",")}`]
            : []),
          ...moves,
          "drop",
        ];
        const readings = options.length - 1;
        questions.push({
          id: `field:${now.name}.${old.name}`,
          kind: "removedField",
          subject: `Field ${now.name}.${old.name} (${old.type}) is gone`,
          options,
          ...(readings === 1 && same.length === 1
            ? { suggested: options[0] }
            : {}),
        });
        continue;
      }
      if (!sameType(cur, old)) {
        questions.push({
          id: `cast:${now.name}.${old.name}`,
          kind: "cast",
          subject: `Field ${now.name}.${old.name} changes type from ${old.type} to ${cur.type}`,
          options: ["cast", "sql"],
        });
      } else if (old.values && cur.values) {
        for (const v of old.values.filter((v) => !cur.values!.includes(v))) {
          questions.push({
            id: `enum:${now.name}.${old.name}:${v}`,
            kind: "enumValue",
            subject: `Enum value '${v}' is removed from ${now.name}.${old.name}`,
            options: [...cur.values],
          });
        }
      }
      if (old.nullable && !cur.nullable && cur.default === undefined) {
        questions.push({
          id: `backfill:${now.name}.${old.name}`,
          kind: "backfill",
          subject: `Field ${now.name}.${old.name} becomes required; rows where it is null need a value`,
          options: cur.values ? [...cur.values, "sql"] : ["sql"],
        });
      }
    }
  }

  // Relationships between the same two entities that change kind or vanish.
  for (const r of beforeRels.filter((r) => r.type === "ManyToOne")) {
    if (!byName(after.entities, r.from) || !byName(after.entities, r.to))
      continue;
    const kept = afterRels.some(
      (x) => x.type === "ManyToOne" && x.from === r.from && x.to === r.to
    );
    if (kept) continue;
    const toMany = afterRels.some(
      (x) =>
        x.type === "ManyToMany" &&
        ((x.from === r.from && x.to === r.to) ||
          (x.from === r.to && x.to === r.from))
    );
    questions.push({
      id: `relation:${r.from}.${r.to}`,
      kind: "relation",
      subject: toMany
        ? `${r.from} ManyToOne ${r.to} becomes ManyToMany`
        : `${r.from} ManyToOne ${r.to} is removed`,
      options: toMany ? ["copy-links", "drop-links"] : ["drop-links"],
    });
  }

  // Carry answers over from the previous plan before deciding on backfills,
  // which depend on what the removed-field answers claimed.
  const prev = new Map((previous?.questions ?? []).map((q) => [q.id, q]));
  const carry = (q: Question): Question => {
    const p = prev.get(q.id);
    if (!p?.answer || !q.options.includes(p.answer)) return q;
    return {
      ...q,
      answer: p.answer,
      ...(p.sql === undefined ? {} : { sql: p.sql }),
    };
  };
  const answeredSoFar = questions.map((q) => carry(q));

  // New required fields on existing tables need a value for existing rows,
  // unless a rename, split or move fills them, or an open question still might.
  const claimed = claimedTargets(answeredSoFar);
  const pending = pendingTargets(answeredSoFar);
  for (const now of after.entities) {
    const was = byName(before.entities, now.name);
    if (!was) continue;
    for (const f of fieldsOf(now)) {
      if (
        byName(fieldsOf(was), f.name) ||
        f.nullable ||
        f.default !== undefined
      )
        continue;
      const key = `${now.name}.${f.name}`;
      if (claimed.has(key) || pending.has(key)) continue;
      answeredSoFar.push(
        carry({
          id: `backfill:${key}`,
          kind: "backfill",
          subject: `New required field ${key} needs a value for existing rows`,
          options: f.values ? [...f.values, "sql"] : ["sql"],
        })
      );
    }
  }

  return {
    version: 1,
    from: hashSchema(before),
    to: hashSchema(after),
    questions: answeredSoFar,
  };
}

/**
 * Plan with --answer values (<question id>=<option>) applied on top of the
 * plan in progress. Throws a message for the user when an answer is malformed,
 * names no question, or is not one of its options.
 */
export function planWithAnswers(
  before: PlanSchema,
  after: PlanSchema,
  previous: Plan | undefined,
  answers: string[]
): Plan {
  const given = new Map<string, string>();
  for (const a of answers) {
    const eq = a.indexOf("=");
    if (eq < 1) throw new Error(`--answer must be <question id>=<option>, got "${a}"`);
    given.set(a.slice(0, eq), a.slice(eq + 1));
  }
  const seed: Plan = previous ?? { version: 1, from: "", to: "", questions: [] };
  for (const [id, answer] of given) {
    const q = seed.questions.find((x) => x.id === id);
    if (q) q.answer = answer;
    else seed.questions.push({ id, kind: "removedField", subject: "", options: [], answer });
  }
  const plan = planMigration(before, after, seed);
  for (const [id, answer] of given) {
    const q = plan.questions.find((x) => x.id === id);
    if (!q) throw new Error(`No question "${id}" in this plan.`);
    if (!q.options.includes(answer))
      throw new Error(`"${answer}" is not an option for ${id}. Options: ${q.options.join(", ")}`);
  }
  return plan;
}
