<p align="center">
  <img src="docs/ghostclick_banner.gif" alt="Ghostclick: a ghost clicking a cursor" width="100%" />
</p>

<h1 align="center">Ghostclick</h1>

<p align="center"><b>Show a website task once, then ask for it again in plain words.</b></p>

---

Ghostclick is a Chrome extension that records what you do on a website and replays it for you, with new values whenever you need. A small AI model runs on your own computer to understand your requests and fix steps when a website changes. Nothing is sent to a server, and no account or API key is needed.

## Install

You need [Node.js](https://nodejs.org) 20 or newer and Google Chrome.

```bash
git clone <repo-url>
cd GHOSTCLICK
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `.output/chrome-mv3` folder inside the project.
3. Pin Ghostclick from the puzzle-piece icon, then click it to open the side panel.

Reload any tabs that were open before you installed it.

### Updating on another computer

`git pull` only updates the **source code**. Chrome keeps running whatever you last **built**. On every machine:

```bash
cd GHOSTCLICK
git pull
npm install
npm run build
```

Then at `chrome://extensions` → Ghostclick → **Reload**.

- Always load / reload **`.output/chrome-mv3`** (not the repo root).
- **`npm install` is required** after pulls that add packages (for example OCR / `tesseract.js`). If you skip it, `npm run build` fails with “failed to resolve import …”.
- If the UI still looks old: remove the extension → **Load unpacked** again → pick `.output/chrome-mv3`.

### Practice form (for Workflows)

The campus practice form is one file: [`demo/index.html`](demo/index.html).

**Easiest:** in Cursor/VS Code, right‑click `demo/index.html` → **Open with Live Server** (or the Live Preview equivalent). The form opens in your browser — no `npm run demo` needed.

You can still run `npm run demo` if you prefer; that serves the same file at `http://127.0.0.1:4173`.

### Dev vs production build

| Folder | How you get it | Keep a terminal running? |
|--------|----------------|--------------------------|
| `.output/chrome-mv3` | `npm run build` | **No** — the extension works on its own |
| `.output/chrome-mv3-dev` | `npm run dev` | **Yes** — leave `npm run dev` running, or Chrome shows WebSocket / “Failed to connect to dev server” errors |

For normal use and demos, load **`.output/chrome-mv3`**. Use **`.output/chrome-mv3-dev`** only when you are editing code and want live reload.

## How to use it

The side panel has three tabs. Each job lives in its own tab.

**Ask: questions and page tasks (no recording here)**
Type a request and press Enter (or click **Go**). Load a text model at the bottom first for summaries and questions (Phi-3.5 Mini is a good default; Vision is only for replay repair).

Examples that work in Ask:
- *"What is this page about?"* / *"Summarize this page"* / *"Who is this?"* — answers from the current page
- *"Find the items on this page related to AI"* / *"Get every item on this page"* — collects a list
- *"Save this page as a clean document"* — downloads Markdown
- *"Read the PDF in this tab"* — opens PDF tools in Data
- *"Which three are cheapest?"* — after you have scraped rows in Data

If you ask to **record** or **teach** a task, Ask sends you to the Workflows tab instead of starting a recording itself.

**Workflows: teach it a task (record / replay)**
1. Open the website and click **Record this page**.
2. Do the task as usual: type, click, submit.
3. Click **Save workflow**.
4. To repeat it, open the workflow, change the values, and click **Run**.

You can also start a saved workflow from Ask when your sentence matches one (for example *"Clear the advising hold for Grace Hopper…"*). Check the values on the card, then click **Run**.

**Data: collect information**
Click **Scrape a list on this page**, then click one item in a list or table. Ghostclick finds the rest, and you can download them as CSV or JSON.

## Features

**Record and replay**
- Record clicks, typing, checkboxes, and dropdowns as steps
- Replay with new values
- Run once per row of a CSV file
- Add page checks ("the page should show *Request submitted*") and see which passed or failed
- Optional screenshot for each step
- Passwords are never saved

**Smart replay**
- If a button was renamed or moved, Ghostclick finds the closest match or asks you to pick
- The AI model can suggest the right button and avoids Cancel, Delete, and Log out
- With Phi-3.5 Vision loaded, Ghostclick tags the possible buttons with numbers on the page, takes one screenshot, and the model picks a number by looking at it
- Pauses at captchas so you can solve them, then continues

**Plain-English requests (Ask tab)**
- Answer questions about the current page, for example *"what is this page about?"*
- Summarize the page
- Find items on a page by description, for example *"repos related to AI"*
- Run a saved workflow and fill in names, emails, and IDs from your sentence
- Recording a new task is only in the Workflows tab

**Data and documents**
- Scrape lists and tables to CSV or JSON
- Download all linked files (PDF, Word, Excel, ZIP, images) at once
- Save any article as a clean Markdown document
- Ask questions about scraped data, for example *"Which three are cheapest?"*

**PDFs**
- Read the PDF in the current tab or open one from your computer
- Save it as text
- Ask questions about it
- Pull information out into a table, with values not found in the PDF flagged

## The AI model (optional)

Pick a model at the bottom of the panel and click **Load model**:

- **Qwen2.5 1.5B**: fastest, about 1 GB
- **Llama 3.2 3B**: balanced, about 2 GB
- **Phi-3.5 Mini**: most accurate, about 2.2 GB
- **Phi-3.5 Vision**: reads screenshots, used only when replay has to repair a step. It needs about 4 GB of graphics memory (more on cards without 16-bit support), so questions and summaries use the text models instead

The model only runs when it is needed: to understand a request, answer a question, or repair a step the page structure alone could not fix. It downloads once and then runs on your graphics card through WebGPU. Recording, replay, scraping, and saving pages all work without a model.

## Project structure

```
entrypoints/              Chrome extension shells (WXT needs these names)
  background.ts           Session state, recording, replay, batch runs
  content.ts              Runs inside web pages: records clicks, replays steps, scrolls, scrapes
  sidepanel/              The side panel UI (Ask, Workflows, Data tabs)
features/                 One folder per side-panel tab, plus the shared local model
  ask/                    Ask tab: plan requests, answer page questions, find by keywords
    requestPlanner.ts     Routes Ask to answer / find / save / PDF — not to recording
    keywordSearch.ts
  data/                   Data tab: scrape lists, save page, PDFs, answer questions about rows
    listScraper.ts
    pageToMarkdown.ts
    loadPdf.ts
    pdfContent.ts
    sortRowsForQuestion.ts
  workflows/              Workflows tab: record/replay helpers, self-repair, captcha pause
    elementSelectors.ts
    selfRepair.ts
    detectCaptcha.ts
  local-ai/               Shared WebLLM model used by all three tabs
    localModel.ts
    useLocalModel.ts
    pageScreenshot.ts     Screenshot of the tab, sized for the vision model
shared/                   Used by several features
  types.ts                Data shapes (workflow, step, row, settings)
  csv.ts                  CSV read and write
  textHelpers.ts          Text cleanup and URL matching
  tabConnection.ts        Reconnects to a tab after the extension reloads
demo/                     Practice form for Workflows (single file: index.html — use Live Server)
browser-tests/            Drive a real Chrome with the extension loaded (not unit tests)
                          live-test + model-test; demo-server can still serve demo/index.html
```

Each `*.test.ts` file sits next to the code it checks. Run them with `npx vitest run`.

While developing with `npm run dev`, load **`.output/chrome-mv3-dev`** and keep that command running. For a build you can close, use `npm run build` and load **`.output/chrome-mv3`**.

## Limits

- One example per workflow
- Scraping covers one page at a time (no automatic "Next page")
- Scanned PDFs (images of text) cannot be read
- Apps drawn on a canvas, such as Figma or Google Docs, cannot be recorded
- Captchas are never solved automatically
- Ask answers from the visible page text; it does not invent facts that are not on the page
- Recording new workflows only happens in the Workflows tab

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
