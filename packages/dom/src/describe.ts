import type { ElementDescriptor } from "@showsteps/core";
import { accessibleName, getRole, labelText, visibleText } from "./aria";
import { buildLocators, frameChain, Scope, shadowChain } from "./locators";
import { isSensitive } from "./sensitive";
import { clip, rootOf } from "./util";

function isEditable(el: Element): boolean {
  const ce = el.getAttribute("contenteditable");
  return ce !== null && ce.toLowerCase() !== "false";
}

function hrefOf(el: Element): string | undefined {
  if (el.localName !== "a" && el.localName !== "area") return undefined;
  const raw = el.getAttribute("href");
  if (raw === null) return undefined;
  const direct = (el as HTMLAnchorElement).href;
  if (typeof direct === "string" && direct) return direct;
  try {
    return new URL(raw, el.ownerDocument.baseURI).href;
  } catch {
    return raw;
  }
}

/** Everything the guide needs to know about an element, computed in the page. */
export function describeElement(el: Element): ElementDescriptor {
  const tag = el.localName;
  const role = getRole(el);
  const label = labelText(el) || undefined;
  const sensitive = isSensitive(el, { labelText: label });
  const rawName = accessibleName(el);
  const name = clip(rawName) || undefined;

  const isField = tag === "input" || tag === "textarea" || tag === "select" || isEditable(el);
  let rawText = "";
  if (tag === "input") {
    const t = (el.getAttribute("type") ?? "text").toLowerCase();
    if (t === "button" || t === "submit" || t === "reset") rawText = el.getAttribute("value") ?? (t === "submit" ? "Submit" : t === "reset" ? "Reset" : "");
  } else if (!isField) {
    rawText = visibleText(el);
  }
  const text = sensitive ? undefined : clip(rawText) || undefined;
  const textFull = !text || text.length === rawText.trim().replace(/\s+/g, " ").length;

  const placeholder = clip(el.getAttribute("placeholder")) || undefined;
  const inputType = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : undefined;
  const href = hrefOf(el);

  const scope = new Scope(rootOf(el));
  const locators = buildLocators({ el, role, name, label, placeholder, text, textFull, sensitive }, scope);

  const d: ElementDescriptor = { tag, locators };
  if (role) d.role = role;
  if (name) d.name = name;
  if (label) d.label = label;
  if (text) d.text = text;
  if (placeholder) d.placeholder = placeholder;
  if (inputType) d.inputType = inputType;
  if (href) d.href = href;
  if (sensitive) d.sensitive = true;
  const frame = frameChain(el);
  if (frame) d.frame = frame;
  const shadow = shadowChain(el);
  if (shadow) d.shadow = shadow;
  // Property order is stable for golden files.
  return {
    tag: d.tag,
    ...(d.role ? { role: d.role } : {}),
    ...(d.name ? { name: d.name } : {}),
    ...(d.label ? { label: d.label } : {}),
    ...(d.text ? { text: d.text } : {}),
    ...(d.placeholder ? { placeholder: d.placeholder } : {}),
    ...(d.inputType ? { inputType: d.inputType } : {}),
    ...(d.href ? { href: d.href } : {}),
    ...(d.sensitive ? { sensitive: true } : {}),
    locators: d.locators,
    ...(d.frame ? { frame: d.frame } : {}),
    ...(d.shadow ? { shadow: d.shadow } : {}),
  };
}
