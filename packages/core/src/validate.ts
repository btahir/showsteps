import type { Guide } from "./schema";

export type ValidateResult = { ok: true; guide: Guide } | { ok: false; errors: string[] };

export function validateGuide(_x: unknown): ValidateResult {
  throw new Error("validateGuide: not implemented yet");
}

export function migrateGuide(_x: unknown): Guide {
  throw new Error("migrateGuide: not implemented yet");
}
