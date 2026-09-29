import { defineConfig } from "wxt";
import react from "@vitejs/plugin-react";

// `--mode e2e` builds a test copy whose host access is granted at install time, because
// Playwright cannot click Chrome's permission prompt. The shipped build asks for
// <all_urls> only when the user presses Record (optional_host_permissions).
export default defineConfig({
  srcDir: "src",
  vite: () => ({
    plugins: [react()],
    build: {
      rolldownOptions: {
        // Workspace packages are pure modules: let the bundler drop what a page does not use
        // (keeps pdf-lib and docx out of the service worker and the side panel).
        treeshake: { moduleSideEffects: (id: string) => !/[\\/]packages[\\/](core|dom)[\\/]|[\\/]node_modules[\\/].*(pdf-lib|docx|@pdf-lib|fflate|jszip)/.test(id) },
      },
    },
  }),
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}-{{mode}}",
  dev: { server: { port: 4620 } },
  manifest: ({ mode }) => ({
    name: "Showsteps",
    short_name: "Showsteps",
    description:
      "Record a task in Chrome and get a step-by-step guide with screenshots. Sensitive fields blurred. Everything stays on your device.",
    permissions: ["activeTab", "scripting", "storage", "sidePanel", "unlimitedStorage"],
    ...(mode === "e2e" ? { host_permissions: ["<all_urls>"] } : { optional_host_permissions: ["<all_urls>"] }),
    action: { default_title: "Showsteps" },
    commands: {
      "toggle-pause": { suggested_key: { default: "Alt+Shift+P" }, description: "Pause or resume recording" },
      "stop-recording": { suggested_key: { default: "Alt+Shift+S" }, description: "Stop recording" },
    },
    minimum_chrome_version: "120",
  }),
  webExt: { disabled: true },
});
