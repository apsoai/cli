import { expect, describe, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  isAnswered,
  openQuestions,
  planMigration,
  Plan,
} from "../../../src/lib/plan";

// Each case is one migration eval from apso-skills: the deployed .apsorc and
// the one the user changed it to.
const schema = (c: string, which: "before" | "after") =>
  JSON.parse(
    fs
      .readFileSync(
        path.join(__dirname, "../../fixtures/plan", c, `${which}.apsorc`)
      )
      .toString()
  );
const plan = (c: string, previous?: Plan) =>
  planMigration(schema(c, "before"), schema(c, "after"), previous);
const asked = (c: string, previous?: Plan) =>
  plan(c, previous).questions.map((q) => ({
    id: q.id,
    options: q.options,
    ...(q.suggested ? { suggested: q.suggested } : {}),
  }));

describe("planMigration on the migration eval cases", () => {
  test("rename-entity: rename suggested, nothing else asked", () => {
    expect(asked("rename-entity")).toEqual([
      {
        id: "entity:Company",
        options: ["rename:Organization", "drop"],
        suggested: "rename:Organization",
      },
    ]);
  });

  test("rename-field: rename suggested", () => {
    expect(asked("rename-field")).toEqual([
      {
        id: "field:Contact.phone",
        options: ["rename:mobilePhone", "drop"],
        suggested: "rename:mobilePhone",
      },
    ]);
  });

  test("split-field: split offered, no rename guessed, no backfill yet", () => {
    expect(asked("split-field")).toEqual([
      {
        id: "field:Contact.fullName",
        options: [
          "rename:firstName",
          "rename:lastName",
          "split:firstName,lastName",
          "drop",
        ],
      },
    ]);
  });

  test("extract-entity: phone can move to PhoneNumber.number", () => {
    expect(asked("extract-entity")).toEqual([
      {
        id: "field:Contact.phone",
        options: ["move:PhoneNumber.number", "drop"],
      },
    ]);
  });

  test("many-to-many: asks whether to copy the existing links", () => {
    expect(asked("many-to-many")).toEqual([
      { id: "relation:Contact.Company", options: ["copy-links", "drop-links"] },
    ]);
  });

  test("enum-replace: the removed value needs a new home", () => {
    expect(asked("enum-replace")).toEqual([
      {
        id: "enum:Contact.status:archived",
        options: ["lead", "active", "closed"],
      },
    ]);
  });

  test("required-field: existing rows need a region", () => {
    expect(asked("required-field")).toEqual([
      { id: "backfill:Company.region", options: ["us", "eu", "apac", "sql"] },
    ]);
  });

  test("type-change: cast or custom SQL", () => {
    expect(asked("type-change")).toEqual([
      { id: "cast:Contact.score", options: ["cast", "sql"] },
    ]);
  });
});

describe("answers", () => {
  test("a split needs one SQL expression per target field", () => {
    const p = plan("split-field");
    const q = p.questions[0];
    q.answer = "split:firstName,lastName";
    q.sql = { firstName: `split_part("fullName", ' ', 1)` };
    expect(isAnswered(q)).toBe(false);
    q.sql.lastName = `NULLIF(split_part("fullName", ' ', 2), '')`;
    expect(isAnswered(q)).toBe(true);
    expect(openQuestions(p)).toEqual([]);
  });

  test("an answer that is not an option stays open", () => {
    const p = plan("enum-replace");
    p.questions[0].answer = "archived";
    expect(openQuestions(p)).toHaveLength(1);
  });

  test("re-planning keeps answers whose question still exists", () => {
    const first = plan("rename-field");
    first.questions[0].answer = "rename:mobilePhone";
    const again = plan("rename-field", first);
    expect(again.questions[0].answer).toBe("rename:mobilePhone");
    expect(again.from).toBe(first.from);
  });

  test("dropping the split source asks for backfills on the new required field", () => {
    const first = plan("split-field");
    first.questions[0].answer = "drop";
    const again = plan("split-field", first);
    expect(again.questions.map((q) => q.id)).toEqual([
      "field:Contact.fullName",
      "backfill:Contact.firstName",
    ]);
  });

  test("renaming the source claims the target, so no backfill is asked", () => {
    const first = plan("split-field");
    first.questions[0].answer = "rename:firstName";
    expect(plan("split-field", first).questions.map((q) => q.id)).toEqual([
      "field:Contact.fullName",
    ]);
  });
});
