// Tiny dependency-free SVG charts. Each chart has a text title and per-mark <title>s for screen readers.
import { escapeHtml } from './app.js';

export function barChart(items, { label, format = String, height = 220 } = {}) {
  const width = 640;
  const pad = { top: 16, right: 12, bottom: 34, left: 56 };
  const max = Math.max(...items.map((item) => item.value), 1);
  const slot = (width - pad.left - pad.right) / items.length;
  const scale = (value) => ((height - pad.top - pad.bottom) * value) / max;
  const ticks = [0, 0.5, 1].map((step) => {
    const y = height - pad.bottom - (height - pad.top - pad.bottom) * step;
    return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" /><text x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(format(max * step))}</text>`;
  });
  const bars = items.map((item, index) => {
    const barHeight = scale(item.value);
    const x = pad.left + index * slot + slot * 0.18;
    const y = height - pad.bottom - barHeight;
    return `<g><rect class="bar" x="${x}" y="${y}" width="${slot * 0.64}" height="${barHeight}" rx="4"><title>${escapeHtml(item.label)}: ${escapeHtml(format(item.value))}</title></rect>
      <text x="${x + slot * 0.32}" y="${height - pad.bottom + 16}" text-anchor="middle">${escapeHtml(item.label)}</text></g>`;
  });
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label ?? 'Bar chart')}">${ticks.join('')}${bars.join('')}</svg>`;
}

export function lineChart(points, { label, format = String, height = 220 } = {}) {
  const width = 640;
  const pad = { top: 16, right: 12, bottom: 30, left: 56 };
  const max = Math.max(...points.map((point) => point.value), 1);
  const x = (index) => pad.left + ((width - pad.left - pad.right) * index) / Math.max(1, points.length - 1);
  const y = (value) => height - pad.bottom - ((height - pad.top - pad.bottom) * value) / max;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`;
  const every = Math.max(1, Math.ceil(points.length / 6));
  const labels = points
    .map((point, index) => (index % every === 0 ? `<text x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(point.label)}</text>` : ''))
    .join('');
  const ticks = [0, 0.5, 1]
    .map((step) => {
      const value = max * step;
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" /><text x="${pad.left - 8}" y="${y(value) + 4}" text-anchor="end">${escapeHtml(format(value))}</text>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label ?? 'Line chart')}">${ticks}<path class="area" d="${area}" /><path class="line" d="${path}" />${labels}</svg>`;
}
