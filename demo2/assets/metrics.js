// Department performance for a date range, shared by the Dashboard, Analytics, and the challenge verifier.
import { DAILY, DEPARTMENTS, daysBefore, TODAY } from './data.js';

export const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' };

export function rangeDates(range, from = '', to = '') {
  if (range === 'custom') return { from: from || daysBefore(89), to: to || TODAY };
  return { from: daysBefore(Number(range) - 1), to: TODAY };
}

export function departmentMetrics(range = '30', from = '', to = '') {
  const window = rangeDates(range, from, to);
  const rows = DAILY.filter((row) => row.date >= window.from && row.date <= window.to);
  const totals = DEPARTMENTS.map((department) => {
    const mine = rows.filter((row) => row.department === department);
    const revenue = mine.reduce((sum, row) => sum + row.revenue, 0);
    const deals = mine.reduce((sum, row) => sum + row.deals, 0);
    const satisfaction = mine.length ? mine.reduce((sum, row) => sum + row.satisfaction, 0) / mine.length : 0;
    return { department, revenue, deals, satisfaction: Math.round(satisfaction * 10) / 10 };
  });
  const best = Math.max(...totals.map((row) => row.revenue), 1);
  for (const row of totals) row.score = Math.round((row.revenue / best) * 100);
  return { window, rows, totals };
}

export function topDepartment(range = '30') {
  return [...departmentMetrics(range).totals].sort((left, right) => right.score - left.score)[0].department;
}

export function dailyTotals(rows) {
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.revenue);
  return [...byDate.entries()].map(([date, value]) => ({ label: date.slice(5), value }));
}
