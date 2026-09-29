import { describe, expect, it } from "vitest";
import { exportPlaywright, type ElementDescriptor, type Guide, type Locator, type Step, type StepAction } from "../src";
import { fixtureGuide } from "./fixtures/guide";
import { expectGolden } from "./golden";
import { typeCheck } from "./tsc-check";

const guide = fixtureGuide();
const spec = exportPlaywright(guide);

// ---- helpers for the preference table ----------------------------------------------------------

const base = (guide.steps.find((s) => s.id === "s_signin") as Step);
const el = (o: Partial<ElementDescriptor> & { locators: Locator[] }): ElementDescriptor => ({ tag: "button", ...o });
const mk = (id: string, action: StepAction, target: ElementDescriptor | undefined, extra: Partial<Step["page"]> = {}): Step => ({
  ...base,
  id,
  action,
  target,
  title: id,
  page: { ...base.page, ...extra },
});
const g = (...steps: Step[]): Guide => ({ ...guide, steps });
const nav = (id: string, url: string, tabId?: number): Step => mk(id, { type: "navigate", url }, undefined, { url, title: url, ...(tabId !== undefined ? { tabId } : {}) });

describe("exportPlaywright: golden and type check", () => {
  it("matches the golden replay.spec.ts", () => expectGolden("playwright/replay.spec.ts.golden", spec));

  it("type-checks against @playwright/test", () => {
    expect(typeCheck(spec)).toEqual([]);
  });

  it("type-checks every variation in this file", () => {
    const variants = [
      exportPlaywright({ ...guide, steps: guide.steps.slice(0, 4) }),
      exportPlaywright({ ...guide, steps: guide.steps.slice(3, 8) }),
      exportPlaywright({ ...guide, steps: [] }),
    ];
    for (const v of variants) expect(typeCheck(v)).toEqual([]);
  });

  it("the type check really catches errors (control)", () => {
    expect(typeCheck('import { test } from "@playwright/test";\ntest("x", async ({ page }) => { await page.nope(); });').length).toBeGreaterThan(0);
  });
});

describe("exportPlaywright: locator preference table", () => {
  const open = nav("open", "https://app.acme.test/");
  const cases: [string, Guide, string | RegExp][] = [
    ["testid beats role", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "testid", value: "save" }, { kind: "role", role: "button", name: "Save" }] }))), 'page.getByTestId("save").click()'],
    ["role beats label", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "role", role: "button", name: "Save" }, { kind: "label", value: "Save" }] }))), 'page.getByRole("button", { name: "Save" }).click()'],
    ["label beats placeholder", g(open, mk("a", { type: "type", value: "x" }, el({ tag: "input", locators: [{ kind: "label", value: "Email" }, { kind: "placeholder", value: "you@x.com" }] }))), 'page.getByLabel("Email").fill("x")'],
    ["placeholder beats text", g(open, mk("a", { type: "type", value: "x" }, el({ tag: "input", locators: [{ kind: "placeholder", value: "Search" }, { kind: "text", value: "Search" }] }))), 'page.getByPlaceholder("Search").fill("x")'],
    ["exact text is replayed with exact", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "text", value: "Go", exact: true }] }))), 'page.getByText("Go", { exact: true }).click()'],
    ["non-exact text stays default", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "text", value: "Go" }] }))), 'page.getByText("Go").click()'],
    ["css is the last resort", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "css", value: "main > .go" }] }))), 'page.locator("main > .go").click()'],
    ["data-cy style attributes arrive as css", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "css", value: '[data-cy="go"]' }] }))), `page.locator('[data-cy="go"]').click()`],
    ["xpath", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "xpath", value: "//button[1]" }] }))), 'page.locator("xpath=//button[1]").click()'],
    ["role without a name is skipped in favour of the next locator", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "role", role: "button", name: "" }, { kind: "css", value: "#b" }] }))), 'page.locator("#b").click()'],
    ["a role Playwright does not know is skipped", g(open, mk("a", { type: "click" }, el({ locators: [{ kind: "role", role: "made-up", name: "X" }, { kind: "css", value: "#b" }] }))), 'page.locator("#b").click()'],
    ["frame chain", g(open, mk("a", { type: "click" }, el({ frame: ["iframe#outer", "iframe[name=inner]"], locators: [{ kind: "role", role: "button", name: "Pay" }] }))), 'page.frameLocator("iframe#outer").frameLocator("iframe[name=inner]").getByRole("button", { name: "Pay" }).click()'],
    ["shadow chain", g(open, mk("a", { type: "click" }, el({ shadow: ["my-app", "x-bar"], locators: [{ kind: "css", value: "button.save" }] }))), 'page.locator("my-app").locator("x-bar").locator("button.save").click()'],
    ["xpath never crosses a shadow root", g(open, mk("a", { type: "click" }, el({ shadow: ["my-app"], locators: [{ kind: "xpath", value: "//b" }, { kind: "css", value: "b" }] }))), 'page.locator("my-app").locator("b").click()'],
    ["select uses selectOption with the label", g(open, mk("a", { type: "select", value: "m", optionText: "Monthly" }, el({ tag: "select", locators: [{ kind: "label", value: "Period" }] }))), 'page.getByLabel("Period").selectOption({ label: "Monthly" })'],
    ["select without optionText uses the value", g(open, mk("a", { type: "select", value: "m" }, el({ tag: "select", locators: [{ kind: "label", value: "Period" }] }))), 'page.getByLabel("Period").selectOption("m")'],
    ["check uses setChecked(true)", g(open, mk("a", { type: "check", checked: true }, el({ tag: "input", locators: [{ kind: "label", value: "Agree" }] }))), 'page.getByLabel("Agree").setChecked(true)'],
    ["uncheck uses setChecked(false)", g(open, mk("a", { type: "check", checked: false }, el({ tag: "input", locators: [{ kind: "label", value: "Agree" }] }))), 'page.getByLabel("Agree").setChecked(false)'],
    ["press on a target uses the locator", g(open, mk("a", { type: "press", key: "Enter" }, el({ tag: "input", locators: [{ kind: "label", value: "Q" }] }))), 'page.getByLabel("Q").press("Enter")'],
    ["press without a target uses the keyboard", g(open, mk("a", { type: "press", key: "Control+K" }, undefined)), 'page.keyboard.press("Control+K")'],
    ["double click", g(open, mk("a", { type: "click", double: true }, el({ locators: [{ kind: "css", value: "#b" }] }))), 'page.locator("#b").dblclick()'],
    ["right click", g(open, mk("a", { type: "click", button: "right" }, el({ locators: [{ kind: "css", value: "#b" }] }))), 'page.locator("#b").click({ button: "right" })'],
    ["hover", g(open, mk("a", { type: "hover" }, el({ locators: [{ kind: "css", value: "#b" }] }))), 'page.locator("#b").hover()'],
    ["scroll", g(open, mk("a", { type: "scroll", x: 0, y: 300 }, undefined)), "page.mouse.wheel(0, 300)"],
    ["non-masked values are literal", g(open, mk("a", { type: "type", value: "jane@example.com" }, el({ tag: "input", locators: [{ kind: "label", value: "Email" }] }))), '.fill("jane@example.com")'],
  ];
  it("covers at least 12 cases", () => expect(cases.length).toBeGreaterThanOrEqual(12));
  it.each(cases)("%s", (_name, gd, expected) => {
    const out = exportPlaywright(gd);
    if (typeof expected === "string") expect(out).toContain(expected);
    else expect(out).toMatch(expected);
    expect(typeCheck(out)).toEqual([]);
  });
});

describe("exportPlaywright: tabs (PLAN 3.9)", () => {
  const click = (id: string, tabId: number, css = "#go") => mk(id, { type: "click" }, el({ locators: [{ kind: "css", value: css }] }), { tabId, url: `https://a.test/t${tabId}` });

  it("opens the first tab with context.newPage() and goes to the first navigation", () => {
    const out = exportPlaywright(g(nav("a", "https://a.test/", 5)));
    expect(out).toContain("const page = await context.newPage();");
    expect(out).toContain('await page.goto("https://a.test/");');
    expect(out).toContain("await expect(page).toHaveURL(");
  });

  it("wraps the previous action in waitForEvent(\"page\") when a never-seen tabId appears, and emits no goto for the navigation", () => {
    const out = exportPlaywright(g(nav("a", "https://a.test/", 5), click("b", 5), nav("c", "https://b.test/x", 6)));
    expect(out).toContain('[page2] = await Promise.all([context.waitForEvent("page"), page.locator("#go").click()]);');
    expect(out).toContain('await page2.waitForLoadState("domcontentloaded");');
    expect(out).toContain("await expect(page2).toHaveURL(/^https:\\/\\/b\\.test\\/x\\/?(?:[?#].*)?$/);");
    expect(out.match(/\.goto\(/g)?.length).toBe(1);
    expect(typeCheck(out)).toEqual([]);
  });

  it("brings a seen tab back to the front", () => {
    const out = exportPlaywright(g(nav("a", "https://a.test/", 5), click("b", 5), nav("c", "https://b.test/", 6), click("d", 6), click("e", 5, "#back")));
    expect(out).toContain("await page.bringToFront();");
    expect(out).not.toContain("await page2.bringToFront();");
    expect(out.indexOf("bringToFront")).toBeGreaterThan(out.indexOf("page2.locator"));
  });

  it("opens the tab itself when nothing preceded it (agent-authored guide)", () => {
    const note = mk("n", { type: "note" }, undefined, { tabId: 5 });
    const out = exportPlaywright(g(nav("a", "https://a.test/", 5), note, nav("c", "https://b.test/x", 6)));
    expect(out).toContain("page2 = await context.newPage();");
    expect(out).toContain('await page2.goto("https://b.test/x");');
    expect(out).not.toContain("waitForEvent");
  });

  it("emits goto for a navigate step in a tab that already exists", () => {
    const out = exportPlaywright(g(nav("a", "https://a.test/", 5), click("b", 5), nav("c", "https://a.test/other?x=1#h", 5)));
    expect(out.match(/\.goto\(/g)?.length).toBe(2);
    expect(out).toContain('await page.goto("https://a.test/other?x=1#h");');
    expect(out).toContain("toHaveURL(/^https:\\/\\/a\\.test\\/other\\/?(?:[?#].*)?$/)");
  });

  it("steps without a tabId share one page", () => {
    const out = exportPlaywright(g(nav("a", "https://a.test/"), mk("b", { type: "click" }, el({ locators: [{ kind: "css", value: "#x" }] })), nav("c", "https://a.test/z")));
    expect(out).not.toContain("page2");
    expect(out).not.toContain("waitForEvent");
  });

  it("opens the start page when the recording did not begin with a navigation", () => {
    const out = exportPlaywright(g(mk("a", { type: "click" }, el({ locators: [{ kind: "css", value: "#x" }] }), { url: "https://a.test/start" })));
    expect(out).toContain('await page.goto("https://a.test/start");');
  });

  it("the fixture flow: popup wrapped, second tab handled", () => {
    expect(spec).toContain('[page2] = await Promise.all([context.waitForEvent("page"), page.frameLocator(\'iframe[name="card-frame"]\').getByRole("button", { name: "Pay now" }).click()]);');
    expect(spec).toContain('await page2.waitForLoadState("domcontentloaded");');
    expect(spec).not.toContain("context.newPage();\n    await page2.goto");
  });
});

describe("exportPlaywright: secrets", () => {
  it("masked type steps read process.env.SHOWSTEPS_SECRET_<n> and skip the test without it", () => {
    expect(spec).toContain('test.skip(!process.env.SHOWSTEPS_SECRET_1, "set SHOWSTEPS_SECRET_1");');
    expect(spec).toContain("fill(process.env.SHOWSTEPS_SECRET_1!)");
    expect(spec).toContain("Set SHOWSTEPS_SECRET_1 before running");
  });

  it("numbers several secrets by their order among the masked steps", () => {
    const pw = (id: string): Step => mk(id, { type: "type", value: "", masked: true }, el({ tag: "input", inputType: "password", sensitive: true, locators: [{ kind: "label", value: id }] }));
    const out = exportPlaywright(g(nav("a", "https://a.test/"), pw("One"), mk("m", { type: "click" }, undefined), pw("Two")));
    expect(out).toContain("SHOWSTEPS_SECRET_1");
    expect(out).toContain('getByLabel("Two").fill(process.env.SHOWSTEPS_SECRET_2!)');
    expect(typeCheck(out)).toEqual([]);
  });

  it("never writes a real value that slipped into a masked or sensitive step", () => {
    const leak = "hunter2-Sup3rSecret";
    const bad = mk("p", { type: "type", value: leak }, el({ tag: "input", inputType: "password", sensitive: true, locators: [{ kind: "label", value: "Password" }] }));
    const noFlag = mk("q", { type: "type", value: leak }, el({ tag: "input", inputType: "text", label: "API key", locators: [{ kind: "label", value: "API key" }] }));
    expect(exportPlaywright(g(nav("a", "https://a.test/"), bad, noFlag))).not.toContain(leak);
  });

  it("does not replay a character typed into a password field", () => {
    const key = mk("k", { type: "press", key: "a" }, el({ tag: "input", inputType: "password", sensitive: true, locators: [{ kind: "label", value: "Password" }] }));
    const out = exportPlaywright(g(nav("a", "https://a.test/"), key));
    expect(out).not.toContain('press("a")');
    expect(out).toContain("not replayed");
  });
});

describe("exportPlaywright: everything else", () => {
  it("escapes quotes and unusual characters", () => {
    const step = mk("a", { type: "type", value: 'say "hi"\n\u2028ok' }, el({ tag: "input", locators: [{ kind: "label", value: 'Name "quoted"' }] }));
    const out = exportPlaywright(g(nav("a0", "https://a.test/"), step));
    expect(out).toContain(`getByLabel('Name "quoted"')`);
    expect(out).toContain(`.fill('say "hi"\\n\u2028ok')`);
    expect(typeCheck(out)).toEqual([]);
  });

  it("includes the recorded viewport and can omit it", () => {
    expect(spec).toContain("test.use({ viewport: { width: 80, height: 50 } });");
    expect(exportPlaywright(guide, { viewport: false })).not.toContain("test.use");
  });

  it("omits skipped steps and marks notes and unreplayable steps in comments", () => {
    const skipped: Guide = { ...guide, steps: guide.steps.map((s) => (s.id === "s_gear" ? { ...s, skipped: true } : s)) };
    expect(exportPlaywright(skipped)).not.toContain("Open settings");
    const out = exportPlaywright(g(nav("a", "https://a.test/"), mk("n", { type: "note" }, undefined), mk("z", { type: "click" }, undefined)));
    expect(out).toContain("(note, not replayed)");
    expect(out).toContain("not replayed (no locator was recorded for this element)");
  });

  it("is deterministic", () => {
    expect(exportPlaywright(guide)).toBe(exportPlaywright(JSON.parse(JSON.stringify(guide)) as Guide));
  });
});
