// Chrome Web Store screenshots: 5 x 1280x800 PNG (24-bit, no alpha), light theme, real product
// screens from the captured footage with a short caption band.
//
//   node store/make-store-shots.mjs [--out docs/launch/store]     (run under research/heavy.sh: it opens Chromium)
//
// Inputs come from capture/capture.mjs (docs/launch/media/footage/light). Regenerate after any UI change.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, FOOT, ROOT, flowData, markSvg, skillData } from "../lib/footage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const OUT = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "docs/launch/store"));
const WORK = resolve(here, "../.work/store");
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const f = flowData("light");
const S = join(FOOT, "light/screens");
const img = (n) => `file://${join(S, n)}`;
const skill = skillData(f.d);
const mark = markSvg();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const CSS = `
@font-face { font-family: "Rethink Sans"; src: url("file://${BRAND}/fonts/RethinkSans-Variable-latin.woff2"); font-weight: 400 800; }
@font-face { font-family: "Fragment Mono"; src: url("file://${BRAND}/fonts/FragmentMono-Regular-latin.woff2"); font-weight: 400; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1280px; height: 800px; overflow: hidden; background: #F4F2EE; }
body { font-family: "Rethink Sans", system-ui, sans-serif; color: #1F1C19; -webkit-font-smoothing: antialiased; font-feature-settings: "liga" 0; position: relative; }
.band { position: absolute; left: 0; top: 0; width: 1280px; height: 112px; background: #1F1C19; color: #F3EFEA; display: flex; align-items: center; gap: 22px; padding: 0 56px; }
.band svg { width: 46px; height: 46px; flex: none; }
.band h1 { font-size: 40px; line-height: 44px; font-weight: 700; letter-spacing: -0.025em; }
.band small { display: block; margin-top: 4px; font-size: 20px; line-height: 24px; font-weight: 400; color: #B9B0A6; letter-spacing: -0.005em; }
.stage { position: absolute; left: 0; top: 112px; width: 1280px; height: 688px; display: flex; align-items: center; justify-content: center; gap: 40px; }
.frame { position: relative; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 2px 6px rgba(31,28,25,.08), 0 30px 70px -20px rgba(31,28,25,.32), 0 0 0 1px rgba(31,28,25,.08); }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
.win { position: relative; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 2px 6px rgba(31,28,25,.08), 0 30px 70px -20px rgba(31,28,25,.32), 0 0 0 1px rgba(31,28,25,.08); }
.win .bar { height: 34px; background: #ECE9E4; border-bottom: 1px solid #E0DCD6; display: flex; align-items: center; gap: 7px; padding: 0 14px; }
.win .bar i { width: 11px; height: 11px; border-radius: 50%; background: #D2CDC6; display: block; }
.win .bar b { margin: 0 auto; transform: translateX(-24px); font-weight: 500; font-size: 13px; color: #57514B; background: #F7F5F2; height: 22px; line-height: 22px; padding: 0 28px; border-radius: 11px; }
.win .body { position: relative; overflow: hidden; }
.win .body img { position: absolute; left: 0; top: 0; }
.code { width: 1140px; height: 560px; border-radius: 16px; background: #fff; box-shadow: 0 2px 6px rgba(31,28,25,.08), 0 30px 70px -20px rgba(31,28,25,.32), 0 0 0 1px rgba(31,28,25,.08); overflow: hidden; display: grid; grid-template-columns: 5fr 6fr; }
.code .col { padding: 26px 30px; font: 400 15px/24px "Fragment Mono", monospace; white-space: pre; overflow: hidden; }
.code .col + .col { border-left: 1px solid #E0DCD6; background: #F7F5F2; }
.code .cap { font: 600 13px/16px "Rethink Sans"; letter-spacing: .06em; text-transform: uppercase; color: #736B63; margin-bottom: 14px; }
.h { color: #B63A14; } .d { color: #736B63; } .s { color: #8A5A00; } .k { color: #1D5FA8; } .ok { color: #217A4F; font-weight: 400; }
.pass { display: inline-flex; margin-top: 12px; height: 34px; padding: 0 14px; border-radius: 17px; background: #E1F2E8; color: #217A4F; font: 700 16px/34px "Rethink Sans"; }
.flag { position: absolute; border: 3px solid #EB4E26; border-radius: 8px 0 8px 8px; box-shadow: 0 0 0 2px rgba(255,255,255,.96); }
.flag b { position: absolute; right: -3px; top: -26px; height: 24px; min-width: 26px; padding: 0 7px; border-radius: 7px 7px 0 0; background: #EB4E26; color: #fff; font: 700 15px/24px "Rethink Sans"; text-align: center; }
`;

const md = (l) => {
  const e = esc(l);
  if (/^#/.test(l)) return `<span class="h">${e}</span>`;
  if (/^---$/.test(l)) return `<span class="d">${e}</span>`;
  if (/^(name|description):/.test(l)) return e.replace(/^(\w+:)(.*)$/, '<span class="k">$1</span><span class="s">$2</span>');
  return e.replace(/\*\*([^*]+)\*\*/g, '<span class="h">$1</span>').replace(/(Find it by:|Value:)/, '<span class="d">$1</span>');
};
const cut = (l, n = 62) => (l.length > n ? l.slice(0, n - 1) + "\u2026" : l);
const ts = (l) => esc(cut(l)).replace(/^(\/\/.*)$/, '<span class="d">$1</span>').replace(/\b(await|async|import|from|type)\b/g, '<span class="k">$1</span>');

function page(caption, sub, body) {
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>
  <div class="band">${mark}<div><h1>${caption}</h1>${sub ? `<small>${sub}</small>` : ""}</div></div>
  <div class="stage">${body}</div></body>`;
}

const B = f.boxes;
const shots = [];

// 1. Record: the page with the recording bar and the Flag on the target, beside the real side panel.
{
  const W = 780, H = Math.round(W * 0.625), sc = W / 1280;
  const b = B.s08; // "Billing period" select on the settings page
  const num = f.guide.steps.findIndex((x) => x.action?.type === "select") + 1 || 1; // its number in the guide
  shots.push([
    "01-record",
    "Press Record and click through the task",
    "Every click and keystroke becomes a step, across tabs.",
    `<div class="win" style="width:${W}px"><div class="bar"><i></i><i></i><i></i><b>books.acme.test</b></div>
       <div class="body" style="width:${W}px;height:${H}px"><img src="${img("page-s08-before.png")}" style="width:${W}px;height:${H}px">
         <div class="flag" style="left:${(b.x - 4) * sc}px;top:${(b.y - 4) * sc}px;width:${(b.width + 8) * sc}px;height:${(b.height + 8) * sc}px"><b>${num}</b></div></div></div>
     <div class="frame" style="width:315px;height:560px"><img src="${img("panel-recording.png")}" style="object-position:top"></div>`,
  ]);
}
// 2. The editor
shots.push([
  "02-editor",
  "Steps write themselves",
  "Screenshots, outlined targets and titles like “Click Sign in”. Edit anything.",
  `<div class="frame" style="width:${Math.round(600 * 1.4884)}px;height:600px"><img src="${img("editor.png")}"></div>`,
]);
// 3. Auto blur
shots.push([
  "03-blur",
  "Passwords are blurred as you record",
  "Undo it, or blur anything else by hand.",
  `<div class="frame" style="width:940px;height:590px"><img src="${img("editor-step3.png")}" style="position:absolute;left:${-380 * 1.068}px;top:${-64 * 1.068}px;width:${1280 * 1.068}px;height:auto"></div>`,
]);
// 4. Export
shots.push([
  "04-export",
  "Export a PDF, web page, Markdown or Word. Free.",
  "No watermark, no account, no upload.",
  `<div class="frame" style="width:${Math.round(600 * 1.4884)}px;height:600px"><img src="${img("editor-export.png")}"></div>`,
]);
// 5. Agent skill (real SKILL.md, replay.spec.ts and a real replay run)
shots.push([
  "05-agent-skill",
  "The same recording is a skill for your agent",
  "SKILL.md, steps.json and a Playwright script it can replay.",
  `<div class="code"><div class="col"><div class="cap">SKILL.md</div>${skill.md.map((l) => md(cut(l, 52))).join("\n")}</div>
     <div class="col"><div class="cap">replay.spec.ts</div>${skill.spec.map(ts).join("\n")}\n\n<span class="d">$</span> ${esc(skill.cmd)}\n${skill.term.map((l) => (l.ok ? `<span class="ok">${esc(l.t)}</span>` : esc(l.t))).join("\n")}</div></div>`,
]);

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const [name, cap, sub, body] of shots) {
  const file = join(WORK, `${name}.html`);
  writeFileSync(file, page(cap, sub, body));
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  const raw = join(WORK, `${name}.png`);
  await p.screenshot({ path: raw });
  // 24-bit PNG (no alpha), as the store requires
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-pix_fmt", "rgb24", join(OUT, `${name}.png`)]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  console.log("wrote", join(OUT, `${name}.png`));
}
await browser.close();
