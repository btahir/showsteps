/**
 * Serves the steps.json JSON Schema at its $id URL (SITE_URL/schema/steps.schema.json).
 * The file is copied byte for byte from packages/core/schema, so the site and the package cannot drift.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function GET() {
  const body = readFileSync(resolve(process.cwd(), "../../packages/core/schema/steps.schema.json"), "utf8");
  return new Response(body, { headers: { "Content-Type": "application/schema+json; charset=utf-8" } });
}
