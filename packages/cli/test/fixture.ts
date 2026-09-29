// A tiny synthetic guide, generated in code. No recorded data, no real sites.
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packBundle, type Guide, type Step } from "@stepsnap/core";

// 1x1 transparent PNG.
export const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

const T = "2026-01-01T00:00:00.000Z";
const page = (path: string, title: string) => ({ url: `https://app.example.test${path}`, title });

const shot = (id: string) => ({
  image: `images/${id}.png`,
  width: 1,
  height: 1,
  devicePixelRatio: 1,
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
  highlight: { x: 0, y: 0, width: 1, height: 1 },
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
      screenshot: { ...shot("s3"), redactions: [{ rect: { x: 0, y: 0, width: 1, height: 1 }, style: "blur", auto: true }] },
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
    app: { name: "stepsnap", version: "0.0.0-test" },
    steps,
  };
}

export function fixtureImages(guide: Guide = fixtureGuide()): Record<string, Uint8Array> {
  const images: Record<string, Uint8Array> = {};
  for (const s of guide.steps) if (s.screenshot) images[s.screenshot.image] = PNG_1X1;
  return images;
}

export interface Sandbox {
  dir: string;
  bundle: string;
  json: string;
}

/** A fresh temp folder holding the fixture as `guide.stepsnap` and `guide.json`. */
export async function makeSandbox(): Promise<Sandbox> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "stepsnap-cli-")));
  const guide = fixtureGuide();
  const bundle = join(dir, "guide.stepsnap");
  await writeFile(bundle, packBundle(guide, fixtureImages(guide)));
  const jsonDir = join(dir, "bare");
  await mkdir(jsonDir);
  const json = join(jsonDir, "guide.json");
  await writeFile(json, JSON.stringify(guide, null, 2));
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
