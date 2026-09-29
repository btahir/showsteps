import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, GuideValidationError, packBundle, referencedImages, unpackBundle } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";

/** Overwrite the uncompressed size a zip's central directory declares for `name`. */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number): void {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const enc = new TextEncoder().encode(name);
  for (let o = 0; o + 46 < zip.length; o++) {
    if (dv.getUint32(o, true) !== 0x02014b50) continue;
    const nameLen = dv.getUint16(o + 28, true);
    if (nameLen === enc.length && enc.every((b, i) => zip[o + 46 + i] === b)) {
      dv.setUint32(o + 24, size, true);
      return;
    }
  }
  throw new Error("entry not found in central directory");
}

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

describe("bundle", () => {
  const guide = fixtureGuide();
  const images = fixtureImages();

  it("round-trips guide and images exactly", () => {
    const bytes = packBundle(guide, images);
    const back = unpackBundle(bytes);
    expect(back.guide).toEqual(guide);
    expect(Object.keys(back.images).sort()).toEqual(Object.keys(images).sort());
    for (const [k, v] of Object.entries(images)) expect(eq(back.images[k] as Uint8Array, v)).toBe(true);
  });

  it("is byte-stable: pack, unpack, pack gives identical bytes", () => {
    const a = packBundle(guide, images);
    const b = unpackBundle(a);
    const c = packBundle(b.guide, b.images);
    expect(eq(a, c)).toBe(true);
  });

  it("is independent of the order images were inserted in", () => {
    const reversed = Object.fromEntries(Object.entries(images).reverse());
    expect(eq(packBundle(guide, images), packBundle(guide, reversed))).toBe(true);
  });

  it("uses fixed mtimes and sorted entries", () => {
    const bytes = packBundle(guide, images);
    // DOS date for 1980-01-01 is 0x0021, time 0x0000; first local header starts at offset 0
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getUint16(10, true)).toBe(0); // time
    expect(dv.getUint16(12, true)).toBe(0x21); // date
    const names = [...new TextDecoder().decode(bytes).matchAll(/images\/s_[a-z]+\.png|guide\.json/g)].map((m) => m[0]);
    const firstOfEach = [...new Set(names)];
    expect(firstOfEach[0]).toBe("guide.json");
    expect(firstOfEach.slice(1)).toEqual([...firstOfEach.slice(1)].sort());
  });

  it("drops images no step references", () => {
    const withOrphan = { ...images, "images/orphan.png": new Uint8Array([1, 2, 3]) };
    const back = unpackBundle(packBundle(guide, withOrphan));
    expect(back.images["images/orphan.png"]).toBeUndefined();
  });

  it("refuses to pack when a screenshot is missing", () => {
    const partial = { ...images };
    delete partial["images/s_email.png"];
    expect(() => packBundle(guide, partial)).toThrow(BundleError);
    expect(() => packBundle(guide, partial)).toThrow(/s_email\.png/);
  });

  it("refuses to pack an invalid guide", () => {
    expect(() => packBundle({ ...guide, id: "" } as never, images)).toThrow(GuideValidationError);
  });

  it("rejects a bundle whose screenshot is missing and names the missing paths", () => {
    const stripped = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify(guide)) });
    expect(() => unpackBundle(stripped)).toThrow(BundleError);
    expect(() => unpackBundle(stripped)).toThrow(/images\/s_open\.png/);
    const partial = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify(guide)), "images/s_open.png": new Uint8Array([1]) });
    expect(() => unpackBundle(partial)).toThrow(/images\/s_email\.png/);
  });

  it("rejects unsafe entry names: ../, absolute paths, backslashes, drive letters", () => {
    const good = new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] }));
    for (const name of ["images/../../evil.png", "../evil.txt", "/abs.png", "images\\a.png", "C:/a.png", "images/./a.png", "a//b"]) {
      const bytes = zipSync({ "guide.json": good, [name]: new Uint8Array([1]) });
      expect(() => unpackBundle(bytes), name).toThrow(BundleError);
      expect(() => unpackBundle(bytes), name).toThrow(/unsafe entry name/);
    }
  });

  it("ignores harmless extra entries such as __MACOSX and directories", () => {
    const bytes = zipSync({
      "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })),
      "__MACOSX/._guide.json": new Uint8Array([1]),
      "notes.txt": new Uint8Array([1]),
      "images/ok.png": new Uint8Array([9]),
    });
    expect(Object.keys(unpackBundle(bytes).images)).toEqual(["images/ok.png"]);
  });

  it("rejects more than 2000 entries", () => {
    const many: Record<string, Uint8Array> = { "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })) };
    for (let i = 0; i < 2001; i++) many[`images/f${i}.png`] = new Uint8Array(1);
    expect(() => unpackBundle(zipSync(many, { level: 0 }))).toThrow(/too many entries/);
  });

  it("rejects an entry that declares a huge size before inflating it", () => {
    const bytes = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })), "images/a.png": new Uint8Array(1000) });
    patchDeclaredSize(bytes, "images/a.png", 300 * 1024 * 1024);
    expect(() => unpackBundle(bytes)).toThrow(BundleError);
    expect(() => unpackBundle(bytes)).toThrow(/too large/);
  });

  it("rejects a total unpacked size over 512 MB", () => {
    const bytes = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })), "images/a.png": new Uint8Array(1000), "images/b.png": new Uint8Array(1000) });
    patchDeclaredSize(bytes, "images/a.png", 250 * 1024 * 1024);
    patchDeclaredSize(bytes, "images/b.png", 250 * 1024 * 1024);
    const guideOnly = zipSync({ "guide.json": new TextEncoder().encode("{}"), "images/a.png": new Uint8Array(10), "images/b.png": new Uint8Array(10), "images/c.png": new Uint8Array(10) });
    for (const n of ["images/a.png", "images/b.png", "images/c.png"]) patchDeclaredSize(guideOnly, n, 200 * 1024 * 1024);
    expect(() => unpackBundle(guideOnly)).toThrow(/too large to open/);
  });

  it("rejects an entry whose declared size does not match its data", () => {
    const bytes = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })), "images/a.png": new Uint8Array(1000) });
    patchDeclaredSize(bytes, "images/a.png", 999);
    expect(() => unpackBundle(bytes)).toThrow(BundleError);
  });

  it("gives typed errors for non-bundles, truncated zips and bad guide.json", () => {
    const real = packBundle(guide, images);
    expect(() => unpackBundle(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not a Showsteps project file/);
    expect(() => unpackBundle(new Uint8Array(0))).toThrow(BundleError);
    expect(() => unpackBundle(new TextEncoder().encode("hello, this is not a zip file at all"))).toThrow(BundleError);
    expect(() => unpackBundle(real.subarray(0, real.length - 40))).toThrow(BundleError);
    expect(() => unpackBundle(real.subarray(0, Math.floor(real.length / 2)))).toThrow(BundleError);
    expect(() => unpackBundle(zipSync({ "other.txt": new Uint8Array([1]) }))).toThrow(/no guide.json/);
    expect(() => unpackBundle(zipSync({ "guide.json": new TextEncoder().encode("{oops") }))).toThrow(/not valid JSON/);
    expect(() => unpackBundle(zipSync({ "guide.json": new Uint8Array([0xff, 0xfe, 0xfd]) }))).toThrow(BundleError);
    expect(() => unpackBundle(zipSync({ "guide.json": new TextEncoder().encode('{"schemaVersion":1}') }))).toThrow(GuideValidationError);
  });

  it("never throws anything but BundleError or GuideValidationError on random damage", () => {
    const real = packBundle(guide, images);
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const copy = real.slice();
      for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256);
      try {
        unpackBundle(i % 3 === 0 ? copy.subarray(0, Math.floor(rnd() * copy.length)) : copy);
      } catch (e) {
        expect(e instanceof BundleError || e instanceof GuideValidationError, String(e)).toBe(true);
      }
    }
  });

  it("stores guide.json with sorted keys, so the bytes do not depend on key order", () => {
    const shuffled = JSON.parse(JSON.stringify(guide)) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse());
    expect(eq(packBundle(reordered as never, images), packBundle(guide, images))).toBe(true);
    const json = new TextDecoder().decode(unzipSync(packBundle(guide, images))["guide.json"]);
    expect(json.indexOf('"app"')).toBeLessThan(json.indexOf('"createdAt"'));
    expect(json.endsWith("\n")).toBe(true);
  });

  it("rejects a guide from a newer version with a helpful message", () => {
    const bytes = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, schemaVersion: 9 })) });
    expect(() => unpackBundle(bytes)).toThrow(/newer/);
  });

  it("strips a UTF-8 BOM", () => {
    const body = new TextEncoder().encode("﻿" + JSON.stringify({ ...guide, steps: [] }));
    expect(unpackBundle(zipSync({ "guide.json": body })).guide.id).toBe(guide.id);
  });
});
