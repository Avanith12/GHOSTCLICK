import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');
const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const pages = {
  countries: 'https://www.scrapethissite.com/pages/simple/',
  bbc: 'https://www.bbc.com/news',
  dev: 'https://dev.to/',
  arxiv: 'https://arxiv.org/list/cs.AI/recent',
  github: 'https://github.com/trending',
  amazon: 'https://www.amazon.com/s?k=usb+c+cable',
  stackoverflow: 'https://stackoverflow.com/questions',
};

const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', `--user-agent=${userAgent}`] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  for (const [name, url] of Object.entries(pages)) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    } catch {
      // Some sites never go fully idle. Whatever has rendered is enough.
    }
    await writeFile(`/tmp/site-${name}.html`, await page.content());
    console.log(name, (await page.content()).length);
  }
} finally {
  await browser.close();
}
