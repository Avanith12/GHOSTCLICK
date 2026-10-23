#!/usr/bin/env node
/**
 * Packs the multi-page Northwind demo into one Live Server–friendly HTML file.
 * Output: demo2/all.html
 *
 * Routing uses ?page=… so each page can still use location.hash for its own tabs/steps.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const staging = path.join(root, '.pack-staging');
const outFile = path.join(root, 'all.html');

const PAGES = [
  ['index', 'index.html', 'assets/pages/dashboard.js', 'Dashboard · Northwind Works'],
  ['directory', 'directory.html', 'assets/pages/directory.js', 'Employee Directory · Northwind Works'],
  ['employee', 'employee.html', 'assets/pages/employee.js', 'Employee profile · Northwind Works'],
  ['apply', 'apply.html', 'assets/pages/apply.js', 'Job Applications · Northwind Works'],
  ['inventory', 'inventory.html', 'assets/pages/inventory.js', 'Product Inventory · Northwind Works'],
  ['product', 'product.html', 'assets/pages/product.js', 'Product · Northwind Works'],
  ['analytics', 'analytics.html', 'assets/pages/analytics.js', 'Analytics & Reports · Northwind Works'],
  ['settings', 'settings.html', 'assets/pages/settings.js', 'Settings · Northwind Works'],
  ['challenges', 'challenges.html', 'assets/pages/challenges.js', 'Automation Challenges · Northwind Works'],
];

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Turn foo.html?x=1#y into ?page=foo&x=1#y (keeps ${…} template bits intact). */
function toPageUrl(target) {
  if (/^(https?:|mailto:|#|javascript:)/i.test(target)) return target;
  const hashIndex = target.indexOf('#');
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const qIndex = withoutHash.indexOf('?');
  const file = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : '';
  const name = path.basename(file).replace(/\.html$/i, '');
  if (!name) return target;
  if (query.includes('${')) {
    return `?page=${name}&${query}${hash}`;
  }
  const params = new URLSearchParams(query.replace(/&amp;/g, '&'));
  params.set('page', name);
  return `?${params.toString()}${hash}`;
}

function rewriteHtmlLinks(html) {
  return html.replace(/\b(href|action)="([^"]+)"/g, (full, attr, target) => {
    if (!target.includes('.html')) return full;
    return `${attr}="${toPageUrl(target)}"`;
  });
}

function rewriteJsLinks(source) {
  return source.replace(/(href|action)=["']([^"']+\.html[^"']*)["']/g, (full, attr, target) => {
    return `${attr}="${toPageUrl(target)}"`;
  });
}

function extractMain(html) {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (!match) throw new Error('No <main> found');
  return rewriteHtmlLinks(match[1].trim());
}

function extractAdvising(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const wrap = html.match(/<div class="wrap">([\s\S]*?)<\/div>\s*<script>/)?.[1];
  let script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
  if (!wrap || !script) throw new Error('Could not parse advising.html');
  script = script
    .replace(/location\.hash = view;/g, "history.replaceState(null, '', '?page=advising#' + view);")
    .replace(/page: 'advising\.html'/g, "page: 'advising.html'");
  return { style, wrap: rewriteHtmlLinks(wrap), script };
}

function wrapPageModule(source) {
  const lines = source.split('\n');
  const imports = [];
  const body = [];
  for (const line of lines) {
    if (/^\s*import\s/.test(line)) imports.push(line);
    else body.push(line);
  }
  return `${imports.join('\n')}\n\nexport function init() {\n${body.join('\n')}\n}\n`;
}

function patchAppJs(source) {
  let next = source;

  next = next.replace(
    "page: location.pathname.split('/').pop() || 'index.html'",
    "page: (new URLSearchParams(location.search).get('page') || 'index') + '.html'",
  );

  next = next.replace(
    `const NAV = [
  ['index.html', 'Dashboard', '▦'],
  ['directory.html', 'Employee Directory', '☺'],
  ['apply.html', 'Job Applications', '✎'],
  ['inventory.html', 'Product Inventory', '▤'],
  ['analytics.html', 'Analytics & Reports', '↗'],
  ['settings.html', 'Settings', '⚙'],
  ['challenges.html', 'Automation Challenges', '★'],
  ['advising.html', 'Advising form (classic)', '✉'],
];`,
    `const NAV = [
  ['index', 'Dashboard', '▦'],
  ['directory', 'Employee Directory', '☺'],
  ['apply', 'Job Applications', '✎'],
  ['inventory', 'Product Inventory', '▤'],
  ['analytics', 'Analytics & Reports', '↗'],
  ['settings', 'Settings', '⚙'],
  ['challenges', 'Automation Challenges', '★'],
  ['advising', 'Advising form (classic)', '✉'],
];

function pageHref(name) {
  return '?page=' + String(name).replace(/\\.html$/, '');
}`,
  );

  next = next.replace(
    `\${NAV.map(
            ([href, label, icon]) =>
              \`<li><a href="\${href}"\${href === active ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">\${icon}</span>\${label}</a></li>\`,
          ).join('')}`,
    `\${NAV.map(
            ([name, label, icon]) =>
              \`<li><a href="\${pageHref(name)}"\${name === active ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">\${icon}</span>\${label}</a></li>\`,
          ).join('')}`,
  );

  next = next.replace('<a class="brand" href="index.html">', '<a class="brand" href="?page=index">');
  next = next.replace('action="directory.html"', 'action="?page=directory"');
  next = next.replace('<a role="menuitem" href="settings.html">', '<a role="menuitem" href="?page=settings">');
  next = next.replace('<a role="menuitem" href="challenges.html">', '<a role="menuitem" href="?page=challenges">');

  next = next.replace(
    `export function readQuery(defaults) {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, params.get(key) ?? value]));
}

export function writeQuery(values, defaults) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== defaults[key]) params.set(key, value);
  const query = params.toString();
  history.replaceState(null, '', \`\${location.pathname}\${query ? \`?\${query}\` : ''}\${location.hash}\`);
}`,
    `export function readQuery(defaults) {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, params.get(key) ?? value]));
}

export function writeQuery(values, defaults) {
  const params = new URLSearchParams();
  const page = new URLSearchParams(location.search).get('page') || 'index';
  params.set('page', page);
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== defaults[key]) params.set(key, value);
  history.replaceState(null, '', \`?\${params.toString()}\${location.hash}\`);
}`,
  );

  next = next.replace(
    'setTimeout(() => location.reload(), 500);',
    "setTimeout(() => { location.search = '?page=' + (new URLSearchParams(location.search).get('page') || 'index'); }, 500);",
  );

  next = next.replace(
    'export function mountShell(active) {',
    `export function mountShell(activePage) {
  const active = String(activePage || '').replace(/\\.html$/, '');`,
  );

  // Global search form: keep page=directory when submitting
  next = next.replace(
    `shell.querySelector('.cart-button').addEventListener('click', openCart);`,
    `shell.querySelector('.global-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = shell.querySelector('#global-search')?.value?.trim() ?? '';
    const params = new URLSearchParams({ page: 'directory' });
    if (q) params.set('q', q);
    location.search = '?' + params.toString();
  });
  shell.querySelector('.cart-button').addEventListener('click', openCart);`,
  );

  return next;
}

rimraf(staging);
fs.mkdirSync(path.join(staging, 'assets/pages'), { recursive: true });

for (const file of ['data.js', 'metrics.js', 'charts.js', 'challenges.js']) {
  fs.writeFileSync(path.join(staging, 'assets', file), fs.readFileSync(path.join(root, 'assets', file)));
}
fs.writeFileSync(path.join(staging, 'assets', 'app.js'), patchAppJs(fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8')));

const templates = {};
for (const [name, htmlFile, scriptFile] of PAGES) {
  templates[name] = extractMain(fs.readFileSync(path.join(root, htmlFile), 'utf8'));
  const wrapped = wrapPageModule(rewriteJsLinks(fs.readFileSync(path.join(root, scriptFile), 'utf8')));
  fs.writeFileSync(path.join(staging, 'assets/pages', path.basename(scriptFile)), wrapped);
}

const advising = extractAdvising(fs.readFileSync(path.join(root, 'advising.html'), 'utf8'));
templates.advising = advising.wrap;
fs.writeFileSync(
  path.join(staging, 'advising-boot.js'),
  `export function bootAdvising(wrapHtml, styleText) {
  document.title = 'Advising hold release · Northwind College';
  document.querySelectorAll('.shell, .toasts, .overlay, main, .wrap, style[data-advising]').forEach((n) => n.remove());
  const style = document.createElement('style');
  style.dataset.advising = '1';
  style.textContent = styleText;
  document.head.append(style);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = wrapHtml;
  document.body.append(wrap);
  ${advising.script}
}
`,
);

const router = `import { init as dashboard } from './assets/pages/dashboard.js';
import { init as directory } from './assets/pages/directory.js';
import { init as employee } from './assets/pages/employee.js';
import { init as apply } from './assets/pages/apply.js';
import { init as inventory } from './assets/pages/inventory.js';
import { init as product } from './assets/pages/product.js';
import { init as analytics } from './assets/pages/analytics.js';
import { init as settings } from './assets/pages/settings.js';
import { init as challenges } from './assets/pages/challenges.js';
import { bootAdvising } from './advising-boot.js';

const TEMPLATES = ${JSON.stringify(templates)};
const TITLES = ${JSON.stringify(Object.fromEntries(PAGES.map(([name, , , title]) => [name, title])))};
const ADVISING_STYLE = ${JSON.stringify(advising.style)};
const BOOT = {
  index: dashboard,
  directory,
  employee,
  apply,
  inventory,
  product,
  analytics,
  settings,
  challenges,
};

function currentPage() {
  return new URLSearchParams(location.search).get('page') || 'index';
}

function clearUi() {
  document.querySelectorAll('.shell, .toasts, .overlay, main, .wrap, style[data-advising]').forEach((node) => node.remove());
}

function bootPage(name) {
  if (name === 'advising') {
    bootAdvising(TEMPLATES.advising, ADVISING_STYLE);
    return;
  }
  clearUi();
  document.title = TITLES[name] || 'Northwind Works';
  const main = document.createElement('main');
  main.innerHTML = TEMPLATES[name] || '<p>Page not found. <a href="?page=index">Dashboard</a></p>';
  document.body.append(main);
  const run = BOOT[name];
  if (run) run();
}

bootPage(currentPage());
window.addEventListener('popstate', () => bootPage(currentPage()));
`;

fs.writeFileSync(path.join(staging, 'router.js'), router);

const css = fs.readFileSync(path.join(root, 'assets', 'app.css'), 'utf8');
const bundled = await esbuild.build({
  entryPoints: [path.join(staging, 'router.js')],
  bundle: true,
  format: 'iife',
  write: false,
  target: ['es2020'],
  logLevel: 'warning',
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Northwind Works</title>
    <style>
${css}
    </style>
    <script>try { const s = JSON.parse(localStorage.getItem('northwind-demo-v1')); if (s?.settings?.theme === 'dark') document.documentElement.dataset.theme = 'dark'; } catch {}</script>
  </head>
  <body>
    <script>
${bundled.outputFiles[0].text}
    </script>
  </body>
</html>
`;

fs.writeFileSync(outFile, html);
rimraf(staging);
console.log(`Wrote ${path.relative(process.cwd(), outFile)} (${Math.round(html.length / 1024)} KB)`);
