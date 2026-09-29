// Shared readers for the captured footage (used by compose.mjs and the screenshot builders).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../../..");
export const MEDIA = join(ROOT, "docs/launch/media");
export const FOOT = join(MEDIA, "footage");
export const BRAND = join(ROOT, "packages/brand");

export const read = (p) => readFileSync(p, "utf8");
export const json = (p) => JSON.parse(read(p));

export function markSvg(fill) {
  let s = read(join(BRAND, "mark.svg")).replace(/ width="104" height="104"/, "");
  if (fill) s = s.replace(/#EB4E26/g, fill);
  return s;
}

export function need(theme) {
  const d = join(FOOT, theme);
  if (!existsSync(join(d, "guide.json"))) throw new Error(`Missing footage for ${theme}: run capture/capture.mjs first (see render.sh)`);
  return d;
}

/** Stored-image indices -> flow-step boxes, plus the highlight corner the recorder measured. */
export function flowData(theme) {
  const d = need(theme);
  const flow = json(join(d, "flow.json"));
  const guide = json(join(d, "guide.json"));
  const boxes = {}, corners = {};
  for (const s of flow.steps) boxes[s.id] = s.box;
  // Match recorded steps to flow steps by order of non-navigate steps.
  const acts = guide.steps.filter((s) => s.action.type !== "navigate");
  flow.steps.forEach((f, i) => {
    corners[f.id] = acts[i]?.screenshot?.highlight?.corner ?? "top-right";
  });
  return { d, flow, guide, boxes, corners };
}

export function skillData(d) {
  const skillDir = join(d, "export/skill");
  const sub = readdirSync(skillDir).find((f) => existsSync(join(skillDir, f, "SKILL.md")));
  const dir = sub ? join(skillDir, sub) : skillDir;
  const md = read(join(dir, "SKILL.md")).split("\n");
  const spec = read(join(dir, "replay.spec.ts")).split("\n");
  const out = [];
  const name = md.find((l) => l.startsWith("name:")) ?? "";
  out.push("---", name.replace(/"/g, ""));
  const desc = (md.find((l) => l.startsWith("description:")) ?? "").replace(/\\"/g, "'");
  out.push(desc.replace(/"/g, "").slice(0, 60) + "...", "---");
  const title = md.find((l) => l.startsWith("# ")) ?? "";
  out.push(title);
  const si = md.findIndex((l) => l.startsWith("## Steps"));
  out.push("## Steps");
  const steps = md.slice(si + 1).filter((l) => l.trim() && !l.startsWith("## "));
  // step 1..3 with their first detail line
  const pick = [];
  let count = 0;
  for (const l of steps) {
    if (/^\d+\./.test(l)) count++;
    if (count > 3) break;
    if (/^\s*- (Tab|URL|Page)/.test(l)) continue;
    pick.push(l);
  }
  out.push(...pick);
  const stepLines = spec.filter((l) => /test\.step\(|await page\.(goto|getBy)/.test(l)).map((l) => l.replace(/^\s{0,2}/, ""));
  const specLines = [spec.find((l) => l.startsWith("import")) ?? "", "", ...stepLines.slice(0, 7)].map((l) => (l.length > 74 ? l.slice(0, 73) + "..." : l));
  const outText = existsSync(join(d, "replay-output.txt")) ? read(join(d, "replay-output.txt")) : "";
  const term = outText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(Running|✓|\d+ passed)/.test(l))
    .map((l) => ({ t: l, ok: /^(✓|\d+ passed)/.test(l) }));
  return { md: out.slice(0, 15), spec: specLines, cmd: "npx playwright test replay.spec.ts", term: term.length ? term : [{ t: "1 passed", ok: true }] };
}

