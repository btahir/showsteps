// In-page recorder. Injected into every frame of the tabs in the recording window (registered
// content script for new pages, scripting.executeScript for pages already open). Only "root"
// frames record: the top frame and cross-origin frames; a root also listens inside its
// same-origin child frames. It listens in the capture phase, asks the worker for a screenshot
// *before* the page reacts (pointerdown, keydown), and reports one draft per step. It never
// stores or sends the value of a sensitive field, and it reports every sensitive field on
// screen (shadow DOM and frames included) so those pixels get redacted.

import { localIso } from "../lib/time";
import { describeElement, isSensitive, pageMetrics, rectOf, resolveTarget, sensitiveRects as domSensitiveRects } from "@stepsnap/dom";
import type { ElementDescriptor, Rect, StepAction, TabCorner } from "@stepsnap/core";
import { TypingTracker } from "../lib/typing";
import { RecBar } from "../lib/rec-bar";
import { pickCorner, tabCandidates, textRectsNear } from "../lib/tab-corner";
import { frameLooksSensitive, sameOriginFrames, scanSensitiveLabeled } from "../lib/sensitive-scan";
import { scanTextSecrets } from "../lib/text-scan";
import type { PatternOptions } from "../lib/text-patterns";
import { parseRedactPrefs, REDACT_PREFS_KEY } from "../lib/prefs";
import { ask, contentBox, isFrameMsg, isRootFrame, msgId, offsetInto, TAG } from "../lib/frames";
import type { FrameMsg } from "../lib/frames";
import type { ControlMessage, HelloReply, RecorderMessage, ScanReply, WorkerToTab } from "../lib/messages";
import type { StepDraft } from "../lib/steps";

interface FieldMeta {
  el: Element;
  key?: string;
  /** Frame taken shortly after the last keystroke, used when the commit has no fresher one. */
  captureId?: string;
}

/** What the redaction scan found: rects to blur, which text patterns matched, and whether it finished. */
interface ScanResult {
  rects: Rect[];
  /** Parallel to `rects` (may be shorter: missing entries have no label). */
  labels: (string | null)[];
  kinds: string[];
  incomplete: boolean;
}

/** Sensitive rects known now, plus those still being collected from cross-origin frames. */
interface SensitiveScan {
  local: ScanResult;
  remote: Promise<ScanResult> | null;
}

interface PendingPointer {
  el: Element;
  captureId: string;
  target: ElementDescriptor;
  rect: Rect;
  metrics: NonNullable<StepDraft["metrics"]>;
  sensitive: SensitiveScan;
  page: StepDraft["page"];
  corner?: TabCorner;
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

  function control(msg: ControlMessage): void {
    if (!alive()) return;
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  // The in-page recording bar (top frame only). Open shadow root in e2e builds so tests can drive it.
  const bar = isTop
    ? new RecBar(
        document,
        {
          pause: () => control({ type: "ctl:pause" }),
          resume: () => control({ type: "ctl:resume" }),
          stop: () => control({ type: "ctl:stop" }),
          discard: () => control({ type: "ctl:discard" }),
        },
        { open: DEBUG },
      )
    : undefined;

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
  /** Last change to content, layout or scroll (not just a CSS transition or animation ending). */
  let lastStructuralAt = 0;
  /** The newest settled frame that exists (a newer request may still be pending). */
  let goodSettled: { captureId: string; sentAt: number; sig: string } | undefined;
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
    if (why !== "transitionend" && why !== "animationend") lastStructuralAt = lastDirtyAt;
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
        if (entry.ok) {
          remember(entry.captureId);
          goodSettled = { captureId: entry.captureId, sentAt: entry.sentAt, sig: entry.sig };
        }
        if (DEBUG) console.debug(`[showsteps] settled ok=${entry.ok}`);
        // Skipped (a real capture was busy): try again shortly while the user is still active.
        if (!entry.ok && settled === entry) setTimeout(scheduleSettle, 1100);
      })
      .catch(() => {});
  }

  /** The settled frame if the page has not changed since it was requested, else a live capture. */
  function preActionCapture(): string {
    if (isTop && settled?.ok && lastDirtyAt + 80 <= settled.sentAt && settled.sig === viewportSig()) return settled.captureId;
    // A hover transition finishing does not make the frame from just before it wrong for a click:
    // keep that frame (the page before the action) rather than racing the click with a live capture.
    const g = goodSettled;
    if (isTop && g && lastStructuralAt + 80 <= g.sentAt && g.sig === viewportSig()) return g.captureId;
    return requestCapture();
  }

  const isRtl = () => {
    try {
      return (document.dir || getComputedStyle(document.documentElement).direction) === "rtl";
    } catch {
      return false;
    }
  };
  const page = (): StepDraft["page"] => ({ url: location.href, title: document.title || undefined, ...(isRtl() ? { dir: "rtl" as const } : {}) });

  /** The visible label of a checkbox, radio or switch (review R2-4: ring the control with its label). */
  function labelOf(el: Element): Element | undefined {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const role = el.getAttribute("role");
    if (!(tagIs(el, "input") && (type === "checkbox" || type === "radio")) && role !== "switch" && role !== "checkbox" && role !== "radio") return undefined;
    const ids = el.getAttribute("aria-labelledby");
    const byId = ids ? el.ownerDocument.getElementById(ids.split(/\s+/)[0]!) : null;
    const label = byId ?? (el as HTMLInputElement).labels?.[0] ?? null;
    const r = label?.getBoundingClientRect();
    return label && r && r.width > 0 && r.height > 0 ? label : undefined;
  }

  /** The highlight tab's corner with the least page text under it (undefined = the default is fine). */
  function cornerFor(el: Element, rect: Rect): TabCorner | undefined {
    if (el.ownerDocument !== document) return undefined;
    try {
      const cands = tabCandidates(rect, innerWidth);
      const text = textRectsNear(document, Object.values(cands), (e) => e.localName === "showsteps-recording-bar" || e === el || el.contains(e));
      return pickCorner(cands, text, { width: innerWidth, height: innerHeight }, isRtl());
    } catch {
      return undefined;
    }
  }

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
    const rects: Rect[] = [];
    const labels: (string | null)[] = [];
    const opaque: Element[] = [];
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // Our own walk first: it knows each field's name for the "Password blurred" chip.
    for (const r of scanSensitiveLabeled(document, { isSensitive, rectOf: (el) => rectOf(el), viewport, shadowRootOf, opaqueFrames: opaque })) {
      rects.push(r.rect);
      labels.push(r.label ?? null);
    }
    try {
      // @stepsnap/dom's scan as a second opinion (duplicates are merged when the step is built).
      for (const r of domSensitiveRects(document, { pad: 2 })) {
        rects.push(r);
        labels.push(null);
      }
    } catch {
      /* our own scan above still ran */
    }
    // Secrets shown as text: card numbers, SSNs, IBANs, tokens (and emails when switched on).
    let kinds: string[] = [];
    let incomplete = false;
    try {
      const text = scanTextSecrets(document, { ...patternOpts, viewport, shadowRootOf, budgetMs: 40 });
      rects.push(...text.rects);
      labels.push(...text.labels);
      kinds = text.kinds;
      incomplete = text.incomplete;
    } catch {
      incomplete = true;
    }
    const local: ScanResult = { rects, labels, kinds, incomplete };
    const visible = opaque.filter((f) => {
      const r = rectOf(f);
      return r.width > 0 && r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight && r.x + r.width > 0 && r.y + r.height > 0;
    });
    if (!visible.length) return { local, remote: null };
    const remote = Promise.all(
      visible.map(async (f): Promise<ScanResult> => {
        const border = rectOf(f);
        const win = (f as HTMLIFrameElement).contentWindow;
        const reply = win ? await ask<Extract<FrameMsg, { kind: "scan-reply" }>>(win, { [TAG]: 1, kind: "scan", id: msgId() }, "scan-reply", 180) : undefined;
        if (reply) {
          // offsetInto clips (and may drop) rects, so labels are matched by index only when nothing was dropped.
          const moved = offsetInto(reply.rects, contentBox(f, border));
          return { rects: moved, labels: moved.length === reply.rects.length ? (reply.labels ?? []) : [], kinds: reply.kinds ?? [], incomplete: !!reply.incomplete };
        }
        // No answer (sandboxed frame, recorder not there yet): blur payment/sign-in widgets whole
        // and flag the step for review either way. Never silently clean.
        return frameLooksSensitive(f)
          ? { rects: [border], labels: ["Payment or sign-in frame"], kinds: [], incomplete: true }
          : { rects: [], labels: [], kinds: [], incomplete: true };
      }),
    ).then(mergeScans);
    return { local, remote };
  }

  function mergeScans(all: ScanResult[]): ScanResult {
    return {
      rects: all.flatMap((a) => a.rects),
      labels: all.flatMap((a) => a.rects.map((_, i) => a.labels[i] ?? null)),
      kinds: [...new Set(all.flatMap((a) => a.kinds))],
      incomplete: all.some((a) => a.incomplete),
    };
  }

  async function allSensitive(scan: SensitiveScan): Promise<ScanResult> {
    return scan.remote ? mergeScans([scan.local, await scan.remote]) : scan.local;
  }

  // Redaction presets (Settings). Emails are off by default.
  let patternOpts: PatternOptions = { emails: false };
  const readPrefs = (v: unknown) => {
    patternOpts = parseRedactPrefs(v);
  };
  try {
    void chrome.storage.local.get(REDACT_PREFS_KEY).then((r) => readPrefs(r[REDACT_PREFS_KEY]), () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[REDACT_PREFS_KEY]) readPrefs(changes[REDACT_PREFS_KEY].newValue);
    });
  } catch {
    /* storage unavailable: defaults */
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
      const r = await allSensitive(collectSensitive());
      source.postMessage({ [TAG]: 1, kind: "scan-reply", id: msg.id, rects: r.rects, labels: r.labels, kinds: r.kinds, incomplete: r.incomplete } satisfies FrameMsg, "*");
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
  /** The last step this recorder sent, and the field it typed into (typing amends need it). */
  let lastSent: { cid: string; fieldKey?: string } | undefined;

  function emit(action: StepAction, el: Element | undefined, captureId: string | undefined, snap?: PendingPointer, typing?: { fieldKey: string }): void {
    if (!recording) return;
    const cid = newCaptureId();
    const draft: StepDraft = {
      action,
      page: snap?.page ?? page(),
      at: localIso(),
      metrics: snap?.metrics ?? metrics(),
      cid,
    };
    // More typing in the field of the previous step (nothing else in between): amend that step.
    if (typing && lastSent?.fieldKey === typing.fieldKey) draft.amends = lastSent.cid;
    lastSent = { cid, fieldKey: typing?.fieldKey };
    if (el) {
      draft.target = snap?.target ?? describe(el);
      draft.rect = snap?.rect ?? rectOf(el);
      const corner = snap ? snap.corner : cornerFor(el, draft.rect);
      if (corner) draft.corner = corner;
      const label = labelOf(el);
      if (label) draft.labelRect = rectOf(label);
    }
    const scan = snap?.sensitive ?? collectSensitive();
    const fallbackCaptureIds = knownFrames.filter((id) => id !== captureId).reverse();
    const fallbackCaptureId = fallbackCaptureIds[0];
    // Fast path (the usual case): send synchronously, so a click that navigates away is not lost.
    const withScan = (r: ScanResult) => {
      draft.sensitiveRects = r.rects;
      if (r.labels.some((l) => l)) draft.sensitiveLabels = r.rects.map((_, i) => r.labels[i] ?? null);
      if (r.kinds.length) draft.sensitiveKinds = r.kinds;
      if (r.incomplete) draft.scanIncomplete = true;
    };
    if (isTop && !scan.remote && chainDepth === 0) {
      withScan(scan.local);
      send({ type: "rec:step", captureId, fallbackCaptureId, fallbackCaptureIds, draft });
      return;
    }
    chainDepth++;
    chain = chain
      .then(async () => {
        withScan(await allSensitive(scan));
        if (!isTop) {
          const off = await offsetInTop();
          const shift = (r: Rect): Rect => ({ ...r, x: r.x + off.x, y: r.y + off.y });
          if (draft.rect) draft.rect = shift(draft.rect);
          if (draft.labelRect) draft.labelRect = shift(draft.labelRect);
          draft.sensitiveRects = (draft.sensitiveRects ?? []).map(shift);
          // Unknown metrics are filled in by the worker from the tab.
          draft.metrics = off.metrics;
        }
        send({ type: "rec:step", captureId, fallbackCaptureId, fallbackCaptureIds, draft });
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
    emit(action, entry.meta.el, captureId, undefined, { fieldKey: entry.key });
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
    // Clicks and keys on our own recording bar are never steps.
    handlers.push([type, (e: Event) => !(bar && bar.owns(e)) && fn(e as WindowEventMap[K])]);
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
      const rect = rectOf(el);
      pending = {
        el,
        captureId,
        target: describe(el),
        rect,
        metrics: metrics(),
        sensitive: collectSensitive(),
        page: page(),
        corner: cornerFor(el, rect),
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
    } else if (msg.type === "tab:bar") {
      if (!isTop) return false;
      bar?.update({ status: msg.status, stepCount: msg.stepCount });
      reply({ ok: true });
    } else if (msg.type === "tab:bar-hide") {
      if (!isTop) return false;
      if (!bar) reply({ ok: true });
      else void bar.hideForCapture().then(() => reply({ ok: true }));
      return true;
    } else if (msg.type === "tab:bar-show") {
      if (!isTop) return false;
      bar?.showAfterCapture();
      reply({ ok: true });
    } else if (msg.type === "tab:scan") {
      // For worker-side steps (navigations): what the top page looks like right now.
      if (!isTop) return false;
      void allSensitive(collectSensitive()).then((r) =>
        reply({ metrics: metrics(), sensitiveRects: r.rects, sensitiveLabels: r.rects.map((_, i) => r.labels[i] ?? null), sensitiveKinds: r.kinds, scanIncomplete: r.incomplete || undefined } satisfies ScanReply),
      );
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
        if (r?.bar) bar?.update(r.bar);
      })
      .catch(() => {});
  }

  window.__stepsnapRecorder = { sync };
  sync();
  // Back/forward cache restores keep this script alive; re-check the recording state.
  window.addEventListener("pageshow", (e) => e.persisted && sync());
});
