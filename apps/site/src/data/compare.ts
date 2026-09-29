/**
 * Comparison table data. Every competitor cell is a claim verified on the vendor's own pages (or, for
 * Mimik, its README) on 2026-09-28. Sources and exact wording: docs/launch/claims.md (gitignored).
 * Do not add a cell without a source there. Prices change; the table is dated on the page.
 * Cells that say "mentioned" are absence claims: worded as what the vendor's page does or does not list.
 */
export const COMPARE_DATE = "28 September 2026";

export interface CompareRow {
  feature: string;
  showsteps: string;
  mimik: string;
  scribe: string;
  tango: string;
}

export const COMPARE_ROWS: CompareRow[] = [
  {
    feature: "Where your guides live",
    showsteps: "In your browser and in files you save. No network requests after install.",
    mimik: "On your device. Its README notes site icons come from Google's favicon service, and optional AI features call the provider you set up.",
    scribe: "Scribe's servers. Its docs describe blurring before capture so blurred data never reaches them.",
    tango: "Tango's cloud, hosted on AWS. No on-premises option.",
  },
  {
    feature: "PDF, HTML and Markdown export",
    showsteps: "Free. Also DOCX.",
    mimik: "Free. Also DOCX, MP4 and GIF.",
    scribe: "Not on the free Basic plan. Included in Pro.",
    tango: "Not on the free plan. Included in Pro.",
  },
  {
    feature: "Blur or redact screenshots",
    showsteps: "Free. Password and card fields blurred as you record; draw your own blur or crop.",
    mimik: "Free. Smart Blur for emails, phone numbers, SSNs, cards, IP and MAC addresses, plus a manual picker.",
    scribe: "Not on Basic. Editing and redacting screenshots is a Pro feature.",
    tango: "Not on the free plan. Annotation and blurring are in Pro.",
  },
  {
    feature: "Free plan limits",
    showsteps: "None. No account, no watermark.",
    mimik: "None listed. No account.",
    scribe: "Basic: web apps only, no unlimited guides.",
    tango: "Free: 5 shared workflows.",
  },
  {
    feature: "Paid price",
    showsteps: "$0. Optional support.",
    mimik: "$0. MIT licensed.",
    scribe: "Pro Personal listed at $35 a month, or $25 a month billed yearly.",
    tango: "Pro listed at $26 per user a month, or $22 billed yearly, for 1 to 2 users.",
  },
  {
    feature: "Replayable script or skill for an agent",
    showsteps: "Yes: SKILL.md, steps.json and a Playwright replay.spec.ts, plus a CLI and MCP server.",
    mimik: "No CLI, MCP or Playwright export mentioned. Has a live walkthrough inside the extension.",
    scribe: "Not listed on its pricing page.",
    tango: "Not listed on its pricing page. Automations are an Enterprise feature.",
  },
  {
    feature: "Desktop app capture",
    showsteps: "No. Chrome tabs only.",
    mimik: "No. Browser workflows; also on Firefox and Edge.",
    scribe: "Yes, on paid plans.",
    tango: "Yes, on Pro.",
  },
  {
    feature: "Team comments, viewer insights, SSO",
    showsteps: "No. It is a personal tool that produces files.",
    mimik: "None mentioned.",
    scribe: "Yes, on higher tiers.",
    tango: "Yes, on higher tiers.",
  },
  {
    feature: "Share by link",
    showsteps: "No hosted links. Send the file, or host the HTML anywhere.",
    mimik: "None mentioned. Exports files.",
    scribe: "Yes.",
    tango: "Yes.",
  },
];
