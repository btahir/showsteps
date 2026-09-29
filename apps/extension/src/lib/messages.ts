// Messages between the recorder (content script), the service worker and extension pages.

import type { SessionState } from "./session";
import type { StepDraft } from "./steps";

/** Content script → worker */
export type RecorderMessage =
  | { type: "rec:hello" }
  | { type: "rec:capture"; captureId: string }
  | { type: "rec:step"; draft: Omit<StepDraft, "page"> & { page: { url: string; title?: string } }; captureId?: string };

/** Extension pages → worker */
export type ControlMessage =
  | { type: "ctl:start"; windowId: number; tabId?: number }
  | { type: "ctl:pause" }
  | { type: "ctl:resume" }
  | { type: "ctl:stop" }
  | { type: "ctl:state" };

/** Worker → content script */
export type WorkerToTab = { type: "tab:state"; recording: boolean } | { type: "tab:flush" };

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
