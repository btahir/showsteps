// In-page recorder. Injected into the tabs of the recording window (registered content
// script for new pages, scripting.executeScript for pages already open). Listens in the
// capture phase, asks the worker for a screenshot *before* the page reacts (pointerdown,
// keydown), and reports one draft per step. It never stores or sends the value of a
// sensitive field.

import { describeElement, isSensitive, pageMetrics, rectOf, resolveTarget, sensitiveRects as domSensitiveRects } from "@stepsnap/dom";
import type { ElementDescriptor, Rect, StepAction } from "@stepsnap/core";
import { TypingTracker } from "../lib/typing";
import { sameOriginFrames, scanSensitive } from "../lib/sensitive-scan";
import type { RecorderMessage, WorkerToTab, HelloReply } from "../lib/messages";
import type { StepDraft } from "../lib/steps";

interface FieldMeta {
  el: Element;
}

interface PendingPointer {
  el: Element;
  captureId: string;
  target: ElementDescriptor;
  rect: Rect;
  metrics: StepDraft["metrics"];
  sensitiveRects: Rect[];
  page: { url: string; title?: string };
  at: number;
}

declare global {
  interface Window {
    __stepsnapRecorder?: { sync(): void };
  }
}

export default defineUnlistedScript(() => {
  if (window.top !== window) return;
  if (window.__stepsnapRecorder) {
    window.__stepsnapRecorder.sync();
    return;
  }

  let recording = false;
  let captureSeq = 0;
  let pending: PendingPointer | undefined;
  /** Capture id to use for typing commits triggered synchronously by the current event. */
  let commitCapture: string | undefined;
  let suppressKeyboardClickUntil = 0;
  const focusValues = new WeakMap<Element, string>();
  const fieldKeys = new WeakMap<Element, string>();
  let fieldSeq = 0;

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  function send(msg: RecorderMessage): void {
    if (!alive()) return;
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  function requestCapture(): string {
    const captureId = `c${Date.now().toString(36)}_${(captureSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    send({ type: "rec:capture", captureId });
    return captureId;
  }

  const page = () => ({ url: location.href, title: document.title || undefined });

  function metrics(): StepDraft["metrics"] {
    const m = pageMetrics(window);
    return { devicePixelRatio: m.devicePixelRatio, viewport: m.viewport };
  }

  /** Open or closed shadow root of `el` (content scripts may open closed roots). */
  function shadowRootOf(el: Element): ShadowRoot | null {
    try {
      const api = (chrome as unknown as { dom?: { openOrClosedShadowRoot?(e: Element): ShadowRoot | null } }).dom;
      return api?.openOrClosedShadowRoot ? api.openOrClosedShadowRoot(el) ?? null : el.shadowRoot;
    } catch {
      return el.shadowRoot;
    }
  }

  /** Every sensitive form field currently on screen (shadow DOM and same-origin frames included), in viewport CSS px. */
  function sensitiveRects(): Rect[] {
    let fromDom: Rect[] = [];
    try {
      fromDom = domSensitiveRects(document, { pad: 2 });
    } catch {
      /* fall back to our own scan below */
    }
    // Our scan adds closed shadow roots and payment/sign-in widgets in cross-origin frames.
    return [...fromDom, ...scanSensitive(document, {
      isSensitive,
      rectOf: (el) => rectOf(el),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      shadowRootOf,
    })];
  }

  function describe(el: Element): ElementDescriptor {
    try {
      return describeElement(el);
    } catch {
      return { tag: el.localName, locators: [{ kind: "css", value: el.localName }] };
    }
  }

  function draftFor(action: StepAction, el: Element | undefined, captureId: string | undefined, snap?: PendingPointer) {
    const draft: RecorderMessage & { type: "rec:step" } = {
      type: "rec:step",
      captureId,
      draft: {
        action,
        page: snap?.page ?? page(),
        at: new Date().toISOString(),
        metrics: snap?.metrics ?? metrics(),
        sensitiveRects: snap?.sensitiveRects ?? sensitiveRects(),
      },
    };
    if (el) {
      draft.draft.target = snap?.target ?? describe(el);
      draft.draft.rect = snap?.rect ?? rectOf(el);
    }
    return draft;
  }

  function emit(action: StepAction, el: Element | undefined, captureId: string | undefined, snap?: PendingPointer): void {
    if (!recording) return;
    send(draftFor(action, el, captureId, snap));
  }

  // ---- typing -------------------------------------------------------------------------------

  const tracker = new TypingTracker<FieldMeta>((entry) => {
    const captureId = commitCapture ?? requestCapture();
    const action: StepAction = entry.masked ? { type: "type", value: "", masked: true } : { type: "type", value: entry.value };
    emit(action, entry.meta.el, captureId);
  }, 1500);

  function keyOf(el: Element): string {
    let k = fieldKeys.get(el);
    if (!k) {
      k = `f${fieldSeq++}`;
      fieldKeys.set(el, k);
    }
    return k;
  }

  function flushTyping(captureId?: string, key?: string): void {
    commitCapture = captureId;
    try {
      tracker.flush(key);
    } finally {
      commitCapture = undefined;
    }
  }

  const TEXT_INPUT_TYPES = new Set(["", "text", "email", "password", "search", "tel", "url", "number", "date", "datetime-local", "month", "time", "week"]);

  // Tag-name checks instead of instanceof: elements of same-origin iframes come from another realm.
  const tagIs = (el: Element | null | undefined, tag: string) => !!el && el.localName === tag;
  const isEditableEl = (el: Element) => !!(el as HTMLElement).isContentEditable;

  function isTextField(el: Element): boolean {
    if (tagIs(el, "textarea")) return true;
    if (tagIs(el, "input")) return TEXT_INPUT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase());
    if (isEditableEl(el)) return true;
    return el.getAttribute("role") === "textbox";
  }

  function valueOf(el: Element): string {
    if (tagIs(el, "input") || tagIs(el, "textarea")) return (el as HTMLInputElement).value;
    return (el as HTMLElement).innerText ?? el.textContent ?? "";
  }

  function isToggle(el: Element): boolean {
    if (!tagIs(el, "input")) return false;
    const t = (el as HTMLInputElement).type;
    return t === "checkbox" || t === "radio";
  }

  const isEl = (n: unknown): n is Element => !!n && (n as Node).nodeType === 1;

  /** The deepest real element an event came from (inside open shadow roots too). */
  function origin(e: Event): Element | null {
    for (const n of e.composedPath()) if (isEl(n)) return n;
    return isEl(e.target) ? e.target : null;
  }

  /** Editable host for an input event target (contenteditable children bubble up to the host). */
  function fieldOf(el: Element): Element | null {
    if (tagIs(el, "input") || tagIs(el, "textarea") || tagIs(el, "select")) return el;
    let cur: Element | null = el;
    let host: Element | null = null;
    while (cur && isEditableEl(cur)) {
      host = cur;
      cur = cur.parentElement;
    }
    return host ?? (el.getAttribute("role") === "textbox" ? el : null);
  }

  function safeTarget(e: Event): Element | null {
    try {
      return resolveTarget(e);
    } catch {
      return origin(e);
    }
  }

  const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);

  // ---- listeners ----------------------------------------------------------------------------

  const opts = { capture: true, passive: true } as const;
  const handlers: [string, (e: any) => void][] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    handlers.push([type, fn]);
  };

  on(
    "pointerdown",
    (e) => {
      if (!recording || !e.isTrusted || e.button !== 0) return;
      const el = safeTarget(e);
      if (!el) return;
      const captureId = requestCapture();
      const field = tracker.pendingKey;
      // A click anywhere but the field being typed in ends that field's step; both share the frame.
      if (field !== undefined && !(isTextField(el) && keyOf(el) === field)) flushTyping(captureId);
      pending = {
        el,
        captureId,
        target: describe(el),
        rect: rectOf(el),
        metrics: metrics(),
        sensitiveRects: sensitiveRects(),
        page: page(),
        at: Date.now(),
      };
    },
  );

  on(
    "click",
    (e) => {
      if (!recording || !e.isTrusted) return;
      const el = safeTarget(e);
      if (!el) return;
      const now = Date.now();
      // Enter in a form field fires a synthetic click on the submit button; "Press Enter" already covers it.
      if (e.detail === 0 && now < suppressKeyboardClickUntil) return;
      // Toggles and selects are recorded from their change event; text fields from typing.
      if (isToggle(el) || tagIs(el, "select") || tagIs(el, "option") || isTextField(el)) return;
      const snap = pending && now - pending.at < 5000 && related(pending.el, el) ? pending : undefined;
      pending = undefined;
      const captureId = snap?.captureId ?? requestCapture();
      if (!snap) flushTyping(captureId);
      const action: StepAction = e.button === 1 ? { type: "click", button: "middle" } : { type: "click" };
      emit(action, el, captureId, snap);
    },
  );

  on(
    "contextmenu",
    (e) => {
      if (!recording || !e.isTrusted) return;
      const el = safeTarget(e);
      if (!el) return;
      const captureId = requestCapture();
      flushTyping(captureId);
      emit({ type: "click", button: "right" }, el, captureId);
    },
  );

  on(
    "focusin",
    (e) => {
      const el = origin(e);
      const field = el && fieldOf(el);
      if (field && isTextField(field)) focusValues.set(field, isSensitive(field) ? "" : valueOf(field));
    },
  );

  on(
    "input",
    (e) => {
      if (!recording || !e.isTrusted) return;
      const o = origin(e);
      const el = o && fieldOf(o);
      if (!el || !isTextField(el)) return;
      const sensitive = isSensitive(el);
      tracker.input(keyOf(el), sensitive ? "" : valueOf(el), {
        sensitive,
        now: Date.now(),
        startValue: focusValues.get(el) ?? "",
        meta: { el },
      });
    },
  );

  on(
    "change",
    (e) => {
      if (!recording || !e.isTrusted) return;
      const o = origin(e);
      if (!o) return;
      const now = Date.now();
      const snapFor = (el: Element) => {
        if (!pending || now - pending.at > 10_000) return undefined;
        const label = tagIs(pending.el, "label") ? (pending.el as HTMLLabelElement).control : null;
        return related(pending.el, el) || label === el ? pending : undefined;
      };
      if (isToggle(o)) {
        const snap = snapFor(o);
        pending = undefined;
        const captureId = snap?.captureId ?? requestCapture();
        if (!snap) flushTyping(captureId);
        emit({ type: "check", checked: (o as HTMLInputElement).checked }, o, captureId, snap && { ...snap, target: describe(o), rect: rectOf(o) });
        return;
      }
      if (tagIs(o, "select")) {
        const sel = o as HTMLSelectElement;
        const snap = snapFor(o);
        pending = undefined;
        const captureId = snap?.captureId ?? requestCapture();
        flushTyping(captureId);
        const opt = sel.selectedOptions[0];
        const action: StepAction = isSensitive(sel)
          ? { type: "select", value: "" }
          : { type: "select", value: sel.value, optionText: opt?.text.trim() || undefined };
        emit(action, o, captureId, snap && { ...snap, target: describe(o), rect: rectOf(o) });
        return;
      }
      const field = fieldOf(o);
      if (field && isTextField(field)) flushTyping(requestCapture(), keyOf(field));
    },
  );

  function comboOf(e: KeyboardEvent): string {
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Meta");
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return [...mods, key].join("+");
  }

  const EDIT_KEYS = new Set(["a", "c", "v", "x", "z", "y"]);
  const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "Fn", "AltGraph"]);

  on(
    "keydown",
    (e) => {
      if (!recording || !e.isTrusted || e.isComposing || MODIFIER_KEYS.has(e.key)) return;
      const o = origin(e);
      const field = o ? fieldOf(o) : null;
      const inText = !!field && isTextField(field);
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;

      let key: string | undefined;
      if (e.key === "Enter") {
        if (tagIs(field, "textarea") && !hasMod) return; // newline
        if (!inText && !hasMod) return; // Enter on a button/link: its click is recorded
        key = comboOf(e);
        suppressKeyboardClickUntil = Date.now() + 600;
      } else if (e.key === "Escape") {
        key = comboOf(e);
      } else if (hasMod) {
        if (inText && (e.ctrlKey || e.metaKey) && EDIT_KEYS.has(e.key.toLowerCase())) return; // copy/paste/undo while typing
        key = comboOf(e);
      }
      if (!key) return;
      const captureId = requestCapture();
      flushTyping(captureId);
      const el = o && !tagIs(o, "body") && !tagIs(o, "html") ? (field ?? o) : undefined;
      emit({ type: "press", key }, el, captureId);
    },
  );

  on(
    "focusout",
    (e) => {
      if (!recording) return;
      const o = origin(e);
      const field = o && fieldOf(o);
      if (field && tracker.pendingKey === keyOf(field)) flushTyping(undefined, keyOf(field));
    },
  );

  on("submit", () => recording && flushTyping());
  on("pagehide", () => recording && flushTyping());

  // Attach to the top window and every same-origin iframe (their events do not reach us otherwise).
  const attached = new WeakSet<Document>();
  function attach(doc: Document): void {
    if (attached.has(doc)) return;
    attached.add(doc);
    const target = doc.defaultView ?? doc;
    for (const [type, fn] of handlers) target.addEventListener(type, fn as EventListener, opts);
    // Frames that load (or navigate) later get attached when their load event reaches us.
    doc.addEventListener("load", (e) => { if (isEl(e.target) && (e.target.localName === "iframe" || e.target.localName === "frame")) attachFrames(); }, true);
  }
  function attachFrames(): void {
    for (const d of sameOriginFrames(document, shadowRootOf)) attach(d);
  }
  attach(document);
  attachFrames();

  // ---- worker link --------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg: WorkerToTab, _sender, reply) => {
    if (msg.type === "tab:state") {
      if (!msg.recording && recording) flushTyping();
      recording = msg.recording;
      if (!recording) pending = undefined;
      reply({ ok: true });
    } else if (msg.type === "tab:flush") {
      flushTyping();
      reply({ ok: true });
    }
    return false;
  });

  function sync(): void {
    if (!alive()) return;
    chrome.runtime
      .sendMessage({ type: "rec:hello" } satisfies RecorderMessage)
      .then((r: HelloReply | undefined) => {
        recording = !!r?.recording;
      })
      .catch(() => {});
  }

  window.__stepsnapRecorder = { sync };
  sync();
});
