// Compile-time check: real canvas contexts satisfy Ctx2D (no runtime code).
import type { Ctx2D } from "./tokens";
declare const a: CanvasRenderingContext2D;
declare const b: OffscreenCanvasRenderingContext2D;
export const _checks: Ctx2D[] = [a, b];
