// Bundles the MCP server (with @showsteps/core and the shared CLI ops inlined) into one Node file.
import { build } from "esbuild";
import { chmod } from "node:fs/promises";

const banner = [
  "#!/usr/bin/env node",
  'import { createRequire as __cr } from "node:module";',
  "const require = __cr(import.meta.url);",
].join("\n");

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/showsteps-mcp.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: banner },
  legalComments: "none",
  logLevel: "info",
});
await chmod("dist/showsteps-mcp.js", 0o755);
