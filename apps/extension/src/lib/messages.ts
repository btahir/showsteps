// Messages between the recorder (content script), the service worker and extension pages.

import type { SessionState } from "./session";
import type { StepDraft } from "./steps";
import type { FrameView } from "./frame-pick";

/** Content script → worker */
export type RecorderMessage =
  | { type: "rec:hello" }
  /** `view`: scroll and size of the page when the capture was asked for (older frames get re-placed by it). */
  | { type: "rec:capture"; captureId: string; settled?: boolean; view?: FrameView }
  | {
      type: "rec:step";
      draft: Omit<StepDraft, "page"> & { page: { url: string; title?: string } };
      captureId?: string;
      /** An earlier frame of the same document, used if `captureId` produced nothing. */
      fallbackCaptureId?: string;
      /** Earlier frames of the same document, newest first (the worker takes the first that still shows it). */
      fallbackCaptureIds?: string[];
    };

/** Extension pages → worker */
export type ControlMessage =
  | { type: "ctl:start"; windowId: number; tabId?: number; /** Append to this guide ("Record more"). */ guideId?: string }
  | { type: "ctl:discard" }
  | { type: "ctl:pause" }
  | { type: "ctl:resume" }
  | { type: "ctl:stop"; openEditor?: boolean }
  | { type: "ctl:state" };

/** What the in-page recording bar shows. */
export interface BarState {
  status: "idle" | "recording" | "paused" | "stopping";
  stepCount: number;
}

/** Worker → content script */
export type WorkerToTab =
  | { type: "tab:state"; recording: boolean }
  | { type: "tab:flush" }
  | { type: "tab:scan" }
  | ({ type: "tab:bar" } & BarState)
  /** Hide the recording bar and reply once a frame without it has been painted. */
  | { type: "tab:bar-hide" }
  | { type: "tab:bar-show" };

export interface ScanReply {
  metrics: NonNullable<StepDraft["metrics"]>;
  sensitiveRects: NonNullable<StepDraft["sensitiveRects"]>;
  sensitiveLabels?: (string | null)[];
  sensitiveKinds?: string[];
  scanIncomplete?: boolean;
}

/** Worker → pages (broadcast) */
export type Broadcast =
  | { type: "bc:session"; state: SessionState }
  | { type: "bc:guide"; guideId: string; stepId?: string };

export type AnyMessage = RecorderMessage | ControlMessage | WorkerToTab | Broadcast;

export interface HelloReply {
  recording: boolean;
  bar?: BarState;
}

export interface ControlReply {
  ok: boolean;
  state: SessionState;
  error?: string;
  /** Recording started on a page Chrome does not let extensions record (chrome://, Web Store, PDF viewer). */
  blocked?: boolean;
}
