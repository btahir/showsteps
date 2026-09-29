// Bundles src/index.ts into a single IIFE that content scripts and Playwright can inject.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/stepsnap-dom.iife.js"),
  bundle: true,
  format: "iife",
  globalName: "StepsnapDom",
  target: "es2022",
  minify: false,
  legalComments: "none",
  // Some injectors (Playwright init scripts) evaluate the file inside a function, so `var` would not be global.
  footer: { js: "globalThis.StepsnapDom = StepsnapDom;" },
});
console.log("built dist/stepsnap-dom.iife.js");
