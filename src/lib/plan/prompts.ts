/**
 * Words for asking a plan question in a terminal: what each option does to
 * the data, a hint for SQL answers, and a starting rule for a two-way split.
 */
import { Question } from ".";

const after = (o: string, prefix: string) => o.slice(prefix.length);

export function optionLabel(q: Question, o: string): string {
  let label = o;
  switch (q.kind) {
    case "removedField":
      if (o.startsWith("rename:")) label = `Renamed to ${after(o, "rename:")} (keeps the data)`;
      else if (o.startsWith("split:"))
        label = `Split into ${after(o, "split:").split(",").join(" and ")} (you give the rule)`;
      else if (o.startsWith("move:")) label = `Moved to ${after(o, "move:")} (copies the existing values)`;
      else if (o === "drop") label = "Dropped (deletes its data)";
      break;
    case "removedEntity":
      if (o.startsWith("rename:")) label = `Renamed to ${after(o, "rename:")} (keeps its rows)`;
      else if (o === "drop") label = "Dropped (deletes its rows)";
      break;
    case "enumValue":
      label = `Change those rows to '${o}'`;
      break;
    case "backfill":
      label = o === "sql" ? "Use a SQL expression" : `Set existing rows to '${o}'`;
      break;
    case "cast":
      label = o === "sql" ? "Use a SQL expression to convert" : "Convert each value as it is (fails on values that don't convert)";
      break;
    case "relation":
      label = o === "copy-links" ? "Copy each existing link into the new join table" : "Start with no links (deletes them)";
      break;
    default:
      break;
  }
  return o === q.suggested ? `${label} (suggested)` : label;
}

const fieldOf = (q: Question) => q.id.slice(q.id.indexOf(":") + 1).split(".")[1]?.split(":")[0] ?? "";

export function sqlHint(q: Question): string {
  const f = fieldOf(q);
  return q.kind === "cast"
    ? `SQL that converts "${f}", e.g. NULLIF("${f}", '')::integer`
    : `SQL for "${f}" on existing rows, e.g. 'unknown' or another column`;
}

/** A two-way split on the first space: "Ada Lovelace" -> Ada / Lovelace, "Cher" -> Cher / null. */
export function splitDefaults(q: Question, targets: string[]): Record<string, string> {
  if (targets.length !== 2) return {};
  const src = `"${fieldOf(q)}"`;
  const first = `split_part(btrim(${src}), ' ', 1)`;
  return {
    [targets[0]]: first,
    [targets[1]]: `NULLIF(btrim(substr(btrim(${src}), length(${first}) + 1)), '')`,
  };
}

/**
 * A question as an app or agent shows it: each option's words, a hint when an
 * option needs SQL, and a starting rule for each two-way split option.
 */
export function describeQuestion(q: Question): Question & {
  labels: Record<string, string>;
  sqlHint?: string;
  splitDefaults?: Record<string, Record<string, string>>;
} {
  const splits = q.options.filter((o) => o.startsWith("split:"));
  return {
    ...q,
    labels: Object.fromEntries(q.options.map((o) => [o, optionLabel(q, o)])),
    ...(q.options.includes("sql") && { sqlHint: sqlHint(q) }),
    ...(splits.length > 0 && {
      splitDefaults: Object.fromEntries(
        splits.map((o) => [o, splitDefaults(q, after(o, "split:").split(","))])
      ),
    }),
  };
}
