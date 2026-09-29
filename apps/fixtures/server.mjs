// Zero-dependency static server for the Acme Books fixture site. Port 4517 by default.
//   pnpm --filter @showsteps/fixtures serve            (or: node server.mjs [--port 4517] [--mutate])
// `/` serves the login page and `/dashboard/*` falls back to dashboard.html so the SPA can pushState.
// Listens on 127.0.0.1 and, when the machine has it, ::1, so http://127.0.0.1:4517 and
// http://localhost:4517 both work (two origins for the cross-origin fixtures in /edge/).
//
// Mutate mode (ACCEPTANCE G4, the replay's negative control): the login button is renamed from
// "Sign in" to "Log in", so a replay recorded against the normal site must fail. Turn it on with
// `--mutate` or FIXTURES_MUTATE=1 at start, or at run time with GET /__fixtures/mutate?on=1
// (and ?on=0 to turn it off). A page opened with ?mutate=1 renames the button itself too.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, sep } from "node:path";

export const DEFAULT_PORT = 4517;
const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function resolvePath(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === "/") p = "/index.html";
  if (p === "/dashboard" || p.startsWith("/dashboard/")) p = "/dashboard.html";
  const full = normalize(join(SITE, p));
  if (full !== SITE && !full.startsWith(SITE + sep)) return null; // path traversal
  return full;
}

/** Login button text in mutate mode (G4). */
export const MUTATED_LABEL = "Log in";

export function mutateHtml(path, html) {
  if (!path.endsWith("index.html")) return html;
  return html.replace('type="submit">Sign in</button>', `type="submit">${MUTATED_LABEL}</button>`);
}

export function createFixtureServer(opts = {}) {
  const state = { mutate: !!opts.mutate };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/__fixtures/mutate") {
        const on = url.searchParams.get("on");
        if (on === "1" || on === "0") state.mutate = on === "1";
        res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }).end(JSON.stringify({ mutate: state.mutate }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const file = resolvePath(url.pathname);
      if (!file) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404, { "Content-Type": TYPES[".txt"] }).end("Not found");
        return;
      }
      let body = await readFile(file);
      if (state.mutate && extname(file) === ".html") body = Buffer.from(mutateHtml(file, body.toString("utf8")));
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      res.writeHead(500, { "Content-Type": TYPES[".txt"] }).end(String(err));
    }
  });
  server.fixtureState = state;
  return server;
}

export function startFixtureServer(port = DEFAULT_PORT, opts = {}) {
  const server = createFixtureServer(opts);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      // localhost may resolve to ::1 first: answer there too (same handler and state), best effort.
      const v6 = createServer((req, res) => server.emit("request", req, res));
      v6.once("error", () => {});
      v6.listen(server.address().port, "::1");
      server.once("close", () => v6.close());
      resolve(server);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--port");
  const port = Number(i > 0 ? process.argv[i + 1] : process.env.PORT ?? DEFAULT_PORT);
  const mutate = process.argv.includes("--mutate") || process.env.FIXTURES_MUTATE === "1";
  const server = await startFixtureServer(port, { mutate });
  console.log(`Acme Books fixtures on http://127.0.0.1:${port}/ and http://localhost:${port}/${mutate ? " (mutate mode)" : ""}`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}
