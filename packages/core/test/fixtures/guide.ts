// Synthetic fixture guide: 10 steps across 2 tabs, including a password field, a select,
// a checkbox, an iframe button and an icon-only button. Screenshots are tiny PNGs generated
// in code (flat colours, no real screenshots). Deterministic: no clocks, no randomness.

import type { Guide, ImageSource, Rect, Step } from "../../src";
import { encodePng } from "../../src/png";

export const FIXTURE_IMAGE = { width: 160, height: 100, devicePixelRatio: 2, viewport: { width: 80, height: 50, scrollX: 0, scrollY: 0 } } as const;

type Rgb = [number, number, number];

function fillRect(data: Uint8Array, w: number, r: Rect, c: Rgb): void {
  for (let y = Math.max(0, r.y); y < Math.min(FIXTURE_IMAGE.height, r.y + r.height); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.width); x++) {
      const p = (y * w + x) * 4;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = 255;
    }
  }
}

/** Draw a fake "page": header bar, title block, content rows and the target element. */
export function fixturePng(opts: { tab: 1 | 2; target?: Rect; targetColor?: Rgb }): Uint8Array {
  const { width, height } = FIXTURE_IMAGE;
  const data = new Uint8Array(width * height * 4);
  const bg: Rgb = opts.tab === 1 ? [246, 247, 249] : [243, 247, 244];
  fillRect(data, width, { x: 0, y: 0, width, height }, bg);
  fillRect(data, width, { x: 0, y: 0, width, height: 12 }, opts.tab === 1 ? [223, 227, 234] : [212, 228, 216]);
  fillRect(data, width, { x: 12, y: 18, width: 60, height: 6 }, [190, 196, 208]);
  for (let i = 0; i < 4; i++) fillRect(data, width, { x: 12, y: 30 + i * 16, width: 136, height: 10 }, [255, 255, 255]);
  if (opts.target) fillRect(data, width, opts.target, opts.targetColor ?? [201, 211, 234]);
  return encodePng({ width, height, data }, 9);
}

interface Spec {
  id: string;
  tab: 1 | 2;
  step: Omit<Step, "id" | "page" | "timestamp" | "screenshot"> & { page: { url: string; title?: string } };
  highlight?: Rect;
  targetColor?: Rgb;
  redactions?: NonNullable<Step["screenshot"]>["redactions"];
}

const T1 = 101;
const T2 = 102;

const SPECS: Spec[] = [
  {
    id: "s_open",
    tab: 1,
    step: {
      action: { type: "navigate", url: "https://app.acme.test/login" },
      title: "Go to **Sign in – Acme**",
      page: { url: "https://app.acme.test/login", title: "Sign in – Acme" },
    },
  },
  {
    id: "s_email",
    tab: 1,
    highlight: { x: 20, y: 30, width: 120, height: 10 },
    step: {
      action: { type: "type", value: "jane@example.com" },
      target: {
        tag: "input",
        role: "textbox",
        inputType: "email",
        label: "Email",
        placeholder: "you@company.com",
        locators: [{ kind: "label", value: "Email" }, { kind: "placeholder", value: "you@company.com" }, { kind: "css", value: "form input[type=email]" }],
      },
      title: 'Type "jane@example.com" in **Email**',
      page: { url: "https://app.acme.test/login", title: "Sign in – Acme" },
    },
  },
  {
    id: "s_pass",
    tab: 1,
    highlight: { x: 20, y: 46, width: 120, height: 10 },
    targetColor: [34, 34, 34],
    redactions: [{ rect: { x: 16, y: 42, width: 128, height: 18 }, style: "blur", auto: true }],
    step: {
      action: { type: "type", value: "", masked: true },
      target: {
        tag: "input",
        role: "textbox",
        inputType: "password",
        label: "Password",
        sensitive: true,
        locators: [{ kind: "label", value: "Password" }, { kind: "css", value: "form input[type=password]" }],
      },
      title: "Enter your password",
      page: { url: "https://app.acme.test/login", title: "Sign in – Acme" },
    },
  },
  {
    id: "s_signin",
    tab: 1,
    highlight: { x: 20, y: 62, width: 50, height: 10 },
    step: {
      action: { type: "click" },
      target: {
        tag: "button",
        role: "button",
        name: "Sign in",
        text: "Sign in",
        locators: [{ kind: "testid", value: "signin-button" }, { kind: "role", role: "button", name: "Sign in" }],
      },
      title: "Click **Sign in**",
      page: { url: "https://app.acme.test/login", title: "Sign in – Acme" },
    },
  },
  {
    id: "s_gear",
    tab: 1,
    highlight: { x: 136, y: 1, width: 10, height: 10 },
    step: {
      action: { type: "click" },
      target: {
        tag: "button",
        role: "button",
        name: "Open settings",
        text: "",
        locators: [{ kind: "role", role: "button", name: "Open settings" }, { kind: "css", value: "header button.icon-gear" }],
      },
      title: "Click **Open settings**",
      description: "The gear icon in the top-right corner.",
      page: { url: "https://app.acme.test/dashboard", title: "Dashboard – Acme" },
    },
  },
  {
    id: "s_period",
    tab: 1,
    highlight: { x: 20, y: 46, width: 80, height: 10 },
    step: {
      action: { type: "select", value: "monthly", optionText: "Monthly" },
      target: {
        tag: "select",
        role: "combobox",
        label: "Billing period",
        name: "Billing period",
        locators: [{ kind: "label", value: "Billing period" }, { kind: "css", value: "select#period" }],
      },
      title: "Select **Monthly** in **Billing period**",
      description: "Choose how often you want to be billed.",
      page: { url: "https://app.acme.test/settings/billing", title: "Billing – Acme" },
    },
  },
  {
    id: "s_invoices",
    tab: 1,
    highlight: { x: 18, y: 62, width: 10, height: 10 },
    step: {
      action: { type: "check", checked: true },
      target: {
        tag: "input",
        role: "checkbox",
        inputType: "checkbox",
        label: "Email me invoices",
        locators: [{ kind: "label", value: "Email me invoices" }, { kind: "css", value: "input[name=invoices]" }],
      },
      title: "Check **Email me invoices**",
      page: { url: "https://app.acme.test/settings/billing", title: "Billing – Acme" },
    },
  },
  {
    id: "s_pay",
    tab: 1,
    highlight: { x: 20, y: 78, width: 44, height: 10 },
    step: {
      action: { type: "click" },
      target: {
        tag: "button",
        role: "button",
        name: "Pay now",
        text: "Pay now",
        frame: ['iframe[name="card-frame"]'],
        locators: [{ kind: "role", role: "button", name: "Pay now" }, { kind: "text", value: "Pay now", exact: true }],
      },
      title: "Click **Pay now**",
      page: { url: "https://app.acme.test/settings/billing", title: "Billing – Acme" },
    },
  },
  {
    id: "s_help",
    tab: 2,
    step: {
      action: { type: "navigate", url: "https://help.acme.test/invoices" },
      title: "Go to **Invoices – Acme Help**",
      page: { url: "https://help.acme.test/invoices", title: "Invoices – Acme Help" },
    },
  },
  {
    id: "s_search",
    tab: 2,
    highlight: { x: 20, y: 30, width: 120, height: 10 },
    step: {
      action: { type: "press", key: "Enter" },
      target: {
        tag: "input",
        role: "searchbox",
        inputType: "search",
        placeholder: "Search help",
        label: "Search help",
        locators: [{ kind: "placeholder", value: "Search help" }, { kind: "css", value: "input[type=search]" }],
      },
      title: "Press **Enter** to search",
      page: { url: "https://help.acme.test/invoices", title: "Invoices – Acme Help" },
    },
  },
];

const ISO0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const iso = (sec: number): string => new Date(ISO0 + sec * 1000).toISOString().replace(".000Z", "Z");

export function fixtureGuide(): Guide {
  const steps: Step[] = SPECS.map((s, i) => {
    const step: Step = {
      id: s.id,
      ...s.step,
      page: { ...s.step.page, tabId: s.tab === 1 ? T1 : T2 },
      timestamp: iso(i * 4),
    };
    if (s.highlight) {
      step.screenshot = {
        image: `images/${s.id}.png`,
        width: FIXTURE_IMAGE.width,
        height: FIXTURE_IMAGE.height,
        devicePixelRatio: FIXTURE_IMAGE.devicePixelRatio,
        viewport: { ...FIXTURE_IMAGE.viewport },
        highlight: { ...s.highlight },
        ...(s.redactions ? { redactions: s.redactions.map((r) => ({ ...r, rect: { ...r.rect } })) } : {}),
      };
    } else {
      // navigation steps still get a screenshot, with no highlight
      step.screenshot = {
        image: `images/${s.id}.png`,
        width: FIXTURE_IMAGE.width,
        height: FIXTURE_IMAGE.height,
        devicePixelRatio: FIXTURE_IMAGE.devicePixelRatio,
        viewport: { ...FIXTURE_IMAGE.viewport },
      };
    }
    return step;
  });
  return {
    schemaVersion: 1,
    id: "g_fixture",
    title: "Update billing settings in Acme",
    description: "Sign in, switch to **monthly** billing, and pay the open invoice.",
    createdAt: iso(0),
    updatedAt: iso(60),
    app: { name: "showsteps", version: "0.1.0" },
    steps,
    settings: { redactStyle: "blur", includeUrls: true },
  };
}

export function fixtureImages(): ImageSource {
  const out: ImageSource = {};
  for (const s of SPECS) {
    const target = s.highlight;
    out[`images/${s.id}.png`] = fixturePng({ tab: s.tab, ...(target ? { target } : {}), ...(s.targetColor ? { targetColor: s.targetColor } : {}) });
  }
  return out;
}
