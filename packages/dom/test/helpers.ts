import { describeElement } from "../src";

export function mount(html: string): void {
  document.body.innerHTML = html;
}

export function $(sel: string): Element {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no element for ${sel}`);
  return el;
}

export function describe$(sel: string) {
  return describeElement($(sel));
}
