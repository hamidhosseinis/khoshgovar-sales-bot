import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE, mainMenu, welcome, mergePublicCatalog, productList, productDetail,
  priceList, variantsList, planList, planDetail, planQuote, planProducts,
  finalPriceList, discountedToman, searchResults,
} from '../src/bot-ui.js';

const priced = (id, name, base = '654107') => ({
  product_id: id, product_name: name, units_per_pack: '6',
  variants: ['کوکاکولا', 'فانتا پرتقالی'],
  consumer_price: { amountIRR: '122000', basis: 'UNIT' },
  box_base_price: { amountIRR: base, unitRawIRR: '109017.83333333333' },
  group_id: 'ORIGINAL_SODA', group_verified: 'TRUE',
});
const products = Array.from({ length: 11 }, (_, i) =>
  priced('P' + String(i + 3).padStart(3, '0'), 'نوشابه محصول ' + (i + 3)));
const plan = { plan_id: 'D001', plan_name: 'طرح ۱', discount_percent: '10',
  conditions: 'از ۱ تا ۱۰ بسته' };
const data = { products, plans: [plan],
  links: [{product_id:'P003',plan_id:'D001'}],
  targets:[{plan_id:'D001',group_id:'ORIGINAL_SODA'}],requirements:[] };
const keys = view => view.reply_markup.inline_keyboard.flat();
const callbacks = view => keys(view).map(x => x.callback_data).filter(Boolean);

test('only inline navigation remains; cart button and reply keyboard are absent', () => {
  assert.deepEqual(welcome(), mainMenu());
  const menu = mainMenu();
  assert.ok(menu.reply_markup.inline_keyboard.length);
  assert.equal(menu.reply_markup.keyboard, undefined);
  assert.ok(callbacks(menu).includes('products:1'));
  assert.ok(callbacks(menu).includes('plans:1'));
  assert.ok(keys(menu).some(x => x.url === 'https://t.me/Hamidhosseinis'));
  assert.ok(!callbacks(menu).includes('cart'));
});
test('catalog pagination includes every published row and concise product details', () => {
  assert.equal(PAGE_SIZE, 5);
  const first = productList(data);
  assert.equal(callbacks(first).filter(x => x.startsWith('product:')).length, 5);
  assert.ok(callbacks(first).includes('products:2'));
  assert.ok(callbacks(productList(data, 3)).includes('product:P013'));
  assert.match(productList(data, 4).text, /در دسترس نیست/);
  const detail = productDetail(products[0], data);
  assert.match(detail.text, /۱۲٬۲۰۰ تومان/);
  assert.match(detail.text, /۶۵٬۴۱۰٫۷ تومان/);
  assert.doesNotMatch(detail.text, /ریال|۶۵۴٬۱۰۷|طعم کوکاکولا/);
  assert.ok(callbacks(detail).includes('final:P003:1'));
  assert.ok(callbacks(detail).includes('variants:P003:1'));
  assert.ok(!callbacks(detail).some(x => x.startsWith('add:')));
});
test('price list uses toman, not rial', () => {
  const view = priceList(data);
  assert.match(keys(view)[0].text, /تومان/);
  assert.doesNotMatch(view.text, /ریال/);
});
test('plans show terms and linked products without cart navigation', () => {
  assert.ok(callbacks(planList(data)).includes('plan:D001'));
  assert.ok(callbacks(planDetail(plan, data)).includes('plan-items:D001:1'));
  assert.ok(callbacks(planProducts(plan, data)).includes('quote:P003:D001'));
  assert.ok(!callbacks(planDetail(plan, data)).includes('cart'));
});
test('discount math converts precise IRR to toman without floating point or invented rounding', () => {
  assert.equal(discountedToman('654107', 13), '۵۶٬۹۰۷٫۳۰۹ تومان');
  assert.equal(discountedToman('883929', 10), '۷۹٬۵۵۳٫۶۱ تومان');
  assert.equal(discountedToman('bad', 10), null);
  const quote = planQuote(products[0], plan, data);
  assert.match(quote.text, /۵۸٬۸۶۹٫۶۳ تومان/);
  assert.match(quote.text, /مالیات و گردکردن هنوز قطعی نیست/);
  assert.doesNotMatch(quote.text, /ریال|فانتا پرتقالی/);
  const full = finalPriceList(products[0], data);
  assert.match(full.text, /۵۸٬۸۶۹٫۶۳ تومان/);
  assert.ok(!callbacks(full).includes('cart'));
  assert.match(variantsList(products[0]).text, /کوکاکولا/);
});
test('not approved base or unlinked plan never yields a fabricated quote', () => {
  const unknown = { ...products[0], box_base_price: null };
  assert.match(finalPriceList(unknown, data).text, /محاسبه انجام نشد/);
  assert.match(planQuote(products[1], plan, data).text, /منتشر نشده/);
});
test('nostalgic legacy Coca and Fanta rows collapse only with a published shared product', () => {
  const coke = priced('P001', 'نوشابه نوستالژیک - کوکاکولا');
  const fanta = priced('P002', 'نوشابه نوستالژیک - فانتا پرتقالی');
  const unified = priced('P010', 'نوشابه نوستالژیک');
  const all = { ...data, products: [coke,fanta,unified,...products] };
  const merged = mergePublicCatalog(all);
  assert.equal(merged.products.filter(p => p.product_name.includes('نوستالژیک')).length, 1);
  assert.equal(merged.products.find(p => p.product_id === 'P010').variants.length, 2);
  assert.equal(mergePublicCatalog({ ...data, products: [coke, fanta] }).products.length, 2);
});
test('search finds a product outside the first catalog page, regardless of flavors', () => {
  const found = searchResults('فرشی دی', { ...data,
    products: [...products, priced('P023','آبمیوه گازدار فرشی دی شیشه 250 سی سی')] });
  assert.ok(callbacks(found).includes('product:P023'));
});
