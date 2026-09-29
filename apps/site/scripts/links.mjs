// Internal link and asset crawl over dist/. Exit 1 on any broken link.   node scripts/links.mjs
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
const dist = new URL("../dist/", import.meta.url).pathname;
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : e.endsWith(".html") && files.push(p); } })(dist);
const exists = (u) => {
  const path = decodeURIComponent(u.split("#")[0].split("?")[0]);
  if (!path) return true;
  const f = join(dist, path);
  return existsSync(f) && (statSync(f).isFile() || existsSync(join(f, "index.html")));
};
let bad = 0, n = 0;
for (const f of files) {
  const html = readFileSync(f, "utf8").replace(/src="data:[^"]*"/g, "");
  for (const m of html.matchAll(/(?:href|src|srcset)="(\/[^"\s]*)"/g)) {
    n++;
    if (!exists(m[1])) { bad++; console.log("BROKEN", f.replace(dist, ""), m[1]); }
  }
  if (!f.endsWith("404.html")) for (const m of html.matchAll(/href="(https:\/\/showsteps\.vercel\.app[^"]*)"/g)) {
    n++;
    if (!exists(new URL(m[1]).pathname)) { bad++; console.log("BROKEN abs", f.replace(dist, ""), m[1]); }
  }
}
console.log(bad ? `${bad} broken of ${n} links` : `links: ${n} internal links/assets checked across ${files.length} pages, none broken`);
process.exit(bad ? 1 : 0);
