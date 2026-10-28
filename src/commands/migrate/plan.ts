import * as fs from "fs";
import * as path from "path";
import { Flags } from "@oclif/core";
import BaseCommand from "../../lib/base-command";
import { readApsorcFile } from "../../lib/apsorc-parser";
import { openQuestions, Plan, planWithAnswers } from "../../lib/plan";
import { Baseline, resolveBaseline } from "../../lib/plan/baseline";
import { describeQuestion } from "../../lib/plan/prompts";

export default class MigratePlan extends BaseCommand {
  static description =
    "Compare the deployed .apsorc with this one and write a migration plan. Changes whose intent is ambiguous (rename or drop, how a field splits, which value replaces a removed enum value) become questions; answer them in the plan file or with --answer. Exits 2 while questions are open.";

  static examples = [
    "$ apso migrate plan",
    "$ apso migrate plan --answer field:Contact.phone=rename:mobilePhone",
    "$ apso migrate plan --baseline deployed.apsorc",
  ];

  static flags = {
    baseline: Flags.string({
      description:
        "The deployed .apsorc to migrate from. Defaults to the schema after the newest planned migration, or the .apsorc from the last commit that changed the migrations folder",
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
      description:
        "Print the open questions as JSON (the default when output is not a terminal)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePlan);
    const planPath = path.resolve(flags.plan);
    const { apsorc: after } = readApsorcFile();
    let baseline: Baseline;
    try {
      baseline = resolveBaseline(
        process.cwd(),
        after,
        flags.baseline,
        planPath
      );
    } catch (error) {
      this.error((error as Error).message, { exit: 1 });
    }
    const before = baseline.schema;
    // Agents read the output from a pipe; people at a terminal get text.
    const json = flags.json || !process.stdout.isTTY;
    // Keep stdout pure JSON for agents: parser notices go to stderr.
    if (json) console.info = (...m: unknown[]) => process.stderr.write(m.join(" ") + "\n");

    const previous: Plan | undefined = fs.existsSync(planPath)
      ? JSON.parse(fs.readFileSync(planPath).toString())
      : undefined;
    let plan: Plan;
    try {
      plan = planWithAnswers(before, after, previous, flags.answer);
    } catch (error) {
      this.error((error as Error).message, { exit: 1 });
    }

    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(
      planPath,
      JSON.stringify({ ...plan, before }, null, 2) + "\n"
    );

    const open = openQuestions(plan);
    if (json) {
      this.log(
        JSON.stringify(
          { plan: flags.plan, baseline: baseline.source, open: open.map((q) => describeQuestion(q)) },
          null,
          2
        )
      );
    } else if (open.length === 0) {
      this.log(`Compared with ${baseline.source}.`);
      this.log(
        `${flags.plan}: all ${plan.questions.length} question(s) answered.`
      );
    } else {
      this.log(`Compared with ${baseline.source}.`);
      this.log(
        `${flags.plan}: ${open.length} of ${plan.questions.length} question(s) open.`
      );
      for (const q of open) {
        const hint = q.suggested ? ` (suggested: ${q.suggested})` : "";
        this.log(
          `\n${q.id}\n  ${q.subject}\n  options: ${q.options.join(
            " | "
          )}${hint}`
        );
      }
      this.log(
        `\nAnswer with --answer <id>=<option>, or edit ${flags.plan}. ` +
          `"sql" and "split:" answers also need a "sql" value in the file.`
      );
    }
    if (open.length > 0) this.exit(2);
  }
}
