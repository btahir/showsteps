// Builds the HyperFrames projects (apps/launch/.work/<name>/) from the templates and the real footage.
//
//   node compose.mjs launch|hero-light|hero-dark|all
//
// Inputs:  docs/launch/media/footage/<theme>/ (from capture/capture.mjs), docs/launch/media/track.mp3,
//          packages/brand (mark, fonts), video/template.html, hero/template.html, shared/kit.js.
// Outputs: .work/<name>/{index.html, hyperframes.json, assets/...} (gitignored).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRAND, FOOT, MEDIA, ROOT, flowData, json, markSvg, read, skillData } from "./lib/footage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WORK = join(here, ".work");
const KIT = readFileSync(join(here, "shared/kit.js"), "utf8");

function copyAssets(proj, themes, { screens = null, track = false } = {}) {
  const a = join(proj, "assets");
  mkdirSync(join(a, "fonts"), { recursive: true });
  for (const f of ["RethinkSans-Variable-latin.woff2", "FragmentMono-Regular-latin.woff2"]) cpSync(join(BRAND, "fonts", f), join(a, "fonts", f));
  for (const t of themes) {
    const src = join(FOOT, t);
    const dst = join(a, t);
    mkdirSync(join(dst, "screens"), { recursive: true });
    mkdirSync(join(dst, "steps"), { recursive: true });
    for (const f of readdirSync(join(src, "screens"))) if (!screens || screens.test(f)) cpSync(join(src, "screens", f), join(dst, "screens", f));
    for (const f of readdirSync(join(src, "steps"))) cpSync(join(src, "steps", f), join(dst, "steps", f));
  }
  if (track) {
    const t = join(MEDIA, track);
    if (!existsSync(t)) throw new Error(`Missing ${t}: run audio/make-track.mjs (render.sh does)`);
    cpSync(t, join(a, "track.mp3"));
  }
}

function writeProject(name, html, extra = {}) {
  const proj = join(WORK, name);
  writeFileSync(join(proj, "index.html"), html);
  writeFileSync(
    join(proj, "hyperframes.json"),
    JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true }, ...extra }, null, 2),
  );
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name, private: true, type: "module" }, null, 2));
  return proj;
}

function fillTemplate(tpl, data) {
  return tpl.replace("/*__KIT__*/", () => KIT).replace("/*__DATA__*/", () => JSON.stringify(data));
}

function launch() {
  const proj = join(WORK, "launch");
  rmSync(proj, { recursive: true, force: true });
  mkdirSync(proj, { recursive: true });
  const T = json(join(here, "video/timings.json"));
  const { d, flow, boxes, corners } = flowData("light");
  copyAssets(proj, ["light"], { screens: /^(clean-|page-|editor|guide-html\.png)/, track: "track.mp3" });
  const data = { T, boxes, corners, editor: flow.editor, mark: markSvg(), markWhite: markSvg("#FFFFFF"), skill: skillData(d) };
  writeProject("launch", fillTemplate(read(join(here, "video/template.html")), data));
  return proj;
}

function hero(theme) {
  const name = `hero-${theme}`;
  const proj = join(WORK, name);
  rmSync(proj, { recursive: true, force: true });
  mkdirSync(proj, { recursive: true });
  const T = json(join(here, "hero/timings.json"));
  const light = flowData("light");
  const themed = flowData(theme);
  copyAssets(proj, ["light", theme], { screens: /^(clean-|page-)/ });
  const data = { theme, T, boxes: light.boxes, corners: light.corners, editor: themed.flow.editor, mark: markSvg(theme === "dark" ? "#FF6337" : null), skill: skillData(themed.d), steps: heroSteps(light) };
  writeProject(name, fillTemplate(read(join(here, "hero/template.html")), data));
  return proj;
}

/** The recorded steps shown in the hero's guide column: real titles, stored screenshots, highlight rects. */
function heroSteps(f) {
  const acts = f.guide.steps.filter((s) => s.action.type !== "navigate");
  const ids = ["s01", "s02", "s03", "s07", "s08"];
  return ids.map((fid, i) => {
    const k = f.flow.steps.findIndex((x) => x.id === fid);
    const s = acts[k];
    return {
      n: i + 1,
      title: s.title,
      id: s.id,
      image: `assets/light/steps/${s.id}.png`,
      w: s.screenshot.width,
      h: s.screenshot.height,
      dpr: s.screenshot.width / (s.screenshot.viewport?.width ?? 1280),
      hl: s.screenshot.highlight,
      corner: s.screenshot.highlight.corner ?? "top-right",
    };
  });
}

const which = process.argv[2] ?? "all";
mkdirSync(WORK, { recursive: true });
if (which === "launch" || which === "all") console.log("composed", launch());
if (which === "hero-light" || which === "hero" || which === "all") if (existsSync(join(here, "hero/template.html"))) console.log("composed", hero("light"));
if (which === "hero-dark" || which === "hero" || which === "all") if (existsSync(join(here, "hero/template.html"))) console.log("composed", hero("dark"));
