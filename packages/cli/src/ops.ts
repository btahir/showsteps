// Guide operations shared by the CLI and the MCP server. Thin: anything that is real guide logic
// (validation, titles, exporters, bundles) is called from @stepsnap/core.
import { resolve } from "node:path";
import {
  exportAgentSkill,
  exportDocx,
  exportHtml,
  exportMarkdown,
  exportPdf,
  exportPlaywright,
  generateStepTitle,
  regenerateTitles,
  validateGuide,
  type Guide,
  type Step,
  type StepAction,
  type ElementDescriptor,
  type Locator,
} from "@stepsnap/core";
import { invalid, usage } from "./errors.ts";
import {
  confinedJoin,
  loadGuideFile,
  saveGuideFile,
  writeFileSafe,
  type ImageSource,
  type LoadedGuide,
} from "./files.ts";
import { VERSION } from "./version.ts";

// ---------------------------------------------------------------- summaries

export const isSensitiveStep = (s: Step): boolean =>
  s.target?.sensitive === true || (s.action.type === "type" && s.action.masked === true);

/** The action with typed/selected values hidden when the step is sensitive. Never leak a masked value. */
export function publicAction(s: Step): StepAction {
  const a = s.action;
  if (a.type === "type" && (a.masked || s.target?.sensitive)) return { ...a, value: "•••" };
  return a;
}

export interface StepSummary {
  /** 1-based position in the guide. */
  index: number;
  id: string;
  title: string;
  description?: string;
  action: StepAction;
  /** Best human name for the target element, if any. */
  target?: string;
  url: string;
  skipped: boolean;
  sensitive: boolean;
  hasScreenshot: boolean;
}

export function listSteps(guide: Guide): StepSummary[] {
  return guide.steps.map((s, i) => ({
    index: i + 1,
    id: s.id,
    title: s.title,
    ...(s.description ? { description: s.description } : {}),
    action: publicAction(s),
    ...(s.target ? { target: s.target.name ?? s.target.label ?? s.target.text ?? s.target.placeholder ?? s.target.tag } : {}),
    url: s.page.url,
    skipped: s.skipped === true,
    sensitive: isSensitiveStep(s),
    hasScreenshot: !!s.screenshot,
  }));
}

export interface GuideInfo {
  id: string;
  title: string;
  description?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
  activeSteps: number;
  skippedSteps: number;
  /** Count of steps per action type, keys sorted. */
  actions: Record<string, number>;
  pages: { url: string; title?: string; steps: number }[];
  sensitiveSteps: { index: number; id: string; title: string }[];
  screenshots: { steps: number; imagesFound: number; imagesMissing: number };
  redactions: number;
}

export function guideInfo(guide: Guide, images: ImageSource): GuideInfo {
  const actions: Record<string, number> = {};
  const pages = new Map<string, { url: string; title?: string; steps: number }>();
  const sensitiveSteps: GuideInfo["sensitiveSteps"] = [];
  let shots = 0;
  let found = 0;
  let redactions = 0;
  guide.steps.forEach((s, i) => {
    actions[s.action.type] = (actions[s.action.type] ?? 0) + 1;
    const p = pages.get(s.page.url) ?? { url: s.page.url, ...(s.page.title ? { title: s.page.title } : {}), steps: 0 };
    p.steps++;
    pages.set(s.page.url, p);
    if (isSensitiveStep(s)) sensitiveSteps.push({ index: i + 1, id: s.id, title: s.title });
    if (s.screenshot) {
      shots++;
      if (images[s.screenshot.image]) found++;
      redactions += s.screenshot.redactions?.length ?? 0;
    }
  });
  const skipped = guide.steps.filter((s) => s.skipped).length;
  return {
    id: guide.id,
    title: guide.title,
    ...(guide.description ? { description: guide.description } : {}),
    schemaVersion: guide.schemaVersion,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    stepCount: guide.steps.length,
    activeSteps: guide.steps.length - skipped,
    skippedSteps: skipped,
    actions: Object.fromEntries(Object.entries(actions).sort(([a], [b]) => a.localeCompare(b))),
    pages: [...pages.values()],
    sensitiveSteps,
    screenshots: { steps: shots, imagesFound: found, imagesMissing: shots - found },
    redactions,
  };
}

// ---------------------------------------------------------------- editing

export interface StepEdit {
  id: string;
  title?: string;
  description?: string;
  skipped?: boolean;
}

export interface EditResult {
  guide: Guide;
  step: StepSummary;
  changed: string[];
}

const nowIso = (): string => {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return new Date().toISOString();
};

function revalidate(g: unknown): Guide {
  const v = validateGuide(g);
  if (!v.ok) throw invalid("the edited guide would be invalid", v.errors);
  return v.guide;
}

export function editStep(guide: Guide, edit: StepEdit): EditResult {
  const idx = guide.steps.findIndex((s) => s.id === edit.id);
  if (idx < 0) {
    const ids = guide.steps.map((s) => s.id).join(", ");
    throw invalid(`no step with id "${edit.id}" (ids: ${ids || "none"})`);
  }
  if (edit.title === undefined && edit.description === undefined && edit.skipped === undefined) {
    throw usage("nothing to change: give a title, a description, or skip/unskip");
  }
  if (edit.title !== undefined && edit.title.trim() === "") throw invalid("title must not be empty");
  const step: Step = { ...guide.steps[idx]! };
  const changed: string[] = [];
  if (edit.title !== undefined && edit.title !== step.title) {
    step.title = edit.title;
    changed.push("title");
  }
  if (edit.title !== undefined) step.titleEdited = true;
  if (edit.description !== undefined) {
    if (edit.description === "") {
      if (step.description !== undefined) changed.push("description");
      delete step.description;
    } else if (edit.description !== step.description) {
      step.description = edit.description;
      changed.push("description");
    }
  }
  if (edit.skipped !== undefined && edit.skipped !== (step.skipped === true)) {
    if (edit.skipped) step.skipped = true;
    else delete step.skipped;
    changed.push("skipped");
  }
  const steps = guide.steps.slice();
  steps[idx] = step;
  const next = revalidate({ ...guide, steps, updatedAt: changed.length ? nowIso() : guide.updatedAt });
  const summary = listSteps(next)[idx]!;
  return { guide: next, step: summary, changed };
}

export function regenTitles(guide: Guide): { guide: Guide; changed: number } {
  const next = regenerateTitles(guide);
  let changed = 0;
  next.steps.forEach((s, i) => {
    if (s.title !== guide.steps[i]?.title) changed++;
  });
  return { guide: changed ? { ...next, updatedAt: nowIso() } : next, changed };
}

// ---------------------------------------------------------------- authoring

export type InputAction = string | StepAction;

/** A step as an agent writes it. Everything but `action` or `title` is optional. */
export interface InputStep {
  id?: string;
  /** "click" | "type" | "select" | "check" | "press" | "navigate" | "scroll" | "hover" | "note", or a full action object. */
  action?: InputAction;
  title?: string;
  description?: string;
  /** Element name (string) or a partial ElementDescriptor. */
  target?: string | Partial<ElementDescriptor>;
  url?: string;
  value?: string;
  optionText?: string;
  key?: string;
  checked?: boolean;
  masked?: boolean;
  page?: { url: string; title?: string };
  skipped?: boolean;
}

export interface StepsInput {
  title?: string;
  description?: string;
  id?: string;
  /** Page URL used by steps that do not name one. */
  startUrl?: string;
  steps: InputStep[];
}

const ACTIONS = ["navigate", "click", "type", "select", "check", "press", "scroll", "hover", "note"];

function toAction(s: InputStep, at: string, errors: string[]): StepAction | undefined {
  let a = s.action;
  if (a === undefined) a = s.url && !s.target ? "navigate" : s.target ? "click" : "note";
  if (typeof a !== "string") {
    if (!a || typeof a !== "object" || !ACTIONS.includes((a as { type?: string }).type ?? "")) {
      errors.push(`${at}: action object needs a "type" of ${ACTIONS.join(", ")}`);
      return undefined;
    }
    return a;
  }
  switch (a) {
    case "navigate":
      if (!s.url) return void errors.push(`${at}: navigate needs "url"`);
      return { type: "navigate", url: s.url };
    case "click":
      return { type: "click" };
    case "type": {
      const masked = s.masked === true || (typeof s.target === "object" && s.target?.sensitive === true);
      if (!masked && s.value === undefined) return void errors.push(`${at}: type needs "value" (or masked: true)`);
      return masked ? { type: "type", value: "•••", masked: true } : { type: "type", value: s.value ?? "" };
    }
    case "select":
      if (s.value === undefined) return void errors.push(`${at}: select needs "value"`);
      return { type: "select", value: s.value, ...(s.optionText ? { optionText: s.optionText } : {}) };
    case "check":
      return { type: "check", checked: s.checked ?? true };
    case "press":
      if (!s.key) return void errors.push(`${at}: press needs "key"`);
      return { type: "press", key: s.key };
    case "scroll":
      return { type: "scroll", x: 0, y: 0 };
    case "hover":
      return { type: "hover" };
    case "note":
      return { type: "note" };
    default:
      errors.push(`${at}: unknown action "${a}" (use ${ACTIONS.join(", ")})`);
      return undefined;
  }
}

function toTarget(s: InputStep, action: StepAction): ElementDescriptor | undefined {
  const t = s.target;
  if (t === undefined || action.type === "navigate" || action.type === "note") return undefined;
  const d: Partial<ElementDescriptor> = typeof t === "string" ? { name: t } : { ...t };
  const label = d.label ?? (typeof t === "string" && (action.type === "type" || action.type === "select" || action.type === "check") ? t : undefined);
  const locators: Locator[] = d.locators?.length ? d.locators : [];
  if (!locators.length) {
    if (d.role && d.name) locators.push({ kind: "role", role: d.role, name: d.name });
    if (label) locators.push({ kind: "label", value: label });
    if (d.placeholder) locators.push({ kind: "placeholder", value: d.placeholder });
    const text = d.text ?? d.name;
    if (text) locators.push({ kind: "text", value: text });
  }
  const tag = d.tag ?? (action.type === "type" ? "input" : action.type === "select" ? "select" : "button");
  return {
    ...d,
    tag,
    ...(label ? { label } : {}),
    ...(action.type === "type" && action.masked ? { sensitive: true } : {}),
    locators,
  } as ElementDescriptor;
}

/** Turn an agent-written step list into a schema-valid guide. Throws exit-1 errors listing every problem. */
export function createGuideFromSteps(input: unknown, opts: { title?: string; now?: string } = {}): Guide {
  const errors: string[] = [];
  const raw: Partial<StepsInput> = Array.isArray(input) ? { steps: input as InputStep[] } : (input as StepsInput);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.steps)) {
    throw invalid('steps input must be an array of steps or an object with a "steps" array');
  }
  if (raw.steps.length === 0) throw invalid("steps input has no steps");
  const now = opts.now ?? nowIso();
  const anyUrl = !!raw.startUrl || raw.steps.some((s) => s && (s.url || s.page?.url));
  let lastUrl = raw.startUrl ?? "";
  const steps: Step[] = [];
  raw.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!s || typeof s !== "object") return void errors.push(`${at}: must be an object`);
    const action = toAction(s, at, errors);
    if (!action) return;
    const url = s.page?.url ?? (action.type === "navigate" ? action.url : undefined) ?? (lastUrl || "about:blank");
    lastUrl = url === "about:blank" ? lastUrl : url;
    const target = toTarget(s, action);
    const page = { url, ...(s.page?.title ? { title: s.page.title } : {}) };
    const step: Step = {
      id: s.id ?? `s${i + 1}`,
      action,
      ...(target ? { target } : {}),
      title: "",
      ...(s.description ? { description: s.description } : {}),
      page,
      timestamp: now,
      ...(s.skipped ? { skipped: true } : {}),
    };
    if (s.title) {
      step.title = s.title;
      step.titleEdited = true;
    } else if (action.type === "note") {
      errors.push(`${at}: a note step needs a "title"`);
    } else {
      step.title = generateStepTitle({ action: step.action, target: step.target, page: step.page });
    }
    steps.push(step);
  });
  if (errors.length) throw invalid("invalid steps input", errors);
  const title = opts.title ?? raw.title;
  if (!title) throw invalid('a guide title is required (steps file "title" or --title)');
  const guide = {
    schemaVersion: 1,
    id: raw.id ?? `g_${Math.random().toString(16).slice(2, 10)}`,
    title,
    ...(raw.description ? { description: raw.description } : {}),
    createdAt: now,
    updatedAt: now,
    app: { name: "stepsnap", version: VERSION },
    steps,
    ...(anyUrl ? {} : { settings: { includeUrls: false } }),
  };
  return revalidate(guide);
}

// ---------------------------------------------------------------- export

export const EXPORT_FORMATS = ["md", "html", "pdf", "docx", "playwright", "skill"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

type Blob = string | Uint8Array;

/**
 * Write exports into `outDir` and return absolute paths, sorted. Layout:
 * md → guide.md + images/, html → guide.html, pdf → guide.pdf, docx → guide.docx,
 * playwright → replay.spec.ts, skill → skill/{SKILL.md,steps.json,replay.spec.ts}.
 */
export async function exportGuideFiles(
  loaded: Pick<LoadedGuide, "guide" | "images">,
  formats: ExportFormat[] | "all",
  outDirArg: string,
): Promise<string[]> {
  const outDir = resolve(outDirArg);
  const list = formats === "all" ? [...EXPORT_FORMATS] : formats;
  const { guide, images } = loaded;
  const planned: [string, Blob][] = [];
  for (const f of list) {
    try {
      switch (f) {
        case "md": {
          const md = exportMarkdown(guide);
          const files: Record<string, Blob> = { ...md.files };
          for (const st of guide.steps) {
            const p = st.screenshot?.image;
            if (p && !(p in files) && images[p] && !st.skipped) files[p] = images[p];
          }
          for (const [p, data] of Object.entries(files)) planned.push([p, data]);
          break;
        }
        case "html":
          planned.push(["guide.html", exportHtml(guide, images)]);
          break;
        case "pdf":
          planned.push(["guide.pdf", await exportPdf(guide, images)]);
          break;
        case "docx":
          planned.push(["guide.docx", await exportDocx(guide, images)]);
          break;
        case "playwright":
          planned.push(["replay.spec.ts", exportPlaywright(guide)]);
          break;
        case "skill":
          for (const [p, data] of Object.entries(exportAgentSkill(guide).files)) planned.push([`skill/${p}`, data]);
          break;
      }
    } catch (e) {
      if (e instanceof Error && e.name === "StepsnapError") throw e;
      throw invalid(`export ${f} failed: ${(e as Error).message}`);
    }
  }
  const written: string[] = [];
  for (const [rel, data] of planned) {
    const abs = confinedJoin(outDir, rel);
    await writeFileSafe(abs, data);
    written.push(abs);
  }
  return written.sort();
}

export function parseFormats(spec: string): ExportFormat[] | "all" {
  const parts = spec.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) throw usage(`--format needs one of: ${[...EXPORT_FORMATS, "all"].join(", ")}`);
  if (parts.includes("all")) return "all";
  const bad = parts.filter((p) => !(EXPORT_FORMATS as readonly string[]).includes(p));
  if (bad.length) throw usage(`unknown format "${bad.join(", ")}" (use ${[...EXPORT_FORMATS, "all"].join(", ")})`);
  return [...new Set(parts)] as ExportFormat[];
}

// ---------------------------------------------------------------- file-level helpers (path in, result out)

export async function editStepFile(file: string, edit: StepEdit, out?: string, cwd = process.cwd()) {
  const loaded = await loadGuideFile(file, cwd);
  const r = editStep(loaded.guide, edit);
  const target = resolve(cwd, out ?? file);
  await saveGuideFile(r.guide, loaded.images, target, loaded.kind);
  return { out: target, step: r.step, changed: r.changed };
}

export async function regenTitlesFile(file: string, out?: string, cwd = process.cwd()) {
  const loaded = await loadGuideFile(file, cwd);
  const r = regenTitles(loaded.guide);
  const target = resolve(cwd, out ?? file);
  await saveGuideFile(r.guide, loaded.images, target, loaded.kind);
  return { out: target, changed: r.changed, steps: r.guide.steps.length };
}

export async function createGuideFile(steps: unknown, out: string, opts: { title?: string; now?: string } = {}, cwd = process.cwd()) {
  const guide = createGuideFromSteps(steps, opts);
  const target = resolve(cwd, out);
  const kind = await saveGuideFile(guide, {}, target, "bundle");
  return { out: target, kind, id: guide.id, title: guide.title, steps: guide.steps.length };
}
