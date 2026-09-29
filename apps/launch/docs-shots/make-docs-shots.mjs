// README screenshots (committed): docs/screenshots/*.webp, light and dark, synthetic data only.
//
//   node docs-shots/make-docs-shots.mjs     (under research/heavy.sh: opens Chromium; needs cwebp)
//
// From the captured footage (capture/capture.mjs, both themes):
//   editor-*, panel-*, export-*, guide-*   real product screens, re-encoded to WebP;
//   before-after-*                          the recorded task next to the guide and the skill it produced;
//   agent-skill-*                           SKILL.md and replay.spec.ts (real files) plus the real replay result.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, FOOT, ROOT, flowData, markSvg, skillData } from "../lib/footage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "docs/screenshots");
const WORK = resolve(here, "../.work/docs-shots");
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const cut = (l, n) => (l.length > n ? l.slice(0, n - 1) + "…" : l);

function webp(src, dst, { width, q = 80 } = {}) {
  const a = ["-q", String(q), "-m", "6", "-mt"];
  if (width) a.push("-resize", String(width), "0");
  const r = spawnSync("cwebp", [...a, src, "-o", dst], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cwebp failed for ${src}: ${r.stderr}`);
  console.log("wrote", dst, `${Math.round(statSync(dst).size / 1024)} KB`);
}

const THEMES = {
  light: { bg: "#F4F2EE", surface: "#FFFFFF", surface2: "#F7F5F2", ink: "#1F1C19", ink2: "#57514B", ink3: "#736B63", line: "#E0DCD6", accent: "#EB4E26", ok: "#217A4F", okSoft: "#E1F2E8", h: "#B63A14", s: "#8A5A00", k: "#1D5FA8", shadow: "0 2px 6px rgba(31,28,25,.08), 0 24px 60px -18px rgba(31,28,25,.30), 0 0 0 1px rgba(31,28,25,.08)" },
  dark: { bg: "#141312", surface: "#1C1A18", surface2: "#100F0E", ink: "#F3EFEA", ink2: "#B9B0A6", ink3: "#8F867C", line: "#2F2B28", accent: "#FF6337", ok: "#5BC98C", okSoft: "#173024", h: "#FF8D6A", s: "#E9C77B", k: "#9CC5F5", shadow: "0 0 0 1px rgba(255,255,255,.08), 0 24px 60px -18px rgba(0,0,0,.7)" },
};

const css = (t) => `
@font-face { font-family: "Rethink Sans"; src: url("file://${BRAND}/fonts/RethinkSans-Variable-latin.woff2"); font-weight: 400 800; }
@font-face { font-family: "Fragment Mono"; src: url("file://${BRAND}/fonts/FragmentMono-Regular-latin.woff2"); font-weight: 400; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: ${t.bg}; }
body { font-family: "Rethink Sans", system-ui, sans-serif; color: ${t.ink}; -webkit-font-smoothing: antialiased; font-feature-settings: "liga" 0; }
.card { position: absolute; background: ${t.surface}; border-radius: 16px; box-shadow: ${t.shadow}; overflow: hidden; }
.lab { position: absolute; font-size: 15px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: ${t.ink3}; }
.lab b { color: ${t.accent}; font-weight: 700; margin-right: 8px; }
.mono { font: 400 14px/22px "Fragment Mono", monospace; white-space: pre; }
.h { color: ${t.h}; } .d { color: ${t.ink3}; } .s { color: ${t.s}; } .k { color: ${t.k}; } .ok { color: ${t.ok}; }
.flag { position: absolute; border: 3px solid #EB4E26; border-radius: 8px 0 8px 8px; box-shadow: 0 0 0 2px rgba(255,255,255,.96); }
.flag b { position: absolute; right: -3px; top: -26px; height: 24px; min-width: 26px; padding: 0 7px; border-radius: 7px 7px 0 0; background: #EB4E26; color: #fff; font: 700 15px/24px "Rethink Sans"; text-align: center; }
.arrow { position: absolute; }
.chip { display: inline-block; height: 26px; padding: 0 12px; border-radius: 13px; background: ${t.okSoft}; color: ${t.ok}; font: 700 14px/26px "Rethink Sans"; }
`;

const mdLine = (l) => {
  const e = esc(l);
  if (/^#/.test(l)) return `<span class="h">${e}</span>`;
  if (/^---$/.test(l)) return `<span class="d">${e}</span>`;
  if (/^(name|description):/.test(l)) return e.replace(/^(\w+:)(.*)$/, '<span class="k">$1</span><span class="s">$2</span>');
  return e.replace(/\*\*([^*]+)\*\*/g, '<span class="h">$1</span>').replace(/(Find it by:|Value:)/, '<span class="d">$1</span>');
};
const tsLine = (l) => esc(l).replace(/^(\/\/.*)$/, '<span class="d">$1</span>').replace(/\b(await|async|import|from|type)\b/g, '<span class="k">$1</span>');

async function shoot(browser, name, html, w, h, out, opts = {}) {
  const file = join(WORK, `${name}.html`);
  writeFileSync(file, html);
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dsf ?? 2 });
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  const png = join(WORK, `${name}.png`);
  await p.screenshot({ path: png });
  await p.close();
  webp(png, out, { width: opts.width ?? w, q: opts.q ?? 82 });
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const t = THEMES[theme];
  const f = flowData(theme);
  const fl = flowData("light"); // the app under test stays light in both themes
  const S = (n) => `file://${join(FOOT, theme, "screens", n)}`;
  const SL = (n) => `file://${join(FOOT, "light", "screens", n)}`;
  const skill = skillData(f.d);
  const mark = markSvg(theme === "dark" ? "#FF6337" : null).replace(/<svg /, '<svg width="38" height="38" ');

  // 1. Real screens, re-encoded.
  for (const [src, dst, width] of [
    ["editor.png", `editor-${theme}.webp`, 1280],
    ["panel-guide.png", `panel-${theme}.webp`, 400],
    ["panel-recording.png", `recording-${theme}.webp`, 400],
    ["editor-export.png", `export-${theme}.webp`, 1280],
    ["guide-html.png", `guide-${theme}.webp`, 1280],
  ]) webp(join(FOOT, theme, "screens", src), join(OUT, dst), { width, q: 82 });

  // 2. Agent skill card.
  const card = (w, h) => `<div class="card" style="left:0;top:0;width:${w}px;height:${h}px;display:grid;grid-template-columns:5fr 6fr">
    <div style="padding:24px 28px;overflow:hidden"><div class="lab" style="position:static;margin-bottom:12px">SKILL.md</div><div class="mono">${skill.md.map((l) => mdLine(cut(l, 50))).join("\n")}</div></div>
    <div style="padding:24px 28px;border-left:1px solid ${t.line};background:${t.surface2};overflow:hidden"><div class="lab" style="position:static;margin-bottom:12px">replay.spec.ts</div><div class="mono">${skill.spec.map((l) => tsLine(cut(l, 58))).join("\n")}\n\n<span class="d">$</span> ${esc(skill.cmd)}\n${skill.term.map((l) => (l.ok ? `<span class="ok">${esc(l.t)}</span>` : esc(l.t))).join("\n")}</div></div></div>`;
  await shoot(browser, `agent-skill-${theme}`, `<!doctype html><meta charset="utf-8"><style>${css(t)} body{width:1000px;height:400px;padding:0} </style><body><div style="position:absolute;left:32px;top:32px;width:936px;height:336px">${card(936, 336)}</div></body>`, 1000, 400, join(OUT, `agent-skill-${theme}.webp`), { width: 1000 });

  // 3. Before / after: the recorded task, the guide and the skill it produced.
  const b = fl.boxes.s08;
  const num = fl.guide.steps.findIndex((x) => x.action?.type === "select") + 1 || 1;
  const pw = 470, ph = Math.round(pw * 0.625), sc = pw / 1280;
  const html = `<!doctype html><meta charset="utf-8"><style>${css(t)} body{width:1400px;height:640px}</style><body>
    <div class="lab" style="left:40px;top:34px"><b>1</b>You do it once</div>
    <div class="card" style="left:40px;top:70px;width:${pw}px;height:${ph + 28}px;border-radius:12px">
      <div style="height:28px;background:${theme === "dark" ? "#25221F" : "#ECE9E4"};display:flex;align-items:center;gap:6px;padding:0 10px"><i style="width:9px;height:9px;border-radius:50%;background:${theme === "dark" ? "#3D3935" : "#D2CDC6"}"></i><i style="width:9px;height:9px;border-radius:50%;background:${theme === "dark" ? "#3D3935" : "#D2CDC6"}"></i><i style="width:9px;height:9px;border-radius:50%;background:${theme === "dark" ? "#3D3935" : "#D2CDC6"}"></i></div>
      <div style="position:relative;width:${pw}px;height:${ph}px"><img src="${SL("page-s08-before.png")}" style="width:${pw}px;height:${ph}px;display:block">
        <div class="flag" style="left:${(b.x - 4) * sc}px;top:${(b.y - 4) * sc}px;width:${(b.width + 8) * sc}px;height:${(b.height + 8) * sc}px;border-width:2px"><b style="top:-20px;height:19px;line-height:19px;font-size:12px;min-width:20px">${num}</b></div></div></div>
    <div style="position:absolute;left:40px;top:${70 + ph + 28 + 26}px;font-size:19px;line-height:26px;color:${t.ink2};width:${pw}px">Press Record, click through the task, press Stop. Passwords and card numbers are blurred as you go.</div>

    <div class="lab" style="left:560px;top:34px"><b>2</b>A guide people can follow</div>
    <div class="card" style="left:560px;top:70px;width:380px;height:475px;border-radius:12px"><img src="${S("guide-html.png")}" style="position:absolute;left:0;top:0;width:${380 / 0.72}px;transform:translate(${-(380 / 0.72) * 0.27}px,${-26}px)"></div>
    <div style="position:absolute;left:560px;top:${70 + 475 + 26}px;font-size:19px;line-height:26px;color:${t.ink2};width:380px">PDF, HTML, Markdown or Word, with the target outlined on every step.</div>

    <div class="lab" style="left:990px;top:34px"><b>3</b>A skill your agent can run</div>
    <div class="card" style="left:990px;top:70px;width:370px;height:475px;border-radius:12px;padding:22px 24px"><div class="mono" style="font-size:13px;line-height:21px">${skill.md.slice(0, 15).map((l) => mdLine(cut(l, 40))).join("\n")}\n\n<span class="d">$</span> npx playwright test\n<span class="ok">${esc((skill.term.at(-1) ?? { t: "1 passed" }).t)}</span></div></div>
    <div style="position:absolute;left:990px;top:${70 + 475 + 26}px;font-size:19px;line-height:26px;color:${t.ink2};width:370px">SKILL.md, steps.json and a Playwright script, from the same recording.</div>
    <svg class="arrow" style="left:${40 + pw + 8}px;top:290px" width="44" height="30" viewBox="0 0 44 30" fill="none"><path d="M2 15h36M28 5l11 10-11 10" stroke="${t.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </body>`;
  await shoot(browser, `before-after-${theme}`, html, 1400, 640, join(OUT, `before-after-${theme}.webp`), { width: 1400 });
}
await browser.close();
