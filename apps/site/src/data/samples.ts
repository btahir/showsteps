// Real exporter output for scripts/site-sample-steps.json (mock data). Regenerate with
// `node scripts/check-site-samples.mjs --write`; the verifier fails the build when these drift from core.
import skillMd from "./samples/SKILL.md?raw";
import replayTs from "./samples/replay.spec.ts?raw";

export const SAMPLE_SKILL_MD: string = skillMd.trimEnd();
export const SAMPLE_REPLAY_TS: string = replayTs.trimEnd();

export const LANDING_FAQ = [
  {
    q: "Is it really free?",
    a: "Yes. Showsteps is MIT-licensed, has no account, no plans and no watermark, and every export format is included. If it saves you time you can <a href=\"/support/\">support the project</a>, but nothing is locked behind it.",
  },
  {
    q: "Where are my screenshots stored?",
    a: "In your browser, on your computer. Showsteps has no server. A guide leaves your machine only when you export a file and send it yourself.",
  },
  {
    q: "What does it record?",
    a: "Clicks, typing (one step per field), selections, checkboxes, keys like Enter, and page changes, across tabs in Chrome. It records Chrome tabs only, not desktop or mobile apps.",
  },
  {
    q: "What happens to passwords and card numbers?",
    a: "Password and card fields are detected while you record. The typed value is never saved, and the field is masked before the screenshot is stored. Card numbers, tax IDs, IBANs and API keys shown as text on the page are masked too. You can also draw a blur or crop on anything else. Check every screenshot before you share it: the extension cannot know that a name in a table is real.",
  },
  {
    q: "Which formats can I export?",
    a: "PDF, self-contained HTML, Markdown with images, DOCX, an agent skill (SKILL.md, steps.json and a Playwright script), and a .showsteps project file you can reopen and edit later.",
  },
  {
    q: "How is it different from other free tools such as Mimik?",
    a: "Mimik is an MIT-licensed, local extension with video and GIF export and Firefox and Edge support. Showsteps is aimed at a different job: the same recording also exports as a SKILL.md and a Playwright script, agents can drive it from a command line or MCP server, and sensitive fields are redacted as you record. The <a href=\"/open-source-scribe-alternative/\">comparison</a> lays it out.",
  },
  {
    q: "What is the agent skill for?",
    a: "It lets a coding agent, or a test runner, follow or replay the task you recorded. The <code>showsteps</code> command line and a local MCP server let an agent list, edit, validate and export guides too. See <a href=\"/docs/agents/\">the agents page</a>.",
  },
  {
    q: "Does it work in Edge, Firefox or Safari?",
    a: "It is built and tested for Chrome. Edge and other Chromium browsers can install Chrome extensions and may work; we do not test them. Firefox and Safari are not supported.",
  },
  {
    q: "What permissions does it need?",
    a: "A short list, each explained on the <a href=\"/privacy/\">privacy page</a>. Access to all sites is optional and requested only when you start recording.",
  },
];
