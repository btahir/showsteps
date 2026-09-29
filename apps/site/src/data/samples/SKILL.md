---
name: "invite-a-teammate"
description: "Replay or walk through the \"Invite a teammate\" workflow recorded in a browser (6 steps, starting at app.acme.test). Use when the user wants to do this task, check that it still works, or run it with Playwright."
---

# Invite a teammate

Invite a teammate to the Acme workspace with the Editor role.

Recorded with Showsteps on 28 September 2026: 6 steps across 1 tab, starting at https://app.acme.test/settings.

## How to use this skill

- **Replay it:** run `npx playwright test replay.spec.ts` in this folder (needs `@playwright/test` and a browser: `npx playwright install chromium`). The test opens its own tab, and follows tabs the recording opened.
- **Do it by hand or with a browser tool:** follow the steps below in order. `steps.json` lists the same steps with every recorded locator, best first, for tools that drive a browser directly.
- **If a step fails:** the page probably changed. Re-locate the element from its name and role instead of the CSS selector, and update `replay.spec.ts`.

## Steps

1. Go to **Settings** on Acme
   - URL: https://app.acme.test/settings
2. Click **Team**
   - Find it by: role "link" named "Team"
3. Click **Invite member**
   - Find it by: role "button" named "Invite member"
4. Type "jane@example.com" in **Email**
   - Find it by: label "Email"
5. Select **Editor** in **Role**
   - Find it by: label "Role"
6. Click **Send invite**
   - Find it by: role "button" named "Send invite"

## Files

- `replay.spec.ts`: Playwright test for the whole flow.
- `steps.json`: machine-readable steps (format `showsteps-steps`, version 1).
