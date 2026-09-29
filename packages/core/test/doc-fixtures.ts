// Synthetic 4-step guide (+1 skipped) shared by pdf.test.ts and docx.test.ts. Tiny PNGs are
// generated in code; nothing here depends on the core agent's fixtures.
import { encodePng } from "../src/export/doc-shared";
import type { Guide, Step } from "../src/schema";

/** RGBA PNG from a per-pixel function. */
export function makePng(width: number, height: number, px: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return encodePng({ width, height, data });
}

export const MAGENTA: [number, number, number] = [255, 0, 255]; // stands in for a sensitive value's pixels
export const SECRET = "hunter2-SECRET-4242";

export function makeStep(i: number, over: Partial<Step> = {}, w = 160, h = 100): Step {
  return {
    id: `s_${i}`,
    action: { type: "click" },
    title: `Click **Item ${i}**`,
    page: { url: `https://app.example.com/page/${i}`, title: `Page ${i}` },
    screenshot: {
      image: `images/s_${i}.png`,
      width: w,
      height: h,
      devicePixelRatio: 1,
      viewport: { width: w, height: h, scrollX: 0, scrollY: 0 },
      highlight: { x: 20, y: 20, width: 50, height: 20 },
    },
    timestamp: "2026-09-28T10:00:00.000Z",
    ...over,
  };
}

export function makeGuide(): { guide: Guide; images: Record<string, Uint8Array> } {
  const steps: Step[] = [
    makeStep(1, { action: { type: "navigate", url: "https://app.example.com/settings" }, title: "Go to **Settings – Acme**" }),
    makeStep(2, {
      title: "Click **Save**",
      description: "Saving applies the change **immediately**.\n\n- Everyone on the team sees it\n- It can be undone from History",
    }),
    makeStep(3, {
      action: { type: "type", value: SECRET, masked: true },
      title: "Type in **Password**",
      target: { tag: "input", inputType: "password", sensitive: true, locators: [{ kind: "css", value: "#pw" }] },
      screenshot: {
        ...makeStep(3).screenshot!,
        redactions: [{ rect: { x: 40, y: 50, width: 60, height: 20 }, style: "blur", auto: true }],
      },
    }),
    makeStep(4, { title: "Press **Enter**", action: { type: "press", key: "Enter" } }),
    makeStep(5, { title: "SKIPPED STEP TITLE", skipped: true }),
  ];
  const images: Record<string, Uint8Array> = {};
  for (const s of steps) {
    const inRedaction = (x: number, y: number) => s.id === "s_3" && x >= 40 && x < 100 && y >= 50 && y < 70;
    images[s.screenshot!.image] = makePng(160, 100, (x, y) => (inRedaction(x, y) ? MAGENTA : [(x * 3) & 255, (y * 5) & 255, 60 + Number(s.id.slice(2)) * 25]));
  }
  return {
    guide: {
      schemaVersion: 1,
      id: "g_1",
      title: "Change your **billing** settings",
      description: "A four step walkthrough for admins.",
      createdAt: "2026-09-28T09:00:00.000Z",
      updatedAt: "2026-09-28T09:30:00.000Z",
      steps,
    },
    images,
  };
}

