import { createRoot } from "react-dom/client";
import "../../ui/theme.css";
import "../../ui/shot.css";
import "../../ui/guide.css";
import "../../ui/export.css";
import "./editor.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

// e2e builds only: both screenshot renderers side by side for ACCEPTANCE X-RENDER-PARITY (the
// editor's canvas renderer and core's pure-TS raster renderer, run in this same page).
if (import.meta.env.MODE === "e2e") {
  void Promise.all([import("../../lib/render"), import("@showsteps/core")]).then(([render, core]) => {
    (globalThis as Record<string, unknown>).__showstepsE2E = {
      renderAnnotated: render.renderAnnotated,
      renderGuideImages: core.renderGuideImages,
      flagLayout: core.flagLayout,
      highlightScale: core.highlightScale,
      stepNumbers: core.stepNumbers,
      isInputLike: core.isInputLike,
    };
  });
}
