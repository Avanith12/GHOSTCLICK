<p align="center">
  <img src="docs/ghostclick_banner.gif" alt="Ghostclick: a ghost clicking a cursor" width="100%" />
</p>

<h1 align="center">Ghostclick</h1>

<p align="center"><b>Tell your browser what you want done. A local AI does it, step by step, and asks before anything that matters.</b></p>

---

Ghostclick is a Chrome extension with a local AI browser agent. Describe a task in plain words and the agent looks at the page, picks one action at a time, checks the result, and keeps going across pages and tabs until the task is done. It can also record a task you show it once and replay it with new values, scrape lists, and read PDFs.

The AI model ([WebLLM](https://github.com/mlc-ai/web-llm)) runs on your own graphics card. Your pages and data are never sent to a server, and no account or API key is needed. The one exception is optional voice input, which uses Chrome's speech service (see [Limits](#limits)).

See **[DEMO.md](DEMO.md)** for the hackathon demo: a multi-page enterprise practice site with 13 graded automation challenges.

## Install

You need [Node.js](https://nodejs.org) 20 or newer, Google Chrome, and for the AI features a graphics card with WebGPU (most from the last few years).

```bash
git clone <repo-url>
cd GHOSTCLICK
npm install        # also generates WXT's types
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `.output/chrome-mv3` folder inside the project.
3. Pin Ghostclick from the puzzle-piece icon, then click it to open the side panel.

Reload any tabs that were open before you installed it.

### The demo site

```bash
npm run demo       # http://127.0.0.1:4173
```

This serves **Northwind Works**, a fictional company app with a dashboard, employee directory, job application portal, product inventory, analytics, settings, and an **Automation Challenges** page that grades each task from the real page state. The original single-page practice form is still at `/advising.html`. Opening `demo/index.html` with VS Code's Live Server works too. Ghostclick only runs on `http(s)` pages, so double-clicking the file (`file://`) will not work.

### Dev vs production build

| Folder | How you get it | Keep a terminal running? |
|--------|----------------|--------------------------|
| `.output/chrome-mv3` | `npm run build` | **No**: the extension works on its own |
| `.output/chrome-mv3-dev` | `npm run dev` | **Yes**: leave `npm run dev` running, or Chrome shows “Failed to connect to dev server” errors |

## How to use it

The side panel opens on a home screen. Click the ghost to open **Ask**. The **⚙ settings** button leads to **Workflows** and **Data**, the theme, and the default model.

### Ask → Do anything (the agent)

1. Pick a model under **Task** (Phi-3.5 Mini or Llama 3.2 3B recommended; see [The AI model](#the-ai-model)) and type a task, for example:
   - *“Go to the Employee Directory, show only Engineering, sort by last name, and export it as CSV.”*
   - *“Open the two cheapest monitors in new tabs, compare their stock, and add the one with more units to the cart.”*
   - *“Find Jordan Lee, check their department, then open that department's analytics for the last 30 days.”*
2. Press **Start**. The panel shows the plan, the current action and why, every step taken with its result, and the final answer.
3. **Pause**, **Resume**, and **Stop** are in the panel. The bar Ghostclick shows on the page while it works also has **Stop**.
4. When the agent wants to do something consequential (place an order, pay, send, delete, publish, submit an application, save account settings, close a tab you opened), it waits for **Approve** or **Skip it**. When it needs you (a login, a captcha, a file to upload, missing information), it waits for **Continue**.
5. When the run ends, **Save as workflow** turns the steps it took into an ordinary workflow you can rename, trim, rerun with new values, or run once per CSV row, all without the model.

### Ask → Quick ask

Fast, mostly rule-based answers that need no agent loop:
- *“What is this page about?”* / *“Summarize this page”*: answers from the current page (needs a text model)
- *“Find the items on this page related to AI”* / *“Get every item on this page”*: collects a list
- *“Save this page as a clean document”*: downloads Markdown
- *“Read the PDF in this tab”*: opens the PDF tools in Data
- *“Which three are cheapest?”*: after you have scraped rows (needs a text model)
- A sentence that matches a saved workflow (*“Clear the advising hold for Grace Hopper…”*) fills in its values and offers **Run**

### Workflows: record and replay

1. Open the website and click **Record this page**.
2. Do the task as usual: type, click, submit.
3. Click **Save workflow**.
4. To repeat it, open the workflow, change the values, and click **Run**, or upload a CSV to run it once per row.

### Data

**Scrape a list on this page**, then click one item. Ghostclick finds the rest. Download as CSV or JSON, download every linked file, save the page as Markdown, or ask questions about the rows. The agent's `EXTRACT` action fills the same table.

## Features

**Autonomous agent (Ask → Do anything)**
- A loop of plan → look at the page → choose one action → validate → approve if needed → act → check the result → repeat, with a final check that the goal is really met before it accepts “done”
- 24 schema-checked actions: `NAVIGATE`, `SEARCH`, `CLICK`, `TYPE` (optionally pressing Enter), `CLEAR`, `SELECT`, `SCROLL`, `HOVER`, `WAIT`, `READ`, `EXTRACT`, `NOTE`, `OPEN_TAB`, `SWITCH_TAB`, `CLOSE_TAB`, `GO_BACK`, `GO_FORWARD`, `DOWNLOAD`, `SUBMIT`, `UPLOAD_FILE` (asks you to pick the file), `SCREENSHOT`, `VERIFY`, `ASK_USER`, `FINISH`. The model only ever produces these JSON objects, never code.
- Page understanding: a compact, numbered list of visible controls with their accessible names, roles, values, options, checked state, link targets, required and invalid flags, plus open dialogs, error messages, password fields, captchas, and the page text most relevant to the goal. Element names follow accessibility rules (`aria-labelledby`, labels, `aria-label`, then text), so it handles custom dropdowns, switches, and modals, not just plain forms.
- Self-healing: if the page re-renders, a chosen element is found again from its recorded selectors. Invented ids, wrong control types, and blocked addresses are rejected with a reason the model reads next step.
- Loop prevention: repeating the same action on an unchanged page is refused, “the page did not change” is reported back, and four failures in a row end the run with an explanation. Configurable step limit (default 25) and a 90-second limit per model reply.
- Task memory: the goal, plan, completion criteria, notes, and recent actions carry across pages and tabs.

**Tabs**
- The model sees every open tab (title, site, which is current, which it opened, which still need permission) and decides itself when to switch, open, or close tabs
- Links that open a new tab are followed automatically
- Page content is read only on sites you allow. The site you start on is allowed; any other site asks once per task (**Allow for this task**, **Always allow**, **Don't allow**). You can keep lists of always-allowed and never-touch sites.
- Closing a tab the agent did not open needs your approval

**Safety**
- Never types passwords or card numbers, never solves captchas, never picks files for you
- Page text is given to the model as untrusted data, and the model is told never to follow instructions in it
- Only `http(s)` addresses can be opened; `javascript:`, `file:`, and browser pages are refused
- Visible Stop in the panel and on the page

**Record and replay**
- Record clicks, typing, checkboxes, and dropdowns as steps; passwords are never saved
- Replay with new values, or once per row of a CSV file
- Page checks (“the page should show *Request submitted*”) with pass/fail results
- If a button was renamed or moved, Ghostclick finds the closest match, asks the model, or asks you, and avoids Cancel, Delete, and Log out. With Phi-3.5 Vision, it can pick from a screenshot.
- Pauses at captchas so you can solve them, then continues

**Data and documents**
- Scrape lists and tables to CSV or JSON, including lists that load more as you scroll
- Download all linked files (PDF, Word, Excel, ZIP, images) at once
- Save any article as clean Markdown
- Read PDFs from a tab or from disk, with on-device OCR for scanned pages; ask questions or pull values into a table, with values not found in the PDF flagged

## The AI model

Choose a model in the **Do anything** panel or in ⚙ settings. It downloads once from Hugging Face, then runs on your graphics card through WebGPU.

| Model | Download | Use it for |
|-------|----------|------------|
| Qwen2.5 1.5B | about 1 GB | Fastest. Fine for Quick ask; loses track on longer agent tasks |
| Llama 3.2 3B | about 2 GB | A good balance for agent tasks |
| Phi-3.5 Mini | about 2.2 GB | The strongest text model here; the first choice for agent tasks |
| Phi-3.5 Vision | about 4 GB | Only for repairing replays from a screenshot; not used by the agent or for questions |

The recommendations above follow model size and the team's earlier testing of Quick ask. The agent loop itself is verified with scripted decisions (see [Testing](#testing)); how often each model completes each challenge has not been benchmarked yet, so try your demo tasks on your own hardware first.

Small local models make mistakes. They sometimes pick the wrong control or stop early. The loop is built around that: every action is validated, failures are fed back, consequential steps need you, and “done” is double-checked. Long, open-ended research across many sites is still beyond what a 1.5–4 B model does reliably. Short, concrete tasks on one or two sites work best.

Recording, replay, scraping, and saving pages all work without a model.

## Project structure

```
entrypoints/
  background.ts           Session state, recording, replay, batch runs, agent status, saving agent runs
  content.ts              Runs in web pages: records, replays, scrapes, and answers the agent's observe/act messages
  sidepanel/              Side panel UI (AgentView = “Ask Ghostclick to Do Anything”, AskView, Workflows, Data)
  voice/                  The small Voice window
features/
  agent/                  The autonomous agent
    agentLoop.ts          Plan → observe → decide → validate → approve → act → verify loop, tabs, permissions
    actions.ts            Action schema, parsing, validation, approval rules, URL and site checks
    agentPrompt.ts        Compact prompts within a 3,072-token window
    observePage.ts        Page observation and action execution (runs in the content script)
    chromeBrowser.ts      Chrome tabs/scripting implementation of the loop's browser
  ask/                    Quick ask: request routing, keyword search
  data/                   Scraping, Markdown, PDFs, OCR, questions about rows
  workflows/              Record/replay helpers, self-repair, captcha detection
  local-ai/               WebLLM loading and calls shared by all features
shared/                   Types, CSV, text helpers, tab reconnection
demo/                     Northwind Works demo site and the classic advising form (static, no backend)
browser-tests/            Real-Chrome tests (see Testing)
```

## Testing

```bash
npm test                                   # 98 unit tests (vitest): planner, agent loop, actions, page observation, scraping, PDFs
npm run build
CHROME_PATH="<path to chrome>" npm run test:demo    # demo site: every page, deep links, refresh, all 13 challenges by hand, scoring
CHROME_PATH="<path to chrome>" npm run test:agent   # the agent in real Chrome with the extension loaded (16 scenarios)
```

`test:agent` swaps the model for scripted decisions that read the real prompt, so it checks everything except the model's judgement: observation, element ids, validation, approvals, site permissions, tab switching, new-tab handling, Stop (panel and page), extraction, saving the run as a workflow, and replaying it without a model. Results are checked against the demo's own challenge grader. `test:live` (external websites) and `model-test.mjs` (real WebLLM models; needs a GPU and the model downloads) cover the older features.

## Limits

- The agent works in one Chrome window's tabs at a time and stops when the side panel closes
- Small local models can choose wrong actions or give up early; per-model success rates on the challenges are not benchmarked yet
- Saved agent workflows replay in one tab: tab switches become “open this page” steps
- Captchas are never solved, passwords are never typed, and files are never chosen automatically
- Scraping covers one page at a time (no automatic “Next page” in the Data tab; the agent can click Next itself)
- OCR for scanned PDFs is English-only and covers the first 20 scanned pages
- PDFs opened from `file://` tabs must be loaded with **Open a PDF file**
- Apps drawn on a canvas, such as Figma or Google Docs, cannot be recorded or read
- Voice input goes through Chrome's speech service, so it is the one feature that sends audio off your computer

## Team

<img src="docs/ghostclick_mini_animated.gif" alt="Ghostclick ghost" width="96" align="right" />

- Avanith Kanamarlapudi
- Kurt Sooknanan
- Ana Maria Fahlböck
- Chelsea Nguyen
- Kalysha MelendezHernandez
- Ila Lama

## License

[MIT](LICENSE) © 2026 the Ghostclick team
