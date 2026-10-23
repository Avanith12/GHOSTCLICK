import { escapeHtml, mountShell, record } from '../app.js';
import { EMPLOYEES } from '../data.js';

mountShell('directory.html');

const id = new URLSearchParams(location.search).get('id');
const person = EMPLOYEES.find((item) => item.id === id);
const root = document.querySelector('#profile');

// Profiles load a moment after the page, like a real app fetching data.
setTimeout(() => {
  if (!person) {
    document.title = 'Profile not found · Northwind Works';
    root.innerHTML = '<section class="card"><h1>Profile not found</h1><p>No employee has that id. Search the directory instead.</p></section>';
    return;
  }
  document.title = `${person.name} · Northwind Works`;
  record('view-employee', { id: person.id, name: person.name, department: person.department, via: 'profile' });
  const manager = EMPLOYEES.find((item) => item.id === person.manager);
  const team = EMPLOYEES.filter((item) => item.manager === person.id || (item.department === person.department && item.id !== person.id)).slice(0, 8);
  const projects = ['Billing revamp', 'Q4 planning', 'Customer portal', 'Data warehouse', 'Hiring sprint', 'Office move'].slice(0, person.projects);

  root.innerHTML = `
    <section class="card">
      <div class="page-head">
        <div class="person">
          <span class="initials" style="width:56px;height:56px;font-size:18px" aria-hidden="true">${person.firstName[0]}${person.lastName[0]}</span>
          <div>
            <h1>${escapeHtml(person.name)}</h1>
            <p>${escapeHtml(person.title)} · <strong data-field="department">${escapeHtml(person.department)}</strong> · ${escapeHtml(person.location)}</p>
          </div>
        </div>
        <div class="toolbar">
          <a class="button" href="mailto:${escapeHtml(person.email)}">Email</a>
          <a class="button primary" href="analytics.html?range=30&amp;dept=${encodeURIComponent(person.department)}">${escapeHtml(person.department)} performance</a>
        </div>
      </div>
    </section>
    <section class="card tabs">
      <div role="tablist" aria-label="Profile sections">
        <button type="button" role="tab" id="tab-overview" aria-controls="panel-overview" aria-selected="true">Overview</button>
        <button type="button" role="tab" id="tab-projects" aria-controls="panel-projects" aria-selected="false" tabindex="-1">Projects (${projects.length})</button>
        <button type="button" role="tab" id="tab-team" aria-controls="panel-team" aria-selected="false" tabindex="-1">Team</button>
      </div>
      <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
        <dl class="review">
          <dt>Employee ID</dt><dd>${person.id}</dd>
          <dt>Department</dt><dd>${escapeHtml(person.department)}</dd>
          <dt>Email</dt><dd>${escapeHtml(person.email)}</dd>
          <dt>Phone</dt><dd>${escapeHtml(person.phone)}</dd>
          <dt>Manager</dt><dd>${manager ? `<a href="employee.html?id=${manager.id}">${escapeHtml(manager.name)}</a>` : 'Department lead'}</dd>
          <dt>Start date</dt><dd>${person.startDate}</dd>
          <dt>Status</dt><dd>${person.status}</dd>
        </dl>
      </div>
      <div role="tabpanel" id="panel-projects" aria-labelledby="tab-projects" hidden>
        <ul>${projects.map((project) => `<li>${project}</li>`).join('')}</ul>
      </div>
      <div role="tabpanel" id="panel-team" aria-labelledby="tab-team" hidden>
        <ul>${team.map((member) => `<li><a href="employee.html?id=${member.id}">${escapeHtml(member.name)}</a> · ${escapeHtml(member.title)}</li>`).join('')}</ul>
      </div>
    </section>`;

  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}, 350);
