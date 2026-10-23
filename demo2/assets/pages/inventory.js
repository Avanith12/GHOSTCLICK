import { addToCart, available, escapeHtml, money, mountShell, readQuery, volatileId, writeQuery } from '../app.js';
import { CATEGORIES, PRODUCTS } from '../data.js';

mountShell('inventory.html');

const ICONS = { Laptops: '💻', Monitors: '🖥️', Phones: '📱', Audio: '🎧', Accessories: '🔌' };
const BATCH = 8;
const DEFAULTS = { q: '', category: '', max: '', sort: 'featured', instock: '' };
const state = readQuery(DEFAULTS);
let limit = BATCH;
const byId = (id) => document.getElementById(id);

byId('categories').innerHTML = ['', ...CATEGORIES]
  .map((category) => `<button type="button" class="chip" data-category="${category}">${category || 'All categories'}</button>`)
  .join('');

function matching() {
  const needle = state.q.trim().toLowerCase();
  const max = Number(state.max);
  const rows = PRODUCTS.filter(
    (product) =>
      (!state.category || product.category === state.category) &&
      (!state.max || product.price <= max) &&
      (!state.instock || available(product) > 0) &&
      (!needle || `${product.name} ${product.sku}`.toLowerCase().includes(needle)),
  );
  const sorts = {
    featured: (left, right) => right.rating - left.rating,
    'price-asc': (left, right) => left.price - right.price,
    'price-desc': (left, right) => right.price - left.price,
    'stock-asc': (left, right) => available(left) - available(right),
    'stock-desc': (left, right) => available(right) - available(left),
    name: (left, right) => left.name.localeCompare(right.name),
  };
  return rows.sort(sorts[state.sort] ?? sorts.featured);
}

function card(product) {
  const left = available(product);
  return `<article class="card product" id="${volatileId('product')}" aria-labelledby="${product.id}-name">
    <div class="art" aria-hidden="true">${ICONS[product.category]}</div>
    <h3 id="${product.id}-name"><a href="product.html?id=${product.id}">${escapeHtml(product.name)}</a></h3>
    <p class="muted" style="margin:0">${escapeHtml(product.summary)}</p>
    <div class="price">${money(product.price)}</div>
    <div class="meta"><span>${product.category}</span><span data-stock="${product.id}">${left ? `${left} in stock` : 'Out of stock'}</span></div>
    <div class="buttons">
      <button type="button" class="button primary small" data-add="${product.id}" ${left ? '' : 'disabled'} aria-label="Add ${escapeHtml(product.name)} to cart">Add to cart</button>
      <a class="button small" href="product.html?id=${product.id}" aria-label="Details for ${escapeHtml(product.name)}">Details</a>
      <a class="button small ghost" href="product.html?id=${product.id}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(product.name)} in a new tab">New tab</a>
    </div>
  </article>`;
}

function render() {
  writeQuery(state, DEFAULTS);
  byId('search').value = state.q;
  byId('max').value = state.max;
  byId('sort').value = state.sort;
  byId('instock').checked = Boolean(state.instock);
  document.querySelectorAll('[data-category]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category)));
  const rows = matching();
  const shown = rows.slice(0, limit);
  byId('count').textContent = rows.length ? `Showing ${shown.length} of ${rows.length} products` : 'No products match these filters.';
  byId('products').innerHTML = shown.map(card).join('');
  byId('more').hidden = shown.length >= rows.length;
}

function reset() {
  limit = BATCH;
  render();
}

// Lazy loading: more cards arrive when the end of the list scrolls into view.
let loadingMore = false;
function loadMore() {
  if (loadingMore || byId('more').hidden) return;
  loadingMore = true;
  byId('loading').hidden = false;
  setTimeout(() => {
    limit += BATCH;
    loadingMore = false;
    byId('loading').hidden = true;
    render();
  }, 450);
}
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) loadMore();
}).observe(byId('sentinel'));
byId('more').addEventListener('click', loadMore);

let typing = 0;
byId('search').addEventListener('input', (event) => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    state.q = event.target.value;
    reset();
  }, 200);
});
byId('max').addEventListener('change', (event) => {
  state.max = event.target.value;
  reset();
});
byId('sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  reset();
});
byId('instock').addEventListener('change', (event) => {
  state.instock = event.target.checked ? '1' : '';
  reset();
});
byId('filters').addEventListener('submit', (event) => event.preventDefault());
byId('categories').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-category]');
  if (!chip) return;
  state.category = chip.dataset.category;
  reset();
});
byId('products').addEventListener('click', (event) => {
  const add = event.target.closest('[data-add]');
  if (add && addToCart(add.dataset.add)) render();
});
window.addEventListener('demo-state', () => render());

render();
