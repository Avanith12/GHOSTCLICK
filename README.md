# Ghostclick

A Chrome extension that learns a website task from one demonstration, then runs it again when you ask in plain words. Replays happen at browser speed. A local model, running on your own GPU through WebLLM, is used only to understand your request, repair a step when the page changed, or answer questions about a page or scraped data. Nothing is sent to a server and there is no API key.

## Run it locally

```bash
npm install
npm run build
npm run demo      # practice form at http://127.0.0.1:4173
```

In Chrome, open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select `.output/chrome-mv3` (press Ctrl+H in the file picker to see dot folders). After a rebuild, click the reload icon on the Ghostclick card.

Click the Ghostclick icon to open the side panel. It has three tabs: Ask, Workflows, and Data.

## What it can do

| Use case | How |
|---|---|
| Fill a form many times with different values | Record once, then Run with new values, or upload a CSV under “Run once per row” |
| Advising-hold style tasks | Ask: “Clear the advising hold for Grace Hopper, ID 55667788”. The planner picks the workflow and fills the fields, and you confirm before it runs |
| Web scraping | Data → Scrape a list on this page, click one item, then download CSV or JSON |
| PDFs | Data → Read the PDF in this tab, or Open a PDF file. Save it as text, ask questions, or describe what to pull out into a table. Values that do not appear word for word in the PDF are flagged in a “not found in PDF” column |
| Save an article neatly | Data → Save page as document, which downloads clean Markdown |
| Download many files | Scrape a list of links, then Download linked files (PDF, DOCX, XLSX, ZIP, images) |
| Price comparison | Scrape product lists, then ask the local model, for example “Which three are cheapest?” |
| News search | Record a search with the query as a field, add a scrape step, then rerun with new queries and ask the model to group headlines |
| Website testing | While recording, add “Check that the page shows this text”. Runs report passed and failed checks, including across CSV rows |
| Page changed | Missing buttons are matched by label first. If that is unclear, the local model suggests a control and you approve it |
| Captchas | Ghostclick detects reCAPTCHA, hCaptcha, and Cloudflare checks, pauses, and asks you to solve them. It does not solve them |

## Try it

1. **Form:** Open the practice form, choose Workflows → Record this page, fill both steps, and add the check “Request submitted” on the last page. Save, then run it again with a new name.
2. **Ask:** In Ask, type “Clear the advising hold for Grace Hopper, ID 55667788”, choose Plan it, check the highlighted fields, and Run.
3. **Repair:** On the practice form, choose Simulate a redesigned button, then run the workflow again.
4. **Scrape:** Open https://books.toscrape.com, choose Data → Scrape a list on this page, and click any book title. You get 20 rows with title, price, and links.
5. **PDF:** Open any text PDF in Chrome, choose Data → Read the PDF in this tab, load a model, then type for example “every course code, title, and credits” and choose Pull out into a table.
6. **Batch:** Create a CSV with headers `Student name,Email,Student ID` and upload it in the workflow’s “Run once per row” box.

## Local models

Choose one at the bottom of the panel: Qwen2.5 1.5B (fastest, about 1 GB), Llama 3.2 3B, or Phi-3.5 Mini (about 2.2 GB). The first load downloads it once into Chrome's cache. It needs WebGPU. Without a model, the Ask tab falls back to simple rules, and everything else still works.

These are existing open-weight models: Qwen2.5 from Alibaba (Apache 2.0), Llama 3.2 from Meta (Llama 3.2 Community License), and Phi-3.5 Mini from Microsoft (MIT). The MLC project converts them for the browser and hosts the files on Hugging Face (`huggingface.co/mlc-ai`). After the one-time download they run entirely on your GPU, so page and PDF content never leaves the computer.

## Known limits

- Steps are matched to the page they were recorded on. Addresses that differ only by an ID count as the same page.
- Closed shadow DOM and canvas-drawn apps cannot be recorded.
- Scraping follows one page at a time. Pagination needs a recorded “Next” click plus another scrape step.
- Only one example per workflow. Merging several demonstrations is not built yet.
- Scanned PDFs (images of text) have no readable text. OCR is not built yet.
- Very long PDFs are read in full, but table extraction looks at the first 20 parts (about 60,000 characters).

## Development

```bash
npm run dev    # rebuilds into .output/chrome-mv3-dev
npm test
CHROME_PATH=/path/to/chrome-for-testing npm run test:live
```

`test:live` loads the built extension into Chrome for Testing and runs it on real websites. It scrapes 12 sites (Books to Scrape, Hacker News, Wikipedia, GitHub Trending, Amazon, arXiv, BBC, and others), saves 5 articles as Markdown, replays logins with right and wrong passwords, runs a 3-row batch, replays searches with new terms, repairs a renamed button, and checks that captcha pages pause for a human. Set `TESTS=scrape,replay` to run only some groups.
# GHOSTCLICK
