// Zero-dependency static server for the Acme Books fixture site. Port 4517 by default.
//   pnpm --filter @stepsnap/fixtures serve            (or: node server.mjs [--port 4517])
// `/` serves the login page and `/dashboard/*` falls back to dashboard.html so the SPA can pushState.
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

export function createFixtureServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
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
      const body = await readFile(file);
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
}

export function startFixtureServer(port = DEFAULT_PORT) {
  const server = createFixtureServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--port");
  const port = Number(i > 0 ? process.argv[i + 1] : process.env.PORT ?? DEFAULT_PORT);
  const server = await startFixtureServer(port);
  console.log(`Acme Books fixtures on http://127.0.0.1:${port}/`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}
