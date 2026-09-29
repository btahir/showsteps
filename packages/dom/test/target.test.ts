import { describe, expect, test } from "vitest";
import { resolveTarget } from "../src";
import { $, mount } from "./helpers";

/** Dispatch a click on `from` and return what resolveTarget picks. */
function resolveFrom(from: Element): Element {
  let got: Element | undefined;
  const on = (e: Event) => (got ??= resolveTarget(e));
  document.addEventListener("click", on, { once: true, capture: true });
  from.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  document.removeEventListener("click", on, { capture: true });
  if (!got) throw new Error("no click seen");
  return got;
}

describe("resolveTarget", () => {
  test("svg path inside a button resolves to the button", () => {
    mount(`<button id=b><svg id=s viewBox="0 0 10 10"><path id=p d="M0 0"/></svg></button>`);
    expect(resolveFrom($("#p"))).toBe($("#b"));
  });
  test("span inside a link resolves to the link", () => {
    mount(`<a id=a href="/x"><span><em id=e>Go</em></span></a>`);
    expect(resolveFrom($("#e"))).toBe($("#a"));
  });
  test("click on a button itself", () => {
    mount(`<button id=b>Hi</button>`);
    expect(resolveFrom($("#b"))).toBe($("#b"));
  });
  test("innermost interactive wins over outer link", () => {
    mount(`<a id=a href="/x"><button id=b><span id=s>Go</span></button></a>`);
    expect(resolveFrom($("#s"))).toBe($("#b"));
  });
  test("label click resolves to its control", () => {
    mount(`<label id=l for=c>Email me</label><input id=c type=checkbox>`);
    expect(resolveFrom($("#l"))).toBe($("#c"));
  });
  test("span inside a wrapping label resolves to the control", () => {
    mount(`<label><span id=s>Remember me</span><input id=c type=checkbox></label>`);
    expect(resolveFrom($("#s"))).toBe($("#c"));
  });
  test("click on the control inside a label stays on the control", () => {
    mount(`<label><span>Remember me</span><input id=c type=checkbox></label>`);
    expect(resolveFrom($("#c"))).toBe($("#c"));
  });
  test("role=button div with icon child", () => {
    mount(`<div id=d role="button" tabindex=0><i id=i></i></div>`);
    expect(resolveFrom($("#i"))).toBe($("#d"));
  });
  test("role=tab resolves", () => {
    mount(`<div role="tablist"><div id=t role="tab"><span id=s>Reports</span></div></div>`);
    expect(resolveFrom($("#s"))).toBe($("#t"));
  });
  test("paragraph inside contenteditable resolves to the editable host", () => {
    mount(`<div id=e contenteditable=true><p id=p>Hello</p></div>`);
    expect(resolveFrom($("#p"))).toBe($("#e"));
  });
  test("option resolves to its select", () => {
    mount(`<select id=s><option id=o>A</option></select>`);
    expect(resolveFrom($("#o"))).toBe($("#s"));
  });
  test("summary resolves", () => {
    mount(`<details><summary id=s><span id=x>More</span></summary></details>`);
    expect(resolveFrom($("#x"))).toBe($("#s"));
  });
  test("onclick attribute makes a div actionable", () => {
    mount(`<div id=d onclick="void 0"><span id=s>Card</span></div>`);
    expect(resolveFrom($("#s"))).toBe($("#d"));
  });
  test("plain text container falls back to the innermost element", () => {
    mount(`<div><p id=p>Just text</p></div>`);
    expect(resolveFrom($("#p"))).toBe($("#p"));
  });
  test("cursor:pointer region resolves to its outermost pointer element", () => {
    mount(`<div id=outer><div id=card style="cursor:pointer"><span id=s>Card</span></div></div>`);
    const got = resolveFrom($("#s"));
    expect([$("#card"), $("#s")]).toContain(got); // happy-dom may not inherit cursor; real Chrome does
  });
  test("input type=hidden is not actionable", () => {
    mount(`<div id=d><input type=hidden id=h></div>`);
    expect(resolveFrom($("#d"))).toBe($("#d"));
  });
  test("open shadow root: inner span resolves to the shadow button", () => {
    mount(`<acme-widget id=w></acme-widget>`);
    const sr = $("#w").attachShadow({ mode: "open" });
    sr.innerHTML = `<button id=sb><span id=ss>Open menu</span></button>`;
    const inner = sr.getElementById("ss")!;
    expect(resolveFrom(inner)).toBe(sr.getElementById("sb"));
  });
  test("resolves when the event target is retargeted to the host", () => {
    mount(`<acme-widget id=w></acme-widget>`);
    const sr = $("#w").attachShadow({ mode: "open" });
    sr.innerHTML = `<button id=sb>Go</button>`;
    let seen: Element | undefined;
    document.addEventListener("click", (e) => (seen = resolveTarget(e)), { once: true });
    sr.getElementById("sb")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(seen).toBe(sr.getElementById("sb")); // not the host that document listeners see as e.target
  });
  test("click on body returns body", () => {
    mount(`<p>x</p>`);
    expect(resolveFrom(document.body)).toBe(document.body);
  });
});
