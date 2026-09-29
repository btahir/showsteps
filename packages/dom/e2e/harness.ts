import { test as base, expect, type BrowserContext, type Frame, type FrameLocator, type Locator as PwLocator, type Page } from "@playwright/test";
import type { ElementDescriptor, Locator } from "@stepsnap/core";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = join(here, "../dist/stepsnap-dom.iife.js");
export const GOLDEN_DIR = join(here, "golden");
export const FIXTURES = join(here, "../../../apps/fixtures");

/** Injects the built in-page bundle into every frame of every page in the context. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript({ path: BUNDLE });
    await use(context);
  },
});
export { expect };

export interface Target {
  key: string;
  selector: string;
  /** URL suffix of a same-origin iframe the element lives in. */
  frame?: string;
  /** Shadow host selectors, outermost first. */
  hosts?: string[];
}

function frameFor(page: Page, t: Target): Frame {
  if (!t.frame) return page.mainFrame();
  const f = page.frames().find((fr) => fr.url().endsWith(t.frame!));
  if (!f) throw new Error(`frame ${t.frame} not found`);
  return f;
}

export async function describeTarget(page: Page, t: Target): Promise<ElementDescriptor> {
  const frame = frameFor(page, t);
  await frame.waitForLoadState("load");
  return frame.evaluate(
    ({ selector, hosts }) => {
      let root: Document | ShadowRoot = document;
      for (const h of hosts) root = (root.querySelector(h) as Element).shadowRoot!;
      const el = root.querySelector(selector);
      if (!el) throw new Error(`no element ${selector}`);
      return StepsnapDom.describeElement(el);
    },
    { selector: t.selector, hosts: t.hosts ?? [] },
  ) as Promise<ElementDescriptor>;
}

export async function markTarget(page: Page, t: Target, on: boolean): Promise<void> {
  const frame = frameFor(page, t);
  await frame.evaluate(
    ({ selector, hosts, on }) => {
      let root: Document | ShadowRoot = document;
      for (const h of hosts) root = (root.querySelector(h) as Element).shadowRoot!;
      const el = root.querySelector(selector)!;
      if (on) el.setAttribute("data-pw-target", "1");
      else el.removeAttribute("data-pw-target");
    },
    { selector: t.selector, hosts: t.hosts ?? [], on },
  );
}

type Scope = Page | FrameLocator | PwLocator;

/** Translate a descriptor's frame + shadow chain into a Playwright scope. */
export function scopeFor(page: Page, d: ElementDescriptor): Scope {
  let scope: Scope = page;
  for (const f of d.frame ?? []) scope = (scope as Page | FrameLocator).frameLocator(f);
  for (const h of d.shadow ?? []) scope = scope.locator(h);
  return scope;
}

export function playwrightLocator(scope: Scope, l: Locator): PwLocator {
  switch (l.kind) {
    case "testid": return scope.getByTestId(l.value);
    case "role": return scope.getByRole(l.role as Parameters<Page["getByRole"]>[0], { name: l.name });
    case "label": return scope.getByLabel(l.value);
    case "placeholder": return scope.getByPlaceholder(l.value);
    case "text": return scope.getByText(l.value, { exact: l.exact });
    case "css": return scope.locator(l.value);
    case "xpath": return scope.locator(`xpath=${l.value}`);
  }
}

/** Every locator must resolve to exactly the marked element, using Playwright's own engines. */
export async function assertLocatorsResolve(page: Page, t: Target, d: ElementDescriptor): Promise<string[]> {
  const problems: string[] = [];
  await markTarget(page, t, true);
  try {
    const scope = scopeFor(page, d);
    for (const l of d.locators) {
      const loc = playwrightLocator(scope, l);
      const n = await loc.count();
      if (n !== 1) {
        problems.push(`${t.key}: ${JSON.stringify(l)} matched ${n} elements`);
        continue;
      }
      if ((await loc.getAttribute("data-pw-target")) !== "1") problems.push(`${t.key}: ${JSON.stringify(l)} matched a different element`);
    }
  } finally {
    await markTarget(page, t, false);
  }
  return problems;
}

/** Compare against (or, with UPDATE_GOLDENS=1, rewrite) e2e/golden/<name>.json. */
export function checkGolden(name: string, actual: unknown): void {
  const file = join(GOLDEN_DIR, `${name}.json`);
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env.UPDATE_GOLDENS === "1") {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  if (!existsSync(file)) throw new Error(`missing golden ${file}; run with UPDATE_GOLDENS=1 and review it`);
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

/** Records what the in-page code resolves for click / input / change events, across navigations and tabs. */
export interface Recorded {
  type: string;
  descriptor: ElementDescriptor;
  rect: { x: number; y: number; width: number; height: number };
  metrics: { devicePixelRatio: number; viewport: { width: number; height: number; scrollX: number; scrollY: number } };
  page: { url: string; title: string };
  sensitiveRects: { x: number; y: number; width: number; height: number }[];
}

export async function installRecorder(context: BrowserContext): Promise<Recorded[]> {
  const records: Recorded[] = [];
  await context.exposeFunction("__ssRecord", (p: Recorded) => {
    records.push(p);
  });
  await context.addInitScript(() => {
    const send = (type: string, e: Event) => {
      try {
        const el = StepsnapDom.resolveTarget(e);
        void window.__ssRecord?.({
          type,
          descriptor: StepsnapDom.describeElement(el),
          rect: StepsnapDom.rectOf(el),
          metrics: StepsnapDom.pageMetrics(),
          page: { url: location.href, title: document.title },
          sensitiveRects: StepsnapDom.sensitiveRects(),
        });
      } catch (err) {
        console.error("recorder failed", err);
      }
    };
    for (const type of ["click", "input", "change"]) document.addEventListener(type, (e) => send(type, e), true);
  });
  return records;
}
