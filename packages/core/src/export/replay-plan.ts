import type { ElementDescriptor, Guide, Locator, Step } from "../schema";
import { isSensitiveStep } from "../titles";
import { plainTitle } from "../text";
import { visibleSteps } from "./shared";

/** Roles Playwright's `getByRole` accepts. Anything else falls through to the next locator. */
const PLAYWRIGHT_ROLES = new Set(
  "alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem".split(" "),
);

/** String literal in the style Prettier would pick: double quotes unless that avoids escaping. */
export function q(s: string): string {
  const json = JSON.stringify(s);
  if (!json.includes('\\"') || s.includes("'")) return json;
  return "'" + json.slice(1, -1).replace(/\\"/g, '"') + "'";
}

export function isValidRole(role: string): boolean {
  return PLAYWRIGHT_ROLES.has(role);
}

/** A locator we would trust on its own. `role` without a name matches too much. */
function usable(l: Locator): boolean {
  switch (l.kind) {
    case "role":
      return isValidRole(l.role) && l.name.trim() !== "";
    case "css":
    case "xpath":
    case "testid":
    case "label":
    case "placeholder":
    case "text":
      return l.value.trim() !== "";
  }
}

/** Locator expression on `scope` (a page or frameLocator expression). */
function locatorOn(scope: string, l: Locator): string {
  switch (l.kind) {
    case "testid":
      return `${scope}.getByTestId(${q(l.value)})`;
    case "role":
      return l.name.trim() !== "" ? `${scope}.getByRole(${q(l.role)}, { name: ${q(l.name)}, exact: true })` : `${scope}.getByRole(${q(l.role)})`;
    case "label":
      return `${scope}.getByLabel(${q(l.value)}, { exact: true })`;
    case "placeholder":
      return `${scope}.getByPlaceholder(${q(l.value)}, { exact: true })`;
    case "text":
      return l.exact ? `${scope}.getByText(${q(l.value)}, { exact: true })` : `${scope}.getByText(${q(l.value)})`;
    case "css":
      return `${scope}.locator(${q(l.value)})`;
    case "xpath":
      return `${scope}.locator(${q("xpath=" + l.value)})`;
  }
}

/** Best locator on `pageVar`, following the frame chain; undefined when nothing usable was recorded. */
export function locatorCode(target: ElementDescriptor | undefined, pageVar: string): string | undefined {
  if (!target) return undefined;
  const best = target.locators.find(usable);
  if (!best) return undefined;
  let scope = pageVar;
  for (const f of target.frame ?? []) scope += `.frameLocator(${q(f)})`;
  return locatorOn(scope, best);
}

export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Assertion for "we are now on this page": ignores query string, fragment and a trailing slash. */
export function urlAssertion(pageVar: string, url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      const path = u.pathname.replace(/\/+$/, "");
      return `await expect(${pageVar}).toHaveURL(/^${escapeRegexLiteral(u.origin + path)}\\/?(?:[?#].*)?$/);`;
    }
  } catch {
    /* fall through to exact match */
  }
  return `await expect(${pageVar}).toHaveURL(${q(url)});`;
}

export interface PlanStep {
  /** 1-based number among visible steps. */
  n: number;
  step: Step;
  /** 1-based tab index in order of first appearance. */
  tab: number;
  /** `page`, `page2`, ... */
  tabVar: string;
  opensTab: boolean;
  switchesTab: boolean;
  /** Playwright statement(s) for the step body, without indentation. */
  lines: string[];
  replayable: boolean;
  /** Why the step is not replayed (comment text), when `replayable` is false. */
  note?: string;
  /** Environment variable that must hold the value for a masked/sensitive `type` step. */
  secret?: string;
  /** Best locator as Playwright code on `page` (for docs and steps.json). */
  locator?: string;
}

export interface ReplayPlan {
  steps: PlanStep[];
  tabCount: number;
  secrets: string[];
  viewport?: { width: number; height: number };
  /** Statements before the first step (opening the start page) when it does not begin with a navigation. */
  preamble: string[];
}

export const SECRET_PREFIX = "SHOWSTEPS_SECRET_";

/** Turn a guide into the ordered Playwright statements shared by `replay.spec.ts` and `steps.json`. */
export function buildReplayPlan(guide: Guide): ReplayPlan {
  const visible = visibleSteps(guide);
  const tabIds: (number | string)[] = [];
  const tabVarOf = (i: number): string => (i === 0 ? "page" : `page${i + 1}`);
  const plan: PlanStep[] = [];
  const secrets: string[] = [];
  const preamble: string[] = [];
  const started = new Set<number>(); // tab indexes that have loaded a page
  let prevTab = 0;

  visible.forEach((step, idx) => {
    const key = step.page.tabId ?? (idx === 0 ? "default" : tabIds[prevTab] ?? "default");
    let tabIdx = tabIds.indexOf(key);
    const opensTab = tabIdx === -1;
    if (opensTab) {
      tabIds.push(key);
      tabIdx = tabIds.length - 1;
    }
    const pv = tabVarOf(tabIdx);
    const switchesTab = idx > 0 && tabIdx !== prevTab && !opensTab;
    const a = step.action;
    const lines: string[] = [];
    let replayable = true;
    let note: string | undefined;
    let secret: string | undefined;

    const first = !started.has(tabIdx);
    if (opensTab && idx > 0) {
      if (a.type === "navigate") {
        lines.push(`${pv} = await context.newPage();`);
      } else {
        const known = Array.from({ length: tabIdx }, (_, i) => tabVarOf(i)).join(", ");
        lines.push(`${pv} = context.pages().find((p) => ![${known}].includes(p)) ?? (await context.waitForEvent("page"));`);
        lines.push(`await ${pv}.waitForLoadState();`);
      }
    } else if (switchesTab) {
      lines.push(`await ${pv}.bringToFront();`);
    }

    const loc = locatorCode(step.target, pv);
    const needLoc = (): string | undefined => {
      if (loc) return loc;
      replayable = false;
      note = "no locator was recorded for this element";
      return undefined;
    };

    switch (a.type) {
      case "navigate":
        if (first) {
          lines.push(`await ${pv}.goto(${q(a.url)});`);
        } else {
          lines.push(urlAssertion(pv, a.url));
        }
        break;
      case "click": {
        const l = needLoc();
        if (l) {
          if (a.double) lines.push(`await ${l}.dblclick();`);
          else if (a.button === "right" || a.button === "middle") lines.push(`await ${l}.click({ button: ${q(a.button)} });`);
          else lines.push(`await ${l}.click();`);
        }
        break;
      }
      case "type": {
        const l = needLoc();
        if (l) {
          if (isSensitiveStep(step)) {
            secrets.push(`${SECRET_PREFIX}${secrets.length + 1}`);
            secret = secrets[secrets.length - 1];
            lines.push(`await ${l}.fill(secret(${q(secret as string)}));`);
          } else {
            lines.push(`await ${l}.fill(${q(a.value)});`);
          }
        }
        break;
      }
      case "select": {
        const l = needLoc();
        if (l) {
          if (step.target?.sensitive) {
            secrets.push(`${SECRET_PREFIX}${secrets.length + 1}`);
            secret = secrets[secrets.length - 1];
            lines.push(`await ${l}.selectOption(secret(${q(secret as string)}));`);
          } else if (a.optionText && a.optionText.trim() !== "") lines.push(`await ${l}.selectOption({ label: ${q(a.optionText)} });`);
          else lines.push(`await ${l}.selectOption(${q(a.value)});`);
        }
        break;
      }
      case "check": {
        const l = needLoc();
        if (l) lines.push(a.checked ? `await ${l}.check();` : `await ${l}.uncheck();`);
        break;
      }
      case "press": {
        const printable = Array.from(a.key).length === 1 && a.key !== " ";
        const secretField = !!step.target?.sensitive || (step.target?.inputType ?? "").toLowerCase() === "password";
        if (printable && secretField) {
          replayable = false;
          note = "a character typed into a sensitive field is not stored";
        } else if (step.target) {
          const l = needLoc();
          if (l) lines.push(`await ${l}.press(${q(a.key)});`);
        } else {
          lines.push(`await ${pv}.keyboard.press(${q(a.key)});`);
        }
        break;
      }
      case "scroll":
        lines.push(`await ${pv}.mouse.wheel(${a.x}, ${a.y});`);
        break;
      case "hover": {
        const l = needLoc();
        if (l) lines.push(`await ${l}.hover();`);
        break;
      }
      case "note":
        replayable = false;
        note = "note for humans, nothing to replay";
        break;
    }
    started.add(tabIdx);
    if (idx === 0 && a.type !== "navigate" && step.page.url) preamble.push(`await ${pv}.goto(${q(step.page.url)});`);

    const ps: PlanStep = { n: idx + 1, step, tab: tabIdx + 1, tabVar: pv, opensTab: opensTab && idx > 0, switchesTab, lines, replayable, ...(note ? { note } : {}), ...(secret ? { secret } : {}) };
    if (loc) ps.locator = locatorCode(step.target, "page") as string;
    plan.push(ps);
    prevTab = tabIdx;
  });

  const vp = visible.find((s) => s.screenshot)?.screenshot?.viewport;
  return {
    steps: plan,
    tabCount: tabIds.length,
    secrets,
    ...(vp && vp.width > 0 && vp.height > 0 ? { viewport: { width: Math.round(vp.width), height: Math.round(vp.height) } } : {}),
    preamble,
  };
}

/** Plain-text label of a step for comments and `test.step` names. */
export function stepLabel(step: Step, n: number): string {
  return `${n}. ${plainTitle(step.title).replace(/\s+/g, " ").trim() || "Step"}`;
}
