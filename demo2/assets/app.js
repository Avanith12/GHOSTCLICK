// Shared shell for every Northwind Works page: persisted demo state, layout, theme, toasts, modals,
// the cart drawer, and file exports. Pages import what they need from here.
import { PRODUCTS } from './data.js';

export const STORE_KEY = 'northwind-demo-v1';

export const DEFAULT_SETTINGS = {
  displayName: 'Demo Admin',
  email: 'admin@northwind.example',
  theme: 'light',
  density: 'Comfortable',
  language: 'English (US)',
  timezone: 'America/Chicago',
  notifications: { email: false, push: true, weekly: false },
  privacy: { analytics: true, shareDirectory: false },
};

function seedState() {
  return {
    version: 1,
    cart: [],
    orders: [],
    applications: [],
    applyDraft: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    events: [],
  };
}

export function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (!parsed || parsed.version !== 1) return seedState();
    const seed = seedState();
    return { ...seed, ...parsed, settings: { ...seed.settings, ...parsed.settings, notifications: { ...seed.settings.notifications, ...parsed.settings?.notifications }, privacy: { ...seed.settings.privacy, ...parsed.settings?.privacy } } };
  } catch {
    return seedState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('demo-state'));
}

/** Change the stored state with a function, then save it. */
export function update(change) {
  const state = loadState();
  change(state);
  saveState(state);
  return state;
}

/** Record something the person did. The challenge verifier reads these events. */
export function record(type, data = {}) {
  update((state) => {
    state.events.push({ type, data, at: Date.now(), page: location.pathname.split('/').pop() || 'index.html' });
    if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
  });
}

export function resetDemo() {
  localStorage.removeItem(STORE_KEY);
  sessionStorage.removeItem('ghostclick-demo-break');
  saveState(seedState());
}

export const money = (value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** A fresh id on every render, like many real apps generate; automation must not depend on it. */
export function volatileId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Cart ----------

export function cartCount(state = loadState()) {
  return state.cart.reduce((total, item) => total + item.qty, 0);
}

/** Units still available: stock minus what is already in the cart. */
export function available(product, state = loadState()) {
  const held = state.cart.find((item) => item.id === product.id)?.qty ?? 0;
  return Math.max(0, product.stock - held);
}

export function addToCart(productId, qty = 1) {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (!product) return false;
  if (available(product) < qty) {
    toast(`${product.name} is out of stock.`, 'error');
    return false;
  }
  update((state) => {
    const line = state.cart.find((item) => item.id === productId);
    if (line) line.qty += qty;
    else state.cart.push({ id: productId, qty });
  });
  record('cart-add', { id: productId, name: product.name, qty });
  toast(`Added ${product.name} to the cart.`);
  renderCartBadge();
  return true;
}

// ---------- Toasts and modals ----------

export function toast(message, tone = 'ok') {
  let stack = document.querySelector('.toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toasts';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${tone}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.classList.add('leaving'), 3200);
  setTimeout(() => item.remove(), 3600);
}

let lastFocus = null;

/** Open an accessible modal dialog. `body` is HTML; returns the dialog element. */
export function openModal({ title, body, actions = '', wide = false, onClose }) {
  closeModal();
  lastFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <section class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <button type="button" class="icon-button" data-close aria-label="Close dialog">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      ${actions ? `<footer class="modal-actions">${actions}</footer>` : ''}
    </section>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) {
      closeModal();
      onClose?.();
    }
  });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('[data-close]').focus();
  return overlay.querySelector('.modal');
}

export function closeModal() {
  document.querySelector('.overlay')?.remove();
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
  lastFocus = null;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.querySelector('.overlay')) closeModal();
});

// ---------- Exports ----------

export function toCsv(rows, columns) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n');
}

/** Download rows as CSV or JSON and record what was exported. */
export function exportRows({ name, format, rows, columns, details }) {
  const text = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows, columns);
  const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${name}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  record('export', { name, format, rows: rows.length, ...details });
  toast(`Exported ${rows.length} rows as ${format.toUpperCase()}.`);
}

// ---------- Layout ----------

const NAV = [
  ['index.html', 'Dashboard', '▦'],
  ['directory.html', 'Employee Directory', '☺'],
  ['apply.html', 'Job Applications', '✎'],
  ['inventory.html', 'Product Inventory', '▤'],
  ['analytics.html', 'Analytics & Reports', '↗'],
  ['settings.html', 'Settings', '⚙'],
  ['challenges.html', 'Automation Challenges', '★'],
  ['advising.html', 'Advising form (classic)', '✉'],
];

export function applyTheme(state = loadState()) {
  document.documentElement.dataset.theme = state.settings.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.density = state.settings.density.toLowerCase();
}

export function renderCartBadge() {
  const badge = document.querySelector('[data-cart-count]');
  if (badge) {
    const count = cartCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
}

/** Build the sidebar and top bar around the page's <main>. `active` is the nav file name. */
export function mountShell(active) {
  applyTheme();
  const main = document.querySelector('main');
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <a class="skip" href="#main">Skip to content</a>
    <aside class="sidebar" aria-label="Sections">
      <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">N</span><span>Northwind <b>Works</b></span></a>
      <nav aria-label="Main">
        <ul>
          ${NAV.map(
            ([href, label, icon]) =>
              `<li><a href="${href}"${href === active ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</a></li>`,
          ).join('')}
        </ul>
      </nav>
      <p class="sidebar-note">Demo data only. Nothing you enter leaves this browser.</p>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <button type="button" class="icon-button menu-toggle" aria-label="Open navigation" aria-expanded="false">☰</button>
        <form class="global-search" role="search" action="directory.html">
          <label class="visually-hidden" for="global-search">Search people</label>
          <input id="global-search" name="q" type="search" placeholder="Search people…" autocomplete="off" />
        </form>
        <div class="topbar-actions">
          <button type="button" class="icon-button theme-toggle" aria-label="Switch to dark mode">◐</button>
          <button type="button" class="cart-button" aria-label="Open cart">Cart <span class="badge" data-cart-count hidden>0</span></button>
          <div class="menu">
            <button type="button" class="avatar-button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">DA</button>
            <div class="menu-list" role="menu" hidden>
              <a role="menuitem" href="settings.html">Profile settings</a>
              <a role="menuitem" href="challenges.html">Automation Challenges</a>
              <button type="button" role="menuitem" data-reset>Reset demo data</button>
            </div>
          </div>
        </div>
      </header>
    </div>`;
  main.id = 'main';
  main.tabIndex = -1;
  main.before(shell);
  shell.querySelector('.workspace').append(main);

  const sidebar = shell.querySelector('.sidebar');
  const menuToggle = shell.querySelector('.menu-toggle');
  menuToggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  const themeButton = shell.querySelector('.theme-toggle');
  const syncThemeButton = () => {
    const dark = loadState().settings.theme === 'dark';
    themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  themeButton.addEventListener('click', () => {
    const state = update((draft) => {
      draft.settings.theme = draft.settings.theme === 'dark' ? 'light' : 'dark';
    });
    record('theme-toggle', { theme: state.settings.theme });
    applyTheme(state);
    syncThemeButton();
  });
  syncThemeButton();

  const avatar = shell.querySelector('.avatar-button');
  const list = shell.querySelector('.menu-list');
  const setMenu = (open) => {
    list.hidden = !open;
    avatar.setAttribute('aria-expanded', String(open));
  };
  avatar.addEventListener('click', () => setMenu(list.hidden));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu')) setMenu(false);
  });
  shell.querySelector('[data-reset]').addEventListener('click', () => {
    setMenu(false);
    confirmReset();
  });

  shell.querySelector('.cart-button').addEventListener('click', openCart);
  renderCartBadge();
  window.addEventListener('storage', (event) => {
    if (event.key === STORE_KEY) {
      renderCartBadge();
      applyTheme();
    }
  });
}

export function confirmReset() {
  const dialog = openModal({
    title: 'Reset demo data?',
    body: '<p>This empties the cart, removes applications and orders, restores default settings, and clears challenge progress.</p>',
    actions: '<button type="button" class="button ghost" data-close>Keep my data</button><button type="button" class="button danger" data-confirm-reset>Reset everything</button>',
  });
  dialog.querySelector('[data-confirm-reset]').addEventListener('click', () => {
    resetDemo();
    closeModal();
    toast('Demo data reset to the starting state.');
    setTimeout(() => location.reload(), 500);
  });
}

// ---------- Cart drawer and mock checkout ----------

export function openCart() {
  const state = loadState();
  const lines = state.cart.map((item) => ({ ...item, product: PRODUCTS.find((product) => product.id === item.id) })).filter((line) => line.product);
  const total = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
  const body = lines.length
    ? `<ul class="cart-lines">${lines
        .map(
          (line) => `<li>
            <span><strong>${escapeHtml(line.product.name)}</strong><small>${line.qty} × ${money(line.product.price)}</small></span>
            <button type="button" class="button ghost small" data-remove="${line.id}" aria-label="Remove ${escapeHtml(line.product.name)} from the cart">Remove</button>
          </li>`,
        )
        .join('')}</ul><p class="cart-total">Total <strong>${money(total)}</strong></p>`
    : '<p class="empty">The cart is empty. Add products from Product Inventory.</p>';
  const dialog = openModal({
    title: `Cart (${cartCount(state)})`,
    body,
    actions: lines.length ? '<button type="button" class="button primary" data-checkout>Checkout</button>' : '',
  });
  dialog.querySelectorAll('[data-remove]').forEach((button) =>
    button.addEventListener('click', () => {
      update((draft) => {
        draft.cart = draft.cart.filter((item) => item.id !== button.dataset.remove);
      });
      record('cart-remove', { id: button.dataset.remove });
      renderCartBadge();
      openCart();
    }),
  );
  dialog.querySelector('[data-checkout]')?.addEventListener('click', () => checkout(lines, total));
}

function checkout(lines, total) {
  const dialog = openModal({
    title: 'Review order',
    body: `<p>This is a demo. Placing the order only records it in this browser; nothing is charged or sent.</p>
      <ul class="cart-lines">${lines.map((line) => `<li><span>${escapeHtml(line.product.name)}</span><span>${line.qty} × ${money(line.product.price)}</span></li>`).join('')}</ul>
      <p class="cart-total">Total <strong>${money(total)}</strong></p>`,
    actions: '<button type="button" class="button ghost" data-close>Back</button><button type="button" class="button primary" data-place>Place order</button>',
  });
  dialog.querySelector('[data-place]').addEventListener('click', () => {
    const reference = `NW-${String(Date.now()).slice(-6)}`;
    update((state) => {
      state.orders.push({ reference, items: state.cart, total, at: Date.now() });
      state.cart = [];
    });
    record('order-placed', { reference, items: lines.map((line) => ({ id: line.id, qty: line.qty })), total });
    renderCartBadge();
    openModal({ title: 'Order placed', body: `<p>Order <strong>${reference}</strong> was recorded. (Demo only.)</p>` });
  });
}

/** Read and write a page's state in its URL, so deep links and refreshes keep filters. */
export function readQuery(defaults) {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, params.get(key) ?? value]));
}

export function writeQuery(values, defaults) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== defaults[key]) params.set(key, value);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
