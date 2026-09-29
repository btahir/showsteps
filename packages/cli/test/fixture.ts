// A tiny synthetic guide, generated in code. No recorded data, no real sites.
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packBundle, type Guide, type Step } from "@stepsnap/core";

/** A small solid-colour RGBA PNG made in code (no binary fixtures). */
export function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

export const IMG_W = 96;
export const IMG_H = 64;
export const PNG_SCREENSHOT = makePng(IMG_W, IMG_H, [0x2b, 0x6c, 0xb0]);

const T = "2026-01-01T00:00:00.000Z";
const page = (path: string, title: string) => ({ url: `https://app.example.test${path}`, title });

const shot = (id: string) => ({
  image: `images/${id}.png`,
  width: IMG_W,
  height: IMG_H,
  devicePixelRatio: 1,
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
  highlight: { x: 10, y: 10, width: 30, height: 14 },
});

export function fixtureGuide(): Guide {
  const steps: Step[] = [
    {
      id: "s1",
      action: { type: "navigate", url: "https://app.example.test/login" },
      title: "Go to **Sign in – Acme**",
      page: page("/login", "Sign in – Acme"),
      timestamp: T,
      screenshot: shot("s1"),
    },
    {
      id: "s2",
      action: { type: "type", value: "jane@example.test" },
      target: { tag: "input", role: "textbox", name: "Email", label: "Email", inputType: "email", locators: [{ kind: "label", value: "Email" }] },
      title: 'Type "jane@example.test" in **Email**',
      page: page("/login", "Sign in – Acme"),
      timestamp: T,
      screenshot: shot("s2"),
    },
    {
      id: "s3",
      action: { type: "type", value: "•••", masked: true },
      target: { tag: "input", role: "textbox", name: "Password", label: "Password", inputType: "password", sensitive: true, locators: [{ kind: "label", value: "Password" }] },
      title: "Type in **Password**",
      page: page("/login", "Sign in – Acme"),
      timestamp: T,
      screenshot: { ...shot("s3"), redactions: [{ rect: { x: 50, y: 30, width: 30, height: 14 }, style: "blur", auto: true }] },
    },
    {
      id: "s4",
      action: { type: "click" },
      target: { tag: "button", role: "button", name: "Sign in", text: "Sign in", locators: [{ kind: "role", role: "button", name: "Sign in" }] },
      title: "Click **Sign in**",
      titleEdited: true,
      description: "You land on the dashboard.",
      page: page("/login", "Sign in – Acme"),
      timestamp: T,
      screenshot: shot("s4"),
    },
    {
      id: "s5",
      action: { type: "select", value: "monthly", optionText: "Monthly" },
      target: { tag: "select", role: "combobox", name: "Billing period", label: "Billing period", locators: [{ kind: "label", value: "Billing period" }] },
      title: "Select **Monthly** in **Billing period**",
      page: page("/settings", "Settings – Acme"),
      timestamp: T,
    },
    {
      id: "s6",
      action: { type: "press", key: "Enter" },
      title: "Press **Enter**",
      page: page("/settings", "Settings – Acme"),
      timestamp: T,
      skipped: true,
    },
  ];
  return {
    schemaVersion: 1,
    id: "g_fixture",
    title: "Set up billing",
    description: "Synthetic fixture guide.",
    createdAt: T,
    updatedAt: T,
    app: { name: "showsteps", version: "0.0.0-test" },
    steps,
  };
}

export function fixtureImages(guide: Guide = fixtureGuide()): Record<string, Uint8Array> {
  const images: Record<string, Uint8Array> = {};
  for (const s of guide.steps) if (s.screenshot) images[s.screenshot.image] = PNG_SCREENSHOT;
  return images;
}

export interface Sandbox {
  dir: string;
  bundle: string;
  json: string;
}

/** A fresh temp folder holding the fixture as `guide.showsteps` and `guide.json`. */
export async function makeSandbox(): Promise<Sandbox> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "showsteps-cli-")));
  const guide = fixtureGuide();
  const bundle = join(dir, "guide.showsteps");
  await writeFile(bundle, packBundle(guide, fixtureImages(guide)));
  const jsonDir = join(dir, "bare");
  await mkdir(jsonDir);
  const json = join(jsonDir, "guide.json");
  await writeFile(json, JSON.stringify(guide, null, 2));
  await mkdir(join(jsonDir, "images"));
  for (const [rel, bytes] of Object.entries(fixtureImages(guide))) await writeFile(join(jsonDir, rel), bytes);
  return { dir, bundle, json };
}

export const STEPS_INPUT = {
  id: "g_from_steps",
  title: "Reset a password",
  description: "Written by an agent.",
  steps: [
    { action: "navigate", url: "https://app.example.test/login", page: { url: "https://app.example.test/login", title: "Sign in" } },
    { action: "click", target: "Forgot password" },
    { action: "type", target: "Email", value: "jane@example.test" },
    { action: "type", target: "New password", masked: true },
    { action: "click", target: "Reset password" },
    { action: "note", title: "Check your inbox for the confirmation email.", description: "It arrives within a minute." },
  ],
};
