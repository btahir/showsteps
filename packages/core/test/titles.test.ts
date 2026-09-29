import { describe, expect, it } from "vitest";
import type { ElementDescriptor, Guide, Step, StepAction } from "../src";
import { formatKey, generateStepTitle, regenerateTitles } from "../src";

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

describe("generateStepTitle golden cases", () => {
  it("has at least 40 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });
  it.each(CASES)("%s", (_label, action, target, expected, p) => {
    expect(t(action, target, p ?? page())).toBe(expected);
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
