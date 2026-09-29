import type { Guide, Step } from "./schema";

export function generateStepTitle(_step: Pick<Step, "action" | "target" | "page">): string {
  throw new Error("generateStepTitle: not implemented yet");
}

export function regenerateTitles(_guide: Guide): Guide {
  throw new Error("regenerateTitles: not implemented yet");
}
