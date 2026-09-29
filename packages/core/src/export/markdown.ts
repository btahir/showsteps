import type { Guide } from "../schema";
import type { ExportResult, ImageSource } from "../types";

export interface MarkdownOptions {
  images?: ImageSource;
}
export function exportMarkdown(_guide: Guide, _opts?: MarkdownOptions): ExportResult {
  throw new Error("exportMarkdown: not implemented yet");
}
