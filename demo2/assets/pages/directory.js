import { escapeHtml, exportRows, mountShell, openModal, readQuery, record, volatileId, writeQuery } from '../app.js';
import { DEPARTMENTS, EMPLOYEES, LOCATIONS } from '../data.js';

mountShell('directory.html');

const PAGE_SIZE = 10;
const DEFAULTS = { q: '', dept: '', location: '', sort: 'lastName', dir: 'asc', page: '1' };
const state = readQuery(DEFAULTS);
const byId = (id) => document.getElementById(id);

byId('department').innerHTML = `<option value="">All departments</option>${DEPARTMENTS.map((name) => `<option>${name}</option>`).join('')}`;
byId('location').innerHTML = `<option value="">All locations</option>${LOCATIONS.map((name) => `<option>${name}</option>`).join('')}`;

function filtered() {
  const needle = state.q.trim().toLowerCase();
  const rows = EMPLOYEES.filter(
    (person) =>
      (!state.dept || person.department === state.dept) &&
      (!state.location || person.location === state.location) &&
      (!needle || `${person.name} ${person.title} ${person.email} ${person.department}`.toLowerCase().includes(needle)),
  );
  const key = state.sort;
  rows.sort((left, right) => {
    const primary = String(left[key]).localeCompare(String(right[key]));
    return (primary || left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName)) * (state.dir === 'desc' ? -1 : 1);
  });
  return rows;
}

function syncControls() {
  byId('search').value = state.q;
  byId('department').value = state.dept;
  byId('location').value = state.location;
  byId('sort').value = state.sort;
  byId('dir').value = state.dir;
  document.querySelectorAll('th button.sort').forEach((button) => {
    const th = button.closest('th');
    if (button.dataset.sort === state.sort) th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending');
    else th.removeAttribute('aria-sort');
    button.textContent = `${button.textContent.replace(/ [▲▼]$/, '')}${button.dataset.sort === state.sort ? (state.dir === 'desc' ? ' ▼' : ' ▲') : ''}`;
  });
}

function render() {
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(state.page) || 1));
  state.page = String(page);
  writeQuery(state, DEFAULTS);
  syncControls();
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  byId('count').textContent = rows.length
    ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + shown.length} of ${rows.length} employees`
    : 'No employees match these filters.';
  byId('rows').innerHTML = shown
    .map(
      (person) => `<tr id="${volatileId('row')}">
        <td><div class="person"><span class="initials" aria-hidden="true">${person.firstName[0]}${person.lastName[0]}</span>
          <span><a href="employee.html?id=${person.id}">${escapeHtml(person.name)}</a><br /><small class="muted">${escapeHtml(person.email)}</small></span></div></td>
        <td>${escapeHtml(person.title)}</td>
        <td>${escapeHtml(person.department)}</td>
        <td>${escapeHtml(person.location)}</td>
        <td>${person.startDate}</td>
        <td><span class="status-pill${person.status === 'Active' ? '' : ' warn'}">${person.status}</span></td>
        <td class="actions">
          <button type="button" class="button small" data-view="${person.id}" aria-label="View details for ${escapeHtml(person.name)}">View</button>
          <a class="button small ghost" href="employee.html?id=${person.id}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(person.name)}'s profile in a new tab">New tab</a>
        </td>
      </tr>`,
    )
    .join('');
  byId('pagination').innerHTML = `
    <span class="muted">Page ${page} of ${pages}</span>
    <span class="pages">
      <button type="button" class="button small" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button>
      ${Array.from({ length: pages }, (_, index) => `<button type="button" class="button small" data-page="${index + 1}" aria-label="Page ${index + 1}"${index + 1 === page ? ' aria-current="page"' : ''}>${index + 1}</button>`).join('')}
      <button type="button" class="button small" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">Next</button>
    </span>`;
}

function showPerson(id) {
  const person = EMPLOYEES.find((item) => item.id === id);
  if (!person) return;
  const manager = EMPLOYEES.find((item) => item.id === person.manager);
  record('view-employee', { id: person.id, name: person.name, department: person.department, via: 'modal' });
  openModal({
    title: person.name,
    body: `<dl class="review">
        <dt>Title</dt><dd>${escapeHtml(person.title)}</dd>
        <dt>Department</dt><dd>${escapeHtml(person.department)}</dd>
        <dt>Location</dt><dd>${escapeHtml(person.location)}</dd>
        <dt>Email</dt><dd>${escapeHtml(person.email)}</dd>
        <dt>Phone</dt><dd>${escapeHtml(person.phone)}</dd>
        <dt>Manager</dt><dd>${manager ? escapeHtml(manager.name) : '—'}</dd>
        <dt>Started</dt><dd>${person.startDate}</dd>
      </dl>`,
    actions: `<a class="button" href="employee.html?id=${person.id}" target="_blank" rel="noopener">Open in new tab</a><a class="button primary" href="employee.html?id=${person.id}">Open full profile</a>`,
  });
}

let typing = 0;
byId('search').addEventListener('input', (event) => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    Object.assign(state, { q: event.target.value, page: '1' });
    render();
  }, 200);
});
byId('filters').addEventListener('submit', (event) => event.preventDefault());
for (const [id, key] of [['department', 'dept'], ['location', 'location'], ['sort', 'sort'], ['dir', 'dir']]) {
  byId(id).addEventListener('change', (event) => {
    Object.assign(state, { [key]: event.target.value, page: '1' });
    render();
  });
}
byId('clear').addEventListener('click', () => {
  Object.assign(state, DEFAULTS);
  render();
});
document.querySelectorAll('th button.sort').forEach((button) =>
  button.addEventListener('click', () => {
    state.dir = state.sort === button.dataset.sort && state.dir === 'asc' ? 'desc' : 'asc';
    state.sort = button.dataset.sort;
    state.page = '1';
    render();
  }),
);
byId('rows').addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]');
  if (view) showPerson(view.dataset.view);
});
byId('pagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button || button.disabled) return;
  state.page = button.dataset.page;
  render();
  byId('count').scrollIntoView({ block: 'nearest' });
});

for (const format of ['csv', 'json']) {
  byId(`export-${format}`).addEventListener('click', () =>
    exportRows({
      name: `employees${state.dept ? `-${state.dept.toLowerCase()}` : ''}`,
      format,
      rows: filtered().map(({ id, firstName, lastName, title, department, location, email, phone, startDate, status }) => ({ id, firstName, lastName, title, department, location, email, phone, startDate, status })),
      columns: ['id', 'firstName', 'lastName', 'title', 'department', 'location', 'email', 'phone', 'startDate', 'status'],
      details: { page: 'directory', department: state.dept, location: state.location, query: state.q, sort: state.sort, dir: state.dir },
    }),
  );
}

render();
