---
name: "sign-in-ask-for-help-and-update-billing-in-acme-books"
description: "Replay or walk through the \"Sign in, ask for help, and update billing in Acme Books\" workflow recorded in a browser (11 steps, starting at 127.0.0.1). Use when the user wants to do this task, check that it still works, or run it with Playwright."
---

# Sign in, ask for help, and update billing in Acme Books

Sign in, look something up in the help centre in a second tab, then switch the **billing period** to yearly and save.

Recorded with Showsteps on 28 September 2026: 11 steps across 2 tabs, starting at http://127.0.0.1:4517/index.html.

## How to use this skill

- **Replay it:** run `npx playwright test replay.spec.ts` in this folder (needs `@playwright/test` and a browser: `npx playwright install chromium`). The test opens its own tab, and follows tabs the recording opened.
- **Do it by hand or with a browser tool:** follow the steps below in order. `steps.json` lists the same steps with every recorded locator, best first, for tools that drive a browser directly.
- **If a step fails:** the page probably changed. Re-locate the element from its name and role instead of the CSS selector, and update `replay.spec.ts`.

## Secrets

The recording never stored the values typed into these fields. Provide them as environment variables before replaying (the replay is skipped, not failed, when one is missing):

- `SHOWSTEPS_SECRET_1`: step 3, field "Password"

## Steps

1. Go to **Sign in – Acme Books**
   - Tab 1
   - URL: http://127.0.0.1:4517/index.html
2. Type "jane@example.com" in **Email**
   - Find it by: label "Email"
   - Tab 1
3. Enter your password
   - Find it by: label "Password"
   - Tab 1
   - Value: read from `SHOWSTEPS_SECRET_1`
4. Click **Sign in**
   - Find it by: role "button" named "Sign in"
   - Tab 1
5. Click **Help centre**
   - Find it by: role "link" named "Help centre"
   - Tab 1
   - Page: Dashboard – Acme Books, http://127.0.0.1:4517/dashboard.html
6. Search for "invoices"
   - Find it by: placeholder "Search help"
   - Tab 2
   - Page: Help centre – Acme Books, http://127.0.0.1:4517/help.html
7. Click **Reports**
   - Find it by: role "link" named "Reports"
   - Tab 1
   - Page: Dashboard – Acme Books, http://127.0.0.1:4517/dashboard.html
8. Click **Settings**
   - Find it by: role "link" named "Settings"
   - Tab 1
   - Page: Reports – Acme Books, http://127.0.0.1:4517/dashboard/reports
9. Select **Yearly** in **Billing period**
   - Find it by: label "Billing period"
   - Tab 1
   - Page: Settings – Acme Books, http://127.0.0.1:4517/settings.html
10. Check **Email me invoices**
    - Find it by: label "Email me invoices"
    - Tab 1
11. Click **Save**
    - Find it by: test id "save-settings"
    - Tab 1

## Files

- `replay.spec.ts`: Playwright test for the whole flow.
- `steps.json`: machine-readable steps (format `showsteps-steps`, version 1).

Made with [Showsteps](https://showsteps.vercel.app).
