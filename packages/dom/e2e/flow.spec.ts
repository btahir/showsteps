// Runs the canonical 10-step fixture flow in real Chrome across two tabs with real input events, and
// checks what the in-page code resolves for every step against apps/fixtures/flows/expected-steps.json.
import { generateStepTitle } from "@stepsnap/core";
import type { Step, StepAction } from "@stepsnap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, FIXTURES, installRecorder, test, type Recorded } from "./harness";

const flow = JSON.parse(readFileSync(join(FIXTURES, "flows/fixture-flow.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(FIXTURES, "flows/expected-steps.json"), "utf8"));

interface FlowStep {
  id: string;
  tab: string;
  do: "type" | "click" | "select" | "check";
  selector: string;
  value?: string;
  checked?: boolean;
  then?: { opensTab?: string; navigatesTo?: string; pushState?: string; statusText?: string };
}

async function waitForRecord(records: Recorded[], from: number, type: string): Promise<Recorded> {
  await expect.poll(() => records.slice(from).some((r) => r.type === type), { timeout: 5000 }).toBe(true);
  const hits = records.slice(from).filter((r) => r.type === type);
  return hits[hits.length - 1]!;
}

test("fixture flow: 10 steps over two tabs resolve to the expected descriptors, titles and highlight boxes", async ({ context }) => {
  const records = await installRecorder(context);
  const tabs: Record<string, Page> = {};
  tabs.main = await context.newPage();
  await tabs.main.goto(flow.start);
  expect(flow.steps).toHaveLength(10);
  expect(expected.steps).toHaveLength(10);

  for (const s of flow.steps as FlowStep[]) {
    const exp = expected.steps.find((e: { flowStep: string }) => e.flowStep === s.id);
    const page = tabs[s.tab]!;
    await page.bringToFront();
    await page.waitForSelector(s.selector);
    const from = records.length;
    // Box of the element the step acts on, measured by Playwright before acting (viewport CSS px).
    await page.locator(exp.highlight).scrollIntoViewIfNeeded(); // so the later click does not scroll again
    const box = (await page.locator(exp.highlight).boundingBox())!;
    expect(box, `${s.id} highlight target is visible`).toBeTruthy();
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    // The password field's box before acting (the step may navigate away afterwards).
    const redact = expected.autoRedact.onFlowSteps.includes(s.id);
    const pw = redact ? (await page.locator("#password").boundingBox())! : null;

    let recordType: string;
    switch (s.do) {
      case "type":
        await page.locator(s.selector).click();
        await page.locator(s.selector).pressSequentially(s.value!, { delay: 5 });
        recordType = "input";
        break;
      case "select":
        await page.selectOption(s.selector, s.value!);
        recordType = "change";
        break;
      case "check":
        await page.check(s.selector);
        recordType = "click";
        break;
      default:
        if (s.then?.opensTab) {
          const [opened] = await Promise.all([context.waitForEvent("page"), page.locator(s.selector).click()]);
          await opened.waitForLoadState("load");
          tabs[s.then.opensTab] = opened;
        } else {
          await page.locator(s.selector).click();
        }
        recordType = "click";
    }
    const rec = await waitForRecord(records, from, recordType);

    // 1. descriptor subset
    expect(rec.descriptor, `${s.id} descriptor`).toMatchObject(exp.target);
    expect(!!rec.descriptor.sensitive, `${s.id} sensitive`).toBe(exp.sensitive);
    // 2. page info
    expect(new URL(rec.page.url).pathname, `${s.id} path`).toBe(exp.page.path);
    expect(rec.page.title, `${s.id} page title`).toBe(exp.page.title);
    // 3. highlight box within 2 px (device px)
    for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) {
      expect(Math.abs((rec.rect as Record<string, number>)[k]! - v) * dpr, `${s.id} highlight ${k}`).toBeLessThanOrEqual(2);
    }
    // 4. title from the core grammar, given the action the recorder would emit
    const action: StepAction =
      s.do === "type" ? (exp.action.masked ? { type: "type", value: "", masked: true } : { type: "type", value: s.value! }) :
      s.do === "select" ? { type: "select", value: s.value!, optionText: exp.action.optionText } :
      s.do === "check" ? { type: "check", checked: !!s.checked } :
      { type: "click" };
    const step: Pick<Step, "action" | "target" | "page"> = { action, target: rec.descriptor, page: { url: rec.page.url, title: rec.page.title } };
    expect(generateStepTitle(step), `${s.id} title`).toBe(exp.title);
    // 5. secrets never reach the descriptor
    for (const secret of flow.secrets) expect(JSON.stringify(rec), `${s.id} leaks ${secret}`).not.toContain(secret);
    // 6. screenshots of steps s01-s03 show the password field, so it must be an auto-redaction candidate
    if (pw) {
      const covered = rec.sensitiveRects.some(
        (r) => Math.abs(r.x - pw.x) <= 1 && Math.abs(r.y - pw.y) <= 1 && Math.abs(r.width - pw.width) <= 1 && Math.abs(r.height - pw.height) <= 1,
      );
      expect(covered, `${s.id} password field is covered by a sensitive rect`).toBe(true);
    }
    // 7. first locator expectation
    if (exp.firstLocator) expect(rec.descriptor.locators[0]).toEqual(exp.firstLocator);
    // 8. the step had its effect
    if (s.then?.navigatesTo) await expect(page).toHaveURL(new RegExp(`${s.then.navigatesTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    if (s.then?.pushState) await expect(page).toHaveURL(new RegExp(`${s.then.pushState}$`));
    if (s.then?.statusText) await expect(page.getByText(s.then.statusText, { exact: true })).toBeVisible();
  }
  expect(Object.keys(tabs)).toEqual(["main", "help"]);
});
