import * as fs from "fs";
import * as path from "path";
import { Flags } from "@oclif/core";
import * as inquirer from "inquirer";
import BaseCommand from "../lib/base-command";
import { readApsorcFile } from "../lib/apsorc-parser";
import { writePlannedMigration } from "../lib/ddl/migration-file";
import { openQuestions, Plan, planWithAnswers, Question } from "../lib/plan";
import { Baseline, baselineFile, resolveBaseline } from "../lib/plan/baseline";
import { describeQuestion, optionLabel, splitDefaults, sqlHint } from "../lib/plan/prompts";
import {
  cliBinPath,
  report,
  run,
  supportsPglite,
  verifyMigration,
} from "../lib/verify";

const required = (v: string) => v.trim() !== "" || "Enter an expression";

export default class Migrate extends BaseCommand {
  static description =
    "Migrate the database to this .apsorc in one step: regenerate the code, compare with the deployed schema, ask about anything ambiguous (a rename or a drop, how a field splits, what replaces a removed value), write the migration, and test it on a local copy. In a terminal it asks; for an agent it prints the open questions as JSON and exits 2, and the agent reruns it with --answer. The steps are also separate commands: apso migrate plan, generate and verify.";

  static examples = [
    "$ apso migrate",
    "$ apso migrate --answer field:Contact.phone=rename:mobilePhone",
    "$ apso migrate --seed seed.sql --check checks.sql",
  ];

  static flags = {
    baseline: Flags.string({
      description:
        "The deployed .apsorc, the first time only. Later runs find it from the last migration",
    }),
    answer: Flags.string({
      description: "Answer a question: <question id>=<option>. Repeatable.",
      multiple: true,
      default: [],
    }),
    seed: Flags.string({
      description: "SQL file of rows to load first; the test then fails if the migration loses any",
    }),
    check: Flags.string({
      description: "SQL file of SELECTs with a boolean ok column, run after the migration",
    }),
    "accept-loss": Flags.string({
      description: "A table or table.column whose seeded data may be dropped on purpose (repeatable)",
      multiple: true,
      default: [],
    }),
    name: Flags.string({ description: "Migration name", default: "SchemaUpdate" }),
    "skip-generate": Flags.boolean({
      description: "Don't regenerate code from .apsorc first",
      default: false,
    }),
    "skip-verify": Flags.boolean({
      description: "Write the migration without testing it",
      default: false,
    }),
    json: Flags.boolean({
      description: "Print the result as JSON (the default when output is not a terminal)",
      default: false,
    }),
  };

  private json = false;

  /** Progress for people; agents get only the final JSON. */
  private say(s: string): void {
    if (!this.json) this.log(s);
  }

  /** Print the outcome: one JSON object for agents, nothing extra for people. */
  private out(status: string, extra: Record<string, unknown>): void {
    if (this.json) this.log(JSON.stringify({ status, ...extra }, null, 2));
  }

  private fail(message: string, extra: Record<string, unknown> = {}): never {
    if (this.json) {
      this.out("failed", { error: message, ...extra });
      this.exit(1);
    }
    this.error(message, { exit: 1 });
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Migrate);
    const cwd = process.cwd();
    this.json = flags.json || !process.stdout.isTTY;
    const interactive = !this.json && Boolean(process.stdin.isTTY);
    // Keep stdout pure JSON for agents: parser notices go to stderr.
    if (this.json) console.info = (...m: unknown[]) => process.stderr.write(m.join(" ") + "\n");

    const { apsorc } = readApsorcFile();
    const cliBin = cliBinPath(this.config.root);

    if (!flags["skip-generate"]) {
      this.say("Generating code from .apsorc...");
      // Agents run without a terminal, where generate needs the language spelled out.
      const language = apsorc.language ?? "typescript";
      const gen = await run(process.execPath, [cliBin, "generate", "--language", language], cwd);
      if (!gen.ok) this.fail(`apso generate failed:\n${gen.output.trim().split("\n").slice(-15).join("\n")}`);
    }

    const planPath = path.resolve(".apso/migration-plan.json");
    let baseline: Baseline;
    try {
      baseline = resolveBaseline(cwd, apsorc, flags.baseline, planPath);
    } catch (error) {
      this.fail((error as Error).message);
    }
    this.say(`Comparing with ${baseline.source}.`);

    const previous: Plan | undefined = fs.existsSync(planPath)
      ? JSON.parse(fs.readFileSync(planPath).toString())
      : undefined;
    let plan: Plan;
    try {
      plan = planWithAnswers(baseline.schema, apsorc, previous, flags.answer);
    } catch (error) {
      this.fail((error as Error).message);
    }
    const save = () => {
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, JSON.stringify({ ...plan, before: baseline.schema }, null, 2) + "\n");
    };

    // Ask until nothing is open. Answers can raise new questions (dropping a
    // field leaves a required one to backfill), so re-plan after each round.
    for (let open = openQuestions(plan); open.length > 0; open = openQuestions(plan)) {
      save();
      if (!interactive) {
        const next =
          'Rerun apso migrate --answer <id>=<option> for each. For "sql" and "split:" answers, also set the question\'s "sql" in the plan file: a string, or one expression per split field.';
        if (this.json) {
          this.out("questions", { plan: path.relative(cwd, planPath), baseline: baseline.source, open: open.map((q) => describeQuestion(q)), next });
        } else {
          for (const q of open) this.log(`\n${q.id}\n  ${q.subject}\n  options: ${q.options.join(" | ")}`);
          this.log(`\n${next}`);
        }
        this.exit(2);
      }
      for (const q of open) {
        // eslint-disable-next-line no-await-in-loop
        await this.ask(q);
      }
      plan = planWithAnswers(baseline.schema, apsorc, plan, []);
    }
    save();

    const written = writePlannedMigration(cwd, baseline.schema, flags.name, planPath);
    if (!written.ok) this.fail(written.steps.map((s) => s.output).filter(Boolean).join("\n"));
    if (!written.needed) {
      this.say("The database already matches .apsorc. Nothing to migrate.");
      this.out("up-to-date", {});
      return;
    }
    this.say(`Wrote ${written.file}`);
    for (const f of written.findings ?? []) this.say(`  warning ${f.code}: ${f.message}`);

    let verified: boolean | "skipped" = "skipped";
    // Python and Go verify without the project's own database driver.
    const canVerify = (apsorc.language ?? "typescript") !== "typescript" || supportsPglite(cwd);
    if (!flags["skip-verify"] && canVerify) {
      this.say("Testing the migration on a local copy of the deployed schema...");
      const result = await verifyMigration(cwd, baselineFile(baseline), written.file!, cliBin, {
        seedFile: flags.seed,
        checkFile: flags.check,
        acceptLoss: flags["accept-loss"],
      });
      verified = result.ok;
      if (!this.json) report((s) => this.log(s), { ...result, findings: [] }, false);
      if (!result.ok)
        this.fail(
          `The migration in ${written.file} failed its test. Fix the answers in ${written.planFile} or the .apsorc, then run apso migrate again.`,
          { file: written.file, planFile: written.planFile, steps: result.steps }
        );
    }

    this.say(`\nReview and commit ${written.file} and ${written.planFile}, then deploy.`);
    if (verified === true && !flags.seed)
      this.say("Tip: --seed <rows.sql> also checks that existing rows survive the migration.");
    this.out("written", { file: written.file, planFile: written.planFile, verified });
  }

  private async ask(q: Question): Promise<void> {
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: "list",
        name: "choice",
        message: q.subject,
        choices: q.options.map((o) => ({ name: optionLabel(q, o), value: o })),
        default: q.suggested,
      },
    ]);
    q.answer = choice;
    if (choice === "sql") {
      const { sql } = await inquirer.prompt<{ sql: string }>([
        { type: "input", name: "sql", message: sqlHint(q), validate: required },
      ]);
      q.sql = sql;
    }
    if (choice.startsWith("split:")) {
      const targets = choice.slice("split:".length).split(",");
      const defaults = splitDefaults(q, targets);
      const sql: Record<string, string> = {};
      for (const t of targets) {
        // eslint-disable-next-line no-await-in-loop
        const { expr } = await inquirer.prompt<{ expr: string }>([
          { type: "input", name: "expr", message: `SQL for ${t}`, default: defaults[t], validate: required },
        ]);
        sql[t] = expr;
      }
      q.sql = sql;
    }
  }
}
