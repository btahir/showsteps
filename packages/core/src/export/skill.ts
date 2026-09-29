import type { ElementDescriptor, Guide, Locator, Step, StepAction } from "../schema";
import { PRODUCT_NAME, SITE_URL, STEPS_JSON_FORMAT, STEPS_JSON_VERSION } from "../brand";
import { hostnameOf, plainTitle, slugify } from "../text";
import type { ExportFiles, ExportResult, ImageSource } from "../types";
import { exportPlaywright } from "./playwright";
import { buildReplayPlan, q, type PlanStep } from "./replay-plan";
import { formatDate, renderGuideImages, type ImageRenderOptions } from "./shared";

export interface AgentSkillOptions extends ImageRenderOptions {
  /** Screenshots to include under `images/` (rendered like the other exporters). Optional. */
  images?: ImageSource;
  /** Override the skill `name` (lowercase letters, digits, hyphens; max 64). Default: from the guide title. */
  name?: string;
  /** Override the frontmatter `description` (max 1024 characters). */
  description?: string;
}

/** Shape of `steps.json`. Documented in docs/schema.md. Additive changes keep `version`; breaking ones bump it. */
export interface StepsJson {
  format: typeof STEPS_JSON_FORMAT;
  version: typeof STEPS_JSON_VERSION;
  generator: { name: string; url: string };
  guide: { id: string; title: string; description?: string; createdAt: string; stepCount: number; tabCount: number };
  /** URL of the first step's page: where a replay starts. */
  startUrl?: string;
  viewport?: { width: number; height: number };
  /** Environment variables the replay needs, one per masked or sensitive field. Values are never stored. */
  secrets: { env: string; step: number; field?: string }[];
  steps: StepsJsonStep[];
}

export interface StepsJsonStep {
  n: number;
  id: string;
  /** Plain-text instruction, e.g. `Click Sign in`. */
  title: string;
  /** Same with Markdown emphasis, as shown in the guide. */
  titleMarkdown: string;
  description?: string;
  action: StepsJsonAction;
  page: { url: string; title?: string; tab: number };
  /** Element the step acted on; `null` for navigation, scroll and note steps. */
  target: StepsJsonTarget | null;
  replay: { replayable: boolean; playwright: string; secret?: string; note?: string };
  screenshot?: string;
}

export type StepsJsonAction =
  | { type: "navigate"; url: string }
  | { type: "click"; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; value?: string; masked?: true; secret?: string }
  | { type: "select"; value?: string; optionText?: string; masked?: true; secret?: string }
  | { type: "check"; checked: boolean }
  | { type: "press"; key: string }
  | { type: "scroll"; x: number; y: number }
  | { type: "hover" }
  | { type: "note" };

export interface StepsJsonTarget {
  tag: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  inputType?: string;
  href?: string;
  sensitive?: true;
  /** Best first: testid, role, label, placeholder, text, css, xpath. */
  locators: Locator[];
  frame?: string[];
  shadow?: string[];
}

function jsonTarget(t: ElementDescriptor, hideText: boolean): StepsJsonTarget {
  const o: StepsJsonTarget = { tag: t.tag, locators: t.locators };
  if (t.role) o.role = t.role;
  if (t.name) o.name = t.name;
  if (t.label) o.label = t.label;
  if (t.text && !hideText) o.text = t.text;
  if (t.placeholder) o.placeholder = t.placeholder;
  if (t.inputType) o.inputType = t.inputType;
  if (t.href) o.href = t.href;
  if (t.sensitive) o.sensitive = true;
  if (t.frame?.length) o.frame = t.frame;
  if (t.shadow?.length) o.shadow = t.shadow;
  return o;
}

function jsonAction(a: StepAction, ps: PlanStep): StepsJsonAction {
  switch (a.type) {
    case "type":
      return ps.secret ? { type: "type", masked: true, secret: ps.secret } : { type: "type", value: a.value };
    case "select":
      return ps.secret ? { type: "select", masked: true, secret: ps.secret } : { type: "select", value: a.value, ...(a.optionText ? { optionText: a.optionText } : {}) };
    default:
      return a;
  }
}

function skillName(guide: Guide, override?: string): string {
  const s = slugify(override ?? guide.title, 64);
  return s || "recorded-workflow";
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function locatorHint(l: Locator): string {
  switch (l.kind) {
    case "role":
      return `role ${q(l.role)}${l.name ? ` named ${q(l.name)}` : ""}`;
    case "testid":
      return `test id ${q(l.value)}`;
    case "label":
      return `label ${q(l.value)}`;
    case "placeholder":
      return `placeholder ${q(l.value)}`;
    case "text":
      return `text ${q(l.value)}`;
    case "css":
      return `CSS \`${l.value}\``;
    case "xpath":
      return `XPath \`${l.value}\``;
  }
}

function buildStepsJson(guide: Guide, images: ImageSource | undefined): { json: StepsJson; plan: ReturnType<typeof buildReplayPlan> } {
  const plan = buildReplayPlan(guide);
  const steps: StepsJsonStep[] = plan.steps.map((ps) => {
    const s: Step = ps.step;
    const sensitiveTarget = !!ps.secret || !!s.target?.sensitive;
    const replay: StepsJsonStep["replay"] = { replayable: ps.replayable, playwright: ps.lines.join("\n") };
    if (ps.secret) replay.secret = ps.secret;
    if (ps.note) replay.note = ps.note;
    const step: StepsJsonStep = {
      n: ps.n,
      id: s.id,
      title: plainTitle(s.title).replace(/\s+/g, " ").trim(),
      titleMarkdown: s.title,
      action: jsonAction(s.action, ps),
      page: { url: s.page.url, ...(s.page.title ? { title: s.page.title } : {}), tab: ps.tab },
      target: s.target ? jsonTarget(s.target, sensitiveTarget || ["textbox", "searchbox"].includes(s.target.role ?? "") || ["input", "textarea"].includes(s.target.tag)) : null,
      replay,
    };
    if (s.description?.trim()) step.description = s.description.trim();
    if (s.screenshot && images?.[s.screenshot.image]) step.screenshot = s.screenshot.image;
    return step;
  });
  const secrets = plan.steps
    .filter((p) => p.secret)
    .map((p) => {
      const field = p.step.target?.label ?? p.step.target?.name ?? p.step.target?.placeholder;
      return { env: p.secret as string, step: p.n, ...(field ? { field } : {}) };
    });
  const startUrl = plan.steps[0]?.step.page.url;
  const json: StepsJson = {
    format: STEPS_JSON_FORMAT,
    version: STEPS_JSON_VERSION,
    generator: { name: PRODUCT_NAME, url: SITE_URL },
    guide: {
      id: guide.id,
      title: plainTitle(guide.title),
      ...(guide.description?.trim() ? { description: guide.description.trim() } : {}),
      createdAt: guide.createdAt,
      stepCount: steps.length,
      tabCount: plan.tabCount,
    },
    ...(startUrl ? { startUrl } : {}),
    ...(plan.viewport ? { viewport: plan.viewport } : {}),
    secrets,
    steps,
  };
  return { json, plan };
}

function buildSkillMd(guide: Guide, json: StepsJson, opts: AgentSkillOptions, hasImages: boolean): string {
  const title = json.guide.title.trim() || "Recorded workflow";
  const host = json.startUrl ? hostnameOf(json.startUrl) : undefined;
  const n = json.steps.length;
  const name = skillName(guide, opts.name);
  const defaultDesc = `Replay or walk through the "${title}" workflow recorded in a browser (${n} step${n === 1 ? "" : "s"}${host ? `, starting at ${host}` : ""}). Use when the user wants to do this task, check that it still works, or run it with Playwright.`;
  const description = oneLine(opts.description ?? defaultDesc).slice(0, 1024);

  const L: string[] = [];
  L.push("---", `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`, "---", "", `# ${title}`, "");
  if (json.guide.description) L.push(json.guide.description, "");
  L.push(
    `Recorded with ${PRODUCT_NAME} on ${formatDate(guide.createdAt)}: ${n} step${n === 1 ? "" : "s"} across ${json.guide.tabCount} tab${json.guide.tabCount === 1 ? "" : "s"}${json.startUrl ? `, starting at ${json.startUrl}` : ""}.`,
    "",
    "## How to use this skill",
    "",
    "- **Replay it:** run `npx playwright test replay.spec.ts` in this folder (needs `@playwright/test` and a browser: `npx playwright install chromium`).",
    "- **Do it by hand or with a browser tool:** follow the steps below in order. `steps.json` lists the same steps with every recorded locator, best first, for tools that drive a browser directly.",
    "- **If a step fails:** the page probably changed. Re-locate the element from its name and role instead of the CSS selector, and update `replay.spec.ts`.",
  );
  if (json.secrets.length) {
    L.push("", "## Secrets", "", "The recording never stored the values typed into these fields. Provide them as environment variables before replaying:", "");
    for (const s of json.secrets) L.push(`- \`${s.env}\`: step ${s.step}${s.field ? `, field "${s.field}"` : ""}`);
  }
  L.push("", "## Steps", "");
  const plan = buildReplayPlan(guide);
  json.steps.forEach((st, i) => {
    const ps = plan.steps[i] as PlanStep;
    const pad = " ".repeat(`${st.n}. `.length);
    L.push(`${st.n}. ${st.titleMarkdown.trim()}`);
    if (st.description) L.push(`${pad}${oneLine(st.description)}`);
    const best = st.target?.locators.find((l) => (l.kind === "role" ? !!l.name : l.value !== ""));
    if (best) L.push(`${pad}- Find it by: ${locatorHint(best)}${st.target?.frame?.length ? ` inside iframe ${st.target.frame.map((f) => `\`${f}\``).join(" > ")}` : ""}`);
    if (st.page.tab > 1 || json.guide.tabCount > 1) L.push(`${pad}- Tab ${st.page.tab}`);
    if (st.action.type === "navigate") L.push(`${pad}- URL: ${st.action.url}`);
    else if (st.page.url && (i === 0 || st.page.url !== json.steps[i - 1]?.page.url)) L.push(`${pad}- Page: ${st.page.title ? `${st.page.title}, ` : ""}${st.page.url}`);
    if (ps.secret) L.push(`${pad}- Value: read from \`${ps.secret}\``);
    if (!st.replay.replayable && st.replay.note && st.action.type !== "note") L.push(`${pad}- Not replayed by the script: ${st.replay.note}`);
  });
  L.push("", "## Files", "", "- `replay.spec.ts`: Playwright test for the whole flow.", `- \`steps.json\`: machine-readable steps (format \`${STEPS_JSON_FORMAT}\`, version ${STEPS_JSON_VERSION}).`);
  if (hasImages) L.push("- `images/`: one screenshot per step, with the target highlighted and sensitive fields covered.");
  L.push("", `Made with [${PRODUCT_NAME}](${SITE_URL}).`, "");
  return L.join("\n");
}

/**
 * Agent skill folder: `SKILL.md` (YAML frontmatter `name` and `description`, then numbered steps with
 * locator hints), `steps.json` (documented, versioned machine list) and `replay.spec.ts`, plus
 * `images/` when `opts.images` is given. Masked values never appear in any file.
 */
export function exportAgentSkill(guide: Guide, opts: AgentSkillOptions = {}): ExportResult {
  const rendered = opts.images ? renderGuideImages(guide, opts.images, opts) : undefined;
  const { json } = buildStepsJson(guide, rendered);
  const files: ExportFiles = {
    "SKILL.md": buildSkillMd(guide, json, opts, !!rendered && Object.keys(rendered).length > 0),
    "replay.spec.ts": exportPlaywright(guide),
    "steps.json": JSON.stringify(json, null, 2) + "\n",
  };
  if (rendered) for (const p of Object.keys(rendered).sort()) files[p] = rendered[p] as Uint8Array;
  return { files };
}
