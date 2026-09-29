// Render public/og.png (1200x630) from brand tokens. Run through research/heavy.sh:  node scripts/og.mjs
import { chromium } from "playwright-core";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const brand = new URL("../../../packages/brand/", import.meta.url).pathname;
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${brand}tokens.css">
<style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:var(--ss-bg);color:var(--ss-ink);font-family:var(--ss-font-ui);display:grid;grid-template-columns:600px 1fr;gap:48px;padding:64px 72px;overflow:hidden}
.l{display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:14px;font-weight:750;font-size:34px;letter-spacing:-.02em}
.brand svg{width:48px;height:48px}
h1{font-size:60px;line-height:1.02;letter-spacing:-.03em;font-weight:750;margin:0}
.sub{font-size:24px;color:var(--ss-ink-2);margin-top:22px;line-height:1.35}
.tags{font-family:var(--ss-font-mono);font-size:19px;color:var(--ss-ink-2)}
.card{align-self:center;background:var(--ss-surface);border:1px solid var(--ss-line);border-radius:20px;box-shadow:var(--ss-shadow-3);padding:26px;display:grid;gap:22px}
.step{display:flex;gap:14px;align-items:center;font-size:22px;font-weight:600}
.n{width:32px;height:32px;background:var(--ss-highlight);color:#fff;border-radius:var(--ss-radius-flag);display:grid;place-items:center;font-size:17px;font-weight:700}
.shot{background:var(--ss-bg);border:1px solid var(--ss-line);border-radius:12px;padding:34px 20px 20px;display:grid;gap:14px;margin-top:12px}
.lab{font-size:14px;color:var(--ss-ink-3);margin-bottom:6px}
.in{height:44px;border:1px solid var(--ss-line-2);background:var(--ss-surface);border-radius:8px;display:flex;align-items:center;padding:0 14px;font-size:18px;position:relative}
.ring{outline:4px solid var(--ss-highlight);outline-offset:4px;box-shadow:0 0 0 7px rgba(255,255,255,.96);border-radius:10px}
.flag{position:absolute;right:-12px;top:-34px;background:var(--ss-highlight);color:#fff;height:30px;min-width:30px;padding:0 8px;border-radius:var(--ss-radius-flag);display:grid;place-items:center;font-size:17px;font-weight:700}
.blur{filter:blur(6px)}
</style></head><body>
<div class="l"><div class="brand"><svg viewBox="12 12 104 104"><path d="M33 44.5H111.5V91A16.5 16.5 0 0 1 95 107.5H33A16.5 16.5 0 0 1 16.5 91V61A16.5 16.5 0 0 1 33 44.5ZM33 55.5H95A5.5 5.5 0 0 1 100.5 61V91A5.5 5.5 0 0 1 95 96.5H33A5.5 5.5 0 0 1 27.5 91V61A5.5 5.5 0 0 1 33 55.5Z" fill="#EB4E26" fill-rule="evenodd"/><path d="M111.5 44.51V22.5A8 8 0 0 0 103.5 14.5H79.5A8 8 0 0 0 71.5 22.5V36.5A8 8 0 0 1 63.5 44.5Z" fill="#EB4E26"/></svg>Showsteps</div>
<div><h1>Record a task once. Get a guide and an agent skill.</h1><div class="sub">Free Chrome extension. Passwords blurred as you record. Nothing leaves your computer.</div></div>
<div class="tags">PDF · HTML · Markdown · DOCX · SKILL.md</div></div>
<div class="card"><div><div class="step"><span class="n">4</span>Type "jane@example.com" in Email</div>
<div class="shot"><div><div class="lab">Email</div><div class="in ring">jane@example.com<span class="flag">4</span></div></div>
<div><div class="lab">Access token</div><div class="in blur">sk_live_4f9a81c0d2b7</div></div></div></div></div>
</body></html>`;
const dir = await mkdtemp(join(tmpdir(), "og-"));
const file = join(dir, "og.html");
await writeFile(file, html);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
await page.goto("file://" + file);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL("../public/og.png", import.meta.url).pathname });
await browser.close();
