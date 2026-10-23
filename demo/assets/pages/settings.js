import { applyTheme, confirmReset, DEFAULT_SETTINGS, loadState, mountShell, record, toast, update } from '../app.js';

mountShell('settings.html');

const form = document.querySelector('#settings');
let draft = structuredClone(loadState().settings);
const PANELS = ['profile', 'appearance', 'notifications', 'advanced', 'privacy', 'admin'];

function get(path) {
  return path.split('.').reduce((value, key) => value?.[key], draft);
}

function set(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((value, key) => value[key], draft)[last] = value;
}

function dirty() {
  return JSON.stringify(draft) !== JSON.stringify(loadState().settings);
}

function showDirty() {
  document.querySelector('#dirty').textContent = dirty() ? 'You have unsaved changes.' : 'All changes saved.';
}

function fill() {
  form.displayName.value = draft.displayName;
  form.email.value = draft.email;
  form.language.value = draft.language;
  form.timezone.value = draft.timezone;
  form.querySelectorAll('input[name="theme"]').forEach((radio) => (radio.checked = radio.value === draft.theme));
  document.querySelector('#density-value').textContent = draft.density;
  document.querySelectorAll('#density [role="option"]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.value === draft.density)));
  document.querySelectorAll('[data-switch]').forEach((button) => button.setAttribute('aria-checked', String(Boolean(get(button.dataset.switch)))));
  showDirty();
}

function showPanel(name) {
  const panel = PANELS.includes(name) ? name : 'profile';
  document.querySelectorAll('[data-panel-id]').forEach((section) => (section.hidden = section.dataset.panelId !== panel));
  document.querySelectorAll('[data-panel]').forEach((button) => {
    if (button.dataset.panel === panel) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  const advanced = ['advanced', 'privacy', 'admin'].includes(panel);
  document.querySelector('#advanced-subnav').hidden = !advanced;
  document.querySelector('[data-panel="advanced"]').setAttribute('aria-expanded', String(advanced));
  history.replaceState(null, '', `#${panel}`);
}

document.querySelector('.settings-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-panel]');
  if (button) showPanel(button.dataset.panel);
});

form.addEventListener('input', (event) => {
  const target = event.target;
  if (target.name === 'theme') draft.theme = target.value;
  else if (['displayName', 'email', 'language', 'timezone'].includes(target.name)) draft[target.name] = target.value;
  showDirty();
});
form.addEventListener('change', (event) => {
  if (event.target.name === 'theme') {
    draft.theme = event.target.value;
    showDirty();
  }
});

document.querySelectorAll('[data-switch]').forEach((button) =>
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    set(button.dataset.switch, next);
    showDirty();
  }),
);

// Custom listbox: options only exist on screen while it is open.
const combo = document.querySelector('#density');
const comboButton = combo.querySelector('.combo-button');
const listbox = combo.querySelector('[role="listbox"]');
const options = [...listbox.querySelectorAll('[role="option"]')];
let active = 0;
function setOpen(open) {
  listbox.hidden = !open;
  comboButton.setAttribute('aria-expanded', String(open));
  if (open) {
    active = Math.max(0, options.findIndex((option) => option.dataset.value === draft.density));
    highlight();
    listbox.focus();
  }
}
function highlight() {
  options.forEach((option, index) => option.classList.toggle('active', index === active));
  listbox.setAttribute('aria-activedescendant', (options[active].id ||= `density-${options[active].dataset.value}`));
}
function choose(option) {
  draft.density = option.dataset.value;
  setOpen(false);
  fill();
  comboButton.focus();
}
comboButton.addEventListener('click', () => setOpen(listbox.hidden));
options.forEach((option) => option.addEventListener('click', () => choose(option)));
listbox.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
    highlight();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    choose(options[active]);
  } else if (event.key === 'Escape') {
    setOpen(false);
    comboButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!combo.contains(event.target)) setOpen(false);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.email.checkValidity() || !form.displayName.value.trim()) {
    showPanel('profile');
    form.email.setAttribute('aria-invalid', String(!form.email.checkValidity()));
    toast('Fix the profile fields before saving.', 'error');
    return;
  }
  form.email.removeAttribute('aria-invalid');
  const saved = structuredClone(draft);
  const state = update((store) => {
    store.settings = saved;
  });
  record('settings-saved', saved);
  applyTheme(state);
  showDirty();
  toast('Settings saved.');
});

document.querySelector('#discard').addEventListener('click', () => {
  draft = structuredClone(loadState().settings);
  fill();
  toast('Changes discarded.');
});
document.querySelector('#defaults').addEventListener('click', () => {
  draft = structuredClone(DEFAULT_SETTINGS);
  fill();
  toast('Defaults restored. Save to keep them.');
});
document.querySelector('#reset-demo').addEventListener('click', confirmReset);

fill();
showPanel(location.hash.slice(1));
