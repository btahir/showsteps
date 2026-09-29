/**
 * Comparison table data. Every competitor cell is a claim we verified on the vendor's own pages on
 * 2026-09-28. Sources and exact wording are in docs/launch/claims.md (gitignored). Do not add a cell
 * without a source there. Prices change; the table is dated on the page.
 */
export const COMPARE_DATE = "28 September 2026";

export interface CompareRow {
  feature: string;
  stepsnap: string;
  scribe: string;
  tango: string;
}

export const COMPARE_ROWS: CompareRow[] = [
  {
    feature: "Where your guides live",
    stepsnap: "In your browser and in files you save. Nothing is uploaded.",
    scribe: "Scribe's servers. Its docs describe blurring before capture so blurred data never reaches them.",
    tango: "Tango's cloud, hosted on AWS. No on-premises option.",
  },
  {
    feature: "PDF, HTML and Markdown export",
    stepsnap: "Free. Also DOCX.",
    scribe: "Not on the free Basic plan. Included in Pro.",
    tango: "Not on the free plan. Included in Pro.",
  },
  {
    feature: "Blur or redact screenshots",
    stepsnap: "Free. Password and card fields are blurred automatically; draw your own blur too.",
    scribe: "Not on Basic. Editing and redacting screenshots is a Pro feature.",
    tango: "Not on the free plan. Annotation and blurring are in Pro.",
  },
  {
    feature: "Free plan limits",
    stepsnap: "None. No account, no watermark.",
    scribe: "Basic: web apps only, no unlimited guides.",
    tango: "Free: 5 shared workflows.",
  },
  {
    feature: "Paid price",
    stepsnap: "$0. Optional support.",
    scribe: "Pro Personal listed at $35 a month, or $25 a month billed yearly.",
    tango: "Pro listed at $26 per user a month, or $22 billed yearly, for 1 to 2 users.",
  },
  {
    feature: "Replayable script for an agent",
    stepsnap: "Yes: SKILL.md, steps.json and a Playwright replay.spec.ts.",
    scribe: "Not listed on its pricing page.",
    tango: "Not listed on its pricing page. Automations are an Enterprise feature.",
  },
  {
    feature: "Desktop app capture",
    stepsnap: "No. Chrome tabs only.",
    scribe: "Yes, on paid plans.",
    tango: "Yes, on Pro.",
  },
  {
    feature: "Team comments, viewer insights, SSO",
    stepsnap: "No. It is a personal tool that produces files.",
    scribe: "Yes, on higher tiers.",
    tango: "Yes, on higher tiers.",
  },
  {
    feature: "Share by link",
    stepsnap: "No hosted links. Send the file, or host the HTML anywhere.",
    scribe: "Yes.",
    tango: "Yes.",
  },
];
