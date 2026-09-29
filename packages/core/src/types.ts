import type { Guide, Rect } from "./schema";

/** Screenshot bytes keyed by `step.screenshot.image` (a path such as `images/s_ab12.png`). */
export type ImageSource = Record<string, Uint8Array>;

/** Files produced by an exporter: path -> text or bytes. Paths use `/`, never start with `/`. */
export type ExportFiles = Record<string, Uint8Array | string>;

export interface ExportResult {
  files: ExportFiles;
}

export type { Guide, Rect };
