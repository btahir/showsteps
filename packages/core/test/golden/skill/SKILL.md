---
name: "update-billing-settings-in-acme"
description: "Replay or walk through the \"Update billing settings in Acme\" workflow recorded in a browser (10 steps, starting at app.acme.test). Use when the user wants to do this task, check that it still works, or run it with Playwright."
---

# Update billing settings in Acme

Sign in, switch to **monthly** billing, and pay the open invoice.

Recorded with Showsteps on 28 September 2026: 10 steps across 2 tabs, starting at https://app.acme.test/login.

## How to use this skill

- **Replay it:** run `npx playwright test replay.spec.ts` in this folder (needs `@playwright/test` and a browser: `npx playwright install chromium`). The test opens its own tab, and follows tabs the recording opened.
- **Do it by hand or with a browser tool:** follow the steps below in order. `steps.json` lists the same steps with every recorded locator, best first, for tools that drive a browser directly.
- **If a step fails:** the page probably changed. Re-locate the element from its name and role instead of the CSS selector, and update `replay.spec.ts`.

## Secrets

The recording never stored the values typed into these fields. Provide them as environment variables before replaying (the replay is skipped, not failed, when one is missing):

- `SHOWSTEPS_SECRET_1`: step 3, field "Password"

## Steps

1. Go to **Sign in – Acme**
   - Tab 1
   - URL: https://app.acme.test/login
2. Type "jane@example.com" in **Email**
   - Find it by: label "Email"
   - Tab 1
3. Enter your password
   - Find it by: label "Password"
   - Tab 1
   - Value: read from `SHOWSTEPS_SECRET_1`
4. Click **Sign in**
   - Find it by: test id "signin-button"
   - Tab 1
5. Click **Open settings**
   The gear icon in the top-right corner.
   - Find it by: role "button" named "Open settings"
   - Tab 1
   - Page: Dashboard – Acme, https://app.acme.test/dashboard
6. Select **Monthly** in **Billing period**
   Choose how often you want to be billed.
   - Find it by: label "Billing period"
   - Tab 1
   - Page: Billing – Acme, https://app.acme.test/settings/billing
7. Check **Email me invoices**
   - Find it by: label "Email me invoices"
   - Tab 1
8. Click **Pay now**
   - Find it by: role "button" named "Pay now" inside iframe `iframe[name="card-frame"]`
   - Tab 1
9. Go to **Invoices – Acme Help**
   - Tab 2
   - URL: https://help.acme.test/invoices
10. Press **Enter** to search
    - Find it by: placeholder "Search help"
    - Tab 2

## Files

- `replay.spec.ts`: Playwright test for the whole flow.
- `steps.json`: machine-readable steps (format `showsteps-steps`, version 1).

Made with [Showsteps](https://showsteps.vercel.app).
