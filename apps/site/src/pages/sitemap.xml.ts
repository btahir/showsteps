import { abs } from "../config/site";
import { KEYWORD_PAGES } from "../data/keyword-pages";

const STATIC = ["/", "/support/", "/about/", "/privacy/", "/docs/agents/", "/changelog/"];

export function GET() {
  const urls = [...STATIC, ...KEYWORD_PAGES.map((p) => `/${p.slug}/`)];
  const lastmod = "2026-09-28";
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(u)}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
