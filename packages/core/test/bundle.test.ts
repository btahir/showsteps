import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, GuideValidationError, packBundle, referencedImages, unpackBundle } from "../src";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

describe("bundle", () => {
  const guide = fixtureGuide();
  const images = fixtureImages();

  it("round-trips guide and images exactly", () => {
    const bytes = packBundle(guide, images);
    const back = unpackBundle(bytes);
    expect(back.guide).toEqual(guide);
    expect(back.warnings).toEqual([]);
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

  it("reads a guide whose screenshot is missing, with a warning", () => {
    const stripped = zipSync({ "guide.json": new TextEncoder().encode(JSON.stringify(guide)) });
    const back = unpackBundle(stripped);
    expect(back.warnings.length).toBe(referencedImages(guide).length);
    expect(back.warnings[0]).toMatch(/missing from the file/);
  });

  it("ignores junk entries and never returns unsafe paths", () => {
    const bytes = zipSync({
      "guide.json": new TextEncoder().encode(JSON.stringify({ ...guide, steps: [] })),
      "__MACOSX/._guide.json": new Uint8Array([1]),
      "images/../../evil.png": new Uint8Array([1]),
      "images/ok.png": new Uint8Array([9]),
    });
    const back = unpackBundle(bytes);
    expect(Object.keys(back.images)).toEqual(["images/ok.png"]);
  });

  it("gives readable errors for non-bundles", () => {
    expect(() => unpackBundle(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not a Showsteps project file/);
    expect(() => unpackBundle(zipSync({ "other.txt": new Uint8Array([1]) }))).toThrow(/no guide.json/);
    expect(() => unpackBundle(zipSync({ "guide.json": new TextEncoder().encode("{oops") }))).toThrow(/not valid JSON/);
    expect(() => unpackBundle(zipSync({ "guide.json": new TextEncoder().encode('{"schemaVersion":1}') }))).toThrow(GuideValidationError);
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
