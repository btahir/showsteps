/**
 * Permission justifications, verbatim from notes/permissions.md ("Per-permission store-review justifications").
 * The privacy page and the Chrome Web Store listing must use exactly these sentences. Do not reword them here
 * without changing the source note and the listing in docs/launch.
 */
export interface PermissionRow {
  /** Manifest name, or a plain label for the optional host permission */
  name: string;
  code: boolean;
  why: string;
}

export const PERMISSIONS: PermissionRow[] = [
  { name: "activeTab", code: true, why: "Lets the user start a recording on the current tab with one click on the toolbar button, and lets Showsteps screenshot pages that extensions cannot otherwise capture (browser-internal pages), only for the tab the user invoked it on." },
  { name: "scripting", code: true, why: "Injects the recorder that notices the user's clicks and typing (and the code that finds sensitive fields to blur) into the pages the user visits while a recording is running, and removes it when the recording stops." },
  { name: "storage", code: true, why: "Keeps the small \"recording in progress\" state and the user's settings so the recorder keeps working if Chrome suspends the extension's background worker mid-recording." },
  { name: "sidePanel", code: true, why: "Shows the recording controls and the step list in Chrome's side panel next to the page being recorded." },
  { name: "unlimitedStorage", code: true, why: "Saves the user's guides and their screenshots in the browser's local database without the default quota or automatic eviction, so a long recording is never silently deleted; nothing is uploaded." },
  { name: "Access to all sites (optional)", code: false, why: "Requested only when the user presses Record. Needed so Showsteps can capture screenshots and notice clicks in every tab and website the user visits during the recording (a guide often crosses several tabs and sign-in redirects); Chrome only allows screenshots of arbitrary sites with this permission. It is not used when no recording is running, the user can revoke it in Chrome at any time, and no page content ever leaves the device." },
];
