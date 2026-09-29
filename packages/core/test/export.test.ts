import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  exportAgentSkill,
  exportHtml,
  exportMarkdown,
  exportPlaywright,
  packBundle,
  type Guide,
  type StepsJson,
  type Step,
} from "../src";
import { generateStepTitle } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { expectGolden, expectGoldenBytes, sha256 } from "./golden";

const guide = fixtureGuide();
const images = fixtureImages();
const text = (f: string | Uint8Array | undefined): string => (typeof f === "string" ? f : new TextDecoder().decode(f));

/** A recorder mistake: the real password ended up in the guide. Nothing may print it. */
const LEAK = "hunter2-Sup3rSecret";
function leakyGuide(): Guide {
  const g = fixtureGuide();
  return {
    ...g,
    steps: g.steps.map((s): Step => {
      if (s.id !== "s_pass") return s;
      const leaky = { ...s, action: { type: "type" as const, value: LEAK } };
      return { ...leaky, title: generateStepTitle(leaky) };
    }),
  };
}

describe("exportMarkdown", () => {
  it("matches the golden guide.md (with images)", () => {
    const { files } = exportMarkdown(guide, { images });
    expectGolden("markdown/guide.md", text(files["guide.md"]));
    const listing = Object.entries(files).map(([k, v]) => `${k} ${typeof v === "string" ? "text" : "bytes"}`);
    expectGolden("markdown/files.txt", listing.join("\n") + "\n");
  });

  it("links images without bytes when no images are given, and can omit links", () => {
    const withLinks = exportMarkdown(guide).files;
    expect(Object.keys(withLinks)).toEqual(["guide.md"]);
    expect(text(withLinks["guide.md"])).toContain("![Step 2: Type \"jane@example.com\" in Email](images/s_email.png)");
    const plain = text(exportMarkdown(guide, { imageLinks: false }).files["guide.md"]);
    expect(plain).not.toContain("![");
  });

  it("is deterministic", () => {
    const a = exportMarkdown(guide, { images }).files;
    const b = exportMarkdown(guide, { images }).files;
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const k of Object.keys(a)) expect(sha256(typeof a[k] === "string" ? new TextEncoder().encode(a[k] as string) : (a[k] as Uint8Array))).toBe(sha256(typeof b[k] === "string" ? new TextEncoder().encode(b[k] as string) : (b[k] as Uint8Array)));
  });

  it("skips skipped steps and renumbers", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s) => (s.id === "s_gear" ? { ...s, skipped: true } : s)) };
    const md = text(exportMarkdown(g, { images }).files["guide.md"]);
    expect(md).not.toContain("Open settings");
    expect(md).toContain("## 5. Select **Monthly** in **Billing period**");
    expect(Object.keys(exportMarkdown(g, { images }).files)).not.toContain("images/s_gear.png");
  });

  it("bakes redactions into the exported password screenshot", () => {
    const files = exportMarkdown(guide, { images }).files;
    expect(sha256(files["images/s_pass.png"] as Uint8Array)).not.toBe(sha256(images["images/s_pass.png"] as Uint8Array));
  });

  it("honours includeUrls and strips query strings and fragments", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s, i) => (i === 0 ? { ...s, page: { ...s.page, url: "https://app.acme.test/login?token=abc123#x" } } : s)) };
    const md = text(exportMarkdown(g).files["guide.md"]);
    expect(md).not.toContain("abc123");
    expect(md).toContain("https://app.acme.test/login");
    expect(text(exportMarkdown(g, { includeUrls: false }).files["guide.md"])).not.toContain("acme.test/login");
    expect(text(exportMarkdown({ ...g, settings: { includeUrls: false } }).files["guide.md"])).not.toContain("*Page:");
  });

  it("escapes the guide title", () => {
    const md = text(exportMarkdown({ ...guide, title: "Q1 *report* [draft]" }).files["guide.md"]);
    expect(md.startsWith("# Q1 \\*report\\* \\[draft\\]\n")).toBe(true);
  });

  it("can drop branding", () => {
    expect(text(exportMarkdown(guide, { branding: false }).files["guide.md"])).not.toContain("Made with");
  });
});

describe("exportHtml", () => {
  const html = exportHtml(guide, images);

  it("matches the golden HTML", () => {
    expectGolden("html/guide.html", html);
  });

  it("is a single self-contained file: images inlined, no scripts, no external resources", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect((html.match(/<img /g) ?? []).length).toBe(10);
    expect((html.match(/src="data:image\/png;base64,/g) ?? []).length).toBe(10);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link /i);
    expect(html).not.toMatch(/(src|href)="(?!data:|https?:\/\/|#)/);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("has print CSS and theme variables", () => {
    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("--ss-accent");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("escapes hostile content", () => {
    const evil: Guide = {
      ...guide,
      title: "<script>alert(1)</script>",
      description: "[click](javascript:alert(1)) and <img src=x onerror=alert(2)> and **bold**",
      steps: guide.steps.slice(0, 1).map((s) => ({ ...s, title: "Click **<b onclick=1>x</b>**", description: "- one\n- <i>two</i>\n\n```\n<script>x</script>\n```" })),
    };
    const out = exportHtml(evil, images);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<b onclick");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<pre><code>&lt;script&gt;x&lt;/script&gt;\n</code></pre>".replace("\n</code>", "</code>"));
  });

  it("puts alt text on every screenshot", () => {
    expect(html).toContain('alt="Screenshot of step 2: Type &quot;jane@example.com&quot; in Email"');
  });

  it("marks up the guide with a numbered ordered list and a footer", () => {
    expect((html.match(/<li class="step/g) ?? []).length).toBe(10);
    expect(html).toContain('<span class="flag" aria-hidden="true">10</span>');
    expect(html).toContain("Made with");
    expect(exportHtml(guide, images, { branding: false })).not.toContain("Made with");
  });

  it("supports theme forcing and extra CSS", () => {
    const out = exportHtml(guide, images, { theme: "dark", css: ":root{--ss-accent:#0af}" });
    expect(out).toContain('<html lang="en" data-theme="dark">');
    expect(out.trimEnd().endsWith("</html>")).toBe(true);
    expect(out).toContain(":root{--ss-accent:#0af}");
  });

  it("works with prerendered images and steps without screenshots", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s) => ({ ...s, screenshot: undefined })) };
    const out = exportHtml(g, {});
    expect((out.match(/<img /g) ?? []).length).toBe(0);
    expect(out).toContain("<li class=\"step\"");
  });

  it("strips query strings from displayed URLs", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s) => ({ ...s, page: { ...s.page, url: s.page.url + "?session=SECRET42" } })) };
    expect(exportHtml(g, images)).not.toContain("SECRET42");
  });
});

describe("exportPlaywright", () => {
  const spec = exportPlaywright(guide);
  it("matches the golden replay.spec.ts", () => expectGolden("playwright/replay.spec.ts.golden", spec));

  it("uses the best locator per step", () => {
    expect(spec).toContain('page.getByLabel("Email").fill("jane@example.com")');
    expect(spec).toContain('page.getByTestId("signin-button").click()');
    expect(spec).toContain('page.getByRole("button", { name: "Open settings" }).click()');
    expect(spec).toContain('page.getByLabel("Billing period").selectOption({ label: "Monthly" })');
    expect(spec).toContain('page.getByLabel("Email me invoices").check()');
    expect(spec).toContain(`page.frameLocator('iframe[name="card-frame"]').getByRole("button", { name: "Pay now" }).click()`);
  });

  it("uses goto for the first step and URL assertions later, with a second tab", () => {
    expect(spec).toContain('await page.goto("https://app.acme.test/login");');
    expect(spec.match(/\.goto\(/g)?.length).toBe(2);
    expect(spec).toContain("page2 = await context.newPage();");
    expect(spec).toContain('await page2.goto("https://help.acme.test/invoices");');
    expect(spec).toContain("await page2.getByPlaceholder(\"Search help\").press(\"Enter\");");
  });

  it("never writes the password", () => {
    expect(spec).toContain('secret("SHOWSTEPS_SECRET_1")');
    expect(spec).not.toContain("hunter2");
    expect(exportPlaywright(leakyGuide())).not.toContain(LEAK);
  });

  it("asserts later navigations instead of navigating", () => {
    const g: Guide = {
      ...guide,
      steps: [
        guide.steps[0] as Step,
        guide.steps[3] as Step,
        { ...(guide.steps[0] as Step), id: "s_nav_again", action: { type: "navigate", url: "https://app.acme.test/dashboard/?tab=1#top" }, page: { url: "https://app.acme.test/dashboard/", title: "Dashboard", tabId: 101 } },
      ],
    };
    const out = exportPlaywright(g);
    expect(out.match(/\.goto\(/g)?.length).toBe(1);
    expect(out).toContain("await expect(page).toHaveURL(/^https:\\/\\/app\\.acme\\.test\\/dashboard\\/?(?:[?#].*)?$/);");
  });

  it("opens the start page when the recording did not begin with a navigation", () => {
    const g: Guide = { ...guide, steps: [guide.steps[3] as Step] };
    expect(exportPlaywright(g)).toContain('await page.goto("https://app.acme.test/login");');
  });

  it("falls back through locator kinds and skips unusable ones", () => {
    const base = guide.steps[3] as Step;
    const mk = (locators: NonNullable<Step["target"]>["locators"]): Guide => ({
      ...guide,
      steps: [{ ...base, target: { ...(base.target as NonNullable<Step["target"]>), locators } }],
    });
    expect(exportPlaywright(mk([{ kind: "role", role: "button", name: "" }, { kind: "text", value: "Go", exact: true }]))).toContain('page.getByText("Go", { exact: true }).click()');
    expect(exportPlaywright(mk([{ kind: "role", role: "not-a-role", name: "X" }, { kind: "css", value: "#go" }]))).toContain('page.locator("#go").click()');
    expect(exportPlaywright(mk([{ kind: "xpath", value: "//button[1]" }]))).toContain('page.locator("xpath=//button[1]").click()');
    expect(exportPlaywright(mk([{ kind: "text", value: "Go" }]))).toContain('page.getByText("Go").click()');
  });

  it("scopes replay by the iframe and shadow-host chains and never uses XPath inside a shadow root", () => {
    const base = guide.steps[3] as Step;
    const withTarget = (t: Partial<NonNullable<Step["target"]>>): Guide => ({
      ...guide,
      steps: [{ ...base, target: { ...(base.target as NonNullable<Step["target"]>), ...t } }],
    });
    const chained = exportPlaywright(
      withTarget({ frame: ["iframe#a", "iframe#b"], shadow: ["my-app", "app-toolbar"], locators: [{ kind: "role", role: "button", name: "Save" }] }),
    );
    expect(chained).toContain(`page.frameLocator("iframe#a").frameLocator("iframe#b").locator("my-app").locator("app-toolbar").getByRole("button", { name: "Save" }).click()`);
    const noXpath = exportPlaywright(withTarget({ shadow: ["my-app"], locators: [{ kind: "xpath", value: "//button" }, { kind: "css", value: "button.save" }] }));
    expect(noXpath).toContain('.locator("my-app").locator("button.save").click()');
    expect(noXpath).not.toContain("xpath=");
  });

  it("replays data-test style attributes (recorded as css) and exact text", () => {
    const base = guide.steps[3] as Step;
    const g: Guide = { ...guide, steps: [{ ...base, target: { ...(base.target as NonNullable<Step["target"]>), locators: [{ kind: "css", value: '[data-cy="go"]' }] } }] };
    expect(exportPlaywright(g)).toContain(`page.locator('[data-cy="go"]').click()`);
  });

  it("handles click variants, scroll, hover, key presses and notes", () => {
    const t = (guide.steps[3] as Step).target;
    const st = (id: string, action: Step["action"], withTarget = true): Step => ({ ...(guide.steps[3] as Step), id, action, target: withTarget ? t : undefined });
    const g: Guide = {
      ...guide,
      steps: [
        st("a", { type: "click", double: true }),
        st("b", { type: "click", button: "right" }),
        st("c", { type: "hover" }),
        st("d", { type: "scroll", x: 0, y: 400 }, false),
        st("e", { type: "press", key: "Control+K" }, false),
        st("f", { type: "check", checked: false }),
        st("g", { type: "note" }, false),
        st("h", { type: "click" }, false),
      ],
    };
    const out = exportPlaywright(g);
    expect(out).toContain(".dblclick();");
    expect(out).toContain('.click({ button: "right" });');
    expect(out).toContain(".hover();");
    expect(out).toContain("page.mouse.wheel(0, 400);");
    expect(out).toContain('page.keyboard.press("Control+K");');
    expect(out).toContain(".uncheck();");
    expect(out).toContain("(note, not replayed)");
    expect(out).toContain("not replayed (no locator was recorded for this element)");
  });

  it("escapes quotes and unusual characters in locators and values", () => {
    const base = guide.steps[1] as Step;
    const g: Guide = {
      ...guide,
      steps: [{ ...base, action: { type: "type", value: 'say "hi"\n\u2028ok' }, target: { ...(base.target as NonNullable<Step["target"]>), locators: [{ kind: "label", value: 'Name "quoted"' }] } }],
    };
    const out = exportPlaywright(g);
    expect(out).toContain(`getByLabel('Name "quoted"')`);
    expect(out).toContain(`.fill('say "hi"\\n\u2028ok')`);
  });

  it("includes the recorded viewport and can omit it", () => {
    expect(spec).toContain("test.use({ viewport: { width: 80, height: 50 } });");
    expect(exportPlaywright(guide, { viewport: false })).not.toContain("test.use");
  });

  it("omits skipped steps", () => {
    const g: Guide = { ...guide, steps: guide.steps.map((s) => (s.id === "s_gear" ? { ...s, skipped: true } : s)) };
    expect(exportPlaywright(g)).not.toContain("Open settings");
  });
});

describe("exportAgentSkill", () => {
  const { files } = exportAgentSkill(guide);
  const skillMd = text(files["SKILL.md"]);
  const stepsJson = JSON.parse(text(files["steps.json"])) as StepsJson;

  it("matches the golden files", () => {
    expectGolden("skill/SKILL.md", skillMd);
    expectGolden("skill/steps.json", text(files["steps.json"]));
    expect(text(files["replay.spec.ts"])).toBe(exportPlaywright(guide));
    expect(Object.keys(files)).toEqual(["SKILL.md", "replay.spec.ts", "steps.json"]);
  });

  it("has YAML frontmatter with name and description", () => {
    const m = /^---\nname: (".*")\ndescription: (".*")\n---\n/.exec(skillMd);
    expect(m).not.toBeNull();
    const name = JSON.parse(m?.[1] ?? '""') as string;
    const description = JSON.parse(m?.[2] ?? '""') as string;
    expect(name).toBe("update-billing-settings-in-acme");
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toContain("Update billing settings in Acme");
  });

  it("numbers the steps and gives locator hints", () => {
    expect(skillMd).toContain("1. Go to **Sign in \u2013 Acme**");
    expect(skillMd).toContain("10. Press **Enter** to search");
    expect(skillMd).toContain('Find it by: test id "signin-button"');
    expect(skillMd).toContain("inside iframe `iframe[name=\"card-frame\"]`");
    expect(skillMd).toContain("`SHOWSTEPS_SECRET_1`");
  });

  it("writes a versioned steps.json", () => {
    expect(stepsJson.format).toBe("showsteps-steps");
    expect(stepsJson.version).toBe(1);
    expect(stepsJson.guide).toMatchObject({ id: "g_fixture", stepCount: 10, tabCount: 2 });
    expect(stepsJson.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stepsJson.steps[2]?.action).toEqual({ type: "type", masked: true, secret: "SHOWSTEPS_SECRET_1" });
    expect(stepsJson.secrets).toEqual([{ env: "SHOWSTEPS_SECRET_1", step: 3, field: "Password" }]);
    expect(stepsJson.steps[8]?.page.tab).toBe(2);
    expect(stepsJson.steps[1]?.replay.playwright).toContain("getByLabel");
    expect(stepsJson.startUrl).toBe("https://app.acme.test/login");
  });

  it("never leaks a secret, even if the guide contains one", () => {
    const leaky = exportAgentSkill(leakyGuide());
    for (const [name, content] of Object.entries(leaky.files)) expect(text(content), name).not.toContain(LEAK);
  });

  it("can include rendered images", () => {
    const withImages = exportAgentSkill(guide, { images }).files;
    expect(Object.keys(withImages)).toContain("images/s_email.png");
    expect(text(withImages["SKILL.md"])).toContain("`images/`");
    expect((JSON.parse(text(withImages["steps.json"])) as StepsJson).steps[1]?.screenshot).toBe("images/s_email.png");
  });

  it("falls back to a default name for a title with no letters", () => {
    expect(text(exportAgentSkill({ ...guide, title: "\u2603\u2603" }).files["SKILL.md"])).toContain('name: "recorded-workflow"');
  });
});

describe("no exporter output contains the secret", () => {
  it("across markdown, html, playwright, skill, bundle", () => {
    const g = leakyGuide();
    const bundle = packBundle(g, images);
    const all: string[] = [
      ...Object.values(exportMarkdown(g).files).map(text),
      exportHtml(g, images),
      exportPlaywright(g),
      ...Object.values(exportAgentSkill(g).files).map(text),
    ];
    for (const s of all) expect(s).not.toContain(LEAK);
    // the raw bundle is a lossless project file and does keep whatever the guide held
    expect(unzipSync(bundle)["guide.json"]).toBeDefined();
  });
});

describe("bundle golden", () => {
  it("is byte-stable across releases", () => {
    expectGoldenBytes("bundle/fixture.showsteps", packBundle(guide, images));
  });
});
