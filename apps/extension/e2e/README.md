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
- **Replay:** `record.spec.ts` unzips the exported skill into `e2e/.artifacts/replay/`, writes a minimal
  `playwright.config.ts` and runs the generated `replay.spec.ts` against the fixtures in a child Playwright
  run: `1 passed` with `SHOWSTEPS_SECRET_1` set, `1 skipped` without it (ACCEPTANCE G3, G5). Output in
  `e2e/.artifacts/record/replay-output.txt`. `e2e/.artifacts/**` is ignored as a test directory.
- **What `round2.spec.ts` checks:** text-pattern redaction on `apps/fixtures/site/patterns.html` (cards, SSN,
  IBAN, JWT, a token that appears 600 ms after load, a card pasted in an input; order number, epoch, date,
  UUID and phone untouched; emails only with the preset) burnt into the stored pixels; the in-page recording
  bar (roles and names, pause/resume/discard/stop from the bar, clicks on it are never steps, and its ink and
  dot colours in **no** stored screenshot, with a positive control); typing amends; auto-blur Undo from the
  in-memory original, Ctrl+Z re-burns, a reopened editor offers no Undo; highlight handles by mouse and
  keyboard; starting on `chrome://version`; and a real DPR 2 run (`--force-device-scale-factor=2`: an
  emulated `deviceScaleFactor` alone changes `devicePixelRatio` but not the captured pixels).
- **Console:** `SHOW_CONSOLE=1` prints the worker's and the pages' console output during `round2.spec.ts`.
