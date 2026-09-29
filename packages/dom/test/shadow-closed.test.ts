// C5: shadow traversal. Open and nested open roots are covered in scan.test.ts and shadow-frame.test.ts;
// this file is the third case: a CLOSED root. A page script can hide a shadow root from `el.shadowRoot`, so
// this package (which only sees the DOM API) cannot look inside it. A content script can: the extension
// resolves roots with `chrome.dom.openOrClosedShadowRoot` and walks them itself (apps/extension/src/lib/
// sensitive-scan.ts, `shadowRootOf`). `findSensitiveElements` takes the same resolver so the case is testable here.
import { describe, expect, test } from "vitest";
import { findSensitiveElements } from "../src";
import { $, mount } from "./helpers";

function closedHost(id: string, inner: string, into: ParentNode = document.body): { host: Element; root: ShadowRoot } {
  const host = document.createElement("acme-vault");
  host.id = id;
  into.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = inner;
  return { host, root };
}

describe("closed shadow roots", () => {
  test("a closed root hides its host's shadowRoot; without a resolver its password field is NOT found (documented limit)", () => {
    mount("");
    const { host } = closedHost("v", `<input id=pin type=password>`);
    expect(host.shadowRoot).toBeNull();
    expect(findSensitiveElements()).toEqual([]);
  });

  test("with an injected openOrClosedShadowRoot (what the extension passes) the field inside is found", () => {
    mount("");
    const { host, root } = closedHost("v", `<input id=pin type=password><input id=name type=text>`);
    const roots = new Map<Element, ShadowRoot>([[host, root]]);
    const openOrClosedShadowRoot = (el: Element) => roots.get(el) ?? el.shadowRoot;
    expect(findSensitiveElements(document, { shadowRootOf: openOrClosedShadowRoot }).map((e) => e.id)).toEqual(["pin"]);
  });

  test("closed inside open inside closed: the resolver is used at every level", () => {
    mount("");
    const outer = closedHost("outer", `<div id=slot></div>`);
    const mid = document.createElement("acme-mid");
    mid.id = "mid";
    outer.root.getElementById("slot")!.appendChild(mid);
    const midRoot = mid.attachShadow({ mode: "open" });
    midRoot.innerHTML = `<div id=slot2></div>`;
    const inner = closedHost("inner", `<input id=deep autocomplete="cc-number">`, midRoot.getElementById("slot2")!);
    const roots = new Map<Element, ShadowRoot>([[outer.host, outer.root], [inner.host, inner.root]]);
    const resolver = (el: Element) => roots.get(el) ?? el.shadowRoot;
    expect(findSensitiveElements(document, { shadowRootOf: resolver }).map((e) => e.id)).toEqual(["deep"]);
    expect(findSensitiveElements()).toEqual([]);
  });

  test("the light DOM next to a closed root is scanned as usual", () => {
    mount(`<input id=top type=password>`);
    closedHost("v", `<input id=pin type=password>`);
    expect(findSensitiveElements().map((e) => e.id)).toEqual(["top"]);
    expect($("#top")).toBeTruthy();
  });
});
