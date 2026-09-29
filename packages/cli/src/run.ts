import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError } from "commander";
import { EXIT, StepsnapError, invalid, ioError, usage } from "./errors.ts";
import { checkGuideFile, loadGuideFile } from "./files.ts";
import {
  createGuideFile,
  editStepFile,
  exportGuideFiles,
  guideInfo,
  listSteps,
  parseFormats,
  regenTitlesFile,
} from "./ops.ts";
import { VERSION } from "./version.ts";

export interface RunIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Base for relative paths. Defaults to process.cwd(). */
  cwd?: string;
}

/** What a command produces: one JSON object (for --json) and the text a person would read. */
interface Result {
  json: Record<string, unknown>;
  text: string;
}

const HELP_FOOTER = `
Exit codes: 0 ok, 1 invalid input, 2 usage error, 3 file error.
With --json every command prints exactly one JSON object on stdout ({"ok": true, ...} or
{"ok": false, "error": {...}}); human messages go to stderr.
Files: a .stepsnap bundle (zip: guide.json + images/) or a bare guide.json.
Docs: https://stepsnap.vercel.app/docs/agents/`;

export async function run(argv: string[], io?: Partial<RunIO>): Promise<number> {
  const out = io?.stdout ?? ((t: string) => void process.stdout.write(t));
  const err = io?.stderr ?? ((t: string) => void process.stderr.write(t));
  const cwd = io?.cwd ?? process.cwd();
  let exitCode: number = EXIT.ok;
  let wantJson = argv.includes("--json");

  const finish = async (fn: () => Promise<Result>, json: boolean | undefined) => {
    wantJson = !!json;
    try {
      const r = await fn();
      out(json ? JSON.stringify({ ok: true, ...r.json }) + "\n" : r.text.endsWith("\n") ? r.text : r.text + "\n");
    } catch (e) {
      exitCode = fail(e, json, out, err);
    }
  };

  const program = new Command();
  program
    .name("stepsnap")
    .description("Validate, inspect, edit and export Stepsnap guides. Local only, no network.")
    .version(VERSION, "-v, --version")
    .configureOutput({ writeOut: out, writeErr: err })
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText("after", HELP_FOOTER);

  program
    .command("validate")
    .description("Check that a guide file is valid. Exit 1 if not.")
    .argument("<file>", ".stepsnap bundle or guide.json")
    .option("--json", "print one JSON object")
    .action((file: string, o: { json?: boolean }) =>
      finish(async () => {
        const r = await checkGuideFile(file, cwd);
        if (!r.ok) throw invalid(`invalid guide: ${r.path}`, r.errors);
        const g = r.loaded.guide;
        return {
          json: { file: r.loaded.path, valid: true, format: r.loaded.kind, schemaVersion: g.schemaVersion, steps: g.steps.length },
          text: `valid: ${r.loaded.path} (${g.steps.length} steps)`,
        };
      }, o.json),
    );

  program
    .command("info")
    .description("Summarise a guide: title, step count, actions, pages, sensitive steps.")
    .argument("<file>")
    .option("--json", "print one JSON object")
    .action((file: string, o: { json?: boolean }) =>
      finish(async () => {
        const l = await loadGuideFile(file, cwd);
        const info = guideInfo(l.guide, l.images);
        const acts = Object.entries(info.actions).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
        const row = (k: string, v: string) => `${(k + ":").padEnd(13)}${v}`;
        const lines = [
          row("Title", info.title),
          row("Steps", `${info.stepCount}${info.skippedSteps ? ` (${info.skippedSteps} skipped)` : ""}`),
          row("Actions", acts),
          row("Pages", String(info.pages.length)),
          ...info.pages.map((p) => `  ${p.url}${p.title ? ` (${p.title})` : ""}: ${p.steps} step${p.steps === 1 ? "" : "s"}`),
          row("Sensitive", info.sensitiveSteps.length ? info.sensitiveSteps.map((s) => s.index).join(", ") : "none"),
          row("Screenshots", `${info.screenshots.imagesFound}/${info.screenshots.steps} images found, ${info.redactions} redactions`),
        ];
        return { json: { file: l.path, format: l.kind, ...info }, text: lines.join("\n") };
      }, o.json),
    );

  program
    .command("steps")
    .description("List the steps with ids, titles and actions.")
    .argument("<file>")
    .option("--json", "print one JSON object")
    .action((file: string, o: { json?: boolean }) =>
      finish(async () => {
        const l = await loadGuideFile(file, cwd);
        const steps = listSteps(l.guide);
        const text = steps
          .map((s) => `${String(s.index).padStart(2)}  ${s.id}  ${s.title}  [${s.action.type}]${s.skipped ? " (skipped)" : ""}${s.sensitive ? " (sensitive)" : ""}`)
          .join("\n");
        return { json: { file: l.path, title: l.guide.title, steps }, text: text || "(no steps)" };
      }, o.json),
    );

  program
    .command("edit-step")
    .description("Change a step's title, description or skipped flag. Edits in place unless --out is given.")
    .argument("<file>")
    .requiredOption("--id <id>", "step id (see `stepsnap steps`)")
    .option("--title <text>", "new title; marks it as hand-edited so regen-titles keeps it")
    .option("--description <text>", 'new description; "" removes it')
    .option("--skip", "hide the step from exports")
    .option("--unskip", "show the step in exports again")
    .option("--out <file>", "write the result here instead of overwriting the input")
    .option("--json", "print one JSON object")
    .action((file: string, o: { id: string; title?: string; description?: string; skip?: boolean; unskip?: boolean; out?: string; json?: boolean }) =>
      finish(async () => {
        if (o.skip && o.unskip) throw usage("--skip and --unskip cannot be used together");
        const skipped = o.skip ? true : o.unskip ? false : undefined;
        const r = await editStepFile(file, { id: o.id, title: o.title, description: o.description, skipped }, o.out, cwd);
        return {
          json: { file: resolve(cwd, file), out: r.out, changed: r.changed, step: r.step },
          text: r.changed.length ? `updated ${r.step.id} (${r.changed.join(", ")}) -> ${r.out}` : `no changes for ${r.step.id} -> ${r.out}`,
        };
      }, o.json),
    );

  program
    .command("regen-titles")
    .description("Regenerate generated step titles. Titles a person edited are kept.")
    .argument("<file>")
    .option("--out <file>", "write the result here instead of overwriting the input")
    .option("--json", "print one JSON object")
    .action((file: string, o: { out?: string; json?: boolean }) =>
      finish(async () => {
        const r = await regenTitlesFile(file, o.out, cwd);
        return { json: { file: resolve(cwd, file), out: r.out, changed: r.changed, steps: r.steps }, text: `regenerated ${r.changed} of ${r.steps} titles -> ${r.out}` };
      }, o.json),
    );

  program
    .command("export")
    .description("Export a guide: md, html, pdf, docx, playwright, skill, or all (comma-separated list allowed).")
    .argument("<file>")
    .requiredOption("--format <format>", "md | html | pdf | docx | playwright | skill | all")
    .requiredOption("--out <dir>", "output folder (created if missing)")
    .option("--json", "print one JSON object")
    .action((file: string, o: { format: string; out: string; json?: boolean }) =>
      finish(async () => {
        const formats = parseFormats(o.format);
        const l = await loadGuideFile(file, cwd);
        const files = await exportGuideFiles(l, formats, resolve(cwd, o.out));
        return {
          json: { file: l.path, format: formats, out: resolve(cwd, o.out), files },
          text: files.join("\n"),
        };
      }, o.json),
    );

  program
    .command("new")
    .description("Create a guide (no screenshots) from a steps.json an agent wrote.")
    .requiredOption("--from-steps <file>", "steps.json: an array of steps or {title, steps: [...]}")
    .requiredOption("--out <file>", "where to write the guide (.stepsnap bundle or .json)")
    .option("--title <text>", "guide title (overrides the one in the steps file)")
    .option("--json", "print one JSON object")
    .action((o: { fromSteps: string; out: string; title?: string; json?: boolean }) =>
      finish(async () => {
        const src = resolve(cwd, o.fromSteps);
        let text: string;
        try {
          text = await readFile(src, "utf8");
        } catch (e) {
          throw ioError(`cannot read ${src}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : (e as Error).message}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw invalid(`${src} is not valid JSON: ${(e as Error).message}`);
        }
        const r = await createGuideFile(parsed, o.out, { title: o.title }, cwd);
        return { json: { out: r.out, format: r.kind, id: r.id, title: r.title, steps: r.steps }, text: `created ${r.out} (${r.steps} steps)` };
      }, o.json),
    );

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === "commander.helpDisplayed" || e.code === "commander.version") return EXIT.ok;
      if (wantJson) out(JSON.stringify({ ok: false, error: { code: "usage", message: e.message.replace(/^error: /, "") } }) + "\n");
      return EXIT.usage;
    }
    exitCode = fail(e, wantJson, out, err);
  }
  return exitCode;
}

/** Print a failure and return its exit code. Unknown errors are bugs: exit 1 with the message. */
function fail(e: unknown, json: boolean | undefined, out: (t: string) => void, err: (t: string) => void): number {
  const se = e instanceof StepsnapError ? e : new StepsnapError(EXIT.invalid, (e as Error)?.message ?? String(e));
  const kind = se.exitCode === EXIT.io ? "io" : se.exitCode === EXIT.usage ? "usage" : "invalid";
  if (json) out(JSON.stringify({ ok: false, error: { code: kind, message: se.message, ...(se.details.length ? { errors: se.details } : {}) } }) + "\n");
  err(`stepsnap: ${se.message}\n${se.details.map((d) => `  - ${d}\n`).join("")}`);
  return se.exitCode;
}
