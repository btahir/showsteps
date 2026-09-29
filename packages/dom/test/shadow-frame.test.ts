import { afterEach, describe, expect, test } from "vitest";
import { describeElement } from "../src";
import { $, mount } from "./helpers";

function host(id: string, inner: string, into: ParentNode = document.body): ShadowRoot {
  const h = document.createElement("acme-widget");
  h.id = id;
  into.appendChild(h);
  const sr = h.attachShadow({ mode: "open" });
  sr.innerHTML = inner;
  return sr;
}

describe("shadow DOM", () => {
  test("button inside shadow root carries the host chain", () => {
    mount("");
    const sr = host("w", `<button id=sb data-testid="menu">Open menu</button>`);
    const d = describeElement(sr.getElementById("sb")!);
    expect(d.shadow).toEqual(["acme-widget"]);
    expect(d.role).toBe("button");
    expect(d.name).toBe("Open menu");
    expect(d.locators[0]).toEqual({ kind: "testid", value: "menu" });
  });

  test("locators are unique within the shadow root even if the light DOM has a twin", () => {
    mount(`<button>Open menu</button>`);
    const sr = host("w", `<button id=sb>Open menu</button>`);
    const d = describeElement(sr.getElementById("sb")!);
    expect(d.locators[0]).toEqual({ kind: "role", role: "button", name: "Open menu" });
    expect(d.shadow).toEqual(["acme-widget"]);
  });

  test("light DOM element's role locator accounts for shadow content (Playwright pierces)", () => {
    mount(`<button id=light>Open menu</button>`);
    host("w", `<button>Open menu</button>`);
    const d = describeElement($("#light"));
    expect(d.locators.find((l) => l.kind === "role")).toBeUndefined();
    expect(d.locators[0]).toEqual({ kind: "css", value: "#light" });
    expect(d.shadow).toBeUndefined();
  });

  test("nested shadow roots give an outermost-first chain", () => {
    mount("");
    const outer = host("outer", `<div id=slot></div>`);
    const inner = document.createElement("acme-inner");
    inner.id = "inner";
    outer.getElementById("slot")!.appendChild(inner);
    const isr = inner.attachShadow({ mode: "open" });
    isr.innerHTML = `<button id=deep>Deep</button>`;
    const d = describeElement(isr.getElementById("deep")!);
    expect(d.shadow).toEqual(["acme-widget", "acme-inner"]);
  });

  test("two instances of a component get distinguishing host selectors", () => {
    mount("");
    const a = host("a", `<button id=x>Go</button>`);
    const b = host("b", `<button id=x>Go</button>`);
    const da = describeElement(a.getElementById("x")!);
    const db = describeElement(b.getElementById("x")!);
    expect(da.shadow).toEqual(["#a"]);
    expect(db.shadow).toEqual(["#b"]);
  });

  test("xpath is omitted inside shadow roots", () => {
    mount("");
    const sr = host("w", `<button id=sb>Go</button>`);
    const d = describeElement(sr.getElementById("sb")!);
    expect(d.locators.some((l) => l.kind === "xpath")).toBe(false);
    expect(d.locators.some((l) => l.kind === "css")).toBe(true);
  });

  test("aria-labelledby resolves within the shadow root", () => {
    mount(`<span id=t>Wrong</span>`);
    const sr = host("w", `<span id=t>Right</span><button id=b aria-labelledby=t>x</button>`);
    expect(describeElement(sr.getElementById("b")!).name).toBe("Right");
  });

  test("label[for] resolves within the shadow root", () => {
    mount("");
    const sr = host("w", `<label for=i>Coupon</label><input id=i>`);
    const d = describeElement(sr.getElementById("i")!);
    expect(d.label).toBe("Coupon");
  });
});

describe("frame chain", () => {
  const original = Object.getOwnPropertyDescriptor(window, "frameElement");
  afterEach(() => {
    if (original) Object.defineProperty(window, "frameElement", original);
    else delete (window as unknown as Record<string, unknown>).frameElement;
  });

  test("same-origin iframe selectors are reported outermost first", () => {
    mount(`<button id=b>Confirm</button>`);
    const parentDoc = document.implementation.createHTMLDocument("parent");
    const frame = parentDoc.createElement("iframe");
    frame.setAttribute("data-testid", "settings-frame");
    parentDoc.body.appendChild(frame);
    Object.defineProperty(window, "frameElement", { value: frame, configurable: true });
    const d = describeElement($("#b"));
    expect(d.frame).toEqual(['[data-testid="settings-frame"]']);
  });

  test("top frame has no frame chain", () => {
    mount(`<button id=b>Confirm</button>`);
    expect(describeElement($("#b")).frame).toBeUndefined();
  });

  test("iframe selector falls back to a structural css selector", () => {
    mount(`<button id=b>x</button>`);
    const parentDoc = document.implementation.createHTMLDocument("parent");
    parentDoc.body.innerHTML = `<iframe name="pay"></iframe><iframe></iframe>`;
    Object.defineProperty(window, "frameElement", { value: parentDoc.querySelector("iframe[name=pay]"), configurable: true });
    expect(describeElement($("#b")).frame).toEqual(['iframe[name="pay"]']);
  });
});
