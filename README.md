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

## How to use it

The side panel has three tabs.

**Workflows: teach it a task**
1. Open the website and click **Record this page**.
2. Do the task as usual: type, click, submit.
3. Click **Save workflow**.
4. To repeat it, open the workflow, change the values, and click **Run**.

**Ask: tell it what you want**
Type a request and press Enter (or click **Go**). Questions, summaries, finding items, and saving pages happen right away. Requests that act on a website show a card first: for *"Clear the advising hold for Grace Hopper, ID 55667788"*, check the filled-in values and click **Run**.

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

**Plain-English requests**
- Run a saved workflow and fill in names, emails, and IDs from your sentence
- Find items on a page by description, for example *"repos related to AI"*
- Summarize or answer questions about the current page

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
features/
  scrape-lists/           "Scrape a list": finds repeated items on a page and turns them into rows
    listScraper.ts
  find-items/             "Find items about X" without the model: keyword search
    keywordSearch.ts
  answer-data-questions/  "Which is cheapest?": sorts rows before the model answers
    sortRowsForQuestion.ts
  understand-request/     Turns a typed request into a plan (rules, cross-checked with the model)
    requestPlanner.ts
  record-and-replay/      Finding page elements again during replay, and self-repair
    elementSelectors.ts
    selfRepair.ts
  save-page/              "Save page as document": page to clean Markdown
    pageToMarkdown.ts
  captcha/                Detects a captcha so replay pauses for a human
    detectCaptcha.ts
  read-pdf/               Opens PDFs, reads their text, pulls out tables
    loadPdf.ts
    pdfContent.ts
  local-ai/               The local AI model (WebLLM): loading, planning, find by meaning, answers
    localModel.ts
    useLocalModel.ts
    pageScreenshot.ts     Screenshot of the tab, sized for the vision model
shared/                   Used by several features
  types.ts                Data shapes (workflow, step, row, settings)
  csv.ts                  CSV read and write
  textHelpers.ts          Text cleanup and URL matching
  tabConnection.ts        Reconnects to a tab after the extension reloads
scripts/                  Live tests on real websites (live-test.mjs, model-test.mjs)
```

Each `*.test.ts` file sits next to the code it checks. Run them with `npx vitest run`.

## Limits

- One example per workflow
- Scraping covers one page at a time (no automatic "Next page")
- Scanned PDFs (images of text) cannot be read
- Apps drawn on a canvas, such as Figma or Google Docs, cannot be recorded
- Captchas are never solved automatically

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
