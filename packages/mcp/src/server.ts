import { isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EXPORT_FORMATS,
  ShowstepsError,
  checkGuideFile,
  createGuideFile,
  editStepFile,
  exportGuideFiles,
  guideInfo,
  invalid,
  listSteps,
  loadGuideFile,
  regenTitlesFile,
} from "@showsteps/cli/ops";
import pkg from "../package.json" with { type: "json" };

export const SERVER_NAME = "showsteps";
export const SERVER_VERSION: string = pkg.version;

const INSTRUCTIONS = `Showsteps guides are step-by-step how-to guides (a .showsteps bundle or a guide.json). All tools work on local files named by ABSOLUTE path, offline. Typical flow: guide_info or list_steps to understand a guide, edit_step / regenerate_titles to fix wording, export_guide to produce Markdown, HTML, PDF, DOCX, a Playwright script or an agent skill. create_guide_from_steps builds a new guide (without screenshots) from a step list you write. A guide recorded in the Showsteps Chrome extension can be opened by a person to review, blur and share; typed passwords are never stored.`;

const absPath = (what: string) =>
  z
    .string()
    .describe(`Absolute path to ${what}.`)
    .refine((p) => isAbsolute(p), { message: "must be an absolute path" });

const guidePath = absPath("a .showsteps bundle or guide.json file");

type Data = Record<string, unknown>;

function ok(data: Data) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function failure(e: unknown) {
  const se = e instanceof ShowstepsError ? e : undefined;
  const kind = se ? (se.exitCode === 3 ? "io" : se.exitCode === 2 ? "usage" : "invalid") : "error";
  const message = se ? se.message : (e as Error)?.message ?? String(e);
  const errors = se?.details ?? [];
  const data: Data = { ok: false, error: { code: kind, message, ...(errors.length ? { errors } : {}) } };
  const text = `${message}${errors.map((x) => `\n- ${x}`).join("")}`;
  return { isError: true, content: [{ type: "text" as const, text }], structuredContent: data };
}

async function guarded(fn: () => Promise<Data>) {
  try {
    return ok(await fn());
  } catch (e) {
    return failure(e);
  }
}

const stepSchema = z.object({
  action: z
    .enum(["navigate", "click", "type", "select", "check", "press", "scroll", "hover", "note"])
    .optional()
    .describe('What the step does. Default: "navigate" if only url, "click" if a target is given, else "note".'),
  title: z
    .string()
    .optional()
    .describe('Step title, Markdown inline allowed, e.g. "Click **Save**". Required for notes; otherwise generated from action and target.'),
  description: z.string().optional().describe("Optional Markdown paragraph shown under the title."),
  target: z
    .union([
      z.string(),
      z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        label: z.string().optional(),
        text: z.string().optional(),
        placeholder: z.string().optional(),
        sensitive: z.boolean().optional(),
      }),
    ])
    .optional()
    .describe("The element acted on: its visible name/label as a string, or {role, name, label, text, placeholder}."),
  url: z.string().optional().describe("Page URL (required for navigate; later steps inherit the last URL)."),
  value: z.string().optional().describe("Text typed (type) or option value (select). Never put a secret here; use masked."),
  optionText: z.string().optional().describe("Visible option text for select."),
  key: z.string().optional().describe('Key for press, e.g. "Enter" or "Control+K".'),
  checked: z.boolean().optional().describe("For check: true (default) checks, false unchecks."),
  masked: z.boolean().optional().describe("For type: true hides the value (passwords, codes). The value is dropped."),
  page: z.object({ url: z.string(), title: z.string().optional() }).optional().describe("Page URL and title for this step."),
  skipped: z.boolean().optional().describe("Keep the step in the file but hide it from exports."),
});

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    "validate_guide",
    {
      title: "Validate a guide",
      description:
        "Check that a .showsteps bundle or guide.json is a valid Showsteps guide (schema v1). Returns { valid: true, steps } or { valid: false, errors: [...] } listing every problem with its JSON path. Errors here mean the file is unusable; a missing file is a tool error.",
      inputSchema: { path: guidePath },
      annotations: { title: "Validate a guide", ...readOnly },
    },
    ({ path }) =>
      guarded(async () => {
        const r = await checkGuideFile(path);
        if (!r.ok) return { valid: false, file: r.path, errors: r.errors };
        return { valid: true, file: r.loaded.path, format: r.loaded.kind, schemaVersion: r.loaded.guide.schemaVersion, steps: r.loaded.guide.steps.length, warnings: r.loaded.warnings };
      }),
  );

  server.registerTool(
    "guide_info",
    {
      title: "Summarise a guide",
      description:
        "Summarise a guide: title, step count (active and skipped), counts per action type, pages visited with step counts, sensitive steps (passwords etc.; their values are never included), and screenshot/redaction counts. Use it before editing or exporting.",
      inputSchema: { path: guidePath },
      annotations: { title: "Summarise a guide", ...readOnly },
    },
    ({ path }) =>
      guarded(async () => {
        const l = await loadGuideFile(path);
        return { file: l.path, format: l.kind, ...guideInfo(l.guide, l.images), warnings: l.warnings };
      }),
  );

  server.registerTool(
    "list_steps",
    {
      title: "List steps",
      description:
        "List a guide's steps in order with id, 1-based index, title, description, action, target name, page URL, skipped and sensitive flags. Use the ids with edit_step. Typed values of sensitive fields are shown as •••.",
      inputSchema: { path: guidePath, include_skipped: z.boolean().default(true).describe("Include steps hidden from exports (default true).") },
      annotations: { title: "List steps", ...readOnly },
    },
    ({ path, include_skipped }) =>
      guarded(async () => {
        const l = await loadGuideFile(path);
        const steps = listSteps(l.guide).filter((s) => include_skipped || !s.skipped);
        return { file: l.path, title: l.guide.title, steps };
      }),
  );

  server.registerTool(
    "edit_step",
    {
      title: "Edit a step",
      description:
        "Change one step's title, description or skipped flag. Give at least one of title, description, skipped. A title set here is marked hand-edited so regenerate_titles keeps it. description \"\" removes the description. Overwrites the file unless out_path is given (then the source is untouched). Returns the updated step and which fields changed.",
      inputSchema: {
        path: guidePath,
        step_id: z.string().describe("Step id from list_steps, e.g. \"s3\"."),
        title: z.string().min(1).optional().describe("New title (Markdown inline allowed)."),
        description: z.string().optional().describe('New description; "" removes it.'),
        skipped: z.boolean().optional().describe("true hides the step from exports, false shows it again."),
        out_path: absPath("write the edited guide to instead of overwriting `path`").optional(),
      },
      annotations: { title: "Edit a step", ...writes, destructiveHint: true },
    },
    ({ path, step_id, title, description, skipped, out_path }) =>
      guarded(async () => {
        const r = await editStepFile(path, { id: step_id, title, description, skipped }, out_path);
        return { out: r.out, changed: r.changed, step: r.step };
      }),
  );

  server.registerTool(
    "regenerate_titles",
    {
      title: "Regenerate step titles",
      description:
        "Rewrite every generated step title from its action and target (for example 'Click **Save**'). Titles a person or edit_step already set are kept. Overwrites the file unless out_path is given. Returns how many titles changed.",
      inputSchema: { path: guidePath, out_path: absPath("write the result to instead of overwriting `path`").optional() },
      annotations: { title: "Regenerate step titles", ...writes, destructiveHint: true },
    },
    ({ path, out_path }) =>
      guarded(async () => {
        const r = await regenTitlesFile(path, out_path);
        return { out: r.out, changed: r.changed, steps: r.steps };
      }),
  );

  server.registerTool(
    "export_guide",
    {
      title: "Export a guide",
      description:
        "Export a guide into a folder (created if missing) and return the absolute paths written. Formats: md (guide.md + images/), html (one self-contained guide.html), pdf (guide.pdf), docx (guide.docx), playwright (replay.spec.ts), skill (skill/SKILL.md + skill/steps.json + skill/replay.spec.ts + skill/images/, a replayable agent skill; result includes skill.name and skill.dir so you can install the folder), or all. Skipped steps are left out and redactions are always baked into exported images.",
      inputSchema: {
        path: guidePath,
        format: z.enum([...EXPORT_FORMATS, "all"]).describe("Export format, or \"all\"."),
        out_dir: absPath("the output folder"),
        include_images: z.boolean().default(true).describe("Include screenshots in the md and skill exports (default true). Redactions are always baked in."),
        credit: z.boolean().default(false).describe('Add a small "Made with Showsteps" line to the md, html, pdf, docx and skill exports (default false).'),
        skill_name: z.string().optional().describe("Agent skill name for format skill: lowercase letters, digits, hyphens."),
        skill_description: z.string().optional().describe("Agent skill description for format skill: when an agent should use it."),
      },
      annotations: { title: "Export a guide", ...writes },
    },
    ({ path, format, out_dir, include_images, credit, skill_name, skill_description }) =>
      guarded(async () => {
        const l = await loadGuideFile(path);
        const r = await exportGuideFiles(l, format === "all" ? "all" : [format], out_dir, {
          images: include_images,
          credit,
          skillName: skill_name,
          skillDescription: skill_description,
        });
        return { format, out_dir, files: r.files, ...(r.skill ? { skill: r.skill } : {}) };
      }),
  );

  server.registerTool(
    "create_guide_from_steps",
    {
      title: "Create a guide from a step list",
      description:
        "Create a new guide (no screenshots) from steps you write, saved to out_path (.showsteps bundle, or .json if the path ends in .json). Titles are generated from action and target unless given. Fails with every problem listed if a step is malformed. Type steps with masked: true never store a value. Use export_guide afterwards to turn it into docs or a Playwright script.",
      inputSchema: {
        out_path: absPath("the guide to create, ending in .showsteps or .json"),
        title: z.string().min(1).describe("Guide title."),
        description: z.string().optional().describe("Guide description (Markdown)."),
        start_url: z.string().optional().describe("Page URL for steps that name none."),
        steps: z.array(stepSchema).min(1).describe("Ordered steps."),
      },
      annotations: { title: "Create a guide from a step list", ...writes },
    },
    ({ out_path, title, description, start_url, steps }) =>
      guarded(async () => {
        if (!/\.(showsteps|stepsnap|json)$/i.test(out_path)) throw invalid("out_path must end in .showsteps or .json");
        const r = await createGuideFile({ title, description, startUrl: start_url, steps }, out_path);
        return { out: r.out, format: r.kind, id: r.id, title: r.title, steps: r.steps };
      }),
  );

  return server;
}
