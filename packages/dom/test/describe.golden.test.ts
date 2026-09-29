import { describe, expect, test } from "vitest";
import type { ElementDescriptor, Locator } from "@showsteps/core";
import { describeElement } from "../src";
import { $, mount } from "./helpers";

interface Case {
  name: string;
  html: string;
  target: string;
  /** Subset of the descriptor (toMatchObject). */
  expect: Partial<ElementDescriptor>;
  /** Exact leading locators. */
  locators?: Locator[];
  /** Keys that must be absent. */
  absent?: (keyof ElementDescriptor)[];
}

const cases: Case[] = [
  // ---- roles: explicit and implicit -------------------------------------------------------
  { name: "button implicit role", html: `<button id=b>Save</button>`, target: "#b", expect: { tag: "button", role: "button", name: "Save", text: "Save" } },
  { name: "link with href", html: `<a id=a href="/help">Help centre</a>`, target: "#a", expect: { role: "link", name: "Help centre", href: "http://localhost:3000/help" } },
  { name: "anchor without href has no role", html: `<a id=a>Plain</a>`, target: "#a", expect: { tag: "a", text: "Plain" }, absent: ["role", "name", "href"] },
  { name: "explicit role wins", html: `<div id=d role="button" tabindex=0>Go</div>`, target: "#d", expect: { role: "button", name: "Go" } },
  { name: "role list takes first known token", html: `<div id=d role="bogus tab">Overview</div>`, target: "#d", expect: { role: "tab", name: "Overview" } },
  { name: "role=presentation on div is generic", html: `<div id=d role="presentation">x</div>`, target: "#d", expect: { text: "x" }, absent: ["role"] },
  { name: "role=presentation ignored on focusable button", html: `<button id=b role="presentation">Ok</button>`, target: "#b", expect: { role: "button", name: "Ok" } },
  { name: "heading levels", html: `<h2 id=h>Billing</h2>`, target: "#h", expect: { role: "heading", name: "Billing" } },
  { name: "checkbox input", html: `<label><input id=c type=checkbox> Email me invoices</label>`, target: "#c", expect: { role: "checkbox", name: "Email me invoices", label: "Email me invoices", inputType: "checkbox" } },
  { name: "radio input", html: `<label><input id=r type=radio name=plan value=pro> Pro</label>`, target: "#r", expect: { role: "radio", name: "Pro", inputType: "radio" } },
  { name: "search input is searchbox", html: `<input id=s type=search aria-label="Find">`, target: "#s", expect: { role: "searchbox", name: "Find" } },
  { name: "text input with list is combobox", html: `<input id=s list=l aria-label="City"><datalist id=l></datalist>`, target: "#s", expect: { role: "combobox" } },
  { name: "number input is spinbutton", html: `<input id=n type=number aria-label="Qty">`, target: "#n", expect: { role: "spinbutton" } },
  { name: "range input is slider", html: `<input id=n type=range aria-label="Vol">`, target: "#n", expect: { role: "slider" } },
  { name: "password input has no role", html: `<input id=p type=password aria-label="Password">`, target: "#p", expect: { inputType: "password", sensitive: true }, absent: ["role"] },
  { name: "select is combobox", html: `<label for=s>Billing period</label><select id=s><option>Monthly<option>Yearly</select>`, target: "#s", expect: { role: "combobox", name: "Billing period", label: "Billing period" }, absent: ["text"] },
  { name: "multi select is listbox", html: `<select id=s multiple aria-label="Tags"></select>`, target: "#s", expect: { role: "listbox" } },
  { name: "textarea is textbox", html: `<label for=t>Notes</label><textarea id=t>secret notes here</textarea>`, target: "#t", expect: { role: "textbox", name: "Notes" }, absent: ["text"] },
  { name: "nav landmark", html: `<nav id=n aria-label="Main"><a href="/">Home</a></nav>`, target: "#n", expect: { role: "navigation", name: "Main" } },
  { name: "header inside article is not banner", html: `<article><header id=h>Hi</header></article>`, target: "#h", expect: { text: "Hi" }, absent: ["role"] },
  { name: "top-level header is banner", html: `<header id=h>Acme</header>`, target: "#h", expect: { role: "banner" } },
  { name: "section without name is not region", html: `<section id=s>x</section>`, target: "#s", expect: {}, absent: ["role"] },
  { name: "table cell", html: `<table><tr><td id=c>42</td></tr></table>`, target: "#c", expect: { role: "cell", name: "42" } },

  // ---- accessible names -------------------------------------------------------------------
  { name: "aria-label beats content", html: `<button id=b aria-label="Add book">+</button>`, target: "#b", expect: { name: "Add book", text: "+" } },
  { name: "aria-labelledby single", html: `<span id=t>Delete account</span><button id=b aria-labelledby=t>x</button>`, target: "#b", expect: { name: "Delete account" } },
  { name: "aria-labelledby multiple joins with space", html: `<span id=a>Remove</span><span id=b2>Jane</span><button id=b aria-labelledby="a b2">x</button>`, target: "#b", expect: { name: "Remove Jane" } },
  { name: "aria-labelledby beats aria-label", html: `<span id=t>From ref</span><button id=b aria-label="Own" aria-labelledby=t>x</button>`, target: "#b", expect: { name: "From ref" } },
  { name: "aria-labelledby to hidden element still counts", html: `<span id=t hidden>Hidden name</span><button id=b aria-labelledby=t>x</button>`, target: "#b", expect: { name: "Hidden name" } },
  { name: "label[for]", html: `<label for=e>Work email</label><input id=e type=email>`, target: "#e", expect: { name: "Work email", label: "Work email" } },
  { name: "wrapping label", html: `<label>Full name <input id=n></label>`, target: "#n", expect: { name: "Full name", label: "Full name" } },
  { name: "label with nested markup", html: `<label for=e>Email <span class=req>*</span></label><input id=e>`, target: "#e", expect: { name: "Email *", label: "Email *" } },
  { name: "img alt inside button", html: `<button id=b><img src="x.png" alt="Print"></button>`, target: "#b", expect: { name: "Print" } },
  { name: "svg title inside button", html: `<button id=b><svg><title>Close dialog</title><path d="M0 0"/></svg></button>`, target: "#b", expect: { name: "Close dialog" } },
  { name: "aria-hidden icon skipped in name", html: `<button id=b><svg aria-hidden="true"><title>icon</title></svg> Export</button>`, target: "#b", expect: { name: "Export", text: "Export" } },
  { name: "display:none child skipped", html: `<button id=b>Send<span style="display:none"> secretly</span></button>`, target: "#b", expect: { name: "Send", text: "Send" } },
  { name: "title fallback", html: `<button id=b title="Refresh"></button>`, target: "#b", expect: { name: "Refresh" } },
  { name: "placeholder as last-resort name", html: `<input id=i placeholder="Search help">`, target: "#i", expect: { name: "Search help", placeholder: "Search help" } },
  { name: "input type=submit uses value", html: `<input id=i type=submit value="Sign in">`, target: "#i", expect: { role: "button", name: "Sign in", text: "Sign in", inputType: "submit" } },
  { name: "input type=submit default name", html: `<input id=i type=submit>`, target: "#i", expect: { name: "Submit" } },
  { name: "whitespace collapsed", html: `<button id=b>  Save \n\t  changes  </button>`, target: "#b", expect: { name: "Save changes", text: "Save changes" } },
  { name: "name clipped at 80 chars", html: `<button id=b>${"word ".repeat(30)}</button>`, target: "#b", expect: { name: "word ".repeat(16).trim() } },
  { name: "inline children concatenate without spaces", html: `<button id=b>Up<b>grade</b></button>`, target: "#b", expect: { name: "Upgrade" } },
  { name: "block children get spaces", html: `<a id=a href="#"><div>Plan</div><div>Pro</div></a>`, target: "#a", expect: { name: "Plan Pro" } },
  { name: "fieldset legend names group", html: `<fieldset id=f><legend>Plan</legend></fieldset>`, target: "#f", expect: { role: "group", name: "Plan" } },
  { name: "contenteditable is not given text", html: `<div id=e contenteditable=true role=textbox aria-label="Signature">Kind regards</div>`, target: "#e", expect: { role: "textbox", name: "Signature" }, absent: ["text"] },

  // ---- href / placeholder / inputType -----------------------------------------------------
  { name: "relative href resolved", html: `<a id=a href="settings.html">Settings</a>`, target: "#a", expect: { href: "http://localhost:3000/settings.html" } },
  { name: "email inputType", html: `<input id=i type="EMAIL" aria-label="E">`, target: "#i", expect: { inputType: "email" } },
  { name: "input without type is text", html: `<input id=i aria-label="X">`, target: "#i", expect: { inputType: "text", role: "textbox" } },

  // ---- locators: order and uniqueness -----------------------------------------------------
  { name: "testid first", html: `<button id=b data-testid="save-settings">Save</button>`, target: "#b", expect: {}, locators: [{ kind: "testid", value: "save-settings" }, { kind: "role", role: "button", name: "Save" }, { kind: "text", value: "Save" }, { kind: "css", value: "#b" }] },
  { name: "duplicate testid is skipped", html: `<button id=a data-testid="row">One</button><button id=b data-testid="row">Two</button>`, target: "#a", expect: {}, locators: [{ kind: "role", role: "button", name: "One" }] },
  { name: "data-qa becomes attribute css, not testid", html: `<button id=b data-qa="pay">Pay</button>`, target: "#b", expect: {}, locators: [{ kind: "css", value: '[data-qa="pay"]' }, { kind: "role", role: "button", name: "Pay" }] },
  { name: "role locator skipped when name is a substring of a sibling", html: `<button id=a>Save</button><button id=b>Save as draft</button>`, target: "#a", expect: {}, locators: [{ kind: "text", value: "Save", exact: true }, { kind: "css", value: "#a" }] },
  { name: "longer name is still unique", html: `<button id=a>Save</button><button id=b>Save as draft</button>`, target: "#b", expect: {}, locators: [{ kind: "role", role: "button", name: "Save as draft" }] },
  { name: "hidden duplicate does not block role locator", html: `<button id=a>Menu</button><button style="display:none">Menu</button>`, target: "#a", expect: {}, locators: [{ kind: "role", role: "button", name: "Menu" }] },
  { name: "label locator for form control", html: `<label for=e>Email</label><input id=e><label for=p>Password</label><input id=p type=password>`, target: "#e", expect: {}, locators: [{ kind: "role", role: "textbox", name: "Email" }, { kind: "label", value: "Email" }] },
  { name: "placeholder locator when no label", html: `<input id=q placeholder="Search books"><input id=r placeholder="Other">`, target: "#q", expect: {}, locators: [{ kind: "role", role: "textbox", name: "Search books" }, { kind: "placeholder", value: "Search books" }] },
  { name: "text locator exact when substring not unique", html: `<a id=a href="#">Pro</a><a id=b href="#">Pro plan</a>`, target: "#a", expect: {}, locators: [{ kind: "text", value: "Pro", exact: true }, { kind: "css", value: "#a" }] },
  { name: "text locator for non-interactive element", html: `<p id=p>Total due: $34.00</p><p>Other</p>`, target: "#p", expect: { text: "Total due: $34.00" }, locators: [{ kind: "text", value: "Total due: $34.00" }, { kind: "css", value: "#p" }] },
  { name: "sensitive element gets no text locator", html: `<div id=d data-showsteps-sensitive>Card 4242</div>`, target: "#d", expect: { sensitive: true }, absent: ["text"] },
  { name: "unstable id skipped in css", html: `<button id=":r1:" class="btn">Go</button><button class="btn other">Stop</button>`, target: '[class="btn"]', expect: {}, locators: [{ kind: "role", role: "button", name: "Go" }] },
  { name: "css uses name attribute", html: `<input name=card aria-label="A"><input name=zip aria-label="A">`, target: "[name=zip]", expect: {}, locators: [{ kind: "css", value: 'input[name="zip"]' }] },
  { name: "css structural path when nothing distinguishes", html: `<ul><li><a href="#">x</a></li><li><a href="#">x</a></li></ul>`, target: "li:nth-child(2) a", expect: {}, locators: [{ kind: "css", value: "li:nth-of-type(2) > a" }] },
  { name: "xpath anchored on stable id", html: `<div id="panel"><div><span>a</span></div><div><span id="t">b</span></div></div>`, target: "#t", expect: {}, locators: [{ kind: "text", value: "b" }, { kind: "css", value: "#t" }, { kind: "xpath", value: '//*[@id="t"]' }] },
  { name: "xpath absolute when nothing stable", html: `<div><p>one</p><p class="x y z">two</p></div>`, target: "p.x", expect: {}, locators: [{ kind: "text", value: "two" }, { kind: "css", value: "p.x" }, { kind: "xpath", value: "/html/body/div/p[2]" }] },
];

describe("describeElement golden cases", () => {
  for (const c of cases) {
    test(c.name, () => {
      mount(c.html);
      const d = describeElement($(c.target));
      expect(d).toMatchObject(c.expect);
      for (const k of c.absent ?? []) expect(d).not.toHaveProperty(k);
      if (c.locators) expect(d.locators.slice(0, c.locators.length)).toEqual(c.locators);
      expect(d.locators.length).toBeGreaterThan(0);
      if (d.name) expect(d.name.length).toBeLessThanOrEqual(80);
      if (d.text) expect(d.text.length).toBeLessThanOrEqual(80);
    });
  }

  test("case count meets the bar", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
});
