import { defineConfig } from "astro/config";
import { SITE_URL } from "./src/config/site.ts";

// Static output. SITE_URL comes from the one config file.
export default defineConfig({
  site: SITE_URL,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  server: { port: 4630 },
  devToolbar: { enabled: false },
});
