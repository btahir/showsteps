# Extension e2e

Playwright drives the unpacked extension against the Acme Books fixture site (`apps/fixtures`, port 4517).

```sh
../../../research/heavy.sh pnpm build          # store build (for the manifest check)
../../../research/heavy.sh pnpm build:e2e      # test build: <all_urls> as host_permissions
../../../research/heavy.sh pnpm e2e            # starts the fixture server if it is not running
```

- **Browser:** Playwright's bundled Chromium (`channel: "chromium"`). Branded Google Chrome 137+ ignores
  `--load-extension`; checked on 2026-09-28 with Chrome 154 (no service worker ever starts). Override with
  `SHOWSTEPS_E2E_CHANNEL=chrome` if that changes.
- **Why a separate build:** Playwright cannot click Chrome's permission prompt, so the e2e build grants
  `<all_urls>` at install. `manifest.spec.ts` fails if the two manifests differ in anything else.
- **What `record.spec.ts` checks:** the 10-step, 2-tab flow in `apps/fixtures/flows/fixture-flow.json`
  gives exactly the steps and titles in `expected-steps.json`, highlight boxes within 2 px, the password
  field auto-blurred on steps 1–3, the password in no stored text and no export, every export format
  downloads and parses, and the `.showsteps` file imports back.
- **Artifacts:** `e2e/.artifacts/record/` (guide.json, every export, `capture-rungs.json` = which capture
  path each step used) and `e2e/.artifacts/screens/` (side panel and editor, light and dark).
- **Replay check (manual for now):** unzip the exported skill, start the fixture server, then
  `SHOWSTEPS_SECRET_1=Correct-Horse-9 npx playwright test replay.spec.ts` in the skill folder. Passed on
  2026-09-28.
