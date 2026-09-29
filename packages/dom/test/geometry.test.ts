import { afterEach, describe, expect, test } from "vitest";
import { pageMetrics, rectOf } from "../src";
import { $, mount } from "./helpers";

function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON() {} }) as DOMRect;
}

describe("rectOf", () => {
  const original = Object.getOwnPropertyDescriptor(window, "frameElement");
  afterEach(() => {
    if (original) Object.defineProperty(window, "frameElement", original);
    else delete (window as unknown as Record<string, unknown>).frameElement;
  });

  test("returns viewport coordinates as x/y/width/height", () => {
    mount(`<button id=b>Go</button>`);
    stubRect($("#b"), { left: 10.126, top: 20, width: 80, height: 32.004 });
    expect(rectOf($("#b"))).toEqual({ x: 10.13, y: 20, width: 80, height: 32 });
  });

  test("adds same-origin iframe offsets (including border)", () => {
    mount(`<button id=b>Go</button>`);
    stubRect($("#b"), { left: 5, top: 6, width: 10, height: 10 });
    const parentDoc = document.implementation.createHTMLDocument("p");
    const frame = parentDoc.createElement("iframe");
    stubRect(frame, { left: 100, top: 200, width: 500, height: 400 });
    Object.defineProperty(frame, "clientLeft", { value: 1 });
    Object.defineProperty(frame, "clientTop", { value: 2 });
    Object.defineProperty(window, "frameElement", { value: frame, configurable: true });
    expect(rectOf($("#b"))).toEqual({ x: 106, y: 208, width: 10, height: 10 });
    expect(rectOf($("#b"), { topLevel: false })).toEqual({ x: 5, y: 6, width: 10, height: 10 });
  });
});

describe("pageMetrics", () => {
  test("reports dpr, viewport and scroll", () => {
    Object.assign(window, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 340.4 });
    const m = pageMetrics(window);
    expect(m.devicePixelRatio).toBe(2);
    expect(m.viewport).toEqual({ width: 1280, height: 720, scrollX: 0, scrollY: 340 });
  });
  test("falls back to dpr 1", () => {
    Object.assign(window, { devicePixelRatio: 0 });
    expect(pageMetrics(window).devicePixelRatio).toBe(1);
  });
});
