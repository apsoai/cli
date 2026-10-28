import { Plan, planMigration } from "../../../src/lib/plan";

// Each migration eval case, answered the way the eval expects. The change
// must leave the seeded database identical in schema to a fresh build of the
// new .apsorc, with every row check in checks.sql passing.
export const answers: Record<
  string,
  Record<
    string,
    string | { answer: string; sql: string | Record<string, string> }
  >
> = {
  "rename-entity": { "entity:Company": "rename:Organization" },
  "rename-field": { "field:Contact.phone": "rename:mobilePhone" },
  "split-field": {
    "field:Contact.fullName": {
      answer: "split:firstName,lastName",
      sql: {
        firstName: `split_part(btrim("fullName"), ' ', 1)`,
        lastName: `NULLIF(btrim(substr(btrim("fullName"), length(split_part(btrim("fullName"), ' ', 1)) + 1)), '')`,
      },
    },
  },
  "extract-entity": { "field:Contact.phone": "move:PhoneNumber.number" },
  "many-to-many": { "relation:Contact.Company": "copy-links" },
  "enum-replace": { "enum:Contact.status:archived": "closed" },
  "required-field": { "backfill:Company.region": "us" },
  "type-change": {
    "cast:Contact.score": {
      answer: "sql",
      sql: `NULLIF(regexp_replace("score", '[^0-9-]', '', 'g'), '')::integer`,
    },
  },
};

export const answeredPlan = (c: string, before: any, after: any): Plan => {
  let plan = planMigration(before, after);
  for (let round = 0; round < 3; round++) {
    for (const q of plan.questions) {
      const a = answers[c][q.id];
      if (a === undefined) continue;
      if (typeof a === "string") q.answer = a;
      else Object.assign(q, a);
    }
    plan = planMigration(before, after, plan);
  }
  return plan;
};

