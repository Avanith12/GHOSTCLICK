# Verified results

Measured checks for Ghostclick. Product overview stays in the [README](README.md).

Last updated: **25 October 2026**.

Runs used Google Chrome with the production build (`.output/chrome-mv3`) and the local Northwind / advising demo (`npm run demo`). Hardware details omitted — results may vary by machine.

---

## Deterministic checks (no model)

| Check | Result |
|-------|--------|
| Type check, production build, packaged `.zip` | pass |
| Unit tests | 122 passed |
| Demo site, every challenge done by hand and graded | 29 / 29 |
| Agent in real Chrome with scripted decisions | 16 / 16 |

Scripted agent coverage includes: navigation, look-alike names and modals, two-step forms with approval, declining a consequential action, multi-page tasks, custom dropdowns and switches, report export, extraction, recovery from bad ids, tab discovery / switching / reading, site permissions, closing tabs only with approval, Stop (panel and page), reporting an impossible task, and saving a run as a workflow then replaying it with new values.

---

## Ask, tabs, workflows, and repair (through 25 Oct 2026)

| Area | Result |
|------|--------|
| **Ask (home)** | Routes plain-English requests: page Q&A, scrape, go-to/open site, match or start workflows, start the agent |
| **Tabs** | “Open my last N tabs,” tab counts/lists, recent + recently closed sites |
| **Workflows** | Record → save → replay with new field values; CSV batch supported |
| **Self-repair** | Advising **Simulate a redesigned button** (Continue → Next): Repair A and/or Repair B finds Next, avoids Cancel; demo challenge 11 / repair smoke |
| **Safety** | Captcha pause, consequential Approve/Skip, Stop in panel and on page |

---

## Real model (Phi-3.5 Mini) — goals reached

12-step limit, one run each:

| Challenge | Verifier | What happened |
|-----------|----------|---------------|
| 1. Find a colleague | pass | Searched “Jordan Lee”, opened the correct person (not a look-alike), opened the profile in a new tab |
| 3. Add a product to the cart | pass | Used the product search box, found Lumen Air, added it to the cart |

---

## How to re-run checks

See [README — Testing](README.md#testing):

```bash
npm test
npx tsc --noEmit -p .
npm run build
CHROME_PATH="<path to chrome>" npm run test:demo
CHROME_PATH="<path to chrome>" npm run test:agent
CHROME_PATH="<path to chrome>" MODEL=Phi-3.5-mini-instruct-q4f16_1-MLC MAX_STEPS=12 node browser-tests/agent-bench.mjs
```
