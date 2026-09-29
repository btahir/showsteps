import { abs } from "../config/site";

export function GET() {
  const body = `User-agent: *
Allow: /

Sitemap: ${abs("/sitemap.xml")}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
