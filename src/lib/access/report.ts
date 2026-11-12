/**
 * The access rule list (rules.json, from apsoai/cli#208) and the record of a
 * suite run against it. Every case's label starts with the rule it proves,
 * "[R6] ..." or "[R11,R12] ...", so a run can be reported rule by rule and a
 * rule with no case fails the run.
 */

import rulesFile from "./rules.json";

export type Language = "typescript" | "python" | "go";
export type RuleStatus = "enforced" | "refused" | "pending" | "na";

export interface Rule {
  id: string;
  group: string;
  rule: string;
  status: Record<Language, RuleStatus>;
  /** The work that builds a pending rule. */
  issue?: string;
  /** Set on rules only the hosted platform provides: what the platform adds. */
  platform?: string;
  note?: string;
}

export const RULES: Rule[] = rulesFile.rules as Rule[];
export const LANGUAGES: Language[] = ["typescript", "python", "go"];

const TAG = /^\[(R\d+(?:\s*,\s*R\d+)*)]\s*/;

/** The rule ids a case label names, e.g. "[R11,R12] ..." gives R11 and R12. */
export const ruleIdsOf = (label: string): string[] =>
  TAG.exec(label)?.[1].split(/\s*,\s*/) ?? [];

export interface CaseResult {
  rules: string[];
  /** The part of the run the case belongs to (a provider, or a service). */
  leg: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface Response {
  status: number;
  text: string;
}

export interface Checker {
  /** Pass when the response has one of the given statuses. */
  expect(label: string, res: Response, ...ok: number[]): boolean;
  assert(label: string, cond: boolean, detail?: string): boolean;
  failures: string[];
}

export interface RuleRow {
  id: string;
  rule: string;
  status: RuleStatus;
  /** pass, FAIL, "no case" (a failure for an enforced or refused rule), or "-". */
  result: string;
  passed: number;
  failed: number;
  note: string;
}

export interface Report {
  language: Language;
  results: CaseResult[];
  checker(leg: string): Checker;
  /** Things wrong with the suite itself: untagged cases, unknown rule ids. */
  problems(): string[];
  rows(only?: (rule: Rule) => boolean): RuleRow[];
  /** Rules marked enforced or refused for this language that ran no case. */
  uncovered(): string[];
  table(only?: (rule: Rule) => boolean): string;
}

/**
 * A record of one language's run.
 * @param {Language} language - The language of the service under test
 * @param {Function} log - Where case lines go
 * @returns {Report} The record
 */
export function createReport(
  language: Language,
  log: (line: string) => unknown = console.log
): Report {
  const results: CaseResult[] = [];
  const known = new Set(RULES.map((r) => r.id));

  const record = (
    leg: string,
    failures: string[],
    label: string,
    pass: boolean,
    shown: string,
    detail: string
  ) => {
    log(`  ${pass ? "ok  " : "FAIL"} ${label}${shown}`);
    results.push({ rules: ruleIdsOf(label), leg, label, pass, detail: pass ? undefined : detail });
    if (!pass) failures.push(`${leg}: ${label}${detail ? ` ${detail}` : ""}`);
    return pass;
  };

  const rows = (only: (rule: Rule) => boolean = () => true): RuleRow[] =>
    RULES.filter((rule) => only(rule)).map((rule) => {
      const cases = results.filter((c) => c.rules.includes(rule.id));
      const failed = cases.filter((c) => !c.pass).length;
      const status = rule.status[language];
      const needsCase = status === "enforced" || status === "refused";
      let result = "-";
      if (failed > 0) result = "FAIL";
      else if (cases.length > 0) result = "pass";
      else if (needsCase) result = "no case";
      return {
        id: rule.id,
        rule: rule.rule,
        status,
        result,
        passed: cases.length - failed,
        failed,
        note: status === "pending" ? rule.issue ?? "" : "",
      };
    });

  return {
    language,
    results,
    checker(leg) {
      const failures: string[] = [];
      return {
        failures,
        expect: (label, res, ...ok) =>
          record(leg, failures, label, ok.includes(res.status), `: ${res.status}`, `got ${res.status} ${res.text.slice(0, 300)}`),
        assert: (label, cond, detail = "") =>
          record(leg, failures, label, Boolean(cond), "", detail),
      };
    },
    problems() {
      const out = new Set<string>();
      for (const c of results) {
        if (c.rules.length === 0) out.add(`case names no rule: "${c.label}"`);
        for (const id of c.rules)
          if (!known.has(id)) out.add(`case names unknown rule ${id}: "${c.label}"`);
      }
      return [...out];
    },
    rows,
    uncovered: () =>
      rows()
        .filter((r) => r.result === "no case")
        .map((r) => r.id),
    table(only) {
      const lines = rows(only).map(
        (r) =>
          `${r.id.padEnd(4)} ${r.status.padEnd(9)} ${r.result.padEnd(8)} ${String(r.passed + r.failed).padStart(5)}  ${r.note}`
      );
      return [`Access rules, ${language}`, "rule status    result   cases", ...lines].join("\n");
    },
  };
}

/**
 * One table for several languages' runs, as Markdown.
 * @param {Record<string, RuleRow[]>} byLanguage - Each language's rows, from Report.rows()
 * @returns {string} The table
 */
export function markdownTable(byLanguage: Partial<Record<Language, RuleRow[]>>): string {
  const langs = LANGUAGES.filter((l) => byLanguage[l]);
  const cell = (r?: RuleRow) => {
    if (!r) return "";
    if (r.status === "na") return "n/a";
    const count = r.passed + r.failed;
    if (r.status === "pending") return count > 0 ? `pending (${r.result}, ${count})` : "pending";
    return `${r.status}: ${r.result}${count > 0 ? ` (${count})` : ""}`;
  };
  const lines = RULES.map((rule) => {
    const cells = langs.map((l) => cell(byLanguage[l]!.find((r) => r.id === rule.id)));
    return `| ${rule.id} | ${rule.rule} | ${cells.join(" | ")} | ${rule.issue ?? ""} |`;
  });
  return [
    `| # | Rule | ${langs.join(" | ")} | Built by |`,
    `|---|---|${langs.map(() => "---").join("|")}|---|`,
    ...lines,
  ].join("\n");
}
