/**
 * Keyword landing pages. Static, indexable content; rendered by src/pages/[slug].astro.
 * Blocks: p (HTML allowed, trusted), ul, ol, code, table, callout, compare (the shared comparison table).
 * Competitor claims are dated and sourced in docs/launch/claims.md (gitignored). No invented numbers.
 */
import { SAMPLE_REPLAY_TS, SAMPLE_SKILL_MD } from "./samples";

export type Block =
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { code: string; caption?: string }
  | { table: { head: string[]; rows: string[][] } }
  | { callout: string }
  | { compare: true };

export interface Section {
  h2: string;
  blocks: Block[];
}

export interface KeywordPage {
  slug: string;
  /** <title> without the site suffix */
  title: string;
  h1: string;
  description: string;
  lede: string;
  sections: Section[];
  faq: { q: string; a: string }[];
  related: string[];
  /** Short label for nav/footer/related lists */
  label: string;
  updated: string;
}

const UPDATED = "2026-09-28";

export const KEYWORD_PAGES: KeywordPage[] = [
  {
    slug: "open-source-scribe-alternative",
    label: "Open-source Scribe alternative",
    title: "Open-source Scribe alternative: free, local, and it exports for agents",
    h1: "An open-source Scribe alternative that also writes the agent skill",
    description:
      "Showsteps is a free, MIT-licensed Chrome extension that records a click-through into a step-by-step guide and a replayable agent skill. Local-first, with redaction on by default. Compared with Scribe and Mimik.",
    lede:
      "Record a task once and get two things: a guide people can read, and a script an agent can replay. It runs in your browser, keeps everything on your computer and does not ask for a plan.",
    updated: UPDATED,
    sections: [
      {
        h2: "What you get for free, and what Scribe asks for",
        blocks: [
          {
            p: "Scribe's free Basic plan lets you capture guides in web apps and share them by link or embed. Its pricing page lists PDF, HTML and Markdown export and screenshot redaction under Pro Personal, which was listed at $35 a month, or $25 a month billed yearly, when we checked on 28 September 2026.",
          },
          {
            p: "Showsteps has no plans. You install it, press Record, click through the task and export in any format it supports. Nothing is locked, watermarked or capped, and the source is on GitHub under the MIT licence.",
          },
        ],
      },
      { h2: "Side by side", blocks: [{ compare: true }] },
      {
        h2: "Other free, open-source options: Mimik",
        blocks: [
          {
            p: "Showsteps is not the only free one. <a href=\"https://github.com/westpoint-io/mimik\">Mimik</a> is an MIT-licensed browser extension that also keeps guides on your device with no account, and it is further along than we are in some ways. Here is what its README says, next to what we do.",
          },
          {
            table: {
              head: ["", "Showsteps", "Mimik"],
              rows: [
                ["Licence", "MIT", "MIT"],
                ["Where guides live", "Your browser. No network requests after install.", "Your device. Its README says site icons are fetched from Google's favicon service, and optional AI features call the provider you configure."],
                ["Browsers", "Chrome", "Chrome, Firefox, Edge"],
                ["Exports", "PDF, HTML, Markdown, DOCX, agent skill, project file", "Video (MP4), GIF, PDF, DOCX, HTML, Markdown, project file"],
                ["Redaction", "Password and card fields blurred automatically; draw your own blur or crop", "Smart Blur for emails, phone numbers, SSNs, cards, IP and MAC addresses, with toggles; manual blur picker"],
                ["Step text", "Written from the page's accessible names; no key needed", "Rule-based by default; optional AI descriptions with your own OpenAI or Anthropic key"],
                ["Replay", "Playwright script and SKILL.md an agent or CI job can run", "Guide Me: live walkthrough inside the extension"],
                ["CLI and MCP server for agents", "Yes", "None mentioned in its README"],
              ],
            },
          },
          {
            p: "If you need video or GIF output, narration or Firefox, use Mimik. If you want the same recording to become a Playwright test and an agent skill, or you want to script edits and exports from a terminal or an MCP client, that is what Showsteps is for.",
          },
        ],
      },
      {
        h2: "One recording, a guide and a skill",
        blocks: [
          {
            p: "Every Showsteps recording exports as an agent skill: a <code>SKILL.md</code> with numbered steps, a machine-readable <code>steps.json</code>, and a Playwright <code>replay.spec.ts</code> that prefers role, label and test-id locators. A person gets the guide; a coding agent or a CI job gets something it can run. Scribe's pricing page does not list an equivalent. Details are on the <a href=\"/docs/agents/\">agents page</a>.",
          },
        ],
      },
      {
        h2: "Why local matters for a guide",
        blocks: [
          {
            p: "The guides people write are usually about internal things: the admin console, the billing back end, the way you approve an expense. The screenshots show customer names, account numbers and URLs that are not meant for anyone outside the company. Scribe's documentation describes blurring sensitive data before a screenshot is taken so that it never reaches Scribe's servers, which is a sensible design and also tells you where the unblurred version would otherwise go.",
          },
          {
            p: "With Showsteps the screenshot is captured by the browser, stored in your browser's IndexedDB, and only leaves when you export a file and send it yourself. There is nothing to procure: no vendor questionnaire, no data processing agreement, no account for a contractor. The <a href=\"/scribe-alternative-without-cloud-upload/\">privacy comparison</a> goes into it in more detail.",
          },
        ],
      },
      {
        h2: "Where Scribe is ahead",
        blocks: [
          { p: "Scribe does things Showsteps does not, and may be the better choice if you need any of them:" },
          {
            ul: [
              "Capturing desktop and mobile apps. Showsteps records Chrome tabs only.",
              "Hosted share links and embeds.",
              "Team workspaces, comments, viewer insights and SSO.",
              "Enterprise-managed auto-redaction of personal and health information.",
            ],
          },
          {
            p: "If your work happens in a browser and you mostly send guides as documents, none of that will be missed. If you need a shared, hosted library for a large support team, Scribe is built for that and Showsteps is not.",
          },
        ],
      },
      {
        h2: "Moving over",
        blocks: [
          {
            ol: [
              "While you still have a paid Scribe plan, export the guides you want to keep as Markdown or PDF.",
              "Install Showsteps and re-record the ones that matter. A ten-step task takes about as long as doing the task.",
              "Use the exports as a checklist for wording, then delete the old guides from Scribe if your policy says to.",
            ],
          },
          {
            p: "There is no importer for Scribe files. Guides you record in Showsteps use an open format (a zip with a <code>guide.json</code> and PNG images), so the same problem cannot happen in reverse.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Is Showsteps really free, with no catch?",
        a: "Yes. It is MIT-licensed, has no account and no paid tier. If it saves you money you can support the project on the support page, but no feature depends on it.",
      },
      {
        q: "Is Showsteps better than Mimik?",
        a: "Different. Mimik exports video and GIF, has narration and runs on Firefox and Edge. Showsteps focuses on agent tooling (a command line, an MCP server, a Playwright script and SKILL.md) and on redacting sensitive fields as you record.",
      },
      {
        q: "Can I get a link to share, like a Scribe link?",
        a: "Not a hosted one. Export a self-contained HTML file or a PDF and send that, or put the HTML file on any static host you already use.",
      },
      {
        q: "Does it record desktop apps like Scribe's desktop capture?",
        a: "No. Showsteps records what happens in Chrome tabs. For a native app, use a screen recorder.",
      },
    ],
    related: ["scribe-alternative-without-cloud-upload", "tango-alternative", "record-workflow-as-agent-skill"],
  },

  {
    slug: "scribe-alternative-without-cloud-upload",
    label: "Scribe alternative without cloud upload",
    title: "A Scribe alternative that never uploads your screenshots",
    h1: "A Scribe alternative that never uploads your screenshots",
    description:
      "Where guide-recorder extensions send your screenshots, how to check any extension yourself, and how Showsteps keeps captures in your browser. For teams whose security rules block cloud uploads.",
    lede:
      "If your security team asked where the screenshots go, the answer for cloud tools is a vendor's servers. Here is what that means, how to verify any extension, and a local option.",
    updated: UPDATED,
    sections: [
      {
        h2: "Where the screenshots go",
        blocks: [
          {
            table: {
              head: ["Tool", "What its own pages say"],
              rows: [
                ["Scribe", "Data is encrypted in transit and at rest. Its Smart Blur documentation says sensitive data is blurred before capture so that it never reaches its servers, which means unblurred captures otherwise would. It also says AI providers delete processed data within 30 days."],
                ["Tango", "Cloud-based, hosted on AWS in a VPC that is not publicly accessible. Not available on premises. Data is stored when you start an action such as capturing a workflow."],
                ["Mimik", "Guides, steps and screenshots live on your device. Its README says site icons are fetched from Google's favicon service, and optional AI features send text to the provider you configure."],
                ["Showsteps", "Guides and screenshots live in your browser. No network requests after install, no AI service, no analytics."],
              ],
            },
          },
          {
            p: "None of that means the cloud tools are careless. They describe serious security work. The point is narrower: if a rule says internal screenshots must not leave your network, a tool that uploads them by design cannot pass, however well it encrypts.",
          },
        ],
      },
      {
        h2: "How to check any extension yourself",
        blocks: [
          {
            p: "Do not rely on a store listing, including ours. You can test in five minutes.",
          },
          {
            ol: [
              "Open <code>chrome://extensions</code>, click Details on the extension and read the site access and permissions list. Ask why each one is there.",
              "Open the extension's background page or service worker inspector from that same page and switch to the Network tab.",
              "Record a short task on a test site, using made-up data.",
              "Watch the Network tab while you record, edit and export. Any request to a domain you do not recognise is data leaving. An empty list is what you want.",
              "Repeat with the browser offline. A local-first tool should work identically.",
            ],
          },
          {
            p: "Showsteps is built to pass this test, and it is open source, so you can also read what it does. If you find a request it should not make, please <a href=\"%GITHUB%/issues\">file an issue</a>.",
          },
        ],
      },
      {
        h2: "What Showsteps does with sensitive fields",
        blocks: [
          {
            p: "While you record, Showsteps looks for password, card and other sensitive fields. The typed value is never stored, and the screenshot is blurred over the field, so the sensitive value never exists in the guide, not even hidden under a mask. You can also draw a blur or crop over anything else, such as a customer name in a table.",
          },
          {
            p: "Automatic detection is a safety net. It cannot know that the name in a table is a real person, so read each screenshot before you send the guide.",
          },
        ],
      },
      {
        h2: "What you give up by staying local",
        blocks: [
          {
            ul: [
              "No hosted share links. You send a file: PDF, single-file HTML, Markdown or DOCX.",
              "No shared team library. Guides live on the machine that recorded them until you export or hand over the <code>.showsteps</code> project file.",
              "No desktop or mobile capture. Chrome tabs only.",
              "No viewer analytics, because nothing is hosted.",
            ],
          },
          {
            p: "For many teams that trade is fine: the guide goes into a wiki, a ticket or a document anyway. If you need a hosted library, a cloud tool is the honest answer.",
          },
        ],
      },
      {
        h2: "Handing guides to your security team",
        blocks: [
          {
            p: "Give them the <a href=\"/privacy/\">privacy page</a>, which lists each permission and why it is needed, and the repository. The extension has no backend, so there is no data processing agreement to sign and no subprocessor list to review.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Does Showsteps work offline?",
        a: "Yes. Recording, editing and every export run inside the extension, with no network.",
      },
      {
        q: "Is anything sent when I click a support link?",
        a: "Your browser opens this website in a normal tab. The extension itself sends nothing.",
      },
      {
        q: "Can I use it for regulated data?",
        a: "We make no compliance claims. The design keeps data on your device, which removes the vendor from the picture, but your own policies still apply, so check every screenshot before sharing.",
      },
    ],
    related: ["open-source-scribe-alternative", "steps-recorder-chrome-extension", "tango-alternative"],
  },

  {
    slug: "tango-alternative",
    label: "Tango alternative",
    title: "A free Tango alternative: local, unlimited, no export paywall",
    h1: "A free Tango alternative with no workflow limit",
    description:
      "Showsteps records your clicks in Chrome into a step-by-step guide, stores it on your machine and exports PDF, HTML, Markdown and DOCX for free. No workflow cap, no cloud, no account.",
    lede:
      "Tango's free plan gives you a taste. Showsteps gives you the whole thing, on your own computer, with no cap on how many guides you make.",
    updated: UPDATED,
    sections: [
      {
        h2: "The free plan comparison",
        blocks: [
          {
            p: "Tango's free plan, as listed on its pricing page on 28 September 2026, includes browser capture, link and embed sharing and five shared workflows. PDF, HTML and Markdown export, screenshot blurring and unlimited workflows are on the Pro plan, listed at $26 per user a month, or $22 billed yearly, for one or two users.",
          },
          {
            p: "Showsteps has one tier and it is free: unlimited guides, every export format, blur and manual redaction.",
          },
        ],
      },
      { h2: "Side by side", blocks: [{ compare: true }] },
      {
        h2: "Where your data goes",
        blocks: [
          {
            p: "Tango describes itself as cloud-based and not available for on-premises deployment, with infrastructure on Amazon Web Services. That is a normal way to build a SaaS product, and it is also a reason some teams cannot use it for anything that touches customer data.",
          },
          {
            p: "Showsteps has no server. Recording, editing and export happen inside the extension. The extension asks for a short list of Chrome permissions, each explained on the <a href=\"/privacy/\">privacy page</a>, and it makes no network requests after install.",
          },
        ],
      },
      {
        h2: "Where Tango is ahead",
        blocks: [
          {
            ul: [
              "Desktop capture on Pro. Showsteps only records Chrome.",
              "Shareable links, embeds and a shared workspace for a team.",
              "Viewer insights and version history on Pro; SSO and audit logs on Enterprise.",
              "Enterprise features such as Guide Me and Automations, which run inside Tango.",
            ],
          },
          {
            p: "If you need the guide to live inside a team workspace and to be seen by dozens of people with analytics on who read it, Tango is designed for that. If you need the guide as a document, and you need it today, keep reading.",
          },
        ],
      },
      {
        h2: "Guides for people, scripts for agents",
        blocks: [
          {
            p: "Tango's Enterprise plan lists automations and guided walk-throughs that run inside Tango. Showsteps takes a different route: the same recording exports as a <code>replay.spec.ts</code> Playwright script and a <code>SKILL.md</code> a coding agent can read. You own the script, it runs wherever Node runs, and you can edit it in any editor.",
          },
          {
            p: "There is a command line (<code>showsteps export guide.showsteps --format skill --json</code>) and a local MCP server for agents that prefer tools over shell commands. Details are on the <a href=\"/docs/agents/\">agents page</a>.",
          },
        ],
      },
      {
        h2: "How to switch a workflow over",
        blocks: [
          {
            ol: [
              "Open the workflow in Tango and note the title and intended audience.",
              "Install Showsteps, open the same starting page, press Record and do the task once, slowly.",
              "Stop, then read the generated step titles. Edit any that read badly and add a note step where a decision is needed.",
              "Export as PDF or HTML and replace the old link where you had it.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Does Showsteps import existing Tango workflows?",
        a: "No. Re-recording a task is usually quicker than converting one, and Tango's Markdown export on Pro gives you the text if you want to reuse the wording.",
      },
      {
        q: "Is there a limit on how many guides I can make?",
        a: "No. Guides are stored in your browser's IndexedDB with the unlimitedStorage permission, so the limit is your disk.",
      },
      {
        q: "Can I use it in Edge or Brave?",
        a: "It is built and tested for Chrome. Other Chromium browsers can install Chrome extensions and may work, but we do not test them.",
      },
    ],
    related: ["open-source-scribe-alternative", "free-step-by-step-guide-maker", "record-clicks-to-playwright-test"],
  },

  {
    slug: "free-step-by-step-guide-maker",
    label: "Free step-by-step guide maker",
    title: "Free step-by-step guide maker for any web task",
    h1: "A free step-by-step guide maker that writes the steps for you",
    description:
      "Record a task in Chrome and get a step-by-step guide with annotated screenshots. Edit the text, blur sensitive fields, and export to PDF, HTML, Markdown or DOCX. Free and local.",
    lede:
      "Press Record, do the task once, press Stop. You get a numbered guide with a screenshot and a plain-English title for every step.",
    updated: UPDATED,
    sections: [
      {
        h2: "How it works",
        blocks: [
          {
            ol: [
              "<strong>Record.</strong> Open the extension, press Record, and use the web app as you normally would. Showsteps notes each click, each typed field, each selection, each key like Enter and each page change, across tabs. A visible indicator shows while it is recording, and you can pause.",
              "<strong>Edit.</strong> The side panel lists every step with its screenshot. The click target is outlined. Titles are written for you (<em>Click Save</em>, <em>Type in Email</em>, <em>Go to Settings</em>) and you can rewrite any of them. Reorder, delete, skip or merge steps, and add a note where a click is not enough.",
              "<strong>Export.</strong> Pick the format that fits where the guide is going.",
            ],
          },
        ],
      },
      {
        h2: "Which format to export",
        blocks: [
          {
            table: {
              head: ["Format", "Use it when"],
              rows: [
                ["PDF", "You are attaching the guide to an email or a ticket, or printing it."],
                ["HTML", "You want one self-contained file, images included, that opens in any browser."],
                ["Markdown", "The guide is going into a wiki, a README or a docs repo. You get a folder with guide.md and an images directory."],
                ["DOCX", "Someone will edit it in Word or Google Docs."],
                ["Agent skill", "A coding agent or a test runner should follow or replay the steps."],
                [".showsteps project", "You want to keep editing later, or hand the recording to a teammate or an agent."],
              ],
            },
          },
          {
            p: "You can also copy the whole guide to the clipboard as Markdown and paste it straight into a chat, an issue or a document.",
          },
        ],
      },
      {
        h2: "Sensitive fields are blurred for you",
        blocks: [
          {
            p: "Password fields, card numbers and other fields that look sensitive are marked while you record, and their values are never stored in the step text. The screenshot for that step gets a blur over the field. You can turn it off for a step, or draw your own blur or crop over anything else, such as a customer name in a table. Redactions are stored as regions and applied when you export, so you can change your mind before sending.",
          },
        ],
      },
      {
        h2: "Tips for a guide people actually follow",
        blocks: [
          {
            ul: [
              "Start from a clean state. Sign out of extra accounts and close unrelated tabs so the screenshots show only what matters.",
              "Go slowly and do one thing at a time. If you fumble, delete the step afterwards rather than starting over.",
              "Use note steps for decisions, warnings and expected results: <em>You should now see a green Saved banner.</em>",
              "Rename the guide to the outcome, not the tool: <em>Refund a customer</em>, not <em>Using the billing dashboard</em>.",
              "Open the exported file yourself before sending it. Read it as someone who has never seen the screen.",
            ],
          },
        ],
      },
      {
        h2: "What it does not do",
        blocks: [
          {
            p: "Showsteps records Chrome tabs only. It cannot capture native desktop or mobile apps, and it cannot record pages Chrome does not let extensions touch, such as <code>chrome://</code> pages and the Chrome Web Store. It does not produce video or GIFs, and it does not host share links. It is a document maker, not a screen recorder.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I need an account?",
        a: "No. There is no sign-up, no email address and no login.",
      },
      {
        q: "Are there watermarks on exports?",
        a: "No. Every export is clean.",
      },
      {
        q: "Can I edit the step text?",
        a: "Yes. Steps get generated titles and an optional description. Once you edit a title, regenerating titles leaves your version alone.",
      },
    ],
    related: ["how-to-create-sop-with-screenshots", "steps-recorder-chrome-extension", "work-instructions-template"],
  },

  {
    slug: "how-to-create-sop-with-screenshots",
    label: "How to create an SOP with screenshots",
    title: "How to create an SOP with screenshots (with a checklist)",
    h1: "How to create an SOP with screenshots",
    description:
      "A practical method for writing a standard operating procedure for a software task: scope it, record it, write clear steps, redact, test it on someone new, and keep it current.",
    lede:
      "A good SOP is short, specific and tested by someone who did not write it. Here is a method that works for software tasks, and where a click-recorder saves you the tedious part.",
    updated: UPDATED,
    sections: [
      {
        h2: "1. Decide what the SOP is for",
        blocks: [
          {
            p: "Write one sentence: <em>After following this, a new hire can [outcome] without asking anyone.</em> If the sentence needs an &ldquo;and&rdquo;, you have two SOPs. Name an owner who will fix it when the screen changes, because software procedures go out of date the first time a vendor moves a button.",
          },
        ],
      },
      {
        h2: "2. Fix the starting conditions",
        blocks: [
          {
            p: "List what the reader needs before step one: the account role, the permission, the URL, any data they must have to hand. Most confusing SOPs fail here, not in the steps. If the task needs a test record, create it now so your screenshots do not contain real customer data.",
          },
        ],
      },
      {
        h2: "3. Capture the steps by doing the task once",
        blocks: [
          {
            p: "Do the real task at a normal pace and capture every action. This is the part a recorder is for. With Showsteps you press Record, work through the task in Chrome, and stop. Each click, typed field, selection and page change becomes a step with a screenshot and the click target outlined, so you are not pasting screenshots into a document one at a time.",
          },
          {
            p: "If you are doing it by hand instead, take one screenshot per action, crop tight, and mark the target with a box, not an arrow.",
          },
        ],
      },
      {
        h2: "4. Write each step so it can only be read one way",
        blocks: [
          {
            ul: [
              "One action per step. &ldquo;Click Billing, then Invoices&rdquo; is two steps.",
              "Start with a verb and name the control exactly as it appears on screen: <em>Click <strong>Export</strong></em>.",
              "Say what should happen: <em>A download starts and the button changes to Done.</em>",
              "Put warnings before the step they apply to, not after.",
              "Use the reader's words for outcomes and the screen's words for buttons.",
            ],
          },
          {
            p: "Generated titles get you most of the way there. Read every one and rewrite those that describe the mechanics rather than the intent. Add a note step where the reader must make a choice.",
          },
        ],
      },
      {
        h2: "5. Cover the exceptions",
        blocks: [
          {
            p: "Add a short section for what goes wrong: the error message people will see, why it happens, and what to do. Two or three real errors beat a long troubleshooting table.",
          },
        ],
      },
      {
        h2: "6. Redact before you share",
        blocks: [
          {
            p: "Check every screenshot for customer names, emails, account numbers, API keys, internal hostnames and anything in a browser tab title. Blur or crop what should not travel. Showsteps blurs password and card fields automatically and lets you draw a blur anywhere else, but it cannot know that the name in a table is real. That check is yours.",
          },
        ],
      },
      {
        h2: "7. Test it on someone who has never done it",
        blocks: [
          {
            p: "Sit next to a person who has never done the task and say nothing while they follow the document. Every time they hesitate, fix the step. This is the whole quality process, and it is cheap.",
          },
        ],
      },
      {
        h2: "8. Version it and set a review date",
        blocks: [
          {
            p: "Put the version, owner and last-reviewed date at the top. Keep the recording file: with Showsteps you can reopen the <code>.showsteps</code> project, fix the one step that changed and export again, instead of starting over.",
          },
          {
            code: "SOP: Refund a customer in the billing dashboard\nOwner: Support lead     Version: 1.2     Reviewed: 2026-09-28\n\nPurpose\nAfter following this, a support agent can issue a full refund without help.\n\nBefore you start\n- You have the Support Agent role in the billing dashboard.\n- You have the order number from the ticket.\n\nSteps\n1. Click Orders.\n2. Type the order number in Search, then press Enter.\n3. Click the order in the results.\n4. Click Refund. A confirmation dialog opens.\n5. Select Full refund, then click Confirm. A green banner reads Refund issued.\n\nIf something goes wrong\n- Refund is greyed out: the order is more than 90 days old; escalate to the finance lead.\n\nChange log\n1.2  Refund button moved to the order header.",
            caption: "Skeleton for a software SOP (mock content)",
          },
        ],
      },
    ],
    faq: [
      {
        q: "How long should an SOP be?",
        a: "As long as the task, and no longer. If a procedure runs past about fifteen steps, look for a natural break and split it into two.",
      },
      {
        q: "Should SOPs include screenshots for every step?",
        a: "For software tasks, yes, for any step where the reader must find something on screen. Skip them for steps like &ldquo;press Enter&rdquo;.",
      },
      {
        q: "Which format should I keep the SOP in?",
        a: "Keep the source as the <code>.showsteps</code> project so it stays editable, and export Markdown, HTML or PDF for wherever people read it.",
      },
    ],
    related: ["work-instructions-template", "free-step-by-step-guide-maker", "open-source-scribe-alternative"],
  },

  {
    slug: "steps-recorder-chrome-extension",
    label: "Steps recorder Chrome extension",
    title: "Steps recorder Chrome extension: what to look for before you install",
    h1: "A steps recorder for Chrome, and how to pick one",
    description:
      "How a steps recorder Chrome extension captures screenshots for documentation, which permissions it needs, what to check about privacy and export, and how Showsteps handles each.",
    lede:
      "Documenting a web task by taking screenshots yourself is slow. A steps recorder extension captures them as you go. Before you install one, here is what it needs to do and what to ask it.",
    updated: UPDATED,
    sections: [
      {
        h2: "How these extensions capture screenshots",
        blocks: [
          {
            p: "Chrome gives extensions a method to capture the visible part of a tab as an image. A documentation extension calls it each time you click, type or change page, and pairs the image with a description of the element you touched: its label, its role, where it sits on the page. That description is what turns a folder of screenshots into a guide.",
          },
          {
            p: "Two limits follow from how this works. The capture shows the visible viewport, not the whole scrolling page. And Chrome does not let extensions read or capture certain pages, including <code>chrome://</code> pages and the Chrome Web Store.",
          },
        ],
      },
      {
        h2: "Questions to ask before installing",
        blocks: [
          {
            ol: [
              "<strong>Where do the screenshots go?</strong> Some tools upload every capture to the vendor's servers. Others keep them in the browser. For internal tools, this is the question that matters.",
              "<strong>What permissions does it want?</strong> &ldquo;Read and change all your data on all websites&rdquo; is the broadest. An extension that only acts when you press a button can ask for much less.",
              "<strong>What does it capture in password fields?</strong> The answer should be nothing, not blurred afterwards.",
              "<strong>Can you blur before you share?</strong> And is that free?",
              "<strong>Can you take your data with you?</strong> Look for open formats: Markdown, HTML, PDF, DOCX.",
            ],
          },
        ],
      },
      {
        h2: "What Showsteps asks for, and why",
        blocks: [
          {
            table: {
              head: ["Permission", "Why"],
              rows: [
                ["activeTab", "Lets Showsteps act on the tab you are working in when you start recording."],
                ["scripting", "Injects the small script that notices your clicks and describes the element."],
                ["storage", "Remembers settings such as highlight colour."],
                ["sidePanel", "Shows the step list and editor beside the page."],
                ["unlimitedStorage", "Guides with many screenshots are large; this stops the browser evicting them."],
                ["Site access (optional)", "Requested only when you start recording, so it can follow you across tabs and navigation."],
              ],
            },
          },
          {
            p: "The <a href=\"/privacy/\">privacy page</a> has the full explanation. Showsteps has no analytics, no account and no network requests after install.",
          },
        ],
      },
      {
        h2: "Sensitive data: what is automatic and what is not",
        blocks: [
          {
            p: "Showsteps marks password, card and similar fields as sensitive while recording. Their values are never stored, and the step screenshot is blurred over the field. It cannot know that a name in a table or an email in a header belongs to a real person, so it lets you draw a blur or crop on any screenshot before you export. Read each image before you send the file.",
          },
        ],
      },
      {
        h2: "Getting the documents out",
        blocks: [
          {
            p: "You can export Markdown (a folder with <code>guide.md</code> and images), a self-contained HTML file, PDF, DOCX, an agent skill, or the <code>.showsteps</code> project itself, which is a zip with a <code>guide.json</code> and PNG images. Because the format is documented, you or a script can open, read and rewrite it without the extension.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can it capture a full scrolling page?",
        a: "No. It captures the visible part of the tab at each step. For a long page, the guide shows one screenshot per action, which is usually what a reader needs.",
      },
      {
        q: "Does it work on pages behind a login?",
        a: "Yes. It records in your normal Chrome session, so it sees what you see.",
      },
      {
        q: "Does it work with iframes and shadow DOM?",
        a: "It is designed to describe elements inside iframes and shadow roots so a step can find them again on replay.",
      },
    ],
    related: ["free-step-by-step-guide-maker", "open-source-scribe-alternative", "tango-alternative"],
  },

  {
    slug: "work-instructions-template",
    label: "Work instructions template",
    title: "Work instructions template you can copy (plus how to fill it in)",
    h1: "A work instructions template you can copy",
    description:
      "A plain work instructions template with purpose, prerequisites, numbered steps, checks and a change log, plus writing rules and how to fill the steps section from a recording.",
    lede:
      "Work instructions tell one person how to do one task, the same way every time. Use the template below as it is, or trim it. The rules under it are what make the steps usable.",
    updated: UPDATED,
    sections: [
      {
        h2: "The template",
        blocks: [
          {
            code: "# [Task name, written as an outcome]\n\nDocument ID:      \nOwner:            \nVersion:          \nLast reviewed:    \nApplies to:       [team, system or role]\n\n## Purpose\nOne sentence: what this achieves and why it matters.\n\n## Before you start\n- Access or role needed:\n- Information you need to hand:\n- Tools or systems open:\n- Safety or data-handling notes:\n\n## Steps\n1. [Verb + exact control name.] [What you should see.]\n2. \n3. \n\n## Check your work\n- How to confirm the task worked:\n\n## If something goes wrong\n| Symptom | Likely cause | What to do |\n|---|---|---|\n|  |  |  |\n\n## Who to ask\n[Name or team, and how to reach them]\n\n## Change log\n| Version | Date | Change | By |\n|---|---|---|---|\n",
            caption: "Copy into any editor",
          },
        ],
      },
      {
        h2: "Rules for writing the steps",
        blocks: [
          {
            ol: [
              "<strong>One action per step.</strong> If a step contains &ldquo;and&rdquo;, split it.",
              "<strong>Verb first.</strong> Click, Type, Select, Choose, Open, Press.",
              "<strong>Use the label on the screen,</strong> in bold, exactly as it appears. If the button says <em>Submit</em>, do not write &ldquo;send&rdquo;.",
              "<strong>State the expected result</strong> when it is not obvious: a dialog opens, a banner appears, the page changes.",
              "<strong>Warnings go before the step.</strong> A caution after the click is too late.",
              "<strong>Keep it in order of doing,</strong> not order of importance.",
              "<strong>Add a screenshot</strong> when the reader has to find something, and outline the target.",
            ],
          },
        ],
      },
      {
        h2: "Filling the steps section from a recording",
        blocks: [
          {
            p: "For a task done in a web app, the Steps section is the slow part: doing the task, taking a screenshot at each stage, cropping, marking and writing each line. Showsteps does that in one pass. Record the task in Chrome, and it produces numbered steps in the style above, with titles such as <em>Click <strong>Export</strong></em> and <em>Select <strong>Monthly</strong> in <strong>Billing period</strong></em>, and a screenshot with the target outlined.",
          },
          {
            p: "Export as Markdown and you get a <code>guide.md</code> plus an images folder. Paste the steps under <em>Steps</em> in the template, keep the images beside the file, and fill in the other sections by hand. Those sections need someone who knows why the task exists, which a recorder cannot supply.",
          },
        ],
      },
      {
        h2: "Level of detail",
        blocks: [
          {
            p: "Match the reader. For an experienced person who needs a reminder, a numbered list without screenshots is enough. For a new hire on their first day, include a screenshot for every step where they must find something on screen. When unsure, write for the new hire and let the experienced person skim.",
          },
          {
            callout:
              "Test every set of instructions on someone who has not done the task. Watch where they stop. Those are the steps to rewrite.",
          },
        ],
      },
      {
        h2: "Keeping it current",
        blocks: [
          {
            p: "Put a review date in the header and an owner who is responsible for it. When a screen changes, re-record only the changed step if your tool lets you, or the whole task if it does not, and add a line to the change log. An old procedure that is wrong does more harm than no procedure.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "What is the difference between work instructions and an SOP?",
        a: "An SOP describes a process, who does what and when. Work instructions describe how one person performs a single task inside that process. The template above works for either; use fewer sections for instructions.",
      },
      {
        q: "Does this cover physical tasks?",
        a: "The template does. The recording part does not: Showsteps records browser tasks only.",
      },
    ],
    related: ["how-to-create-sop-with-screenshots", "free-step-by-step-guide-maker", "steps-recorder-alternative"],
  },

  {
    slug: "steps-recorder-alternative",
    label: "Steps Recorder alternative",
    title: "Steps Recorder alternative for Windows 11 (for web tasks)",
    h1: "An alternative to Windows Steps Recorder for web tasks",
    description:
      "Microsoft has deprecated Steps Recorder (psr.exe). Showsteps records clicks in Chrome into an annotated step list, on Windows, macOS and Linux, and exports PDF, HTML, Markdown and DOCX.",
    lede:
      "Steps Recorder was the quiet, useful tool that turned a few minutes of clicking into a numbered list with screenshots. Microsoft has deprecated it. If your tasks are in a browser, Showsteps does the same job.",
    updated: UPDATED,
    sections: [
      {
        h2: "What happened to Steps Recorder",
        blocks: [
          {
            p: "Problem Steps Recorder (<code>psr.exe</code>) recorded your clicks and produced a zipped report with a screenshot and a description for each action. Microsoft lists it as deprecated, and Windows 11 has shown a notice since its February 2024 update saying it will be removed in a future release. Microsoft&rsquo;s suggested replacements are Snipping Tool, Xbox Game Bar and Clipchamp, which record video rather than producing a list of steps.",
          },
          {
            p: "Older Windows versions can still run it, so if you are on one and it works, there is no urgency. This page is for when it is gone, or when you want something that runs beyond one operating system.",
          },
        ],
      },
      {
        h2: "What Showsteps does the same way",
        blocks: [
          {
            ul: [
              "Press Record, do the task, press Stop.",
              "Every click, typed field, selection and page change becomes a numbered step.",
              "Each step has a screenshot with the clicked item outlined.",
              "Steps have readable text you can edit.",
            ],
          },
        ],
      },
      {
        h2: "What is different",
        blocks: [
          {
            table: {
              head: ["", "Steps Recorder", "Showsteps"],
              rows: [
                ["Runs on", "Windows", "Chrome on Windows, macOS and Linux"],
                ["Records", "Windows desktop apps and browsers", "Chrome tabs only"],
                ["Step text", "Automatic description of the action", "Automatic title you can edit, plus optional description"],
                ["Editing", "Little; you edit outside the tool", "Reorder, delete, merge, add notes, blur, crop"],
                ["Output", "Zipped web archive (.mht)", "PDF, HTML, Markdown, DOCX, agent skill, .showsteps project"],
              ],
            },
          },
          {
            callout:
              "The one thing Steps Recorder did that Showsteps does not: record native Windows apps. If your task lives in File Explorer, Excel desktop or another program, Showsteps cannot see it.",
          },
        ],
      },
      {
        h2: "Why it works for web tasks",
        blocks: [
          {
            p: "Most of what people used Steps Recorder to document, such as configuring a cloud console, filing an expense, running a report or setting up an account, now happens in a browser. Showsteps reads the page, so it can label a step by the button&rsquo;s accessible name (<em>Click <strong>Save changes</strong></em>) instead of describing pixels, and it can find that element again later.",
          },
          {
            p: "That is also what lets it export a Playwright script alongside the guide. If a support engineer records a task, a QA engineer can replay the same steps in a test.",
          },
        ],
      },
      {
        h2: "Recording a bug report",
        blocks: [
          {
            p: "A common use of Steps Recorder was a reproduction for a bug. Record the steps in Showsteps, blur anything private, and export the PDF or Markdown to attach to the ticket. If the developer uses Playwright, attach the exported <code>replay.spec.ts</code> too, so they can run the steps themselves.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Is Steps Recorder actually gone?",
        a: "Microsoft lists it as deprecated with a notice in Windows 11 that it will be removed in a future release. Older Windows builds still include it.",
      },
      {
        q: "Can Showsteps record File Explorer or desktop apps?",
        a: "No. It only records what happens inside Chrome tabs.",
      },
      {
        q: "Will it run on my locked-down work PC?",
        a: "If your organisation lets you install Chrome extensions, yes. There is no separate installer and no server to reach.",
      },
    ],
    related: ["record-clicks-to-playwright-test", "free-step-by-step-guide-maker", "work-instructions-template"],
  },

  {
    slug: "record-clicks-to-playwright-test",
    label: "Convert clicks to a Playwright test",
    title: "Convert clicks to a Playwright test: record in Chrome, get replay.spec.ts",
    h1: "Record clicks in Chrome and convert them to a Playwright test",
    description:
      "How to convert a click-through into a Playwright test, compared with Playwright codegen, and how Showsteps exports a replay.spec.ts and an agent skill from the same recording as your guide.",
    lede:
      "Playwright can write a test while you click. Showsteps does that too, in your normal Chrome, and at the same time gives you the documentation for the flow.",
    updated: UPDATED,
    sections: [
      {
        h2: "What Playwright codegen does",
        blocks: [
          {
            p: "Playwright ships a test generator. You run <code>npx playwright codegen your-site.example</code>, a browser opens beside an inspector, and it writes code for each click and keystroke. Its documentation says it favours role, text and test-id locators, and that it can add assertions for visibility, text and values. It produces test code only: no screenshots and no documentation.",
          },
          {
            p: "Codegen runs in a browser that Playwright launches. If the flow needs your real session, an extension, or a page behind single sign-on, you have to preserve authentication state or script the login first.",
          },
        ],
      },
      {
        h2: "What Showsteps adds",
        blocks: [
          {
            ul: [
              "<strong>Records in the Chrome you already use,</strong> across tabs, in your signed-in session.",
              "<strong>Gives you the guide and the test from one recording.</strong> The steps you review for documentation are the steps that get replayed.",
              "<strong>Uses the best locator per step.</strong> It tries <code>getByTestId</code>, <code>getByRole</code> and <code>getByLabel</code> before text, and falls back to CSS only when nothing else identifies the element.",
              "<strong>Lets you edit before export.</strong> Delete a wrong click, merge two typing steps, or skip a step, in the editor.",
              "<strong>Handles sensitive input.</strong> Values typed into password fields are never stored, so they never end up in a script you commit.",
            ],
          },
        ],
      },
      {
        h2: "What the exported test looks like",
        blocks: [
          {
            code: SAMPLE_REPLAY_TS,
            caption: "replay.spec.ts (mock data)",
          },
          {
            p: "Run it with <code>npx playwright test replay.spec.ts</code>. The export is a starting point, not a finished test: it replays what you did, and it does not know what &ldquo;success&rdquo; looks like. Add an <code>expect</code> after the final step, such as <code>await expect(page.getByText(\"Invite sent\")).toBeVisible()</code>.",
          },
        ],
      },
      {
        h2: "The agent skill format",
        blocks: [
          {
            p: "The same export includes a <code>SKILL.md</code> and a <code>steps.json</code>. The skill file has frontmatter with a name and description and a numbered list of steps in plain language. <code>steps.json</code> is the machine version, with each step&rsquo;s action, target and locators. A coding agent can read the skill to understand the task, run the script to check it still works, and patch a locator when the UI changes.",
          },
          {
            p: "Agents can also work with the recording directly through the <a href=\"/docs/agents/\">command line and local MCP server</a>: list steps, edit a step, validate, export.",
          },
        ],
      },
      {
        h2: "When to use which",
        blocks: [
          {
            table: {
              head: ["You want", "Use"],
              rows: [
                ["A test for a flow you already understand, written in code", "Playwright codegen or write it by hand"],
                ["A test and a guide for the same flow, from your own signed-in Chrome", "Showsteps"],
                ["A script a support or ops person can produce without writing code", "Showsteps, then hand replay.spec.ts to an engineer"],
                ["Assertions on many pages", "Write the tests; recorders only replay what you did"],
              ],
            },
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I need Playwright installed to record?",
        a: "No. Recording happens in the extension. You need Node and Playwright only to run the exported script.",
      },
      {
        q: "Will the test survive UI changes?",
        a: "Role, label and test-id locators survive cosmetic changes better than CSS selectors do. No recorded test is immune to a renamed button, so keep the recording and re-export when the UI changes.",
      },
      {
        q: "Does it record assertions?",
        a: "No. It records actions. Add your own expectations to the exported file.",
      },
    ],
    related: ["steps-recorder-alternative", "tango-alternative", "free-step-by-step-guide-maker"],
  },
  {
    slug: "record-workflow-as-agent-skill",
    label: "Record a workflow as an agent skill",
    title: "Record a workflow as an agent skill (SKILL.md generator)",
    h1: "Record a workflow once, get a SKILL.md your agent can follow",
    description:
      "How to turn a browser task you do by hand into a SKILL.md, a steps.json and a Playwright replay script, using a Chrome extension. Free, local, no API key.",
    lede:
      "Agents are good at following instructions and bad at guessing which button you meant. A recording of you doing the task gives them exact names, order and URLs.",
    updated: UPDATED,
    sections: [
      {
        h2: "What a skill file is",
        blocks: [
          {
            p: "An agent skill is a folder with a <code>SKILL.md</code> file: Markdown with a small header holding a <code>name</code> and a <code>description</code>, followed by instructions. Agents that support skills read the description to decide when a skill applies, then load the rest. Because it is plain Markdown, other agents and people can read it too.",
          },
        ],
      },
      {
        h2: "Why record instead of writing it",
        blocks: [
          {
            p: "Writing instructions for a web task from memory leaves gaps. You forget the menu that has to be open first, the exact label on the button, the step that only appears for admins. A recording has no gaps because it is what you actually did, in order, on the real page.",
          },
          {
            ul: [
              "<strong>Exact names.</strong> Each step is named from the page&rsquo;s accessible name: <em>Click <strong>Invite member</strong></em>, not &ldquo;click the blue button&rdquo;.",
              "<strong>Order and URLs.</strong> Page changes and tab switches are steps, so the agent knows where to start.",
              "<strong>Locators.</strong> Each step keeps the ways to find that element again: test id, role and name, label, then text, with CSS only as a last resort.",
              "<strong>Nothing sensitive.</strong> Values typed into password and card fields are never stored, so credentials do not end up in a file you commit.",
            ],
          },
        ],
      },
      {
        h2: "What Showsteps exports",
        blocks: [
          {
            table: {
              head: ["File", "For", "What it holds"],
              rows: [
                ["SKILL.md", "The agent, and you", "Frontmatter with a name and description, then the numbered steps in plain language."],
                ["steps.json", "Programs", "The same steps as data: action, target, locators, page URL."],
                ["replay.spec.ts", "Playwright, CI", "A test that performs the steps using the best locator for each."],
              ],
            },
          },
          {
            code: SAMPLE_SKILL_MD,
            caption: "SKILL.md (mock data)",
          },
        ],
      },
      {
        h2: "From recording to a working skill",
        blocks: [
          {
            ol: [
              "Record the task in Chrome, slowly, with test data.",
              "In the editor, delete any wrong clicks. Rewrite titles that describe mechanics instead of intent, and add note steps for expected results (<em>A green banner reads Invite sent</em>). Agents use these to know they succeeded.",
              "Export as an agent skill. You get a folder with the three files.",
              "Put the folder where your agent reads skills. For Claude Code that is a folder under <code>.claude/skills/</code> in your project or home directory. Other tools have their own location; the file is plain Markdown either way.",
              "Run <code>npx playwright test replay.spec.ts</code> once to confirm the steps still work. Do it again after the app changes.",
            ],
          },
        ],
      },
      {
        h2: "Limits to know about",
        blocks: [
          {
            ul: [
              "A skill describes the interface as it was on the day you recorded. When the app changes, re-record or edit the affected step.",
              "It replays actions, it does not judge results. Add expectations where success matters.",
              "Credentials are not in the file. Your agent needs its own way to sign in, such as an existing session.",
              "The recording is a human&rsquo;s account of a task. Review it before an agent acts on your behalf, especially for anything that spends money or deletes data.",
            ],
          },
        ],
      },
      {
        h2: "Agents can edit the recording too",
        blocks: [
          {
            p: "The same recording is a file. A command line and a local MCP server let an agent list steps, rewrite titles, validate the file and export, and create a guide from a list of steps it wrote, with no network and no API key. See the <a href=\"/docs/agents/\">agents page</a> for commands and tool names.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Does it need an API key or an LLM?",
        a: "No. Step text is generated from the page&rsquo;s accessible names by rules, on your machine. Your own agent brings any intelligence.",
      },
      {
        q: "Will Claude Code, Cursor or other agents read it?",
        a: "SKILL.md is the skill format used by Claude Code. Other agents can read the same Markdown, or use the command line and MCP server instead.",
      },
      {
        q: "Can I use it without an agent?",
        a: "Yes. The same recording gives you a PDF, HTML, Markdown or DOCX guide for people.",
      },
    ],
    related: ["record-clicks-to-playwright-test", "open-source-scribe-alternative", "free-step-by-step-guide-maker"],
  },
];

export const bySlug = (slug: string): KeywordPage | undefined => KEYWORD_PAGES.find((p) => p.slug === slug);
