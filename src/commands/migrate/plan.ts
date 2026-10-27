import * as fs from "fs";
import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { readApsorcFile } from "../../lib/apsorc-parser";
import { openQuestions, Plan, planMigration } from "../../lib/plan";

export default class MigratePlan extends BaseCommand {
  static description =
    "Compare the deployed .apsorc with this one and write a migration plan. Changes whose intent is ambiguous (rename or drop, how a field splits, which value replaces a removed enum value) become questions; answer them in the plan file or with --answer. Exits 2 while questions are open.";

  static examples = [
    "$ apso migrate plan --baseline deployed.apsorc",
    "$ apso migrate plan --baseline deployed.apsorc --answer field:Contact.phone=rename:mobilePhone",
    "$ apso migrate plan --baseline deployed.apsorc --json",
  ];

  static flags = {
    baseline: Flags.string({
      description: "The deployed .apsorc to migrate from",
      required: true,
    }),
    plan: Flags.string({
      description: "Plan file to read answers from and write",
      default: ".apso/migration-plan.json",
    }),
    answer: Flags.string({
      description: "Answer a question: <question id>=<option>. Repeatable.",
      multiple: true,
      default: [],
    }),
    json: Flags.boolean({
      description: "Print the open questions as JSON",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePlan);
    const planPath = path.resolve(flags.plan);
    const before = JSON.parse(fs.readFileSync(path.resolve(flags.baseline)).toString());
    const { apsorc: after } = readApsorcFile();

    const previous: Plan | undefined = fs.existsSync(planPath)
      ? JSON.parse(fs.readFileSync(planPath).toString())
      : undefined;
    const given = new Map<string, string>();
    for (const a of flags.answer) {
      const eq = a.indexOf("=");
      if (eq < 1) this.error(`--answer must be <question id>=<option>, got "${a}"`, { exit: 1 });
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
      if (!q) this.error(`No question "${id}" in this plan.`, { exit: 1 });
      if (!q.options.includes(answer))
        this.error(`"${answer}" is not an option for ${id}. Options: ${q.options.join(", ")}`, { exit: 1 });
    }

    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

    const open = openQuestions(plan);
    if (flags.json) {
      this.log(JSON.stringify({ plan: flags.plan, open }, null, 2));
    } else if (open.length === 0) {
      this.log(`${flags.plan}: all ${plan.questions.length} question(s) answered.`);
    } else {
      this.log(`${flags.plan}: ${open.length} of ${plan.questions.length} question(s) open.`);
      for (const q of open) {
        const hint = q.suggested ? ` (suggested: ${q.suggested})` : "";
        this.log(`\n${q.id}\n  ${q.subject}\n  options: ${q.options.join(" | ")}${hint}`);
      }
      this.log(
        `\nAnswer with --answer <id>=<option>, or edit ${flags.plan}. ` +
          `"sql" and "split:" answers also need a "sql" value in the file.`
      );
    }
    if (open.length > 0) this.exit(2);
  }
}
