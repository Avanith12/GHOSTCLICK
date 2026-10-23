import { escapeHtml, loadState, money, mountShell } from '../app.js';
import { barChart } from '../charts.js';
import { EMPLOYEES, OPEN_ROLES, PRODUCTS } from '../data.js';
import { departmentMetrics } from '../metrics.js';

mountShell('index.html');

const now = departmentMetrics('30');
const before = departmentMetrics('custom', '2026-07-04', '2026-08-01');
const revenue = now.totals.reduce((sum, row) => sum + row.revenue, 0);
const previous = before.totals.reduce((sum, row) => sum + row.revenue, 0);
const change = Math.round(((revenue - previous) / previous) * 100);

const kpis = [
  ['Active employees', EMPLOYEES.filter((person) => person.status === 'Active').length, `${EMPLOYEES.length} on the payroll`],
  ['Open roles', OPEN_ROLES.length, 'Hiring across 5 teams'],
  ['Inventory value', money(PRODUCTS.reduce((sum, product) => sum + product.price * product.stock, 0)), `${PRODUCTS.length} products`],
  ['Revenue · 30 days', money(revenue / 100), `<span class="trend ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs. prior 30 days</span>`],
];
document.querySelector('#kpis').innerHTML = kpis
  .map(([label, value, note]) => `<article class="card kpi"><p>${label}</p><strong>${value}</strong><small class="muted">${note}</small></article>`)
  .join('');

document.querySelector('#dept-chart').innerHTML = barChart(
  now.totals.map((row) => ({ label: row.department.slice(0, 9), value: row.revenue / 100 })),
  { label: 'Revenue by department for the last 30 days', format: (value) => `$${Math.round(value / 1000)}k` },
);

const SEEDED = [
  ['Grace Hopper shipped the billing service migration', 'Engineering · 2 hours ago'],
  ['Q4 inventory count finished for Monitors', 'Operations · yesterday'],
  ['Jordan Leigh closed the Lakeside account', 'Sales · 2 days ago'],
  ['New role posted: Data Analyst', 'People · 3 days ago'],
  ['Support satisfaction hit 96% for the week', 'Support · 4 days ago'],
  ['Brand refresh moved to design review', 'Marketing · 5 days ago'],
];
const describeEvent = {
  'cart-add': (data) => `Added ${data.name} to the cart`,
  'order-placed': (data) => `Placed demo order ${data.reference}`,
  'application-submitted': (data) => `Application sent for ${data.position}`,
  'settings-saved': () => 'Saved settings',
  export: (data) => `Exported ${data.rows} rows (${data.name})`,
};
let shown = 4;

function renderActivity() {
  const mine = loadState()
    .events.filter((event) => describeEvent[event.type])
    .slice(-4)
    .reverse()
    .map((event) => [describeEvent[event.type](event.data), `You · ${new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`]);
  document.querySelector('#activity').innerHTML = [...mine, ...SEEDED]
    .slice(0, shown)
    .map(([text, meta]) => `<li><span class="dot" aria-hidden="true"></span><span>${escapeHtml(text)}<small>${escapeHtml(meta)}</small></span></li>`)
    .join('');
}

document.querySelector('#refresh-activity').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  document.querySelector('#activity').innerHTML = '<li class="loading"><span class="spinner" aria-hidden="true"></span> Loading…</li>';
  setTimeout(() => {
    shown = Math.min(shown + 3, 10);
    renderActivity();
    button.disabled = false;
  }, 600);
});

renderActivity();
