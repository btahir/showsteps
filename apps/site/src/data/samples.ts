/** Example agent-skill output shown on the landing page and agents docs. Mock data. Keep in step with core's exportAgentSkill / exportPlaywright. */
export const SAMPLE_SKILL_MD = `---
name: invite-a-teammate
description: Invite a teammate to the Acme workspace with the Editor role.
---

# Invite a teammate

Start at https://app.acme.test/settings (signed in as an admin).

1. Click **Team**
2. Click **Invite member**
3. Type "jane@example.com" in **Email**
4. Select **Editor** in **Role**
5. Click **Send invite**
   Expected: a green banner reads "Invite sent".

Machine-readable steps: steps.json. Replay: replay.spec.ts.
`;

export const SAMPLE_REPLAY_TS = `import { test } from "@playwright/test";

test("Invite a teammate", async ({ page }) => {
  await page.goto("https://app.acme.test/settings");
  await page.getByRole("link", { name: "Team" }).click();
  await page.getByRole("button", { name: "Invite member" }).click();
  await page.getByLabel("Email").fill("jane@example.com");
  await page.getByLabel("Role").selectOption("Editor");
  await page.getByRole("button", { name: "Send invite" }).click();
});
`;

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
    a: "Password and card fields are detected while you record. The typed value is never saved, and the screenshot is blurred over the field. You can also draw a blur or crop on anything else. Check every screenshot before you share it: the extension cannot know that a name in a table is real.",
  },
  {
    q: "Which formats can I export?",
    a: "PDF, self-contained HTML, Markdown with images, DOCX, an agent skill (SKILL.md, steps.json and a Playwright script), and a .stepsnap project file you can reopen and edit later.",
  },
  {
    q: "How is it different from other free tools such as Mimik?",
    a: "Mimik is an MIT-licensed, local extension with video and GIF export and Firefox and Edge support. Showsteps is aimed at a different job: the same recording also exports as a SKILL.md and a Playwright script, agents can drive it from a command line or MCP server, and sensitive fields are redacted as you record. The <a href=\"/open-source-scribe-alternative/\">comparison</a> lays it out.",
  },
  {
    q: "What is the agent skill for?",
    a: "It lets a coding agent, or a test runner, follow or replay the task you recorded. The <code>stepsnap</code> command line and a local MCP server let an agent list, edit, validate and export guides too. See <a href=\"/docs/agents/\">the agents page</a>.",
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
