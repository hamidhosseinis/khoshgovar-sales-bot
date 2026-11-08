import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE, productList, productDetail, priceList, planList, cartSummary,
  cartItem, cartPrices, clearConfirm, mainMenu, welcome,
} from '../src/bot-ui.js';

const products = Array.from({length: 11}, (_, i) => ({
  product_id: 'P' + String(i + 1).padStart(3, '0'),
  product_name: 'نوشابه محصول ' + (i + 1),
  units_per_pack: '6',
  variants: ['کوکاکولا', 'اسپرایت'],
  consumer_price: i === 0 ? { amountIRR: '122000', basis: 'UNIT' } : null,
  box_base_price: i === 0 ? { amountIRR: '654107', unitRawIRR: '109017.8333333333' } : null,
  group_verified: 'TRUE',
  group_id: 'ORIGINAL_SODA',
}));
const data = { products, plans: [], links: [], targets: [], requirements: [] };
const keys = screen => screen.reply_markup.inline_keyboard.flat();
const callbacks = screen => keys(screen).map(x => x.callback_data).filter(Boolean);

test('welcome is short and uses a five-action, three-row keyboard', () => {
  const msg = welcome();
  assert.ok(msg.text.split(String.fromCharCode(10)).length <= 4);
  assert.equal(msg.reply_markup.keyboard.length, 3);
  assert.equal(msg.reply_markup.keyboard.flat().length, 5);
  assert.ok(msg.reply_markup.keyboard.flat().some(x => x.text === '💬 مشاوره'));
  assert.ok(callbacks(mainMenu()).includes('products:1'));
});
test('catalog shows five names per page, with no verbose prices or codes', () => {
  const first = productList(data, 1);
  assert.equal(PAGE_SIZE, 5);
  assert.ok(first.text.includes('صفحه ۱ از ۳'));
  assert.ok(!first.text.includes('P001'));
  assert.ok(!first.text.includes('122000'));
  assert.equal(callbacks(first).filter(x => x.startsWith('product:')).length, 5);
  assert.ok(callbacks(first).includes('products:2'));
  const last = productList(data, 3);
  assert.equal(callbacks(last).filter(x => x.startsWith('product:')).length, 1);
  assert.ok(callbacks(last).includes('products:2'));
  assert.equal(productList(data, 4).text, 'این صفحه در دسترس نیست.');
});
test('product details show only approved prices; variants and per-unit details need extra click', () => {
  const published = productDetail(products[0], data);
  assert.match(published.text, /۱۲۲٬۰۰۰/);
  assert.match(published.text, /۶۵۴٬۱۰۷/);
  assert.doesNotMatch(published.text, /۱۰۹٬۰۱۷/);
  assert.doesNotMatch(published.text, /کوکاکولا/);
  assert.ok(callbacks(published).includes('variants:P001:1'));
  assert.ok(callbacks(published).includes('unit:P001'));
  const hidden = productDetail(products[1], data);
  assert.doesNotMatch(hidden.text, /۱۲۲٬۰۰۰|۶۵۴٬۱۰۷/);
  assert.match(hidden.text, /قیمت عمومی/);
});
test('price list only contains authorized priced products', () => {
  const list = priceList(data);
  assert.deepEqual(callbacks(list).filter(x => x.startsWith('price:')), ['price:P001']);
  assert.equal(callbacks(list).includes('price:P002'), false);
});
test('cart summary is concise, displays only eligible approved calculations', () => {
  const many = products.slice(0, 7).map(p => ({product_id: p.product_id, qty: 1}));
  const summary = cartSummary(many, data, {});
  assert.ok(summary.text.split(String.fromCharCode(10)).length <= 7);
  assert.ok(summary.text.includes('و ۴ محصول دیگر'));
  assert.ok(callbacks(summary).includes('cart:items:1'));
  assert.ok(callbacks(summary).includes('cart:prices:1'));
  assert.ok(callbacks(summary).includes('cart:confirm-clear'));
  assert.doesNotMatch(summary.text, /۶۵۴٬۱۰۷/);
});
test('cart quantity buttons and clearing require explicit user action', () => {
  const detail = cartItem({ qty: 10 }, products[0]);
  assert.ok(callbacks(detail).includes('add:P001:10'));
  assert.ok(callbacks(detail).includes('remove:P001:5'));
  const clear = clearConfirm();
  assert.ok(callbacks(clear).includes('cart:clear'));
  assert.ok(callbacks(clear).includes('cart'));
  for (const cb of [...callbacks(detail), ...callbacks(clear)]) assert.ok(Buffer.byteLength(cb) <= 64);
});
test('unapproved final price is not fabricated', () => {
  const res = cartPrices([{product_id:'P001',qty:10}], data, {});
  assert.match(res.text, /طرح منطبق/);
  assert.doesNotMatch(res.text, /ریال/);
  assert.match(planList(data).text, /تأییدشده/);
});
