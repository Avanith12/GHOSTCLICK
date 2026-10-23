import { addToCart, available, escapeHtml, money, mountShell, record } from '../app.js';
import { PRODUCTS } from '../data.js';

mountShell('inventory.html');

const ICONS = { Laptops: '💻', Monitors: '🖥️', Phones: '📱', Audio: '🎧', Accessories: '🔌' };
const product = PRODUCTS.find((item) => item.id === new URLSearchParams(location.search).get('id'));
const root = document.querySelector('#product');

function render() {
  const left = available(product);
  root.innerHTML = `
    <section class="card grid two">
      <div class="product">
        <div class="art" style="height:220px;font-size:72px" aria-hidden="true">${ICONS[product.category]}</div>
      </div>
      <div class="grid" style="align-content:start">
        <p class="eyebrow">${product.category}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="muted">${escapeHtml(product.summary)}</p>
        <p style="font-size:28px;font-weight:750;margin:0" data-field="price">${money(product.price)}</p>
        <p style="margin:0"><span class="status-pill${left ? '' : ' danger'}" data-field="stock">${left ? `${left} in stock` : 'Out of stock'}</span></p>
        <form class="toolbar" id="add-form">
          <label class="field">Quantity <input id="qty" type="number" min="1" max="${Math.max(1, left)}" value="1" ${left ? '' : 'disabled'} /></label>
          <button type="submit" class="button primary" ${left ? '' : 'disabled'}>Add to cart</button>
        </form>
      </div>
    </section>
    <section class="card">
      <h2>Specifications</h2>
      <table style="margin-top:10px">
        <tbody>
          <tr><th scope="row">SKU</th><td>${product.sku}</td></tr>
          <tr><th scope="row">Category</th><td>${product.category}</td></tr>
          <tr><th scope="row">Price</th><td>${money(product.price)}</td></tr>
          <tr><th scope="row">Units in stock</th><td>${left}</td></tr>
          <tr><th scope="row">Customer rating</th><td>${product.rating} / 5</td></tr>
        </tbody>
      </table>
    </section>`;
  root.querySelector('#add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const qty = Math.max(1, Number(root.querySelector('#qty').value) || 1);
    if (addToCart(product.id, qty)) render();
  });
}

setTimeout(() => {
  if (!product) {
    root.innerHTML = '<section class="card"><h1>Product not found</h1><p><a href="inventory.html">Browse the inventory</a> instead.</p></section>';
    return;
  }
  document.title = `${product.name} · Northwind Works`;
  // A page opened in its own tab (a target=_blank link or a new tab) starts with a one-entry history.
  record('view-product', { id: product.id, name: product.name, category: product.category, price: product.price, stock: available(product), freshTab: history.length === 1 });
  render();
}, 300);
