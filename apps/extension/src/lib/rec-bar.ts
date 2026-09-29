// In-page recording bar (SPEC §3): a floating ink pill at the bottom of the recorded page with
// the live step count, Pause/Resume, Discard and "Stop and review". Lives in a closed shadow root
// (page CSS cannot reach in, page scripts cannot read it) and is never in a screenshot: the worker
// asks the page to hide it right before every capture, waits for a painted frame without it, and
// shows it again afterwards. Hiding changes only a style inside the shadow root, so the page's
// DOM (and the recorder's "page changed" tracking) never sees it.
//
// Fonts: the page cannot load extension fonts without web_accessible_resources (which we do not
// declare), so the bar uses the system UI font.

import type { BarState } from "./messages";

export interface RecBarActions {
  pause(): void;
  resume(): void;
  stop(): void;
  discard(): void;
}

const INK = "#1F1C19";
const PAPER = "#F3EFEA";
const MUTED = "#B9B0A6";
const DOT = "#FF5A3F";
const ACCENT = "#EB4E26";
const MARGIN = 24; // default distance from the bottom edge, CSS px
const HEIGHT = 48;

const ICON = {
  pause: "M7 5v10M13 5v10",
  play: "M7 4.8v10.4L15.2 10z",
  close: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  grip: "M8 5h.01M12 5h.01M8 10h.01M12 10h.01M8 15h.01M12 15h.01",
};

const CSS = `
:host { all: initial; }
.wrap { position: fixed; left: 50%; bottom: var(--bottom, ${MARGIN}px); transform: translateX(-50%); z-index: 2147483647;
  font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: ${PAPER};
  -webkit-font-smoothing: antialiased; letter-spacing: 0; text-transform: none; }
.wrap.is-hidden { opacity: 0 !important; transition: none !important; pointer-events: none; }
.bar { display: flex; align-items: center; gap: 4px; height: ${HEIGHT}px; padding: 0 6px 0 4px; border-radius: 999px; background: ${INK};
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 12px 32px -8px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08);
  box-sizing: border-box; white-space: nowrap; user-select: none; -webkit-user-select: none; touch-action: none; cursor: grab; }
.bar.is-dragging { cursor: grabbing; }
.status { display: inline-flex; align-items: center; gap: 0; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: ${DOT}; margin: 0 8px 0 2px; box-sizing: border-box; flex: none; }
.is-paused .dot { background: transparent; border: 2px solid ${DOT}; }
.count { font: 400 12.5px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: ${MUTED}; margin: 0 6px 0 10px; }
.flag { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; box-sizing: border-box; background: ${ACCENT}; color: #fff;
  font: 750 11px/1 ui-sans-serif, system-ui, sans-serif; border-radius: 6px 6px 6px 2px; font-variant-numeric: tabular-nums; }
.flag.drop { animation: drop 420ms cubic-bezier(.34, 1.4, .64, 1) both; }
@keyframes drop { from { transform: translateY(-7px); opacity: 0; } to { transform: none; opacity: 1; } }
.domain { font: 400 12.5px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: ${MUTED}; margin: 0 8px 0 10px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 559px) { .domain { display: none; } }
button { all: unset; box-sizing: border-box; height: 36px; padding: 0 12px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px;
  color: ${PAPER}; cursor: pointer; font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; transition: background-color 120ms; }
button:hover { background: rgba(243,239,234,.1); }
button:active { background: rgba(243,239,234,.16); }
button:focus-visible { outline: none; box-shadow: 0 0 0 2px ${INK}, 0 0 0 4px #FF8A66; }
button.icon { width: 36px; padding: 0; justify-content: center; }
button.grip { width: 24px; padding: 0; justify-content: center; cursor: ns-resize; color: ${MUTED}; }
button.stop { background: ${PAPER}; color: ${INK}; padding: 0 16px; }
button.stop:hover { background: #fff; }
button.danger { background: ${DOT}; color: ${INK}; padding: 0 14px; }
button.danger:hover { background: #ff7a63; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.grip svg { stroke-width: 2.6; }
[data-icon="play"] svg { fill: currentColor; stroke-width: 1.2; }
.sep { width: 1px; height: 20px; background: #3D3935; margin: 0 4px; flex: none; }
.ask { margin: 0 6px 0 12px; font-weight: 600; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .flag.drop { animation: none; } button { transition: none; } }
`;

// No innerHTML anywhere: pages with Trusted Types or odd CSP must not break the bar.
function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function icon(doc: Document, d: string): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

/** Keep the bar on screen: bottom offset clamped between 8 px and the top of the viewport. */
export function clampBottom(bottom: number, viewportHeight: number, height = HEIGHT): number {
  return Math.round(Math.max(8, Math.min(Math.max(8, viewportHeight - height - 8), bottom)));
}

export class RecBar {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly wrap: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private state: BarState = { status: "idle", stepCount: 0 };
  private confirming = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private bottom = MARGIN;
  private readonly posKey: string;

  constructor(
    private readonly doc: Document,
    private readonly actions: RecBarActions,
    opts: { open?: boolean } = {},
  ) {
    this.host = doc.createElement("showsteps-recording-bar");
    this.host.setAttribute("style", "all: initial !important; position: static !important; display: contents !important;");
    this.root = this.host.attachShadow({ mode: opts.open ? "open" : "closed" });
    // A constructed stylesheet is not subject to the page's style-src CSP; <style> is the fallback.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      this.root.appendChild(el(doc, "style", {}, CSS));
    }
    this.wrap = el(doc, "div", { class: "wrap" });
    this.bar = el(doc, "div", { class: "bar", role: "toolbar", "aria-label": "Showsteps recording", "aria-orientation": "horizontal" });
    this.wrap.appendChild(this.bar);
    this.root.appendChild(this.wrap);
    this.posKey = `bar:bottom:${doc.location?.origin ?? ""}`;
    this.bar.addEventListener("pointerdown", (e) => this.dragStart(e));
    try {
      void chrome.storage.local.get(this.posKey).then((r) => {
        const v = r[this.posKey];
        if (typeof v === "number") this.setBottom(v);
      }, () => {});
    } catch {
      /* no storage: default position */
    }
  }

  /** True when an event came from inside the bar (so the recorder ignores it). */
  owns(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  update(next: BarState): void {
    const prev = this.state;
    this.state = next;
    if (next.status === "idle") {
      this.host.remove();
      return;
    }
    if (!this.host.isConnected) (this.doc.documentElement ?? this.doc).appendChild(this.host);
    if (this.confirming) return;
    const statusChanged = prev.status !== next.status || !this.bar.firstChild;
    if (statusChanged) this.render();
    else if (prev.stepCount !== next.stepCount) this.renderCount(true);
  }

  /** Hide for a capture; resolves once a frame without the bar has been painted. */
  hideForCapture(): Promise<void> {
    clearTimeout(this.hideTimer);
    // Never stay hidden if the "show" never comes (worker restarted mid-capture).
    this.hideTimer = setTimeout(() => this.showAfterCapture(), 2500);
    if (!this.host.isConnected) return Promise.resolve();
    if (this.wrap.classList.contains("is-hidden") && this.painted) return this.painted;
    this.wrap.classList.add("is-hidden");
    const painted = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 150);
      // Two animation frames: the style change has been committed and composited.
      requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(timer), resolve())));
    });
    this.painted = painted;
    return painted;
  }
  private painted: Promise<void> | undefined;

  showAfterCapture(): void {
    clearTimeout(this.hideTimer);
    this.painted = undefined;
    this.wrap.classList.remove("is-hidden");
  }

  destroy(): void {
    this.host.remove();
  }

  // ---- rendering ------------------------------------------------------------------------------

  private render(): void {
    const d = this.doc;
    const { status } = this.state;
    const paused = status === "paused";
    const stopping = status === "stopping";
    const focused = this.root.activeElement?.getAttribute("data-k");
    this.bar.replaceChildren();
    this.bar.classList.toggle("is-paused", paused);

    const grip = el(d, "button", { class: "grip", type: "button", "data-k": "grip", "aria-label": "Move the recording bar. Use the up and down arrow keys.", title: "Drag to move" }, icon(d, ICON.grip));
    grip.addEventListener("keydown", (e) => this.nudge(e));

    const status_ = el(d, "span", { class: "status", role: "status" });
    status_.appendChild(el(d, "span", { class: "dot", "aria-hidden": "true" }));
    status_.appendChild(el(d, "span", {}, stopping ? "Finishing" : paused ? "Paused" : "Recording"));
    status_.appendChild(el(d, "span", { class: "count", "aria-hidden": "true" }, "step"));
    const flag = el(d, "span", { class: "flag", "data-count": "" });
    status_.appendChild(flag);
    const domain = d.location?.hostname;

    const toggle = el(
      d,
      "button",
      { type: "button", "data-k": "toggle", "data-icon": paused ? "play" : "pause", "aria-keyshortcuts": "Alt+Shift+P", ...(stopping ? { disabled: "", "aria-disabled": "true" } : {}) },
      icon(d, paused ? ICON.play : ICON.pause),
      el(d, "span", {}, paused ? "Resume" : "Pause"),
    );
    toggle.setAttribute("aria-label", paused ? "Resume recording" : "Pause recording");
    toggle.addEventListener("click", (e) => e.isTrusted && !stopping && (paused ? this.actions.resume() : this.actions.pause()));

    const discard = el(d, "button", { type: "button", class: "icon", "data-k": "discard", "aria-label": "Discard this recording", title: "Discard" }, icon(d, ICON.close));
    discard.addEventListener("click", (e) => e.isTrusted && !stopping && this.askDiscard());

    const stop = el(d, "button", { type: "button", class: "stop", "data-k": "stop", "aria-keyshortcuts": "Alt+Shift+S" }, "Stop and review");
    stop.addEventListener("click", (e) => e.isTrusted && !stopping && this.actions.stop());

    this.bar.append(grip, status_);
    if (domain) this.bar.append(el(d, "span", { class: "domain", "aria-hidden": "true" }, domain));
    this.bar.append(toggle, el(d, "span", { class: "sep", "aria-hidden": "true" }), discard, stop);
    this.renderCount(false);
    if (focused) (this.bar.querySelector(`[data-k="${focused}"]`) as HTMLElement | null)?.focus();
  }

  private renderCount(animate: boolean): void {
    const flag = this.bar.querySelector<HTMLElement>("[data-count]");
    if (!flag) return;
    const n = this.state.stepCount;
    flag.textContent = String(n);
    const status = this.bar.querySelector<HTMLElement>(".status");
    status?.setAttribute("aria-label", `${this.state.status === "paused" ? "Paused" : "Recording"}, ${n} ${n === 1 ? "step" : "steps"}`);
    if (animate) {
      flag.classList.remove("drop");
      void flag.offsetWidth;
      flag.classList.add("drop");
    }
  }

  private askDiscard(): void {
    const d = this.doc;
    this.confirming = true;
    this.bar.replaceChildren();
    const q = el(d, "span", { class: "ask", role: "alert" }, "Discard this recording?");
    const keep = el(d, "button", { type: "button", "data-k": "keep" }, "Keep recording");
    const yes = el(d, "button", { type: "button", class: "danger", "data-k": "confirm-discard" }, "Discard");
    const back = () => {
      this.confirming = false;
      this.render();
      (this.bar.querySelector('[data-k="discard"]') as HTMLElement | null)?.focus();
    };
    keep.addEventListener("click", (e) => e.isTrusted && back());
    yes.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      this.confirming = false;
      this.actions.discard();
    });
    this.bar.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.removeEventListener("keydown", esc);
        back();
      }
    });
    this.bar.append(q, keep, el(d, "span", { class: "sep", "aria-hidden": "true" }), yes);
    keep.focus();
  }

  // ---- position -------------------------------------------------------------------------------

  private setBottom(v: number): void {
    this.bottom = clampBottom(v, this.doc.defaultView?.innerHeight ?? 800);
    this.wrap.style.setProperty("--bottom", `${this.bottom}px`);
  }

  private savePosition(): void {
    try {
      void chrome.storage.local.set({ [this.posKey]: this.bottom }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private nudge(e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    this.setBottom(this.bottom + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 64 : 16));
    this.savePosition();
  }

  private dragStart(e: PointerEvent): void {
    if (!e.isTrusted || e.button !== 0) return;
    const onButton = (e.composedPath() as Element[]).some((n) => n instanceof Element && n.localName === "button" && !n.classList.contains("grip"));
    if (onButton) return;
    e.preventDefault();
    const startY = e.clientY;
    const startBottom = this.bottom;
    this.bar.classList.add("is-dragging");
    this.bar.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => this.setBottom(startBottom + (startY - m.clientY));
    const up = () => {
      this.bar.classList.remove("is-dragging");
      this.bar.removeEventListener("pointermove", move);
      this.bar.removeEventListener("pointerup", up);
      this.bar.removeEventListener("pointercancel", up);
      this.savePosition();
    };
    this.bar.addEventListener("pointermove", move);
    this.bar.addEventListener("pointerup", up);
    this.bar.addEventListener("pointercancel", up);
  }
}
