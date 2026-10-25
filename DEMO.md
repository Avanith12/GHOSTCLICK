# Ghostclick demo guide

This guide sets up the **Northwind Works** demo site, loads Ghostclick, and walks through the 13 Automation Challenges. It ends with a three-minute presentation script.

Northwind Works is a fictional company app with seeded data that is identical on every reset. It is a static site with no backend, and nothing typed into it leaves the browser. Ghostclick has no special access to it: the agent sees and uses it the same way it would any unfamiliar website.

## 1. Set up (5 minutes, do it before the presentation)

```bash
npm install
npm run build
npm run demo            # leave running: http://127.0.0.1:4173
```

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `.output/chrome-mv3`.
2. Open `http://127.0.0.1:4173`, then click the Ghostclick icon to open the side panel.
3. On the panel's home screen click the keyboard button (⌨), switch to **Do anything**, pick **Phi-3.5 Mini**, and press **Start** on any small task once. The first load downloads the model (about 2 GB; 294 s on our test laptop). After that it loads from the cache in about 12 seconds.
4. Open **Automation Challenges** in the demo's sidebar and choose **Reset demo data**.

**Warm-up check:** run challenge 3 once before presenting so the model is loaded and you know how long a step takes on your machine (15–21 s per step on an Intel Arc 140V).

## 2. The site

| Page | What is on it |
|------|---------------|
| Dashboard | KPI cards, revenue chart, activity feed that loads more on demand, shortcuts |
| Employee Directory | 64 people; search, department and location filters, sortable columns, pagination, detail modals, profiles that open in new tabs, CSV/JSON export |
| Employee profile | Tabbed sections, manager link, a link to the department's analytics |
| Job Application Portal | Four-step form with validation, radios, checkboxes, a date field, progress, a review step, a draft that survives refresh, and a mock submission |
| Product Inventory | Category chips, price and stock sorting, lazy loading as you scroll, sold-out items, stock that drops as items go into the cart, detail pages, a cart drawer with a mock checkout |
| Analytics & Reports | Date ranges (the 30-day and 90-day leaders differ on purpose), KPI cards, chart, sortable table in a scrolling container, collapsible department details, report generation and export, a paginated ledger |
| Settings | Nested navigation, toggle switches, native dropdowns, a custom dropdown whose options exist only while it is open, theme, save/discard/reset |
| Automation Challenges | 13 tasks graded live from the real page state, plus Reset |
| Advising form (classic) | The original practice form, with a “Simulate a redesigned button” switch for self-healing |

Built-in automation hurdles: look-alike names (Jordan Lee, Jordan Leigh, Jordana Lewis), row and card ids that change on every render, many similar “Add to cart”, “View”, and “New tab” buttons, sticky headers, modals, lazy loading, content that appears after a delay, sold-out products, and validation errors.

## 3. The challenges

Copy an instruction from the Challenges page (each card has **Copy instruction**), paste it into **Do anything**, and press **Start**. Keep the Challenges page open in another tab: it re-grades when you switch back to it. A challenge passes only when the page state shows the work was done (what is in the cart, what was saved, exported, submitted, or viewed, and in what order), never because the agent said so.

| # | Challenge | Level | Expected result | Shows |
|---|-----------|-------|-----------------|-------|
| 1 | Find a colleague | Easy | Jordan Lee's profile or details open; answer: Operations | Search, look-alike names, modal |
| 2 | Turn on dark mode | Easy | Saved theme is dark | Nested settings, radios, save |
| 3 | Add a product to the cart | Easy | A Lumen Air is in the cart | Many similar buttons |
| 4 | Export a filtered list | Medium | Engineering only, last name A to Z, CSV downloaded | Filters, sorting, export |
| 5 | Change several settings | Medium | Dark theme, email notifications on, Compact density, saved | Switches, custom dropdown |
| 6 | Shop for the cheapest laptop | Medium | Pico Book 11, Nimbus 13, and Lumen Air inspected; Nimbus 13 in the cart (Pico is sold out) | Filtering, sorting, out-of-stock reasoning |
| 7 | Complete a job application | Medium | Avery Quinn's Data Analyst application submitted with every detail right | Multi-step form, validation, review |
| 8 | Analyze and export a report | Hard | 30-day report exported; answer: Sales (Engineering leads over 90 days) | Date filter, reading tables, export |
| 9 | Connect two pages | Hard | After viewing Jordan Lee, Operations details open in Analytics for 30 days | Carrying information across pages |
| 10 | Compare in new tabs | Hard | Both cheapest monitors opened in their own tabs; Clarity 27 QHD (18 in stock) in the cart | Opening, switching, and reading tabs |
| 11 | Replay after a redesign | Hard | Recorded workflow replayed for Grace Hopper on the redesigned page | Record, replay, self-repair |
| 12 | Buy with approval | Expert | Order with Orbit Mini placed (Pulse X is cheaper but sold out); the agent asks before **Place order** | Approval before consequential actions |
| 13 | Recover from a form error | Expert | Phone rejected as 5550107788, fixed to 555-010-7788, application submitted | Reading errors, retrying |

**Real-model status:** every challenge is verified done by hand (`test:demo`), and the agent machinery is verified on the site with scripted decisions (`test:agent`). With the real Phi-3.5 Mini model, challenges 1 and 3 have passed the verifier and challenge 2 has failed; the others have not been run with a model yet. Treat them as stretch goals, not demo material.

Challenge 11 uses **Workflows** rather than the agent: record the classic form once, turn on **Simulate a redesigned button**, then run the workflow with new values. Replay notices that Continue became Next, avoids the new Cancel button, and asks you, the model, or a screenshot which control to use.

Any agent run that finishes can be saved with **Save as workflow** and replayed later without the model. Run challenge 7 once with the agent, save it, then rerun it from Workflows with a different name to show deterministic replay.

## 4. Three-minute presentation

The live agent segment uses **challenge 3**, the task Phi-3.5 Mini completed with real inference in our benchmark (goal reached on its 4th action, about 1.5–2 minutes from Start). The model does not reliably send FINISH by itself, so the presenter presses **Stop** once the goal is reached. The rest of the script shows features that do not depend on the model.

**Before you start:** model loaded (warm-up done), demo data reset, the **Dashboard** open, Challenges open in a second tab, and the classic advising form recorded once as a workflow (Workflows → Record this page → fill it → Save).

| Time | Do | Say |
|------|----|-----|
| 0:00 | Dashboard with the side panel open | “Ghostclick is a browser agent whose AI runs on this laptop's own GPU. No cloud, no API key.” |
| 0:15 | ⌨ → **Do anything**, paste: *In Product Inventory, add one Lumen Air laptop to the cart.* → **Start** | “It has never seen this site. Each step it reads the page as a numbered list of controls and picks one action, as checked JSON.” |
| 0:30 | Point at the plan, the current action, and the **Why** line while it works | “It is choosing the product search box, not the people search. Every action is validated before it runs.” |
| 1:45 | When the toast says *Added Lumen Air to the cart*, press **Stop** | “Goal reached. Stop is always one click away, in the panel and on the page.” |
| 2:00 | Switch to the Challenges tab: #3 is green | “The site grades itself from the real cart, not from the AI saying it is done.” |
| 2:15 | Open the advising form, turn on **Simulate a redesigned button**, run the recorded workflow with a new name | “Tasks you show it once replay instantly, without the model, and survive a redesign: Continue became Next, and it avoids the new Cancel.” |
| 2:45 | Close | “Small local models are slow and imperfect, so Ghostclick validates every step, asks before anything consequential, and turns good runs into instant, reliable workflows.” |

**If the live agent stalls or picks wrong:** press **Stop**, say “this is a 3.8-billion-parameter model on a laptop GPU, so that happens; this is why every step is checked”, and go straight to the workflow replay at 2:15. Do not attempt the multi-tab or approval challenges live with the model: they work in the scripted end-to-end tests but have not been verified with real inference.

## 5. Troubleshooting

| Problem | Fix |
|---------|-----|
| “Ghostclick cannot reach this page” | Reload the tab once. Tabs open before the extension was installed or reloaded have no content script yet. |
| The page shows file:// in the address bar | Serve the site with `npm run demo` or Live Server; extensions do not run on `file://` pages. |
| “This Chrome profile does not expose WebGPU” or the model will not load | Check `chrome://gpu`, update Chrome and graphics drivers, close other tabs using the GPU, or pick a smaller model. |
| “The graphics card dropped the local model” | The GPU ran out of memory. Choose a smaller model and click Start again. |
| The agent keeps choosing the wrong control | Make the instruction more specific (name the page and the item), keep it to one site, or Stop and start again. Phi-3.5 Mini is the only model benchmarked. |
| The agent reached the goal but keeps going | Expected with small models; press **Stop**. The result stays in place. |
| The panel was closed during a task | Reopen it: an **Interrupted task** card offers **Resume task** from the last checkpoint. |
| “Reached the limit of 25 steps” | Raise **Most steps per task** under Agent options. |
| A challenge does not turn green | Switch back to the Challenges tab (it re-grades on focus) or click **Check again**. Each card lists which criteria are still unmet. |
| Leftover state from an earlier attempt | **Reset demo data** on the Challenges page or in Settings → Advanced → Administration. |
| “Failed to connect to dev server” | You loaded `.output/chrome-mv3-dev`; load `.output/chrome-mv3` instead. |

## 6. Verifying the demo yourself

```bash
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run test:demo
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run test:agent
```

`test:demo` completes all 13 challenges by hand in a real Chrome and confirms each one turns green, and that nothing passes on fresh data. `test:agent` loads the extension and drives the agent loop with scripted decisions through 16 scenarios on this site, checking results with the challenge grader. Neither test downloads a model. `browser-tests/agent-bench.mjs` runs the challenges with the real model; see [verifiedresults.md](verifiedresults.md) for what has been measured.
