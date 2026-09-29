import { describe, expect, test } from "vitest";
import { findSensitiveElements, sensitiveRects } from "../src";
import { $, mount } from "./helpers";

function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON() {} }) as DOMRect;
}

describe("findSensitiveElements", () => {
  test("finds password, card and marked elements but not ordinary fields", () => {
    mount(`<input id=email type=email><input id=pw type=password><input id=cc autocomplete="cc-number"><span id=m data-showsteps-sensitive>x</span><input id=q type=search>`);
    const ids = findSensitiveElements().map((e) => e.id).sort();
    expect(ids).toEqual(["cc", "m", "pw"]);
  });

  test("reaches into open shadow roots, including nested ones", () => {
    mount(`<acme-a id=a></acme-a>`);
    const sa = $("#a").attachShadow({ mode: "open" });
    sa.innerHTML = `<acme-b id=b></acme-b>`;
    const sb = sa.getElementById("b")!.attachShadow({ mode: "open" });
    sb.innerHTML = `<input id=deep type=password>`;
    expect(findSensitiveElements().map((e) => e.id)).toEqual(["deep"]);
  });

  test("honours an explicit opt-out", () => {
    mount(`<input id=pw type=password data-showsteps-sensitive="false">`);
    expect(findSensitiveElements()).toEqual([]);
  });

  test("flags payment iframes", () => {
    mount(`<iframe id=f src="https://js.stripe.com/v3/elements-inner-card.html"></iframe><iframe id=ok src="about:blank" title="Map"></iframe>`);
    expect(findSensitiveElements().map((e) => e.id)).toEqual(["f"]);
  });
});

describe("sensitiveRects", () => {
  test("returns viewport rects, skipping hidden and zero-size elements", () => {
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    mount(`<input id=a type=password><input id=b type=password style="display:none"><input id=c type=password>`);
    stubRect($("#a"), { left: 10, top: 20, width: 200, height: 30 });
    stubRect($("#b"), { left: 10, top: 60, width: 200, height: 30 });
    stubRect($("#c"), { left: 0, top: 0, width: 0, height: 0 });
    expect(sensitiveRects()).toEqual([{ x: 10, y: 20, width: 200, height: 30 }]);
  });

  test("clips to the viewport and drops rects fully outside", () => {
    Object.assign(window, { innerWidth: 500, innerHeight: 400 });
    mount(`<input id=a type=password><input id=b type=password>`);
    stubRect($("#a"), { left: 400, top: 380, width: 200, height: 100 });
    stubRect($("#b"), { left: 0, top: 900, width: 100, height: 20 });
    expect(sensitiveRects()).toEqual([{ x: 400, y: 380, width: 100, height: 20 }]);
    expect(sensitiveRects(document, { clip: false })).toHaveLength(2);
  });

  test("pad grows the rect", () => {
    Object.assign(window, { innerWidth: 500, innerHeight: 400 });
    mount(`<input id=a type=password>`);
    stubRect($("#a"), { left: 10, top: 10, width: 50, height: 20 });
    expect(sensitiveRects(document, { pad: 4 })).toEqual([{ x: 6, y: 6, width: 58, height: 28 }]);
  });
});
