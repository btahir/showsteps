// Showsteps (formerly Stepsnap) guide file format, v1. This is the contract every package codes against.
// A guide is saved as a folder or zip: `guide.json` (this schema) + `images/<stepId>.png`.
// Change it only by adding optional fields; bump `schemaVersion` for breaking changes.

export const SCHEMA_VERSION = 1 as const;

/** Pixel rectangle in screenshot coordinates (device pixels of the captured image). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a recorded element can be found again. Ordered most to least robust. */
export type Locator =
  | { kind: "testid"; value: string } // data-testid / data-test / data-qa
  | { kind: "role"; role: string; name: string } // ARIA role + accessible name
  | { kind: "label"; value: string } // <label> text for form controls
  | { kind: "placeholder"; value: string }
  | { kind: "text"; value: string; exact?: boolean } // visible text
  | { kind: "css"; value: string } // last resort
  | { kind: "xpath"; value: string };

/** What we know about the element a step acted on. Captured in the page, DOM-free afterwards. */
export interface ElementDescriptor {
  tag: string; // lower-case tag name
  role?: string; // explicit or implicit ARIA role
  name?: string; // accessible name (trimmed, <= 80 chars)
  label?: string; // associated <label> text, for form controls
  text?: string; // visible text (trimmed, <= 80 chars)
  placeholder?: string;
  inputType?: string; // for <input>
  href?: string;
  sensitive?: boolean; // password, card, OTP, SSN-like, or user-marked
  locators: Locator[]; // at least one; best first
  frame?: string[]; // iframe locator chain, outermost first (css selectors)
  shadow?: string[]; // shadow-host css chain, outermost first
}

export type StepAction =
  | { type: "navigate"; url: string }
  | { type: "click"; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; value: string; masked?: boolean } // value is "" or "•••" when masked
  | { type: "select"; value: string; optionText?: string }
  | { type: "check"; checked: boolean }
  | { type: "press"; key: string } // e.g. "Enter", "Control+K"
  | { type: "scroll"; x: number; y: number }
  | { type: "hover" }
  | { type: "note" }; // human-only step with no page action

/** Corner of the highlight ring the numbered tab grows out of. */
export type TabCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface Redaction {
  rect: Rect;
  style: "blur" | "pixelate" | "solid" | "mask"; // "mask": a form field replaced by its background colour and a row of dots
  auto?: boolean; // added by auto-redaction rather than the user
  label?: string; // what was covered, e.g. the field's accessible name ("Password"); shown as "Password blurred"
}

export interface Step {
  id: string; // stable, url-safe, unique within the guide
  action: StepAction;
  target?: ElementDescriptor; // absent for navigate/note/scroll
  title: string; // "Click **Save**" — Markdown inline allowed; generated, then user-editable
  titleEdited?: boolean; // true once a human edited it; regeneration must not overwrite
  description?: string; // optional Markdown paragraph
  page: { url: string; title?: string; tabId?: number; dir?: "ltr" | "rtl" }; // dir: document direction; the highlight tab flips to the left for "rtl"
  screenshot?: {
    image: string; // path inside the guide bundle, e.g. "images/s_ab12.png"
    width: number; // image pixel size
    height: number;
    devicePixelRatio: number;
    viewport: { width: number; height: number; scrollX: number; scrollY: number }; // CSS px
    highlight?: Rect & { corner?: TabCorner; labelRect?: Rect }; // target box in image pixels; drawn at export time, never baked in. `corner`: where the recorder found the least text for the numbered tab; `labelRect`: box of the control's <label> (checkbox, radio, switch) so a small control is ringed together with its label
    redactions?: Redaction[];
    crop?: Rect; // optional export crop in image pixels
  };
  timestamp: string; // ISO 8601
  skipped?: boolean; // hidden from exports but kept
}

export interface Guide {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string; // Markdown
  createdAt: string; // ISO 8601
  updatedAt: string;
  app?: { name: "showsteps" | "stepsnap"; version: string }; // "stepsnap" = old name, still read
  steps: Step[];
  settings?: {
    highlightColor?: string; // CSS colour, default from brand
    redactStyle?: Redaction["style"];
    includeUrls?: boolean; // show page URLs in exports (default true)
  };
}
