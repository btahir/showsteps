import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ElementDescriptor, Guide, Step, StepAction } from "../src";
import { formatKey, generateStepTitle, regenerateTitles } from "../src";
import { sample11Guide } from "./fixtures/sample11";
import { expectGolden } from "./golden";

const el = (o: Partial<ElementDescriptor> & { tag: string }): ElementDescriptor => ({ locators: [{ kind: "css", value: o.tag }], ...o });
const page = (title?: string, url = "https://app.acme.test/x"): Step["page"] => ({ url, ...(title ? { title } : {}) });
const t = (action: StepAction, target?: ElementDescriptor, p: Step["page"] = page()) => generateStepTitle({ action, target, page: p });

const click: StepAction = { type: "click" };

const button = (name: string) => el({ tag: "button", role: "button", name, text: name });

type Case = [label: string, action: StepAction, target: ElementDescriptor | undefined, expected: string, p?: Step["page"]];

const CASES: Case[] = [
  // buttons and links
  ["button", click, button("Save"), "Click **Save**"],
  ["button with text only", click, el({ tag: "button", text: "Add member" }), "Click **Add member**"],
  ["input submit", click, el({ tag: "input", inputType: "submit", name: "Sign in" }), "Click **Sign in**"],
  ["link", click, el({ tag: "a", role: "link", name: "Pricing", href: "/pricing" }), "Click **Pricing**"],
  ["icon-only button uses aria-label", click, el({ tag: "button", role: "button", name: "Open settings" }), "Click **Open settings**"],
  ["icon-only button glyph x", click, el({ tag: "button", role: "button", name: "×" }), "Click **Close**"],
  ["icon-only button glyph kebab", click, el({ tag: "button", role: "button", text: "⋮" }), "Click **More options**"],
  ["nameless button", click, el({ tag: "button", role: "button" }), "Click the button"],
  ["nameless link", click, el({ tag: "a", role: "link" }), "Click the link"],
  ["symbol-only name is ignored", click, el({ tag: "button", role: "button", name: "•••" }), "Click the button"],
  ["generic div with text", click, el({ tag: "div", text: "Learn more" }), "Click **Learn more**"],
  ["generic nameless", click, el({ tag: "div" }), "Click the highlighted area"],
  ["no target at all", click, undefined, "Click the highlighted area"],
  ["name whitespace is collapsed", click, button("  Save \n  changes  "), "Click **Save changes**"],
  ["long name is truncated on a word boundary", click, button("Continue to the payment page and review your order details before confirming"), "Click **Continue to the payment page and review your order details…**"],
  ["markdown in a name is escaped", click, button("Save *all* [now]"), "Click **Save \\*all\\* \\[now\\]**"],
  ["underscore inside a word is kept", click, button("export_csv"), "Click **export_csv**"],
  ["click variants: double", { type: "click", double: true }, button("Open"), "Double-click **Open**"],
  ["click variants: right", { type: "click", button: "right" }, el({ tag: "div", text: "Row 3" }), "Right-click **Row 3**"],
  ["click variants: middle", { type: "click", button: "middle" }, el({ tag: "a", role: "link", name: "Docs" }), "Middle-click **Docs**"],
  // form controls, clicks
  ["click text field", click, el({ tag: "input", role: "textbox", inputType: "email", label: "Email" }), "Click the **Email** field"],
  ["click textarea", click, el({ tag: "textarea", role: "textbox", label: "Message" }), "Click the **Message** field"],
  ["click contenteditable", click, el({ tag: "div", role: "textbox", name: "Note body", text: "secret draft text" }), "Click the **Note body** editor"],
  ["contenteditable never leaks its content", click, el({ tag: "div", role: "textbox", text: "my private words" }), "Click the editor"],
  ["click checkbox", click, el({ tag: "input", inputType: "checkbox", label: "Remember me" }), "Click the **Remember me** checkbox"],
  ["click radio", click, el({ tag: "input", inputType: "radio", label: "Monthly" }), "Select **Monthly**"],
  ["click select opens dropdown", click, el({ tag: "select", role: "combobox", label: "Billing period" }), "Open the **Billing period** dropdown"],
  ["click nameless select", click, el({ tag: "select" }), "Open the dropdown"],
  ["click menu item", click, el({ tag: "div", role: "menuitem", name: "Delete" }), "Select **Delete** from the menu"],
  ["click tab", click, el({ tag: "button", role: "tab", name: "Billing" }), "Open the **Billing** tab"],
  ["click option", click, el({ tag: "li", role: "option", name: "Canada" }), "Select **Canada**"],
  ["click switch", click, el({ tag: "button", role: "switch", name: "Dark mode" }), "Click the **Dark mode** toggle"],
  ["click search field", click, el({ tag: "input", inputType: "search", placeholder: "Search docs" }), "Click the **Search docs** search field"],
  // typing
  ["type email", { type: "type", value: "jane@example.com" }, el({ tag: "input", inputType: "email", label: "Email" }), 'Type "jane@example.com" in **Email**'],
  ["type uses placeholder when no label", { type: "type", value: "Acme" }, el({ tag: "input", inputType: "text", placeholder: "Company name" }), 'Type "Acme" in **Company name**'],
  ["type into nameless field", { type: "type", value: "hello" }, el({ tag: "input", inputType: "text" }), 'Type "hello" in the text field'],
  ["type into nameless textarea", { type: "type", value: "hello" }, el({ tag: "textarea" }), 'Type "hello" in the text area'],
  ["type clears field", { type: "type", value: "" }, el({ tag: "input", label: "Coupon" }), "Clear **Coupon**"],
  ["type long value truncated", { type: "type", value: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor" }, el({ tag: "textarea", label: "Notes" }), 'Type "Lorem ipsum dolor sit amet, consectetur…" in **Notes**'],
  ["type multi-line value collapses", { type: "type", value: "line one\nline two" }, el({ tag: "textarea", label: "Notes" }), 'Type "line one line two" in **Notes**'],
  ["type value with markdown is escaped", { type: "type", value: "a*b*c" }, el({ tag: "input", label: "Formula" }), 'Type "a\\*b\\*c" in **Formula**'],
  ["search input reads naturally", { type: "type", value: "refund policy" }, el({ tag: "input", inputType: "search", label: "Search" }), 'Search for "refund policy"'],
  ["type masked password", { type: "type", value: "•••", masked: true }, el({ tag: "input", inputType: "password", label: "Password", sensitive: true }), "Enter your password"],
  ["type masked confirm password", { type: "type", value: "", masked: true }, el({ tag: "input", inputType: "password", label: "Confirm password", sensitive: true }), "Enter your password"],
  ["type masked password with odd label", { type: "type", value: "", masked: true }, el({ tag: "input", inputType: "password", label: "Your secret word" }), "Enter your password in **Your secret word**"],
  ["type masked non-password field", { type: "type", value: "", masked: true }, el({ tag: "input", inputType: "text", label: "Card number", sensitive: true }), "Fill in **Card number**"],
  ["real value on a password input never leaks", { type: "type", value: "hunter2" }, el({ tag: "input", inputType: "password", label: "Password" }), "Enter your password"],
  ["real value on a sensitive field never leaks", { type: "type", value: "4242 4242 4242 4242" }, el({ tag: "input", inputType: "text", label: "Card", sensitive: true }), "Fill in **Card**"],
  ["value in a field named like a secret never leaks", { type: "type", value: "sk_live_abc" }, el({ tag: "input", inputType: "text", label: "API key" }), "Fill in **API key**"],
  ["bullet placeholder value never leaks", { type: "type", value: "••••••" }, el({ tag: "input", inputType: "text", label: "Code" }), "Fill in **Code**"],
  ["card-number-shaped value never leaks", { type: "type", value: "4111111111111111" }, el({ tag: "input", inputType: "text", label: "Number" }), "Fill in **Number**"],
  ["masked without any target", { type: "type", value: "", masked: true }, undefined, "Fill in the highlighted field"],
  // select / check
  ["select with option text", { type: "select", value: "monthly", optionText: "Monthly" }, el({ tag: "select", label: "Billing period" }), "Select **Monthly** in **Billing period**"],
  ["select falls back to value", { type: "select", value: "CA" }, el({ tag: "select", label: "Country" }), "Select **CA** in **Country**"],
  ["select without label", { type: "select", value: "1", optionText: "Small" }, el({ tag: "select" }), "Select **Small** from the dropdown"],
  ["select with no option text", { type: "select", value: "" }, el({ tag: "select", label: "Country" }), "Choose an option in **Country**"],
  ["check", { type: "check", checked: true }, el({ tag: "input", inputType: "checkbox", label: "Send me invoices by email" }), "Check **Send me invoices by email**"],
  ["uncheck", { type: "check", checked: false }, el({ tag: "input", inputType: "checkbox", label: "Remember me" }), "Uncheck **Remember me**"],
  ["check unnamed", { type: "check", checked: true }, el({ tag: "input", inputType: "checkbox" }), "Check the checkbox"],
  ["radio", { type: "check", checked: true }, el({ tag: "input", inputType: "radio", label: "Annual" }), "Select **Annual**"],
  ["switch on", { type: "check", checked: true }, el({ tag: "button", role: "switch", name: "Notifications" }), "Turn on **Notifications**"],
  ["switch off", { type: "check", checked: false }, el({ tag: "button", role: "switch", name: "Notifications" }), "Turn off **Notifications**"],
  // press
  ["press Enter", { type: "press", key: "Enter" }, undefined, "Press **Enter**"],
  ["press Enter in a field", { type: "press", key: "Enter" }, el({ tag: "input", inputType: "text", label: "Title" }), "Press **Enter** in **Title**"],
  ["press Enter in search", { type: "press", key: "Enter" }, el({ tag: "input", inputType: "search", label: "Search" }), "Press **Enter** to search"],
  ["press shortcut", { type: "press", key: "Control+K" }, undefined, "Press **Ctrl+K**"],
  ["press shortcut with Meta", { type: "press", key: "Meta+Shift+P" }, undefined, "Press **Shift+Cmd+P**"],
  ["press Escape", { type: "press", key: "Escape" }, undefined, "Press **Esc**"],
  ["press arrow", { type: "press", key: "ArrowDown" }, el({ tag: "div", role: "menuitem", name: "Menu" }), "Press **Down Arrow** on **Menu**"],
  ["press space key", { type: "press", key: " " }, undefined, "Press **Space**"],
  ["press never echoes a character typed into a password", { type: "press", key: "a" }, el({ tag: "input", inputType: "password", label: "Password" }), "Press a key in **Password**"],
  // navigate
  ["navigate uses page title", { type: "navigate", url: "https://app.acme.test/settings" }, undefined, "Go to **Settings – Acme**", page("Settings – Acme")],
  ["navigate falls back to hostname", { type: "navigate", url: "https://www.docs.acme.test/a/b?c=1" }, undefined, "Go to **docs.acme.test**", page()],
  ["navigate with unparsable url", { type: "navigate", url: "not a url" }, undefined, "Go to **not a url**", { url: "also bad" }],
  ["navigate title is escaped", { type: "navigate", url: "https://x.test" }, undefined, "Go to **Q1 \\[draft\\] report**", page("Q1 [draft] report")],
  // scroll / hover / note
  ["scroll down", { type: "scroll", x: 0, y: 600 }, undefined, "Scroll down"],
  ["scroll up", { type: "scroll", x: 0, y: -200 }, undefined, "Scroll up"],
  ["scroll right", { type: "scroll", x: 300, y: 0 }, undefined, "Scroll right"],
  ["scroll nowhere", { type: "scroll", x: 0, y: 0 }, undefined, "Scroll the page"],
  ["hover", { type: "hover" }, el({ tag: "a", role: "link", name: "Products" }), "Hover over **Products**"],
  ["hover unnamed", { type: "hover" }, el({ tag: "div" }), "Hover over the highlighted area"],
  ["note", { type: "note" }, undefined, "Note"],
];

// Cases added for the acceptance spread (B-TITLES): long values, escaping, RTL/Unicode, non-http navigation.
CASES.push(
  ["long value 2", { type: "type", value: "x".repeat(120) }, el({ tag: "input", label: "Bio" }), `Type "${"x".repeat(49)}\u2026" in **Bio**`],
  ["quotes in a value", { type: "type", value: 'say "hi" to _them_' }, el({ tag: "input", label: "Greeting" }), 'Type "say \"hi\" to \\_them\\_" in **Greeting**'.replace(/\\"/g, '"')],
  ["Arabic button name", click, el({ tag: "button", role: "button", name: "\u062d\u0641\u0638" }), "Click **\u062d\u0641\u0638**"],
  ["Japanese field and value", { type: "type", value: "\u3053\u3093\u306b\u3061\u306f" }, el({ tag: "input", label: "\u540d\u524d" }), 'Type "\u3053\u3093\u306b\u3061\u306f" in **\u540d\u524d**'],
  ["navigate to a long URL without a title", { type: "navigate", url: `https://very-long-hostname.example.com/${"a".repeat(300)}?q=1` }, undefined, "Go to **very-long-hostname.example.com**", page()],
  ["navigate to about:blank", { type: "navigate", url: "about:blank" }, undefined, "Go to **about:blank**", { url: "about:blank" }],
  ["navigate to a chrome page with a title", { type: "navigate", url: "chrome://settings/" }, undefined, "Go to **Settings**", page("Settings", "chrome://settings/")],
  ["note with a target is still a note", { type: "note" }, button("Save"), "Note"],
  ["press Escape in a dialog", { type: "press", key: "Escape" }, undefined, "Press **Esc**"],
);

const tagsOf = (label: string, a: StepAction): string[] => {
  const tags: string[] = [a.type];
  if (/mask|password|never leaks/i.test(label) || (a.type === "type" && a.masked)) tags.push("masked");
  if (/long|truncated/i.test(label)) tags.push("long");
  if (/escap|quote|markdown/i.test(label)) tags.push("escaping");
  if (/arabic|japanese|unicode|rtl/i.test(label)) tags.push("unicode");
  if (/nameless|anonymous|no target|unnamed|symbol-only/i.test(label)) tags.push("no-name");
  return tags;
};

describe("generateStepTitle golden cases", () => {
  it("has at least 40 cases with the required spread", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    const count = (tag: string): number => CASES.filter(([label, a]) => tagsOf(label, a).includes(tag)).length;
    expect(count("click")).toBeGreaterThanOrEqual(10);
    expect(count("type")).toBeGreaterThanOrEqual(8);
    expect(CASES.filter(([, a]) => a.type === "type" && (a.masked || false)).length).toBeGreaterThanOrEqual(3);
    expect(count("long")).toBeGreaterThanOrEqual(2);
    expect(count("escaping")).toBeGreaterThanOrEqual(2);
    expect(count("select")).toBeGreaterThanOrEqual(4);
    expect(CASES.filter(([, a]) => a.type === "check" && a.checked).length).toBeGreaterThanOrEqual(2);
    expect(CASES.filter(([, a]) => a.type === "check" && !a.checked).length).toBeGreaterThanOrEqual(2);
    expect(count("press")).toBeGreaterThanOrEqual(4);
    expect(count("navigate")).toBeGreaterThanOrEqual(4);
    expect(count("note")).toBeGreaterThanOrEqual(2);
    expect(count("unicode")).toBeGreaterThanOrEqual(2);
    expect(count("no-name")).toBeGreaterThanOrEqual(3);
  });

  it.each(CASES)("%s", (_label, action, target, expected, p) => {
    expect(t(action, target, p ?? page())).toBe(expected);
  });

  it("the five BRIEF examples appear verbatim", () => {
    const outs = new Set(CASES.map(([, a, tg, , p]) => t(a, tg, p ?? page())));
    for (const ex of ["Click **Save**", 'Type "jane@example.com" in **Email**', "Select **Monthly** in **Billing period**", "Press **Enter**", "Go to **Settings \u2013 Acme**"]) expect(outs.has(ex), ex).toBe(true);
  });

  it("matches titles.golden.json (inputs and expected titles)", () => {
    const json = JSON.stringify(
      CASES.map(([name, action, target, expected, p]) => ({ name, tags: tagsOf(name, action), step: { action, ...(target ? { target } : {}), page: p ?? page() }, expected })),
      null,
      2,
    );
    expectGolden("titles.golden.json", json + "\n");
    const parsed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "golden/titles.golden.json"), "utf8")) as { step: Pick<Step, "action" | "target" | "page">; expected: string }[];
    for (const c of parsed) expect(generateStepTitle(c.step)).toBe(c.expected);
  });

  it("is deterministic: 60 repeated calls give byte-identical strings", () => {
    for (const [, a, tg, , p] of CASES) {
      const first = t(a, tg, p ?? page());
      for (let i = 0; i < 60; i++) expect(t(a, tg, p ?? page())).toBe(first);
    }
  });

  it("no title contains a newline or exceeds 160 characters", () => {
    for (const [, a, tg, , p] of CASES) {
      const title = t(a, tg, p ?? page());
      expect(title).not.toMatch(/[\r\n]/);
      expect(title.length).toBeLessThanOrEqual(160);
    }
  });
});

// ---- property tests ----------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NOISE = ["*", "_", "`", "[", "]", "<", "\\", "\n", "\r", "\t", "  ", "\u202e", "\u0000", '"', "'", "\u2028", "\u0645", "\u{1F600}"];

describe("titles: property tests (seeded)", () => {
  const rand = rng(20260928);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const word = (n: number): string => Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
  const junk = (max: number): string => {
    let out = "";
    const len = Math.floor(rand() * max);
    while (out.length < len) out += rand() < 0.3 ? pick(NOISE) : word(1 + Math.floor(rand() * 8)) + " ";
    return out;
  };

  it("masked or sensitive steps never contain the typed value (500 random steps)", () => {
    for (let i = 0; i < 500; i++) {
      const value = word(12);
      const variant = i % 5;
      const target = el({
        tag: "input",
        inputType: variant === 0 ? "password" : "text",
        role: variant === 3 ? "textbox" : undefined,
        label: junk(30) || "Field",
        name: rand() < 0.5 ? junk(30) : undefined,
        placeholder: rand() < 0.3 ? junk(20) : undefined,
        sensitive: variant === 1 || variant === 4 ? true : undefined,
      });
      const action: StepAction = { type: "type", value, ...(variant === 2 || variant === 3 ? { masked: true as const } : {}) };
      const sensitiveOnly = variant === 4 ? true : variant <= 3;
      expect(sensitiveOnly).toBe(true);
      const title = t(action, target, page(junk(40) || "Home"));
      expect(title.includes(value), `${JSON.stringify(title)} leaked ${value}`).toBe(false);
    }
  });

  it("random elements and actions: one line, at most 160 characters, balanced bold markers, no throw (2000 cases)", () => {
    const actions: (() => StepAction)[] = [
      () => ({ type: "click", ...(rand() < 0.2 ? { double: true } : {}), ...(rand() < 0.2 ? { button: pick(["left", "right", "middle"] as const) } : {}) }),
      () => ({ type: "type", value: junk(300) }),
      () => ({ type: "select", value: junk(80), ...(rand() < 0.5 ? { optionText: junk(200) } : {}) }),
      () => ({ type: "check", checked: rand() < 0.5 }),
      () => ({ type: "press", key: pick(["Enter", "Escape", " ", "Control+K", "Meta+Shift+P", "ArrowDown", "a", junk(20)]) }),
      () => ({ type: "scroll", x: Math.round((rand() - 0.5) * 800), y: Math.round((rand() - 0.5) * 800) }),
      () => ({ type: "hover" }),
      () => ({ type: "navigate", url: pick(["https://a.test/x", "about:blank", junk(400), "http://[bad"]) }),
      () => ({ type: "note" }),
    ];
    for (let i = 0; i < 2000; i++) {
      const target = rand() < 0.15 ? undefined : el({
        tag: pick(["button", "a", "input", "textarea", "select", "div", "li", "svg"]),
        role: rand() < 0.6 ? pick(["button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "menuitem", "tab", "option", "img", "slider", "generic"]) : undefined,
        inputType: rand() < 0.4 ? pick(["text", "email", "password", "checkbox", "radio", "search", "file", "range", "contenteditable"]) : undefined,
        name: rand() < 0.7 ? junk(150) : undefined,
        label: rand() < 0.4 ? junk(150) : undefined,
        text: rand() < 0.4 ? junk(150) : undefined,
        placeholder: rand() < 0.2 ? junk(80) : undefined,
      });
      const title = t(pick(actions)(), target, page(rand() < 0.6 ? junk(120) : undefined));
      expect(title, "single line").not.toMatch(/[\r\n]/);
      expect(title.length).toBeLessThanOrEqual(160);
      expect(title.length).toBeGreaterThan(0);
      // bold markers are balanced: an even number of unescaped **
      const unescaped = title.replace(/\\./g, "");
      expect((unescaped.match(/\*\*/g) ?? []).length % 2, JSON.stringify(title)).toBe(0);
    }
  });
});

describe("titles: expected-steps.json from the fixture site", () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/fixtures/flows/expected-steps.json");
  const exists = existsSync(file);
  it.skipIf(!exists)("every expected title equals generateStepTitle on the matching descriptor", () => {
    const e = JSON.parse(readFileSync(file, "utf8")) as { steps: { flowStep: string; title: string; action: Record<string, unknown>; target: ElementDescriptor; page: { path: string; title: string } }[] };
    expect(e.steps).toHaveLength(10);
    for (const es of e.steps) {
      const action = (es.action.masked ? { ...es.action, value: "" } : es.action) as StepAction;
      const target = { ...es.target, locators: [{ kind: "css" as const, value: "x" }] };
      expect(generateStepTitle({ action, target, page: { url: `http://127.0.0.1:4517${es.page.path}`, title: es.page.title } }), es.flowStep).toBe(es.title);
    }
  });
  it("the sample-11 guide's stored titles are what generateStepTitle produces", () => {
    for (const s of sample11Guide().steps) expect(generateStepTitle(s), s.id).toBe(s.title);
  });
});

describe("secrets never leak", () => {
  const secrets = ["hunter2", "P@ssw0rd!", "4242 4242 4242 4242", "sk_live_abcdef"];
  const targets: (ElementDescriptor | undefined)[] = [
    el({ tag: "input", inputType: "password", label: "Password" }),
    el({ tag: "input", inputType: "text", label: "Anything", sensitive: true }),
    el({ tag: "input", inputType: "text", label: "Card number" }),
    undefined,
  ];
  for (const s of secrets) {
    for (const [i, target] of targets.entries()) {
      it(`type ${JSON.stringify(s)} on target #${i} (masked flag set)`, () => {
        expect(t({ type: "type", value: s, masked: true }, target)).not.toContain(s);
      });
      if (target) {
        it(`type ${JSON.stringify(s)} on target #${i} (masked flag forgotten)`, () => {
          expect(t({ type: "type", value: s }, target)).not.toContain(s);
        });
      }
    }
  }
  it("select on a sensitive control hides the chosen option", () => {
    expect(t({ type: "select", value: "secret-a", optionText: "Secret A" }, el({ tag: "select", label: "Vault", sensitive: true }))).not.toContain("Secret A");
  });
});

describe("formatKey", () => {
  it.each([
    ["Enter", "Enter"],
    ["Control+Shift+K", "Ctrl+Shift+K"],
    ["Shift+Control+k", "Ctrl+Shift+K"],
    ["Control++", "Ctrl++"],
    ["ControlOrMeta+S", "Ctrl/Cmd+S"],
    ["F5", "F5"],
    ["PageDown", "Page Down"],
  ])("%s -> %s", (input, out) => expect(formatKey(input)).toBe(out));
});

describe("regenerateTitles", () => {
  const base = (id: string, action: StepAction, target: ElementDescriptor | undefined, title: string, extra: Partial<Step> = {}): Step => ({
    id,
    action,
    target,
    title,
    page: page("Home"),
    timestamp: "2026-09-28T10:00:00Z",
    ...extra,
  });
  const guide: Guide = {
    schemaVersion: 1,
    id: "g",
    title: "T",
    createdAt: "2026-09-28T10:00:00Z",
    updatedAt: "2026-09-28T10:00:00Z",
    steps: [
      base("a", click, button("Save"), "stale"),
      base("b", click, button("Save"), "My custom title", { titleEdited: true }),
      base("c", { type: "note" }, undefined, "Remember to breathe"),
    ],
  };
  it("regenerates stale titles, keeps edited titles and note titles", () => {
    const out = regenerateTitles(guide);
    expect(out.steps.map((s) => s.title)).toEqual(["Click **Save**", "My custom title", "Remember to breathe"]);
  });
  it("leaves all 5 titleEdited steps untouched and rewrites the others", () => {
    const g = sample11Guide();
    const edited = new Set(["s01", "s03", "s05", "s07", "s09"]);
    const mangled: Guide = { ...g, steps: g.steps.map((s) => ({ ...s, title: `STALE ${s.id}`, ...(edited.has(s.id) ? { titleEdited: true } : {}) })) };
    const out = regenerateTitles(mangled);
    for (const s of out.steps) {
      if (edited.has(s.id)) expect(s.title).toBe(`STALE ${s.id}`);
      else expect(s.title).toBe(generateStepTitle(s));
    }
  });
  it("does not mutate the input", () => {
    const before = JSON.stringify(guide);
    regenerateTitles(guide);
    expect(JSON.stringify(guide)).toBe(before);
  });
  it("is idempotent", () => {
    const once = regenerateTitles(guide);
    expect(regenerateTitles(once)).toEqual(once);
  });
});
