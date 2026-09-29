// Import a .showsteps (or legacy .stepsnap) project into the library.
import { getGuide, putGuide, putImage } from "./db";
import { newId } from "./guide-ops";
import { readBundle } from "./export";

/** Stores the bundle's guide and images. A guide whose id already exists is imported as a copy. */
export async function importProject(file: Blob): Promise<string> {
  const { guide, images } = await readBundle(file);
  const exists = await getGuide(guide.id);
  const now = new Date().toISOString();
  const g = exists ? { ...guide, id: newId("g"), title: `${guide.title} (copy)`, updatedAt: now } : { ...guide, updatedAt: now };
  for (const [path, blob] of Object.entries(images)) {
    const step = g.steps.find((s) => s.screenshot?.image === path);
    await putImage(g.id, path, blob, step?.screenshot?.highlight);
  }
  await putGuide(g);
  return g.id;
}
