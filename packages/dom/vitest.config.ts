import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    // Never let happy-dom fetch iframe sources: unit tests must not touch the network.
    environmentOptions: { happyDOM: { url: "http://localhost:3000/", settings: { disableIframePageLoading: true } } },
  },
});
