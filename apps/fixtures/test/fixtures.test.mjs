import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "../server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flow = JSON.parse(readFileSync(join(root, "flows/fixture-flow.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(root, "flows/expected-steps.json"), "utf8"));

async function withServer(fn, opts) {
  const server = await startFixtureServer(0, opts);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("serves every page and asset with the right type", async () => {
  await withServer(async (base) => {
    for (const [path, type] of [
      ["/", "text/html"], ["/index.html", "text/html"], ["/dashboard.html", "text/html"], ["/settings.html", "text/html"],
      ["/help.html", "text/html"], ["/frame.html", "text/html"], ["/assets/app.css", "text/css"], ["/assets/dashboard.js", "text/javascript"],
    ]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type"), new RegExp(type), path);
    }
  });
});

test("SPA routes fall back to the dashboard page", async () => {
  await withServer(async (base) => {
    const a = await (await fetch(`${base}/dashboard/reports`)).text();
    const b = await (await fetch(`${base}/dashboard.html`)).text();
    assert.equal(a, b);
  });
});

test("unknown paths 404 and traversal is refused", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
    assert.notEqual((await fetch(`${base}/%2e%2e/server.mjs`)).status, 200);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
  });
});

test("every local link and script in the site resolves", async () => {
  await withServer(async (base) => {
    const pages = [
      ...readdirSync(join(root, "site")).filter((f) => f.endsWith(".html")),
      ...readdirSync(join(root, "site/edge")).filter((f) => f.endsWith(".html")).map((f) => `edge/${f}`),
    ];
    for (const page of pages) {
      const html = readFileSync(join(root, "site", page), "utf8");
      for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) {
        const res = await fetch(base + m[1]);
        await res.arrayBuffer();
        assert.equal(res.status, 200, `${page} references ${m[1]}`);
      }
    }
  });
});

test("flow has 10 steps over two tabs and expected-steps matches it one to one", () => {
  assert.equal(flow.steps.length, 10);
  assert.equal(expected.steps.length, 10);
  assert.deepEqual(expected.steps.map((s) => s.flowStep), flow.steps.map((s) => s.id));
  assert.deepEqual([...new Set(flow.steps.map((s) => s.tab))].sort(), ["help", "main"]);
  assert.ok(flow.steps.some((s) => s.tab === "help"));
});

test("flow selectors and highlight selectors point at ids that exist in the site", () => {
  const all = readdirSync(join(root, "site"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => readFileSync(join(root, "site", f), "utf8"))
    .concat(readFileSync(join(root, "site/assets/dashboard.js"), "utf8"))
    .join("\n");
  for (const s of flow.steps) {
    const id = s.selector.replace(/^#/, "");
    assert.match(all, new RegExp(`id="${id}"`), `${s.id} ${s.selector}`);
  }
  for (const e of expected.steps) {
    const id = e.highlight.replace(/^#/, "");
    assert.match(all, new RegExp(`id="${id}"`), `${e.flowStep} highlight`);
  }
});

test("titles follow the grammar and never contain the secret", () => {
  for (const e of expected.steps) {
    assert.match(e.title, /^(Click|Type|Search for|Select|Check|Enter your password)/, e.title);
    for (const secret of flow.secrets) assert.ok(!e.title.includes(secret));
  }
  const pw = expected.steps.find((e) => e.flowStep === "s02");
  assert.equal(pw.action.masked, true);
  assert.equal(pw.sensitive, true);
});

// ACCEPTANCE §E/§R: the edge pages every extension check needs exist (mock data only).
const EDGE_PAGES = [
  "burst", "pointerdown-remove", "banner-a", "banner-b", "xorigin-frame", "frame-inner", "nested-frame", "nested-mid",
  "scaled-frame", "xorigin-scaled", "shadow-open", "shadow-closed", "spa", "editors", "sensitive", "neutral", "newtab",
  "select", "heavy", "blocked-messages",
];

test("edge pages are served, and cross-origin ones point at localhost", async () => {
  await withServer(async (base) => {
    for (const name of EDGE_PAGES) {
      const res = await fetch(`${base}/edge/${name}.html`);
      assert.equal(res.status, 200, name);
      const html = await res.text();
      assert.match(html, /<title>[^<]+<\/title>/, name);
    }
    for (const name of ["xorigin-frame", "xorigin-scaled", "blocked-messages", "nested-mid"]) {
      const html = readFileSync(join(root, "site/edge", `${name}.html`), "utf8");
      assert.match(html, /src="http:\/\/localhost:4517\/edge\/frame-inner\.html"/, name);
    }
  });
});

test("sensitive and neutral pages carry the canaries they promise (and neutral none of them)", () => {
  const sens = readFileSync(join(root, "site/edge/sensitive.html"), "utf8");
  for (const c of ["Correct-Horse-9", "4242 4242 4242 4242", "123-45-6789", "sk_" + "live_51HxxxxxxxxxxxxxxxxxxxxxxxxxxTEST", 'autocomplete="cc-number"', 'autocomplete="new-password"']) assert.ok(sens.includes(c), c);
  const neutral = readFileSync(join(root, "site/edge/neutral.html"), "utf8");
  for (const c of ["Correct-Horse-9", "4242", "123-45-6789", "sk_live", 'type="password"']) assert.ok(!neutral.includes(c), c);
  assert.ok(neutral.includes("Passenger name"));
});

test("mutate mode renames the login button (G4), at start or at run time, and only on the login page", async () => {
  await withServer(async (base) => {
    assert.match(await (await fetch(`${base}/index.html`)).text(), /type="submit">Log in<\/button>/);
    assert.doesNotMatch(await (await fetch(`${base}/index.html`)).text(), />Sign in<\/button>/);
  }, { mutate: true });
  await withServer(async (base) => {
    assert.match(await (await fetch(`${base}/index.html`)).text(), />Sign in<\/button>/);
    assert.deepEqual(await (await fetch(`${base}/__fixtures/mutate?on=1`)).json(), { mutate: true });
    assert.match(await (await fetch(`${base}/index.html`)).text(), />Log in<\/button>/);
    const dash = await (await fetch(`${base}/dashboard.html`)).text();
    assert.equal(dash, readFileSync(join(root, "site/dashboard.html"), "utf8"));
    assert.deepEqual(await (await fetch(`${base}/__fixtures/mutate?on=0`)).json(), { mutate: false });
    assert.match(await (await fetch(`${base}/index.html`)).text(), />Sign in<\/button>/);
  });
  // The page-level switch does the same in the browser.
  assert.match(readFileSync(join(root, "site/assets/login.js"), "utf8"), /mutate.*=== "1"/);
});
