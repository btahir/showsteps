// Small stroke icon set drawn on a 20px grid (1.6px strokes), so every icon aligns the same way.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  className: "i",
  ...props,
});

export const IconRecord = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="5" fill="currentColor" stroke="none" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.5 5v10M12.5 5v10" strokeWidth="2.2" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 5.2v9.6L14.6 10z" fill="currentColor" />
  </svg>
);
export const IconStop = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
  </svg>
);
export const IconUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />
  </svg>
);
export const IconDown = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 5v10M5.5 10.5 10 15l4.5-4.5" />
  </svg>
);
export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
    <circle cx="10" cy="10" r="2.2" />
  </svg>
);
export const IconEyeOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 3l14 14M8.3 5.2A7.6 7.6 0 0 1 10 5c4.7 0 7.5 5 7.5 5a13 13 0 0 1-2.2 2.8M5.3 6.6A12.6 12.6 0 0 0 2.5 10s2.8 5 7.5 5a7 7 0 0 0 3.2-.8" />
  </svg>
);
/** Blur: a frame with a 45° hatch (review #32: the dotted grid read as a keyboard). */
export const IconBlur = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
    <path d="M3.5 9.5l5-5M3.5 14.5l10-10M7.5 15.5l9-9M12.5 15.5l4-4" strokeWidth="1.3" />
  </svg>
);
export const IconCrop = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2.5V14h11.5M2.5 6H14v11.5" />
  </svg>
);
export const IconHighlight = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="6" width="12" height="8" rx="2" />
    <circle cx="4.5" cy="6" r="2.3" fill="currentColor" stroke="none" />
  </svg>
);
export const IconNote = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 3.5h7l3 3v10H5z" />
    <path d="M8 10h4M10 8v4" />
  </svg>
);
/** Lucide "merge" (ISC), redrawn on the 24 grid at the set's 1.6 px visual stroke. */
export const IconMerge = (p: P) => (
  <svg {...base({ viewBox: "0 0 24 24", strokeWidth: 1.9, ...p })}>
    <path d="m8 6 4-4 4 4M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22M20 22l-5-5" />
  </svg>
);
export const IconSkip = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M5.5 14.5l9-9" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 3.5v9M6 8.8l4 3.8 4-3.8M4 16h12" />
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 12.5v-9M6 7.2l4-3.7 4 3.7M4 16h12" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="7" width="9" height="9" rx="1.5" />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" />
  </svg>
);
export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 4h5v5M16 4l-7 7M14 11.5V16H4V6h4.5" />
  </svg>
);
export const IconGrip = (p: P) => (
  <svg {...base(p)}>
    <g fill="currentColor" stroke="none">
      <circle cx="7.5" cy="5.5" r="1.2" />
      <circle cx="12.5" cy="5.5" r="1.2" />
      <circle cx="7.5" cy="10" r="1.2" />
      <circle cx="12.5" cy="10" r="1.2" />
      <circle cx="7.5" cy="14.5" r="1.2" />
      <circle cx="12.5" cy="14.5" r="1.2" />
    </g>
  </svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 5l10 10M15 5 5 15" />
  </svg>
);
export const IconUndo = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.5 5 4 8.5 7.5 12M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9" />
  </svg>
);
export const IconRedo = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.5 5 16 8.5 12.5 12M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11" />
  </svg>
);
export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.5 4.5l3 3L7 16H4v-3z" />
  </svg>
);
export const IconHeart = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 16s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.9A3.3 3.3 0 0 1 16 8c0 4.4-6 8-6 8z" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
);

/** Lucide "settings" gear (ISC); the old sun-like glyph read as a theme toggle (review #27). */
export const IconSettings = (p: P) => (
  <svg {...base({ viewBox: "0 0 24 24", strokeWidth: 1.9, ...p })}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5l5 5-5 5" />
  </svg>
);
export const IconChevronLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5l-5 5 5 5" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </svg>
);
export const IconCode = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11 4.5l-2 11" />
  </svg>
);
export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
  </svg>
);

/** The app icon (packages/brand/icon.svg), inline so it needs no request. */
export const BrandIcon = ({ size = 22, ...p }: P & { size?: number }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} aria-hidden focusable={false} {...p}>
    <rect width="128" height="128" rx="30" fill="#EB4E26" />
    <path
      d="M33 44.5H111.5V91A16.5 16.5 0 0 1 95 107.5H33A16.5 16.5 0 0 1 16.5 91V61A16.5 16.5 0 0 1 33 44.5ZM33 55.5H95A5.5 5.5 0 0 1 100.5 61V91A5.5 5.5 0 0 1 95 96.5H33A5.5 5.5 0 0 1 27.5 91V61A5.5 5.5 0 0 1 33 55.5Z"
      fill="#FFFFFF"
      fillRule="evenodd"
    />
    <path d="M111.5 44.51V22.5A8 8 0 0 0 103.5 14.5H79.5A8 8 0 0 0 71.5 22.5V36.5A8 8 0 0 1 63.5 44.5Z" fill="#FFFFFF" />
    <path d="M99.39 40L85.17 40L85.17 35.92L90.27 35.92L90.27 24.22L85.41 25.15L85.41 21.43L92.22 19L94.71 19L94.71 35.92L99.39 35.92L99.39 40Z" fill="#EB4E26" />
  </svg>
);

/** packages/brand/mark.svg: ring and tab without the squircle, for empty states. */
/** The mark (packages/brand/mark.svg at 64 px and up: numeral cut into the tab, thinner ring; mark-small.svg below). */
export const BrandMark = ({ size = 88, ...p }: P & { size?: number }) =>
  size >= 64 ? (
    <svg viewBox="12 12 104 104" width={size} height={size} aria-hidden focusable={false} {...p}>
      <path
        d="M33 44.5H111.5V91A16.5 16.5 0 0 1 95 107.5H33A16.5 16.5 0 0 1 16.5 91V61A16.5 16.5 0 0 1 33 44.5ZM33 53.5H95A7.5 7.5 0 0 1 102.5 61V91A7.5 7.5 0 0 1 95 98.5H33A7.5 7.5 0 0 1 25.5 91V61A7.5 7.5 0 0 1 33 53.5Z"
        fill="var(--ss-accent)"
        fillRule="evenodd"
      />
      <path
        d="M111.5 44.51V22.5A8 8 0 0 0 103.5 14.5H79.5A8 8 0 0 0 71.5 22.5V36.5A8 8 0 0 1 63.5 44.5ZM99.39 40L85.17 40L85.17 35.92L90.27 35.92L90.27 24.22L85.41 25.15L85.41 21.43L92.22 19L94.71 19L94.71 35.92L99.39 35.92L99.39 40Z"
        fill="var(--ss-accent)"
        fillRule="evenodd"
      />
    </svg>
  ) : (
    <svg viewBox="12 12 104 104" width={size} height={size} aria-hidden focusable={false} {...p}>
      <path
        d="M33 44.5H111.5V91A16.5 16.5 0 0 1 95 107.5H33A16.5 16.5 0 0 1 16.5 91V61A16.5 16.5 0 0 1 33 44.5ZM33 55.5H95A5.5 5.5 0 0 1 100.5 61V91A5.5 5.5 0 0 1 95 96.5H33A5.5 5.5 0 0 1 27.5 91V61A5.5 5.5 0 0 1 33 55.5Z"
        fill="var(--ss-accent)"
        fillRule="evenodd"
      />
      <path d="M111.5 44.51V22.5A8 8 0 0 0 103.5 14.5H79.5A8 8 0 0 0 71.5 22.5V36.5A8 8 0 0 1 63.5 44.5Z" fill="var(--ss-accent)" />
    </svg>
  );
