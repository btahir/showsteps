/* Shared motion helpers for the launch video and the README hero (inlined by compose.mjs).
 * Seek-safe: everything is built at load time; motion is added to a paused GSAP timeline.
 * Geometry follows drawFlagHighlight in packages/brand/tokens.ts: ring with the tab-side corner
 * squared, 2 px white halo, a 24 px tab sitting on the outer corner with a 7 px concave fillet. */
window.Kit = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, cls, css, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) Object.assign(e.style, css);
    if (parent) parent.appendChild(e);
    return e;
  };
  const px = (n) => `${n}px`;

  /** Ring path with one square corner ("tr" or "br"), stroke centred on the path. */
  function ringPath(w, h, r, sw, corner) {
    const i = sw / 2, x0 = i, y0 = i, x1 = w - i, y1 = h - i;
    if (corner === "br")
      return `M${x1},${y1} H${x0 + r} A${r},${r} 0 0 1 ${x0},${y1 - r} V${y0 + r} A${r},${r} 0 0 1 ${x0 + r},${y0} H${x1 - r} A${r},${r} 0 0 1 ${x1},${y0 + r} Z`;
    return `M${x1},${y0} H${x0 + r} A${r},${r} 0 0 0 ${x0},${y0 + r} V${y1 - r} A${r},${r} 0 0 0 ${x0 + r},${y1} H${x1 - r} A${r},${r} 0 0 0 ${x1},${y1 - r} Z`;
  }

  /**
   * Build a Flag highlight inside `host` (page coordinates). `box` = target rect in host px.
   * Returns { root, draw(tl, t, dur), hide(tl, t, dur) }.
   */
  function flag(host, box, n, o = {}) {
    const pad = o.pad ?? 4, sw = o.ring ?? 3, r = o.r ?? 8, halo = o.halo ?? 2, k = o.scale ?? 1;
    const corner = o.corner && String(o.corner).startsWith("bottom") ? "br" : "tr";
    // Minimum ring so the tab always fits (tab width + 2 x radius).
    let w = box.width + pad * 2, h = box.height + pad * 2;
    let x = box.x - pad, y = box.y - pad;
    const minW = 26 + 2 * r + 4;
    if (w < minW) { x -= (minW - w) / 2; w = minW; }
    const root = el("div", "flag", { position: "absolute", left: px(x), top: px(y), width: px(w), height: px(h), pointerEvents: "none", opacity: 0, zIndex: 20 }, host);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", w); svg.setAttribute("height", h); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible";
    const d = ringPath(w, h, r, sw, corner);
    const mk = (stroke, width) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", stroke);
      p.setAttribute("stroke-width", width); p.setAttribute("pathLength", "1");
      p.style.strokeDasharray = "1 1"; p.style.strokeDashoffset = "1";
      svg.appendChild(p); return p;
    };
    const haloP = mk("rgba(255,255,255,.96)", sw + halo * 2);
    const ringP = mk("#EB4E26", sw);
    root.appendChild(svg);
    const th = 24, tw = Math.max(26, 14 + String(n).length * 10);
    const tab = el("div", "flag-tab", {
      position: "absolute", right: "0", height: px(th), minWidth: px(tw), padding: "0 7px", boxSizing: "border-box",
      display: "grid", placeItems: "center", background: "#EB4E26", color: "#fff", font: "700 15px/1 'Rethink Sans', sans-serif",
      borderRadius: corner === "br" ? "0 0 7px 7px" : "7px 7px 0 0", opacity: 0,
      boxShadow: "0 0 0 2px rgba(255,255,255,.96)", zIndex: 1,
    }, root);
    if (corner === "br") tab.style.top = `calc(100% - ${sw}px)`; else tab.style.bottom = `calc(100% - ${sw}px)`;
    tab.textContent = n;
    const fil = el("div", "", { position: "absolute", left: "-7px", width: "7px", height: "7px" }, tab);
    if (corner === "br") { fil.style.top = "0"; fil.style.background = "radial-gradient(circle at 0 100%, transparent 6.5px, #EB4E26 7px)"; }
    else { fil.style.bottom = "0"; fil.style.background = "radial-gradient(circle at 0 0, transparent 6.5px, #EB4E26 7px)"; }
    return {
      root, tab, box: { x, y, width: w, height: h },
      draw(tl, t, dur = 0.55) {
        tl.set(root, { opacity: 1 }, t);
        tl.fromTo([haloP, ringP], { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.out" }, t);
        tl.fromTo(tab, { opacity: 0, y: corner === "br" ? 10 : -10, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "back.out(2.2)" }, t + dur * 0.75);
      },
      hide(tl, t, dur = 0.2) { tl.to(root, { opacity: 0, duration: dur, ease: "power1.in" }, t); },
    };
  }

  /** A mouse pointer inside `host`. Returns { root, moveTo(tl,t0,t1,x,y,ease), click(tl,t) }. */
  function cursor(host, o = {}) {
    const size = o.size ?? 30;
    const root = el("div", "cursor", { position: "absolute", left: "0", top: "0", width: px(size), height: px(size), zIndex: 40, pointerEvents: "none", opacity: 0, transformOrigin: "3px 2px" }, host);
    root.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="overflow:visible;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28))"><path d="M4 2.5 L4 19 L8.3 15 L11.2 21.4 L14 20.1 L11.1 13.8 L17 13.6 Z" fill="#1F1C19" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const rip = el("div", "ripple", { position: "absolute", left: "0", top: "0", width: px(size * 1.6), height: px(size * 1.6), marginLeft: px(-size * 0.8), marginTop: px(-size * 0.8), borderRadius: "50%", border: `${Math.max(2, size / 10)}px solid #EB4E26`, opacity: 0, zIndex: 39, pointerEvents: "none" }, host);
    let cx = 0, cy = 0;
    return {
      root, rip,
      place(tl, t, x, y) { cx = x; cy = y; tl.set(root, { x, y }, t); tl.set(rip, { x, y }, t); },
      show(tl, t, d = 0.2) { tl.to(root, { opacity: 1, duration: d }, t); },
      hide(tl, t, d = 0.2) { tl.to(root, { opacity: 0, duration: d }, t); },
      moveTo(tl, t0, t1, x, y, ease = "power2.inOut") { tl.to(root, { x, y, duration: t1 - t0, ease }, t0); cx = x; cy = y; },
      click(tl, t) {
        tl.to(root, { scale: 0.82, duration: 0.07, ease: "power1.out" }, t).to(root, { scale: 1, duration: 0.16, ease: "power2.out" }, t + 0.07);
        tl.set(rip, { x: cx, y: cy }, t);
        tl.fromTo(rip, { x: cx, y: cy, scale: 0.3, opacity: 0.7 }, { x: cx, y: cy, scale: 1.25, opacity: 0, duration: 0.5, ease: "power2.out", immediateRender: false }, t);
      },
    };
  }

  /** Camera: zoom `pv` (a page-sized element, transform-origin 0 0) so that (cx,cy) sits in the viewport centre. */
  function camera(pv, vw, vh, pw, ph, base) {
    const state = (cx, cy, z) => {
      const s = base * z;
      let x = vw / 2 - cx * s, y = vh / 2 - cy * s;
      x = Math.min(0, Math.max(vw - pw * s, x)); y = Math.min(0, Math.max(vh - ph * s, y));
      return { x, y, scale: s };
    };
    return {
      state,
      to(tl, t, dur, cx, cy, z, ease = "power3.inOut") { tl.to(pv, { ...state(cx, cy, z), duration: dur, ease }, t); },
      home(tl, t, dur, ease = "power3.inOut") { tl.to(pv, { x: 0, y: 0, scale: base, duration: dur, ease }, t); },
    };
  }

  /** Typewriter: reveal `node` text by characters over [t, t+dur] (linear). */
  function type(tl, node, text, t, dur) {
    const o = { n: 0 };
    tl.fromTo(o, { n: 0 }, { n: text.length, duration: dur, ease: "none", onUpdate() { node.textContent = text.slice(0, Math.round(o.n)); } }, t);
    tl.set(node, {}, t); // keep timeline aware
  }

  return { el, px, flag, cursor, camera, type };
})();
