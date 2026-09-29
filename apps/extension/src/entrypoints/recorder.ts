// In-page recorder. Injected into every frame of the tabs in the recording window (registered
// content script for new pages, scripting.executeScript for pages already open). Only "root"
// frames record: the top frame and cross-origin frames; a root also listens inside its
// same-origin child frames. It listens in the capture phase, asks the worker for a screenshot
// *before* the page reacts (pointerdown, keydown), and reports one draft per step. It never
// stores or sends the value of a sensitive field, and it reports every sensitive field on
// screen (shadow DOM and frames included) so those pixels get redacted.

import { describeElement, isSensitive, pageMetrics, rectOf, resolveTarget, sensitiveRects as domSensitiveRects } from "@stepsnap/dom";
import type { ElementDescriptor, Rect, StepAction } from "@stepsnap/core";
import { TypingTracker } from "../lib/typing";
import { frameLooksSensitive, sameOriginFrames, scanSensitive } from "../lib/sensitive-scan";
import { ask, contentBox, isFrameMsg, isRootFrame, msgId, offsetInto, TAG } from "../lib/frames";
import type { FrameMsg } from "../lib/frames";
import type { HelloReply, RecorderMessage, ScanReply, WorkerToTab } from "../lib/messages";
import type { StepDraft } from "../lib/steps";

interface FieldMeta {
  el: Element;
  /** Frame taken shortly after the last keystroke, used when the commit has no fresher one. */
  captureId?: string;
}

/** Sensitive rects known now, plus those still being collected from cross-origin frames. */
interface SensitiveScan {
  local: Rect[];
  remote: Promise<Rect[]> | null;
}

interface PendingPointer {
  el: Element;
  captureId: string;
  target: ElementDescriptor;
  rect: Rect;
  metrics: NonNullable<StepDraft["metrics"]>;
  sensitive: SensitiveScan;
  page: { url: string; title?: string };
  at: number;
}

declare global {
  interface Window {
    __stepsnapRecorder?: { sync(): void };
  }
}

export default defineUnlistedScript(() => {
  // Same-origin child frames are handled by the root above them.
  if (!isRootFrame()) return;
  const isTop = window.top === window;
  const DEBUG = import.meta.env.MODE === "e2e";
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
  let typingShot: ReturnType<typeof setTimeout> | undefined;

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

  const newCaptureId = () => `c${Date.now().toString(36)}_${(captureSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  /** Captures of this document, newest last (the worker falls back to an earlier one). */
  const knownFrames: string[] = [];
  function remember(id: string): void {
    knownFrames.push(id);
    if (knownFrames.length > 4) knownFrames.shift();
  }

  function requestCapture(): string {
    const captureId = newCaptureId();
    send({ type: "rec:capture", captureId });
    remember(captureId);
    return captureId;
  }

  // ---- settled frame --------------------------------------------------------------------------
  // While the user is active, keep a screenshot of the page as it is *before* the next action:
  // after any change (DOM mutation, input, scroll, resize) and 250 ms of quiet, ask the worker
  // for a low-priority capture. A pointerdown uses it when nothing changed since it was asked
  // for (exact pre-action state, zero latency); otherwise it captures live.

  let lastDirtyAt = 0;
  let armedUntil = 0;
  let settled: { captureId: string; sentAt: number; sig: string; ok: boolean; done: boolean } | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function viewportSig(): string {
    const vv = window.visualViewport;
    return [scrollX, scrollY, innerWidth, innerHeight, devicePixelRatio, vv?.scale ?? 1, vv?.offsetLeft ?? 0, vv?.offsetTop ?? 0].map((n) => Math.round(n * 100)).join(",");
  }

  function scheduleSettle(): void {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleCheck, 260);
  }

  function markDirty(why?: string): void {
    if (DEBUG && why) console.debug(`[showsteps] dirty ${why}`);
    lastDirtyAt = Date.now();
    if (recording && isTop) scheduleSettle();
  }

  function arm(): void {
    const wasArmed = Date.now() < armedUntil;
    armedUntil = Date.now() + 5000;
    if (!wasArmed && recording && isTop) scheduleSettle();
  }

  function settleCheck(): void {
    const now = Date.now();
    if (DEBUG) console.debug(`[showsteps] check rec=${recording} hidden=${document.hidden} expired=${now > armedUntil} quietMs=${now - lastDirtyAt}`);
    if (!recording || !isTop || document.hidden || now > armedUntil) return;
    if (now - lastDirtyAt < 250) return scheduleSettle();
    // Already have (or are waiting for) a frame of this exact state.
    if (settled && (settled.ok || !settled.done) && settled.sentAt > lastDirtyAt && settled.sig === viewportSig()) return;
    const captureId = newCaptureId();
    const entry = { captureId, sentAt: now, sig: viewportSig(), ok: false, done: false };
    settled = entry;
    if (!alive()) return;
    chrome.runtime
      .sendMessage({ type: "rec:capture", captureId, settled: true } satisfies RecorderMessage)
      .then((r: { captured?: boolean } | undefined) => {
        entry.ok = !!r?.captured;
        entry.done = true;
        if (entry.ok) remember(entry.captureId);
        if (DEBUG) console.debug(`[showsteps] settled ok=${entry.ok}`);
        // Skipped (a real capture was busy): try again shortly while the user is still active.
        if (!entry.ok && settled === entry) setTimeout(scheduleSettle, 1100);
      })
      .catch(() => {});
  }

  /** The settled frame if the page has not changed since it was requested, else a live capture. */
  function preActionCapture(): string {
    if (isTop && settled?.ok && lastDirtyAt + 80 <= settled.sentAt && settled.sig === viewportSig()) return settled.captureId;
    return requestCapture();
  }

  const page = () => ({ url: location.href, title: document.title || undefined });

  function metrics(): NonNullable<StepDraft["metrics"]> {
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

  /**
   * Every sensitive field on screen, in this root's viewport CSS px: our document, open and
   * closed shadow roots, same-origin frames (via @stepsnap/dom and our own walk), and
   * cross-origin frames, whose recorders are asked over postMessage. A frame that does not
   * answer in time is blurred whole when it looks like a payment or sign-in widget.
   */
  function collectSensitive(): SensitiveScan {
    const local: Rect[] = [];
    try {
      local.push(...domSensitiveRects(document, { pad: 2 }));
    } catch {
      /* our own scan below still runs */
    }
    const opaque: Element[] = [];
    local.push(
      ...scanSensitive(document, {
        isSensitive,
        rectOf: (el) => rectOf(el),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        shadowRootOf,
        opaqueFrames: opaque,
      }),
    );
    const visible = opaque.filter((f) => {
      const r = rectOf(f);
      return r.width > 0 && r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight && r.x + r.width > 0 && r.y + r.height > 0;
    });
    if (!visible.length) return { local, remote: null };
    const remote = Promise.all(
      visible.map(async (f) => {
        const border = rectOf(f);
        const win = (f as HTMLIFrameElement).contentWindow;
        const reply = win ? await ask<Extract<FrameMsg, { kind: "scan-reply" }>>(win, { [TAG]: 1, kind: "scan", id: msgId() }, "scan-reply", 180) : undefined;
        if (reply) return offsetInto(reply.rects, contentBox(f, border));
        return frameLooksSensitive(f) ? [border] : [];
      }),
    ).then((all) => all.flat());
    return { local, remote };
  }

  async function allSensitive(scan: SensitiveScan): Promise<Rect[]> {
    return [...scan.local, ...(scan.remote ? await scan.remote : [])];
  }

  /** Where this root's viewport sits in the top-level viewport, and the top page's metrics. */
  async function offsetInTop(): Promise<{ x: number; y: number; metrics?: StepDraft["metrics"] }> {
    if (isTop) return { x: 0, y: 0, metrics: metrics() };
    const r = await ask<Extract<FrameMsg, { kind: "offset-reply" }>>(window.parent, { [TAG]: 1, kind: "offset", id: msgId() }, "offset-reply", 400);
    return r ? { x: r.x, y: r.y, metrics: r.metrics as StepDraft["metrics"] } : { x: 0, y: 0 };
  }

  /** Every frame element in the documents this root manages (its own and same-origin frames). */
  function frameElements(): Element[] {
    const docs = [document, ...sameOriginFrames(document, shadowRootOf)];
    const out: Element[] = [];
    for (const d of docs) {
      out.push(...Array.from(d.querySelectorAll("iframe, frame")));
      for (const el of Array.from(d.querySelectorAll("*"))) {
        const sr = shadowRootOf(el);
        if (sr) out.push(...Array.from(sr.querySelectorAll("iframe, frame")));
      }
    }
    return out;
  }

  /** Answers child frames (offset) and the parent frame (scan). */
  async function onFrameMessage(e: MessageEvent): Promise<void> {
    if (!isFrameMsg(e.data) || !e.source) return;
    const msg = e.data;
    const source = e.source as Window;
    if (msg.kind === "scan" && source === window.parent && !isTop) {
      const rects = await allSensitive(collectSensitive());
      source.postMessage({ [TAG]: 1, kind: "scan-reply", id: msg.id, rects } satisfies FrameMsg, "*");
    } else if (msg.kind === "offset") {
      const frame = frameElements().find((f) => (f as HTMLIFrameElement).contentWindow === source);
      if (!frame) return;
      const box = contentBox(frame, rectOf(frame));
      const mine = await offsetInTop();
      source.postMessage({ [TAG]: 1, kind: "offset-reply", id: msg.id, x: mine.x + box.x, y: mine.y + box.y, metrics: mine.metrics } satisfies FrameMsg, "*");
    }
  }

  function describe(el: Element): ElementDescriptor {
    try {
      return describeElement(el);
    } catch {
      return { tag: el.localName, locators: [{ kind: "css", value: el.localName }] };
    }
  }

  let chain: Promise<void> = Promise.resolve();
  let chainDepth = 0;

  function emit(action: StepAction, el: Element | undefined, captureId: string | undefined, snap?: PendingPointer): void {
    if (!recording) return;
    const draft: StepDraft = {
      action,
      page: snap?.page ?? page(),
      at: new Date().toISOString(),
      metrics: snap?.metrics ?? metrics(),
    };
    if (el) {
      draft.target = snap?.target ?? describe(el);
      draft.rect = snap?.rect ?? rectOf(el);
    }
    const scan = snap?.sensitive ?? collectSensitive();
    const fallbackCaptureId = knownFrames.filter((id) => id !== captureId).at(-1);
    // Fast path (the usual case): send synchronously, so a click that navigates away is not lost.
    if (isTop && !scan.remote && chainDepth === 0) {
      send({ type: "rec:step", captureId, fallbackCaptureId, draft: { ...draft, sensitiveRects: scan.local } });
      return;
    }
    chainDepth++;
    chain = chain
      .then(async () => {
        draft.sensitiveRects = await allSensitive(scan);
        if (!isTop) {
          const off = await offsetInTop();
          const shift = (r: Rect): Rect => ({ ...r, x: r.x + off.x, y: r.y + off.y });
          if (draft.rect) draft.rect = shift(draft.rect);
          draft.sensitiveRects = draft.sensitiveRects.map(shift);
          // Unknown metrics are filled in by the worker from the tab.
          draft.metrics = off.metrics;
        }
        send({ type: "rec:step", captureId, fallbackCaptureId, draft });
      })
      .catch(() => {})
      .finally(() => {
        chainDepth--;
      });
  }

  // ---- typing -------------------------------------------------------------------------------

  const tracker = new TypingTracker<FieldMeta>((entry) => {
    const captureId = commitCapture ?? entry.meta.captureId ?? requestCapture();
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
      const captureId = preActionCapture();
      queueMicrotask(markDirty);
      const field = tracker.pendingKey;
      // A click anywhere but the field being typed in ends that field's step; both share the frame.
      if (field !== undefined && !(isTextField(el) && keyOf(el) === field)) flushTyping(captureId);
      pending = {
        el,
        captureId,
        target: describe(el),
        rect: rectOf(el),
        metrics: metrics(),
        sensitive: collectSensitive(),
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
      const key = keyOf(el);
      tracker.input(key, sensitive ? "" : valueOf(el), {
        sensitive,
        now: Date.now(),
        startValue: focusValues.get(el) ?? "",
        meta: { el },
      });
      // Take the step's frame shortly after the last keystroke, while this tab is still in front
      // (the commit itself may come later, e.g. after switching tabs).
      clearTimeout(typingShot);
      typingShot = setTimeout(() => {
        if (recording && tracker.pendingKey === key) tracker.touch(key, { el, captureId: requestCapture() });
      }, 350);
    },
  );

  on(
    "change",
    (e) => {
      if (!recording) return;
      const o = origin(e);
      if (!o) return;
      // Native select popups (and automation such as Playwright's selectOption) report the
      // change through a synthetic event; everything else must come from the user.
      if (!e.isTrusted && !tagIs(o, "select")) return;
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
      const captureId = preActionCapture();
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
  // Leaving the tab or window ends the field being typed in (with the frame taken after the last key).
  on("blur", (e) => recording && (e.target as unknown) === window && flushTyping());
  document.addEventListener("visibilitychange", () => recording && document.hidden && flushTyping(), true);

  for (const t of ["pointermove", "wheel", "touchstart"] as const) on(t, () => recording && arm());
  for (const t of ["input", "change", "keydown", "scroll", "resize", "transitionend", "animationend"] as const) on(t, () => recording && markDirty(t));
  on("keydown", () => recording && arm());
  if (isTop) {
    new MutationObserver(() => recording && markDirty("mutation")).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  // Attach to the top window and every same-origin iframe (their events do not reach us otherwise).
  const attached = new WeakSet<Document>();
  function attach(doc: Document): void {
    if (attached.has(doc)) return;
    attached.add(doc);
    const target = doc.defaultView ?? doc;
    for (const [type, fn] of handlers) target.addEventListener(type, fn as EventListener, opts);
    target.addEventListener("message", (e) => void onFrameMessage(e as MessageEvent), true);
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
    } else if (msg.type === "tab:scan") {
      // For worker-side steps (navigations): what the top page looks like right now.
      if (!isTop) return false;
      void allSensitive(collectSensitive()).then((sensitiveRects) => reply({ metrics: metrics(), sensitiveRects } satisfies ScanReply));
      return true;
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
  // Back/forward cache restores keep this script alive; re-check the recording state.
  window.addEventListener("pageshow", (e) => e.persisted && sync());
});
