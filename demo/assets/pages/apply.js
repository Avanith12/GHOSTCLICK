import { escapeHtml, loadState, mountShell, record, toast, update } from '../app.js';
import { LOCATIONS, OPEN_ROLES, SKILLS } from '../data.js';

mountShell('apply.html');

const form = document.querySelector('#application');
const steps = [...form.querySelectorAll(':scope > fieldset[data-step]')];
const summary = document.querySelector('#error-summary');
const next = document.querySelector('#next');
const back = document.querySelector('#back');

form.location.innerHTML = `<option value="">Choose a location</option>${LOCATIONS.map((name) => `<option>${name}</option>`).join('')}`;
form.position.innerHTML = `<option value="">Choose a position</option>${OPEN_ROLES.map((role) => `<option value="${role.title}">${role.title} · ${role.department}</option>`).join('')}`;
document.querySelector('#skills').innerHTML = SKILLS.map((skill) => `<label><input type="checkbox" name="skills" value="${skill}" /> ${skill}</label>`).join('');

const SECTIONS = [
  ['Personal details', 1, [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location']]],
  ['Role', 2, [['position', 'Position'], ['startDate', 'Start date'], ['employmentType', 'Employment type'], ['relocate', 'Willing to relocate']]],
  ['Experience', 3, [['years', 'Years of experience'], ['skills', 'Skills'], ['portfolio', 'Portfolio'], ['note', 'Why Northwind?']]],
];

function values() {
  const data = new FormData(form);
  return {
    firstName: String(data.get('firstName') ?? '').trim(),
    lastName: String(data.get('lastName') ?? '').trim(),
    email: String(data.get('email') ?? '').trim(),
    phone: String(data.get('phone') ?? '').trim(),
    location: String(data.get('location') ?? ''),
    position: String(data.get('position') ?? ''),
    startDate: String(data.get('startDate') ?? ''),
    employmentType: String(data.get('employmentType') ?? ''),
    relocate: data.get('relocate') === 'on',
    years: String(data.get('years') ?? ''),
    skills: data.getAll('skills').map(String),
    portfolio: String(data.get('portfolio') ?? '').trim(),
    note: String(data.get('note') ?? '').trim(),
  };
}

function fill(draft) {
  for (const [key, value] of Object.entries(draft ?? {})) {
    if (key === 'skills') form.querySelectorAll('input[name="skills"]').forEach((box) => (box.checked = value.includes(box.value)));
    else if (key === 'relocate') form.relocate.checked = Boolean(value);
    else if (key === 'employmentType') form.querySelectorAll('input[name="employmentType"]').forEach((radio) => (radio.checked = radio.value === value));
    else if (form.elements[key] && key !== 'step') form.elements[key].value = value;
  }
}

function saveDraft(step) {
  update((state) => {
    state.applyDraft = { ...values(), step };
  });
}

let current = 1;

function show(step) {
  current = step;
  steps.forEach((fieldset) => (fieldset.hidden = Number(fieldset.dataset.step) !== step));
  document.querySelectorAll('.stepper li').forEach((item) => {
    const number = Number(item.dataset.step);
    item.classList.toggle('done', number < step);
    if (number === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  document.querySelector('#progress-bar').style.width = `${(step / 4) * 100}%`;
  back.disabled = step === 1;
  next.textContent = step === 4 ? 'Submit application' : 'Next';
  summary.textContent = '';
  if (step === 4) renderReview();
  history.replaceState(null, '', `#step-${step}`);
}

function renderReview() {
  const data = values();
  const shown = (key) => {
    const value = data[key];
    if (key === 'relocate') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ') || '—';
    return value || '—';
  };
  document.querySelector('#review').innerHTML = SECTIONS.map(
    ([title, step, fields]) => `<details class="collapse" open>
      <summary>${title} <button type="button" class="button small ghost" data-edit="${step}" aria-label="Edit ${title.toLowerCase()}">Edit</button></summary>
      <div class="collapse-body"><dl class="review">${fields.map(([key, label]) => `<dt>${label}</dt><dd data-review="${key}">${escapeHtml(shown(key))}</dd>`).join('')}</dl></div>
    </details>`,
  ).join('');
}

function clearErrors(fieldset) {
  fieldset.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  fieldset.querySelectorAll('.field-error[data-for]').forEach((message) => message.remove());
}

function flag(input, message) {
  input.setAttribute('aria-invalid', 'true');
  const note = document.createElement('span');
  note.className = 'field-error';
  note.dataset.for = input.name;
  note.id = `error-${input.name}`;
  note.textContent = message;
  input.setAttribute('aria-describedby', note.id);
  (input.closest('label') ?? input.closest('fieldset')).append(note);
}

function validate(step) {
  const fieldset = steps[step - 1];
  clearErrors(fieldset);
  const problems = [];
  for (const input of fieldset.querySelectorAll('input, select, textarea')) {
    if (input.type === 'radio' || input.type === 'checkbox') continue;
    if (!input.checkValidity()) {
      const label = input.closest('label')?.childNodes[0]?.textContent.trim() ?? input.name;
      const message = input.validity.valueMissing
        ? `${label} is required.`
        : input.validity.patternMismatch
          ? `${label} must look like 555-010-1234.`
          : input.validity.typeMismatch
            ? `${label} is not valid.`
            : input.validationMessage;
      flag(input, message);
      problems.push(message);
    }
  }
  if (step === 2 && !form.querySelector('input[name="employmentType"]:checked')) {
    const first = form.querySelector('input[name="employmentType"]');
    flag(first, 'Choose an employment type.');
    problems.push('Choose an employment type.');
  }
  if (step === 3 && !form.querySelector('input[name="skills"]:checked')) {
    flag(form.querySelector('input[name="skills"]'), 'Choose at least one skill.');
    problems.push('Choose at least one skill.');
  }
  if (step === 4 && !form.consent.checked) {
    flag(form.consent, 'Confirm that the details are accurate.');
    problems.push('Confirm that the details are accurate.');
  }
  summary.textContent = problems.length ? `Please fix ${problems.length} problem${problems.length > 1 ? 's' : ''}: ${problems.join(' ')}` : '';
  fieldset.querySelector('[aria-invalid="true"]')?.focus();
  return problems.length === 0;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validate(current)) return;
  if (current < 4) {
    saveDraft(current + 1);
    show(current + 1);
    return;
  }
  const application = { ...values(), reference: `APP-${String(Date.now()).slice(-5)}`, at: Date.now() };
  update((state) => {
    state.applications.push(application);
    state.applyDraft = null;
  });
  record('application-submitted', application);
  form.closest('section').hidden = true;
  const done = document.querySelector('#done');
  done.hidden = false;
  done.innerHTML = `<p class="eyebrow">Submitted</p><h2>Application received</h2>
    <p>Thanks, ${escapeHtml(application.firstName)}. Your application for <strong>${escapeHtml(application.position)}</strong> has reference <strong>${application.reference}</strong>. (Demo only: nothing was sent.)</p>
    <p><a class="button" href="apply.html">Start another application</a> <a class="button ghost" href="challenges.html">Check the challenges</a></p>`;
  toast('Application submitted (demo).');
});

back.addEventListener('click', () => {
  if (current > 1) {
    saveDraft(current - 1);
    show(current - 1);
  }
});

document.querySelector('#discard').addEventListener('click', () => {
  update((state) => {
    state.applyDraft = null;
  });
  form.reset();
  show(1);
  toast('Draft discarded.');
});

form.addEventListener('change', () => saveDraft(current));
form.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  if (edit) {
    event.preventDefault();
    show(Number(edit.dataset.edit));
  }
});

const draft = loadState().applyDraft;
fill(draft);
const fromHash = Number(location.hash.match(/step-(\d)/)?.[1] ?? 0);
show(Math.min(draft?.step ?? 1, fromHash || draft?.step || 1));
