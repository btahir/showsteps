// Messages between the recorder (content script), the service worker and extension pages.

import type { SessionState } from "./session";
import type { StepDraft } from "./steps";

/** Content script → worker */
export type RecorderMessage =
  | { type: "rec:hello" }
  | { type: "rec:capture"; captureId: string; settled?: boolean }
  | {
      type: "rec:step";
      draft: Omit<StepDraft, "page"> & { page: { url: string; title?: string } };
      captureId?: string;
      /** An earlier frame of the same document, used if `captureId` produced nothing. */
      fallbackCaptureId?: string;
    };

/** Extension pages → worker */
export type ControlMessage =
  | { type: "ctl:start"; windowId: number; tabId?: number; /** Append to this guide ("Record more"). */ guideId?: string }
  | { type: "ctl:discard" }
  | { type: "ctl:pause" }
  | { type: "ctl:resume" }
  | { type: "ctl:stop"; openEditor?: boolean }
  | { type: "ctl:state" };

/** Worker → content script */
export type WorkerToTab = { type: "tab:state"; recording: boolean } | { type: "tab:flush" } | { type: "tab:scan" };

export interface ScanReply {
  metrics: NonNullable<StepDraft["metrics"]>;
  sensitiveRects: NonNullable<StepDraft["sensitiveRects"]>;
}

/** Worker → pages (broadcast) */
export type Broadcast =
  | { type: "bc:session"; state: SessionState }
  | { type: "bc:guide"; guideId: string; stepId?: string };

export type AnyMessage = RecorderMessage | ControlMessage | WorkerToTab | Broadcast;

export interface HelloReply {
  recording: boolean;
}

export interface ControlReply {
  ok: boolean;
  state: SessionState;
  error?: string;
}
