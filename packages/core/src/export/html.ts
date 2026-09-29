import type { Guide } from "../schema";
import type { ImageSource } from "../types";

export interface HtmlOptions {
  includeUrls?: boolean;
}
export function exportHtml(_guide: Guide, _images: ImageSource, _opts?: HtmlOptions): string {
  throw new Error("exportHtml: not implemented yet");
}
