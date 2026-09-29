/**
 * /sample/: a real exported guide, produced at build time by calling core's exportHtml on a recorded
 * mock guide (synthetic "Acme Books" data from the extension e2e run), so the site dogfoods the exporter.
 * Source bundle: src/sample/acme-sign-in.showsteps
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unpackBundle, exportHtml, regenerateTitles } from "@showsteps/core";
import type { Guide } from "@showsteps/core";

export function GET() {
  const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), "src/sample/acme-sign-in.showsteps")));
  const { guide: raw, images } = unpackBundle(bytes);
  // The recording ran against a local fixture server; show a plausible mock host instead.
  const swap = (s: string) => s.replaceAll("http://127.0.0.1:4517", "https://books.acme.test");
  const guide = regenerateTitles(JSON.parse(swap(JSON.stringify(raw))) as Guide);
  guide.createdAt = "2026-09-28T12:00:00.000Z";
  guide.updatedAt = guide.createdAt;
  guide.title = "Switch a workspace to yearly billing";
  guide.description = "Sign in to Acme Books, find the help centre, then change the billing period. Sample guide made with Showsteps; every name and value is mock data.";
  let html = exportHtml(guide, images, { branding: false });
  // Same-origin icon so browsers do not request /favicon.ico (a 404 on this site).
  if (!/<link[^>]+rel="icon"/.test(html)) html = html.replace("</head>", '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n</head>');
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
