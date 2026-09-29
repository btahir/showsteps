import type { Guide } from "./schema";
import type { ImageSource } from "./types";

export function packBundle(_guide: Guide, _images: ImageSource): Uint8Array {
  throw new Error("packBundle: not implemented yet");
}
export function unpackBundle(_bytes: Uint8Array): { guide: Guide; images: ImageSource } {
  throw new Error("unpackBundle: not implemented yet");
}
