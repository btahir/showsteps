#!/usr/bin/env node
/* eslint-disable */
// "No network" checks (ACCEPTANCE D-NONET, MCP6, K16, NN1..NN3). Owned by the verifier.
//
// One file, three uses:
//
//  1. Node preload (D-NONET, MCP6). Blocks every non-loopback connection in a Node process tree:
//       NODE_OPTIONS="--require $PWD/scripts/no-network.cjs" pnpm --filter @stepsnap/cli test
//     net.Socket.connect, dns.lookup/resolve*, http(s).request/get and fetch throw for any host other
//     than localhost / 127.0.0.0/8 / ::1 (Unix sockets and named pipes are allowed: stdio MCP and vitest
//     IPC need them). Set NO_NETWORK_REPORT=<file> to also append every blocked attempt as a JSON line.
//     `node scripts/no-network.cjs --self-test` proves the guard actually throws.
//
//  2. Site check:    node scripts/no-network.cjs site [--port 4634] [--json]
//     Serves apps/site/dist, loads every page (light+dark, 1280 and 375 px), and fails if any request goes
//     to a non-localhost origin. Fonts must be served locally and must actually load.
//
//  3. Extension check: node scripts/no-network.cjs extension [--build <dir>] [--json]
//     Loads the unpacked build in Chrome with all non-loopback DNS mapped to NOTFOUND and a net-log, drives
//     the extension pages and (e2e build only) the fixture flow on apps/fixtures (port 4517), then fails on
//     any request or host-resolution attempt attributable to the extension. Exit 3 = pending (no build, or
//     this Chrome refuses --load-extension), not a pass.
//
// Heavy modes (2, 3) must be started through research/heavy.sh (scripts/verify.mjs does it).
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::ffff:127.0.0.1"]);
function isLocalHost(h) {
  if (!h) return true; // no host => localhost by Node's default
  h = String(h).toLowerCase().replace(/\.$/, "");
  if (LOCAL_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost")) return true;
  return /^127\.\d+\.\d+\.\d+$/.test(h);
}

/* ------------------------------------------------------------------------------------------------ */
/* 1. Node preload guard                                                                             */
/* ------------------------------------------------------------------------------------------------ */
function installGuard() {
  const net = require("node:net");
  const dns = require("node:dns");
  const http = require("node:http");
  const https = require("node:https");
  const report = process.env.NO_NETWORK_REPORT;

  function blocked(kind, target) {
    const line = JSON.stringify({ t: Date.now(), pid: process.pid, kind, target: String(target) });
    if (report) { try { fs.appendFileSync(report, line + "\n"); } catch {} }
    const err = new Error(`no-network: blocked ${kind} to ${target}`);
    err.code = "ENONETWORK";
    return err;
  }

  // net.Socket#connect covers http, https, tls, undici (fetch) and raw sockets.
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let host, port, isPath = false;
    const a0 = args[0];
    if (Array.isArray(a0)) {
      // internal normalised form [options, cb]
      const o = a0[0] || {};
      if (o.path) isPath = true; else { host = o.host; port = o.port; }
    } else if (a0 && typeof a0 === "object") {
      if (a0.path) isPath = true; else { host = a0.host; port = a0.port; }
    } else if (typeof a0 === "string" && !/^\d+$/.test(a0)) {
      isPath = true;
    } else {
      port = a0; host = typeof args[1] === "string" ? args[1] : undefined;
    }
    if (!isPath && !isLocalHost(host)) {
      const err = blocked("connect", `${host}:${port}`);
      // Match real socket behaviour: emit asynchronously so callers with error handlers see it too, and throw for sync callers.
      process.nextTick(() => this.destroy(err));
      throw err;
    }
    return origConnect.apply(this, args);
  };

  const origLookup = dns.lookup;
  dns.lookup = function (hostname, ...rest) {
    if (!isLocalHost(hostname)) throw blocked("dns.lookup", hostname);
    return origLookup.call(this, hostname, ...rest);
  };
  for (const fn of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveMx", "resolveTxt", "resolveSrv", "resolveCname", "resolveNs", "reverse"]) {
    if (typeof dns[fn] === "function") {
      const orig = dns[fn];
      dns[fn] = function (name, ...rest) {
        if (!isLocalHost(name)) throw blocked(`dns.${fn}`, name);
        return orig.call(this, name, ...rest);
      };
    }
  }
  if (dns.promises && typeof dns.promises.lookup === "function") {
    const orig = dns.promises.lookup;
    dns.promises.lookup = function (hostname, ...rest) {
      if (!isLocalHost(hostname)) return Promise.reject(blocked("dns.promises.lookup", hostname));
      return orig.call(this, hostname, ...rest);
    };
  }

  function hostOf(args) {
    const a = args[0];
    if (typeof a === "string") { try { return new URL(a).hostname; } catch { return undefined; } }
    if (a instanceof URL) return a.hostname;
    if (a && typeof a === "object") return a.hostname || (a.host ? String(a.host).replace(/:\d+$/, "") : undefined);
    return undefined;
  }
  for (const mod of [http, https]) {
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      mod[fn] = function (...args) {
        let h = hostOf(args);
        if (typeof args[0] === "object" && !(args[0] instanceof URL) && typeof args[1] === "object" && !h) h = hostOf([args[1]]);
        if (h && !isLocalHost(h)) throw blocked(`${mod === https ? "https" : "http"}.${fn}`, h);
        return orig.apply(this, args);
      };
    }
  }

  if (typeof globalThis.fetch === "function") {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      let url;
      try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); } catch { return origFetch.call(this, input, init); }
      if (/^https?:|^wss?:|^ftp:/.test(url.protocol) && !isLocalHost(url.hostname)) return Promise.reject(blocked("fetch", url.host));
      return origFetch.call(this, input, init);
    };
  }
  if (typeof globalThis.WebSocket === "function") {
    const OrigWS = globalThis.WebSocket;
    globalThis.WebSocket = class extends OrigWS {
      constructor(url, ...rest) {
        const u = new URL(String(url));
        if (!isLocalHost(u.hostname)) throw blocked("WebSocket", u.host);
        super(url, ...rest);
      }
    };
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Helpers shared by the browser modes                                                               */
/* ------------------------------------------------------------------------------------------------ */
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const AS_JSON = args.includes("--json");

function nonLocalRequest(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (["data:", "blob:", "about:", "chrome-extension:", "chrome:", "devtools:", "file:", "filesystem:", "chrome-error:"].includes(u.protocol)) return false;
  return !isLocalHost(u.hostname);
}

function playwrightFrom(dir) {
  const req = require("node:module").createRequire(path.join(dir, "package.json"));
  for (const name of ["playwright-core", "@playwright/test", "playwright"]) {
    try { return req(name); } catch {}
  }
  throw new Error(`playwright not resolvable from ${dir}`);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function launchChannel(wantBundled) {
  if (process.env.NN_CHANNEL) return process.env.NN_CHANNEL;
  // Extensions need Playwright's bundled Chromium (branded Chrome 137+ ignores --load-extension).
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const haveBundled = fs.existsSync(cache) && fs.readdirSync(cache).some((d) => /^chromium-\d+$/.test(d));
  return wantBundled && haveBundled ? "chromium" : "chrome";
}

function finish(result) {
  if (AS_JSON) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`no-network ${result.mode}: ${result.status.toUpperCase()}`);
    for (const l of result.lines) console.log("  " + l);
  }
  process.exit(result.status === "pass" ? 0 : result.status === "pending" ? 3 : 1);
}

/* ------------------------------------------------------------------------------------------------ */
/* 2. Site                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
async function siteMode() {
  const http = require("node:http");
  const siteDir = path.join(ROOT, "apps", "site");
  const dist = path.join(siteDir, "dist");
  const lines = [];
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    return finish({ mode: "site", status: "fail", lines: [`apps/site/dist/index.html missing: run pnpm --filter @stepsnap/site build first`] });
  }
  const pages = walk(dist).filter((f) => f.endsWith(".html")).map((f) => {
    let rel = "/" + path.relative(dist, f).split(path.sep).join("/");
    if (rel.endsWith("/index.html")) rel = rel.slice(0, -"index.html".length);
    return rel;
  }).sort();

  const served = new Map();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(dist, p));
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { served.set("404 " + p, 1); res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
      served.set(p, (served.get(p) || 0) + 1);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "content-length": buf.length }).end(buf);
    });
  });
  const port = Number(flag("--port", "4634"));
  await new Promise((r, j) => server.once("error", j).listen(port, "127.0.0.1", r));

  const pw = playwrightFrom(siteDir);
  const browser = await pw.chromium.launch({
    channel: launchChannel(),
    headless: true,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
  });
  const external = new Map(); // "url (page)" -> count
  const failedLocal = [];
  let total = 0, fonts = 0, fontsLocal = 0, loadedFaces = 0, consoleErrors = [];
  const combos = [
    { scheme: "light", width: 1280, height: 800 },
    { scheme: "dark", width: 1280, height: 800 },
    { scheme: "light", width: 375, height: 812 },
    { scheme: "light", width: 768, height: 1024 },
  ];
  const homeBytes = { total: 0, images: 0, files: [] }; // K16: what "/" transfers in a light desktop load (gzip estimate for text)
  const overflow = []; // K17
  const smallTargets = new Map();
  try {
    for (const c of combos) {
      const ctx = await browser.newContext({ colorScheme: c.scheme, viewport: { width: c.width, height: c.height } });
      ctx.on("request", (r) => {
        total++;
        if (r.resourceType() === "font") { fonts++; if (!nonLocalRequest(r.url())) fontsLocal++; }
        if (nonLocalRequest(r.url())) {
          const k = `${r.url()}  [${r.resourceType()}, initiator page ${r.frame()?.url?.() ?? "?"}]`;
          external.set(k, (external.get(k) || 0) + 1);
        }
      });
      ctx.on("requestfailed", (r) => { if (!nonLocalRequest(r.url())) failedLocal.push(`${r.url()} ${r.failure()?.errorText}`); });
      const page = await ctx.newPage();
      page.on("response", (r) => { if (r.status() >= 400 && !/\/404\.html$/.test(page.url())) failedLocal.push(`HTTP ${r.status()} ${r.url()} (on ${page.url()})`); });
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()} ${m.text()}`); });
      page.on("websocket", (w) => { if (nonLocalRequest(w.url())) external.set(`WebSocket ${w.url()}`, 1); });
      let measuring = false;
      if (c.scheme === "light" && c.width === 1280) {
        page.on("response", async (r) => {
          if (!measuring) return;
          try {
            const body = await r.body(); const u = new URL(r.url()); const ct = r.headers()["content-type"] || "";
            const size = /text|javascript|json|svg|xml/.test(ct) ? require("node:zlib").gzipSync(body).length : body.length;
            homeBytes.total += size; if (/^image\//.test(ct) && !/svg/.test(ct)) homeBytes.images += size; homeBytes.files.push(`${u.pathname.split("/").pop() || "/"}=${size}`);
          } catch { /* redirects have no body */ }
        });
      }
      for (const p of pages) {
        measuring = p === "/" && c.scheme === "light" && c.width === 1280;
        const resp = await page.goto(`http://127.0.0.1:${port}${p}`, { waitUntil: "networkidle" });
        if (!resp || resp.status() >= 400) failedLocal.push(`${p} HTTP ${resp?.status()}`);
        // Trigger lazy content, then give late requests (analytics, prefetch) a window to appear.
        await page.evaluate(async () => {
          window.scrollTo(0, document.body.scrollHeight);
          await document.fonts.ready;
        });
        await page.waitForTimeout(400);
        measuring = false;
        loadedFaces += await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").length);
        const m = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          small: [...document.querySelectorAll("header a, header button, nav a, nav button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44); }).map((e) => `${(e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
        }));
        if (m.over) overflow.push(`${p} @${c.width}`);
        if (c.width === 375) for (const t of m.small) smallTargets.set(`${p} ${t}`, 1);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  lines.push(`${pages.length} pages x ${combos.length} contexts (light+dark at 1280, 375, 768 px), ${total} requests observed`);
  lines.push(`fonts: ${fonts} font requests, ${fontsLocal} local, ${loadedFaces} FontFace loads across contexts`);
  lines.push(`external (non-localhost) requests: ${external.size}`);
  for (const [k, n] of external) lines.push(`  EXTERNAL x${n} ${k}`);
  if (failedLocal.length) { lines.push(`local failures: ${failedLocal.length}`); for (const f of failedLocal.slice(0, 10)) lines.push(`  ${f}`); }
  if (consoleErrors.length) { lines.push(`console errors: ${consoleErrors.length}`); for (const f of consoleErrors.slice(0, 5)) lines.push(`  ${f}`); }
  lines.push(`home page transfer (K16, light 1280): ${(homeBytes.total / 1024).toFixed(0)} KB, of which raster images ${(homeBytes.images / 1024).toFixed(0)} KB, excluding those ${((homeBytes.total - homeBytes.images) / 1024).toFixed(0)} KB (limit 300)`);
  lines.push(`horizontal overflow (K17): ${overflow.length} page/width combos${overflow.length ? " " + overflow.slice(0, 6).join(", ") : ""}`);
  lines.push(`nav tap targets under 44 px at 375 wide (K17): ${smallTargets.size}${smallTargets.size ? " e.g. " + [...smallTargets.keys()].slice(0, 4).join("; ") : ""}`);
  const ok = external.size === 0 && overflow.length === 0 && homeBytes.total <= 300 * 1024 && fonts > 0 && fontsLocal === fonts && failedLocal.length === 0 && consoleErrors.length === 0;
  if (fonts === 0) lines.push("no font request seen: fonts did not load, the font check is void");
  finish({ mode: "site", status: ok ? "pass" : "fail", pages, requests: total, external: [...external.keys()], fontRequests: fonts, lines });
}

/* ------------------------------------------------------------------------------------------------ */
/* 3. Extension                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** Static part of P4/NN2: no eval, no remote scripts, no network API except fetch of data/blob/local URLs. */
function staticAudit(build) {
  const res = { ok: true, lines: [], urls: [], flagged: [] };
  const files = walk(build).filter((f) => /\.(js|html|css)$/.test(f));
  const NS = /^https?:\/\/(schemas\.(openxmlformats|microsoft)\.(org|com)|www\.w3\.org|purl\.org\/dc)\b/;
  const APP = /^https:\/\/showsteps\.vercel\.app(\/support\/|\/schema\/steps\.schema\.json)?$|^https:\/\/github\.com\/btahir\/showsteps/;
  // Documentation and issue-tracker links that libraries keep in comments and error strings. They are strings, never requested.
  const LIBDOC = /^https:\/\/(react\.dev\/|reactjs\.org\/|rolldown\.rs\/|answers\.microsoft\.com\/|developer\.mozilla\.org\/|bugs\.(webkit|chromium)\.org\/|json-schema\.org\/|github\.com\/(Hopding\/pdf-lib|ashtuchkin\/iconv-lite|facebook\/react|tc39\/|WICG\/|whatwg\/)|stuk\.github\.io\/jszip|tc39\.es\/|html\.spec\.whatwg\.org\/|w3c\.github\.io\/)/;
  const urls = new Set();
  const flagged = [];
  for (const f of files) {
    const rel = path.relative(build, f);
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/https?:\/\/[^"'`\s)\\<>]+/g)) urls.add(m[0]);
    if (/\beval\(|new Function\(/.test(text)) flagged.push(`${rel}: eval or new Function`);
    if (/<script[^>]+src=["']https?:/i.test(text) || /<link[^>]+href=["']https?:[^>]*stylesheet/i.test(text)) flagged.push(`${rel}: remote script or stylesheet`);
    for (const api of ["XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) if (new RegExp("\\b" + api + "\\b").test(text)) flagged.push(`${rel}: uses ${api}`);
    for (const m of text.matchAll(/(?<![\w.])fetch\(([^)]{0,80})\)/g)) {
      const arg = m[1];
      const viteModulePreload = /modulepreload/.test(text) && /e\.href/.test(arg);
      if (/https?:\/\//.test(arg)) flagged.push(`${rel}: fetch of a literal remote URL: ${arg}`);
      else res.lines.push(`fetch(${arg.slice(0, 40)}) in ${rel}${viteModulePreload ? " (Vite modulepreload polyfill: extension-local chunks only)" : " (argument is a variable: reviewed as data-URL/blob from captureVisibleTab)"}`);
    }
  }
  const unknown = [...urls].filter((u) => !NS.test(u) && !APP.test(u) && !LIBDOC.test(u)).sort();
  res.lines.unshift(`static audit: ${files.length} files, ${urls.size} distinct URL strings (${[...urls].filter((u) => NS.test(u)).length} XML/W3C namespaces, ${[...urls].filter((u) => APP.test(u)).length} app URLs, ${[...urls].filter((u) => LIBDOC.test(u)).length} library doc links), ${unknown.length} unrecognised`);
  for (const u of unknown) { flagged.push(`unrecognised URL string: ${u}`); }
  res.flagged = flagged;
  res.ok = flagged.length === 0;
  for (const f of flagged) res.lines.push(`  STATIC FLAG ${f}`);
  return res;
}

/** Drive the fixture flow with real mouse and keyboard input (same steps as apps/fixtures/flows/fixture-flow.json). */
async function driveFlow(ctx, tabs, flow) {
  for (const s of flow.steps) {
    const tp = tabs[s.tab];
    await tp.bringToFront();
    const loc = tp.locator(s.selector);
    if (s.do === "type") { await loc.click(); await tp.keyboard.type(s.value, { delay: 20 }); }
    else if (s.do === "select") await loc.selectOption(s.value);
    else if (s.do === "check") await loc.setChecked(!!s.checked);
    else if (s.do === "click") {
      if (s.then && s.then.opensTab) {
        const [np] = await Promise.all([ctx.waitForEvent("page"), loc.click()]);
        await np.waitForLoadState("load");
        tabs[s.then.opensTab] = np;
      } else await loc.click();
    }
    await tp.waitForTimeout(650); // capture scheduler spacing is 520 ms
  }
}

async function extensionMode() {
  const extDir = path.join(ROOT, "apps", "extension");
  const lines = [];
  const pending = (why) => finish({ mode: "extension", status: "pending", lines: [why, ...lines] });

  let build = flag("--build");
  const candidates = ["chrome-mv3-e2e", "chrome-mv3-production", "chrome-mv3"].map((d) => path.join(extDir, ".output", d));
  if (!build) build = candidates.find((d) => fs.existsSync(path.join(d, "manifest.json")));
  if (!build || !fs.existsSync(path.join(build, "manifest.json"))) return pending("apps/extension has no build (.output/chrome-mv3-e2e or -production): run pnpm --filter @stepsnap/extension build:e2e");
  const manifest = JSON.parse(fs.readFileSync(path.join(build, "manifest.json"), "utf8"));
  const hasHostAccess = (manifest.host_permissions || []).includes("<all_urls>");
  lines.push(`build: ${path.relative(ROOT, build)} (${hasHostAccess ? "host access granted at install: can record" : "store build: optional host permission cannot be granted headlessly, recorder not driven"})`);

  const audit = staticAudit(build);
  lines.push(...audit.lines);
  if (!audit.ok) return finish({ mode: "extension", status: "fail", lines });

  // fixture server (port 4517), reuse if already up
  const { spawn } = require("node:child_process");
  const FIX = 4517;
  const up = async () => { try { return (await fetch(`http://127.0.0.1:${FIX}/index.html`)).ok; } catch { return false; } };
  let fixtureProc = null;
  if (!(await up())) {
    fixtureProc = spawn(process.execPath, [path.join(ROOT, "apps", "fixtures", "server.mjs"), "--port", String(FIX)], { stdio: "ignore" });
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await up())) { fixtureProc.kill(); return finish({ mode: "extension", status: "fail", lines: ["fixture server did not start on 4517", ...lines] }); }
  }

  const pw = playwrightFrom(extDir);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "showsteps-nn-"));
  const netlog = path.join(userData, "netlog.json");
  const channel = launchChannel(true);
  const cleanup = () => { try { fixtureProc && fixtureProc.kill(); } catch {} try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} };
  let ctx;
  const external = new Map();
  const seen = { requests: 0, pages: 0 };
  try {
    ctx = await pw.chromium.launchPersistentContext(userData, {
      channel,
      headless: true,
      args: [
        `--disable-extensions-except=${build}`,
        `--load-extension=${build}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        `--log-net-log=${netlog}`,
        "--net-log-capture-mode=Default",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
    });
    ctx.on("request", (r) => {
      seen.requests++;
      if (nonLocalRequest(r.url())) external.set(`${r.url()} [${r.resourceType()}]`, 1);
    });
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => undefined);
    if (!sw) {
      await ctx.close(); ctx = undefined; cleanup();
      return pending(`extension service worker never started: this Chrome (${channel}) ignores --load-extension (branded Chrome, ACCEPTANCE F16). Needs bundled Chromium (\`playwright install chromium\`, not installed, download needs owner approval) or a Chrome that honours the flag.`);
    }
    const extId = new URL(sw.url()).host;
    lines.push(`extension id ${extId} loaded`);

    // Fixture pages on both origins, plus the extension's own pages.
    const page = await ctx.newPage();
    for (const origin of [`http://127.0.0.1:${FIX}`, `http://localhost:${FIX}`]) {
      for (const p of ["/index.html", "/help.html", "/settings.html", "/frame.html"]) {
        await page.goto(origin + p, { waitUntil: "load" }).catch(() => {});
        seen.pages++;
      }
    }
    const ext = await ctx.newPage();
    for (const p of ["/sidepanel.html", "/editor.html"]) {
      await ext.goto(`chrome-extension://${extId}${p}`, { waitUntil: "load" }).catch((e) => lines.push(`could not open ${p}: ${e.message.split("\n")[0]}`));
      await ext.waitForTimeout(500);
      seen.pages++;
    }

    // Recording flow (needs host access at install time).
    let recorded = null;
    if (hasHostAccess) {
      const flow = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "fixtures", "flows", "fixture-flow.json"), "utf8"));
      const tabs = { main: page };
      await page.goto(flow.baseUrl + flow.start, { waitUntil: "load" });
      const windowId = await ext.evaluate(() => chrome.windows.getCurrent().then((w) => w.id));
      const startTabId = await ext.evaluate(async (u) => (await chrome.tabs.query({ url: u + "*" }))[0]?.id, flow.baseUrl + flow.start);
      const started = await ext.evaluate(({ windowId, tabId }) => chrome.runtime.sendMessage({ type: "ctl:start", windowId, tabId }), { windowId, tabId: startTabId });
      lines.push(`ctl:start -> ${started && started.ok ? "ok" : JSON.stringify(started)}`);
      await page.bringToFront();
      await driveFlow(ctx, tabs, flow);
      const stopped = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "ctl:stop", openEditor: true }));
      recorded = stopped && stopped.ok;
      lines.push(`flow of ${flow.steps.length} steps driven, ctl:stop -> ${recorded ? "ok" : JSON.stringify(stopped)}`);
      await page.waitForTimeout(1500);
      // NN1: every export format from the editor UI, then import the project file back, all while the net-log runs.
      try {
        const editor = ctx.pages().find((p) => /editor\.html\?guide=/.test(p.url())) || (await ctx.waitForEvent("page", { predicate: (p) => /editor\.html\?guide=/.test(p.url()), timeout: 8000 }).catch(() => null));
        const done = []; let projectFile = null;
        if (editor) {
          await editor.bringToFront();
          lines.push(`editor page ${editor.url().replace(/^chrome-extension:\/\/[a-z]+/, "chrome-extension://<id>")}: ${(await editor.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160)}`);
          await editor.getByRole("button", { name: /^export/i }).first().click({ timeout: 10000 });
          const dialog = editor.locator("dialog.export");
          for (const fmt of ["markdown", "html", "pdf", "docx", "skill", "project"]) {
            await dialog.locator(`[data-format="${fmt}"]`).click();
            const [dl] = await Promise.all([editor.waitForEvent("download", { timeout: 60000 }), dialog.getByTestId("export-go").click()]);
            const target = path.join(userData, dl.suggestedFilename()); await dl.saveAs(target); done.push(fmt);
            if (fmt === "project") projectFile = target;
            await dialog.getByRole("button", { name: "Export another" }).click().catch(() => {});
          }
        }
        let imported = "not attempted";
        if (projectFile) {
          const imp = await ctx.newPage();
          await imp.goto(`chrome-extension://${extId}/sidepanel.html`);
          await imp.getByRole("button", { name: /^guides/i }).click().catch(() => {});
          await imp.locator('input[type="file"]').setInputFiles(projectFile);
          await imp.waitForTimeout(2500);
          imported = "project file imported through the panel";
        }
        lines.push(`UI exports driven: ${done.join(", ") || "none"}; import: ${imported}`);
      } catch (e) { lines.push(`UI exports/import step failed: ${String(e.message).split("\n").filter(Boolean).slice(0, 3).join(" ").slice(0, 300)}`); }
    } else {
      lines.push("recording not exercised (store build): only extension pages and fixture pages loaded");
    }
    await page.waitForTimeout(Number(flag("--idle-ms", "5000")));
    await ctx.close();
    ctx = undefined;

    // Net-log analysis.
    if (flag("--keep-netlog")) fs.copyFileSync(netlog, flag("--keep-netlog"));
    const nl = analyseNetlog(netlog, extId);
    lines.push(`Playwright saw ${seen.requests} requests over ${seen.pages} page loads; ${external.size} non-local`);
    for (const k of external.keys()) lines.push(`  EXTERNAL (playwright) ${k}`);
    if (nl.unreadable || nl.urlRequests === 0) { lines.push("net-log could not be read or holds no URL requests: the net-log part of this check is void"); external.set("net-log unreadable", 1); }
    lines.push(`net-log: ${nl.urlRequests} URL requests, ${nl.extensionRequests} initiated by the extension, ${nl.extensionNonLocal.length} of those non-loopback`);
    for (const r of nl.extensionNonLocal) lines.push(`  EXTERNAL (net-log, extension) ${r}`);
    lines.push(`net-log: non-loopback hosts contacted by the whole browser: ${nl.nonLocalHosts.join(", ") || "none"}`);
    lines.push(`net-log: host-resolution attempts for non-loopback hosts: ${nl.dnsAttempts.length}`);
    // Proof that any browser-internal traffic is not ours: the same browser without the extension contacts the same hosts.
    let baseline = null, onlyOurs = [];
    if (nl.nonLocalHosts.length || nl.dnsAttempts.length) {
      const bl = path.join(userData, "netlog-baseline.json");
      const bctx = await pw.chromium.launchPersistentContext(fs.mkdtempSync(path.join(userData, "base-")), {
        channel, headless: true,
        args: [`--log-net-log=${bl}`, "--net-log-capture-mode=Default", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
      });
      const bp = await bctx.newPage();
      for (const origin of [`http://127.0.0.1:${FIX}`, `http://localhost:${FIX}`]) for (const p2 of ["/index.html", "/help.html", "/settings.html", "/frame.html"]) await bp.goto(origin + p2, { waitUntil: "load" }).catch(() => {});
      if (recorded !== null) {
        // Same user actions (a password is typed), no extension: Chrome's own password leak check is triggered by the typing, not by us.
        const flow = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "fixtures", "flows", "fixture-flow.json"), "utf8"));
        await bp.goto(flow.baseUrl + flow.start, { waitUntil: "load" });
        await driveFlow(bctx, { main: bp }, flow);
      }
      await bp.waitForTimeout(Number(flag("--idle-ms", "5000")));
      await bctx.close();
      baseline = analyseNetlog(bl, extId);
      onlyOurs = [...new Set([...nl.nonLocalHosts.filter((h) => !baseline.nonLocalHosts.includes(h)), ...nl.dnsAttempts.filter((h) => !baseline.dnsAttempts.includes(h))])];
      lines.push(`baseline (same Chromium, no extension): non-loopback hosts ${baseline.nonLocalHosts.join(", ") || "none"}`);
      lines.push(`hosts contacted only when the extension is loaded: ${onlyOurs.join(", ") || "none"}`);
    }
    const ok = external.size === 0 && nl.extensionNonLocal.length === 0 && onlyOurs.length === 0;
    finish({ mode: "extension", status: ok ? "pass" : "fail", build: path.relative(ROOT, build), recorded, netlog: nl, baseline, lines });
  } catch (e) {
    try { if (ctx) await ctx.close(); } catch {}
    lines.push(`error: ${e && e.stack || e}`);
    finish({ mode: "extension", status: "fail", lines });
  } finally {
    cleanup();
  }
}

function analyseNetlog(file, extId) {
  const out = { urlRequests: 0, extensionRequests: 0, extensionNonLocal: [], nonLocalHosts: [], dnsAttempts: [], extensionDns: [], unreadable: false };
  if (!fs.existsSync(file)) { out.unreadable = true; return out; }
  const raw = fs.readFileSync(file, "utf8").trim();
  let j;
  try { j = JSON.parse(raw); } catch {
    // Chrome writes the closing brackets only on a clean exit; repair a truncated log.
    try { j = JSON.parse(raw.replace(/,\s*$/, "") + "]}"); } catch { out.unreadable = true; return out; }
  }
  const typeName = Object.fromEntries(Object.entries(j.constants.logEventTypes).map(([k, v]) => [v, k]));
  const srcName = Object.fromEntries(Object.entries(j.constants.logSourceType).map(([k, v]) => [v, k]));
  const bySource = new Map();
  for (const ev of j.events) {
    const s = bySource.get(ev.source.id) || { type: srcName[ev.source.type], events: [] };
    s.events.push({ name: typeName[ev.type], params: ev.params });
    bySource.set(ev.source.id, s);
  }
  const hosts = new Set(), dnsHosts = new Set();
  for (const s of bySource.values()) {
    if (s.type === "URL_REQUEST") {
      out.urlRequests++;
      const first = s.events.find((e) => e.params && e.params.url);
      const p = first && first.params;
      if (!p) continue;
      const fromExt = String(p.initiator || "").startsWith("chrome-extension://");
      if (fromExt) out.extensionRequests++;
      if (nonLocalRequest(p.url)) {
        hosts.add(new URL(p.url).host);
        if (fromExt) out.extensionNonLocal.push(`${p.method || "GET"} ${p.url} (initiator ${p.initiator})`);
      }
    } else if (s.type === "HOST_RESOLVER_IMPL_JOB" || s.type === "NETWORK_SERVICE_HOST_RESOLVER") {
      for (const e of s.events) {
        const h = e.params && (e.params.host || e.params.host_resolver_hostname);
        if (h) { const host = String(h).replace(/:\d+$/, "").replace(/^\[|\]$/g, ""); if (!isLocalHost(host)) dnsHosts.add(host); }
      }
    }
  }
  out.nonLocalHosts = [...hosts].sort();
  out.dnsAttempts = [...dnsHosts].sort();
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Self test for the preload                                                                         */
/* ------------------------------------------------------------------------------------------------ */
function selfTest() {
  const { spawnSync } = require("node:child_process");
  const probes = {
    "net.connect to a public IP throws": `const n=require("net");try{n.connect(80,"93.184.216.34");console.log("NO")}catch(e){console.log(e.code)}`,
    "dns.lookup of a public name throws": `try{require("dns").lookup("example.com",()=>{});console.log("NO")}catch(e){console.log(e.code)}`,
    "http.request throws": `try{require("http").request("http://example.com/");console.log("NO")}catch(e){console.log(e.code)}`,
    "https.get throws": `try{require("https").get({hostname:"example.com"});console.log("NO")}catch(e){console.log(e.code)}`,
    "fetch rejects": `fetch("https://example.com/").then(()=>console.log("NO"),e=>console.log(e.code||e.cause&&e.cause.code||"NO"))`,
    "loopback TCP still works": `const s=require("net").createServer(c=>c.end("ok")).listen(0,"127.0.0.1",()=>{const c=require("net").connect(s.address().port,"127.0.0.1");c.on("data",d=>{console.log(String(d)==="ok"?"ALLOWED":"NO");c.destroy();s.close()})})`,
    "unix socket path still works": `const p=require("path").join(require("os").tmpdir(),"nn-"+process.pid+".sock");const s=require("net").createServer(c=>c.end("ok")).listen(p,()=>{const c=require("net").connect(p);c.on("data",d=>{console.log(String(d)==="ok"?"ALLOWED":"NO");c.destroy();s.close()})})`,
  };
  let bad = 0;
  for (const [name, code] of Object.entries(probes)) {
    const r = spawnSync(process.execPath, ["--require", __filename, "-e", code], { encoding: "utf8", timeout: 15000 });
    const out = (r.stdout || "").trim();
    const want = name.includes("still works") ? "ALLOWED" : "ENONETWORK";
    const ok = out === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} -> ${out || r.stderr.trim().slice(0, 120)}`);
  }
  console.log(bad ? `self-test: ${bad} FAILED` : `self-test: ${Object.keys(probes).length} preload probes ok`);
  process.exit(bad ? 1 : 0);
}

/* ------------------------------------------------------------------------------------------------ */
if (require.main === module) {
  const cmd = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a) && a !== flag("--port") && a !== flag("--build") && a !== flag("--idle-ms") && a !== flag("--keep-netlog"));
  if (args.includes("--self-test")) selfTest();
  else if (cmd === "site") siteMode().catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === "extension") extensionMode().catch((e) => { console.error(e); process.exit(1); });
  else { console.error("usage: no-network.cjs site|extension [opts] | --self-test  (or --require it as a preload)"); process.exit(2); }
} else {
  installGuard();
}
module.exports = { isLocalHost, nonLocalRequest };
