import { escapeHtml, exportRows, money, mountShell, readQuery, record, writeQuery } from '../app.js';
import { lineChart } from '../charts.js';
import { dailyTotals, departmentMetrics, RANGES } from '../metrics.js';

mountShell('analytics.html');

const DEFAULTS = { range: '30', from: '', to: '', dept: '', sort: 'score', dir: 'desc' };
const state = readQuery(DEFAULTS);
const LEDGER_PAGE = 15;
let ledgerPage = 1;
let metrics = departmentMetrics(state.range, state.from, state.to);
const byId = (id) => document.getElementById(id);
const dollars = (cents) => money(cents / 100);

function rangeLabel() {
  return state.range === 'custom' ? `${metrics.window.from} to ${metrics.window.to}` : RANGES[state.range];
}

function sortedTotals() {
  const rows = [...metrics.totals];
  rows.sort((left, right) => {
    const a = left[state.sort];
    const b = right[state.sort];
    const order = typeof a === 'string' ? a.localeCompare(b) : a - b;
    return state.dir === 'desc' ? -order : order;
  });
  return rows;
}

function render() {
  metrics = departmentMetrics(state.range, state.from, state.to);
  writeQuery(state, DEFAULTS);
  byId('range').value = state.range;
  byId('from').value = metrics.window.from;
  byId('to').value = metrics.window.to;
  document.querySelectorAll('[data-custom]').forEach((field) => (field.hidden = state.range !== 'custom'));
  byId('window').textContent = `Showing ${rangeLabel()} (${metrics.window.from} to ${metrics.window.to}).`;

  const revenue = metrics.totals.reduce((sum, row) => sum + row.revenue, 0);
  const deals = metrics.totals.reduce((sum, row) => sum + row.deals, 0);
  const satisfaction = metrics.totals.reduce((sum, row) => sum + row.satisfaction, 0) / metrics.totals.length;
  byId('kpis').innerHTML = [
    ['Revenue', dollars(revenue)],
    ['Deals closed', deals.toLocaleString()],
    ['Average satisfaction', `${satisfaction.toFixed(1)}%`],
    ['Departments', metrics.totals.length],
  ]
    .map(([label, value]) => `<article class="card kpi"><p>${label}</p><strong>${value}</strong></article>`)
    .join('');

  byId('trend').innerHTML = lineChart(dailyTotals(metrics.rows), {
    label: `Daily revenue for ${rangeLabel()}`,
    format: (value) => `$${Math.round(value / 100000)}k`,
  });

  document.querySelectorAll('th button.sort').forEach((button) => {
    const th = button.closest('th');
    if (button.dataset.sort === state.sort) th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending');
    else th.removeAttribute('aria-sort');
  });
  byId('departments').innerHTML = sortedTotals()
    .map(
      (row) => `<tr>
        <th scope="row"><a href="#dept-${row.department}">${row.department}</a></th>
        <td>${dollars(row.revenue)}</td>
        <td>${row.deals}</td>
        <td>${row.satisfaction}%</td>
        <td><strong>${row.score}</strong></td>
      </tr>`,
    )
    .join('');

  renderBreakdown();
  renderLedger();
  byId('report').hidden = true;
}

function renderBreakdown() {
  const open = state.dept;
  byId('breakdown').innerHTML = metrics.totals
    .map((row) => {
      const mine = metrics.rows.filter((item) => item.department === row.department);
      const weeks = [];
      for (let index = 0; index < mine.length; index += 7) {
        const slice = mine.slice(index, index + 7);
        weeks.push({ from: slice[0].date, to: slice.at(-1).date, revenue: slice.reduce((sum, item) => sum + item.revenue, 0), deals: slice.reduce((sum, item) => sum + item.deals, 0) });
      }
      return `<details class="collapse" id="dept-${row.department}" data-department="${row.department}"${row.department === open ? ' open' : ''}>
        <summary><span>${row.department}</span><span class="muted">Score ${row.score} · ${dollars(row.revenue)}</span></summary>
        <div class="collapse-body">
          <dl class="review">
            <dt>Performance score</dt><dd data-metric="score">${row.score}</dd>
            <dt>Revenue</dt><dd data-metric="revenue">${dollars(row.revenue)}</dd>
            <dt>Deals closed</dt><dd data-metric="deals">${row.deals}</dd>
            <dt>Average satisfaction</dt><dd data-metric="satisfaction">${row.satisfaction}%</dd>
          </dl>
          <table style="margin-top: 10px">
            <thead><tr><th scope="col">Week</th><th scope="col">Revenue</th><th scope="col">Deals</th></tr></thead>
            <tbody>${weeks.map((week) => `<tr><td>${week.from} – ${week.to}</td><td>${dollars(week.revenue)}</td><td>${week.deals}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join('');
  if (open) {
    const section = document.getElementById(`dept-${open}`);
    if (section) {
      record('expand-department', { department: open, range: state.range, via: 'link' });
      setTimeout(() => section.scrollIntoView({ block: 'start' }), 50);
    }
  }
}

function renderLedger() {
  const rows = [...metrics.rows].reverse();
  const pages = Math.max(1, Math.ceil(rows.length / LEDGER_PAGE));
  ledgerPage = Math.min(ledgerPage, pages);
  byId('ledger-count').textContent = `${rows.length} rows`;
  byId('ledger').innerHTML = rows
    .slice((ledgerPage - 1) * LEDGER_PAGE, ledgerPage * LEDGER_PAGE)
    .map((row) => `<tr><td>${row.date}</td><td>${row.department}</td><td>${dollars(row.revenue)}</td><td>${row.deals}</td><td>${row.satisfaction}%</td></tr>`)
    .join('');
  byId('ledger-pages').innerHTML = `<span class="muted">Page ${ledgerPage} of ${pages}</span>
    <span class="pages">
      <button type="button" class="button small" data-ledger="${ledgerPage - 1}" ${ledgerPage === 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="button small" data-ledger="${ledgerPage + 1}" ${ledgerPage === pages ? 'disabled' : ''}>Next</button>
    </span>`;
}

function reportRows() {
  return sortedTotals().map((row) => ({ department: row.department, revenue: (row.revenue / 100).toFixed(2), deals: row.deals, satisfaction: row.satisfaction, score: row.score }));
}

function generate() {
  const best = [...metrics.totals].sort((left, right) => right.score - left.score)[0];
  const report = byId('report');
  report.hidden = false;
  report.innerHTML = `<div class="card-head">
      <h2 id="report-title">Performance report · ${escapeHtml(rangeLabel())}</h2>
      <span class="toolbar">
        <button type="button" class="button" data-export="csv">Export report as CSV</button>
        <button type="button" class="button" data-export="json">Export report as JSON</button>
      </span>
    </div>
    <p>Top department: <strong data-field="top-department">${best.department}</strong> with ${dollars(best.revenue)} revenue and ${best.deals} deals.</p>
    <p class="muted">Covers ${metrics.window.from} to ${metrics.window.to} across ${metrics.totals.length} departments.</p>`;
  record('report-generated', { range: state.range, from: metrics.window.from, to: metrics.window.to, top: best.department });
  report.scrollIntoView({ block: 'nearest' });
}

byId('range').addEventListener('change', (event) => {
  state.range = event.target.value;
  if (state.range !== 'custom') {
    state.from = '';
    state.to = '';
    render();
  } else {
    document.querySelectorAll('[data-custom]').forEach((field) => (field.hidden = false));
  }
});
byId('range-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.range = byId('range').value;
  if (state.range === 'custom') {
    state.from = byId('from').value;
    state.to = byId('to').value;
  }
  render();
});
document.querySelectorAll('th button.sort').forEach((button) =>
  button.addEventListener('click', () => {
    state.dir = state.sort === button.dataset.sort && state.dir === 'desc' ? 'asc' : 'desc';
    state.sort = button.dataset.sort;
    render();
  }),
);
byId('generate').addEventListener('click', generate);
byId('report').addEventListener('click', (event) => {
  const button = event.target.closest('[data-export]');
  if (!button) return;
  exportRows({
    name: `performance-report-${state.range === 'custom' ? 'custom' : `${state.range}d`}`,
    format: button.dataset.export,
    rows: reportRows(),
    columns: ['department', 'revenue', 'deals', 'satisfaction', 'score'],
    details: { page: 'analytics', range: state.range, from: metrics.window.from, to: metrics.window.to },
  });
});
byId('breakdown').addEventListener(
  'toggle',
  (event) => {
    const section = event.target;
    if (!section.dataset?.department) return;
    if (!section.open) {
      if (section.dataset.department === state.dept) {
        state.dept = '';
        writeQuery(state, DEFAULTS);
      }
      return;
    }
    // Sections opened by a deep link were already recorded while rendering.
    if (section.dataset.department !== state.dept) {
      state.dept = section.dataset.department;
      writeQuery(state, DEFAULTS);
      record('expand-department', { department: section.dataset.department, range: state.range, via: 'click' });
    }
  },
  true,
);
byId('ledger-pages').addEventListener('click', (event) => {
  const button = event.target.closest('[data-ledger]');
  if (!button || button.disabled) return;
  ledgerPage = Number(button.dataset.ledger);
  renderLedger();
});

render();
