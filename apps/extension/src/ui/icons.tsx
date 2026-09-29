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
export const IconBlur = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="13" height="10" rx="1.5" />
    <path d="M6.5 8h1M9.5 8h1M12.5 8h1M8 10h1M11 10h1M6.5 12h1M9.5 12h1M12.5 12h1" strokeWidth="1.8" />
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
export const IconMerge = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3.5v4.5a4 4 0 0 0 4 4 4 4 0 0 1 4-4V3.5M10 12v4.5" />
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

/** Placeholder mark until packages/brand ships the logo: a numbered step marker on a frame. */
export const BrandMark = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden focusable={false} className="brand-mark" {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <rect x="9" y="10" width="9" height="6" rx="1.5" fill="none" stroke="var(--ss-accent)" strokeWidth="1.8" />
    <circle cx="9" cy="10" r="3.4" fill="var(--ss-accent)" />
  </svg>
);
