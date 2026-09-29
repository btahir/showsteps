import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "../server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flow = JSON.parse(readFileSync(join(root, "flows/fixture-flow.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(root, "flows/expected-steps.json"), "utf8"));

async function withServer(fn) {
  const server = await startFixtureServer(0);
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
    const pages = readdirSync(join(root, "site")).filter((f) => f.endsWith(".html"));
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
