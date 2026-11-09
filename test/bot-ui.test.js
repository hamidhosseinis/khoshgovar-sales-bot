import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE, mainMenu, welcome, mergePublicCatalog, productList, productFamilyList,
  productFamilies, productDetail,
  approvedSinglePackOffer, variantsList, planList, planCategories, planGroupList, planDetail, planQuote, planProducts,
  finalPriceList, discountedToman, sheetToman, unitDetail, searchResults,
} from '../src/bot-ui.js';

const priced = (id, name, base = '654107') => ({
  product_id: id, product_name: name, units_per_pack: '6',
  variants: ['کوکاکولا', 'فانتا پرتقالی'],
  consumer_price: { amountIRR: '122000', basis: 'UNIT' },
  box_base_price: { amountToman: base, unitRawToman: '109017.83333333333' },
  group_id: 'ORIGINAL_SODA', group_verified: 'TRUE',
});
const products = Array.from({ length: 11 }, (_, i) =>
  priced('P' + String(i + 3).padStart(3, '0'), 'نوشابه اورجینال محصول ' + (i + 3)));
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
  assert.ok(!callbacks(menu).includes('prices:1'));
  assert.ok(!keys(menu).some(k => k.text === '💰 قیمت‌ها'));
  assert.ok(keys(menu).some(x => x.url === 'https://t.me/Hamidhosseinis'));
  assert.ok(!callbacks(menu).includes('cart'));
});
test('catalog shows families first, then every published model with per-family pagination', () => {
  assert.equal(PAGE_SIZE, 5);
  const first = productList(data);
  assert.deepEqual(callbacks(first).filter(x => x.startsWith('family:')), ['family:original:1']);
  assert.equal(productFamilies(data)[0].name, 'نوشابه اورجینال');
  assert.equal(callbacks(productFamilyList(data, 'original')).filter(x => x.startsWith('product:')).length, 5);
  assert.ok(callbacks(productFamilyList(data, 'original')).includes('family:original:2'));
  assert.ok(callbacks(productFamilyList(data, 'original', 3)).includes('product:P013'));
  assert.match(productFamilyList(data, 'original', 4).text, /در دسترس نیست/);
  const detail = productDetail(products[0], data);
  assert.match(detail.text, /۱۲٬۲۰۰ تومان/);
  assert.match(detail.text, /تعداد در بسته: ۶ عدد/);
  assert.match(detail.text, /قیمت پایه هر عدد: ۱۰۹٬۰۱۷٫۸۳۳۳۳۳۳۳۳۳۳ تومان/);
  assert.doesNotMatch(detail.text, /ریال|۶۵٬۴۱۰٫۷|طعم کوکاکولا/);
  assert.ok(!callbacks(detail).includes('final:P003:1'));
  assert.ok(callbacks(detail).includes('product-plans:P003:1'));
  assert.match(detail.text, /طرح تخفیفی دارد؛ قیمت یک بسته قابل اعلام نیست/);
  assert.ok(!callbacks(detail).includes('variants:P003:1'));
  assert.ok(!callbacks(detail).some(x => x.startsWith('add:')));
});
test('product detail shows each approved flavor inline instead of hiding them behind a button', () => {
  const item = {
    product_id: 'P022',
    product_name: 'آبمیوه گازدار فرشی دی 1 لیتری',
    units_per_pack: 6,
    variants: ['انگور', 'بلوبری', 'موهیتو', 'انبه'],
    consumer_price: null,
    box_base_price: null,
  };
  const catalog = {...data, products: [item]};
  const detail = productDetail(item, catalog);
  assert.match(detail.text, /🎨 طعم‌ها: انگور، بلوبری، موهیتو، انبه/);
  assert.ok(!callbacks(detail).includes('variants:P022:1'));
  assert.match(productDetail(item, catalog).text, /انگور، بلوبری، موهیتو، انبه/);
  const privateItem = {...item, variants: []};
  assert.doesNotMatch(productDetail(privateItem, {...catalog, products:[privateItem]}).text,
    /انگور|بلوبری|موهیتو|انبه|شامل طعم/);
});
test('plans show terms and linked products without cart navigation', () => {
  assert.ok(callbacks(planList(data)).includes('plan:D001'));
  assert.ok(callbacks(planDetail(plan, data)).includes('plan-items:D001:1'));
  assert.ok(callbacks(planProducts(plan, data)).includes('quote:P003:D001'));
  assert.ok(!callbacks(planDetail(plan, data)).includes('cart'));
});
test('source base prices are already toman; discount math preserves exact units', () => {
  assert.equal(discountedToman('654107', 13), '۵۶۹٬۰۷۳٫۰۹ تومان');
  assert.equal(discountedToman('883929', 10), '۷۹۵٬۵۳۶٫۱ تومان');
  assert.equal(sheetToman('883929'), '۸۸۳٬۹۲۹ تومان');
  assert.equal(sheetToman('147321.5'), '۱۴۷٬۳۲۱٫۵ تومان');
  assert.equal(sheetToman('109017.83333333333'), '۱۰۹٬۰۱۷٫۸۳۳۳۳۳۳۳۳۳۳ تومان');
  assert.match(unitDetail(products[0]).text, /پایه هر عدد: ۱۰۹٬۰۱۷٫۸۳۳۳۳۳۳۳۳۳۳ تومان/);
  assert.equal(discountedToman('bad', 10), null);
  const quote = planQuote(products[0], plan, data);
  assert.match(quote.text, /۵۸۸٬۶۹۶٫۳ تومان/);
  assert.match(quote.text, /مالیات و گردکردن هنوز قطعی نیست/);
  assert.doesNotMatch(quote.text, /ریال|فانتا پرتقالی/);
  const full = finalPriceList(products[0], data);
  assert.match(full.text, /۵۸۸٬۶۹۶٫۳ تومان/);
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

test('back and home share a compact inline row on detail screens', () => {
  const product = productDetail(products[0], data);
  const nav = product.reply_markup.inline_keyboard.at(-1);
  assert.deepEqual(nav.map(button => button.callback_data), ['family:original:1', 'menu']);
  assert.equal(product.reply_markup.keyboard, undefined);
  const planView = planDetail(plan, data);
  assert.deepEqual(planView.reply_markup.inline_keyboard.at(-1)
    .map(button => button.callback_data), ['plans:1', 'menu']);
  const menu = mainMenu();
  assert.deepEqual(callbacks(menu).slice(0, 4),
    ['products:1', 'plans:1', 'search']);
});

test('canonical plan categories drive compact public plan navigation', () => {
  const catalog = {...data, plans: [
    {...plan, plan_category_fa:'نوشابه اورجینال'},
    {plan_id:'D004', plan_name:'طرح کانادا', discount_percent:'16',
      conditions:'حداقل ۱۱ بسته', plan_category_fa:'نوشابه کانادا'},
    {plan_id:'D005', plan_name:'طرح لیموناد', discount_percent:'23',
      conditions:'۱۰+۵', plan_category_fa:'نوشابه کانادا'},
  ]};
  assert.deepEqual(planCategories(catalog).map(x => x.name),
    ['نوشابه اورجینال','نوشابه کانادا']);
  assert.deepEqual(callbacks(planList(catalog)).filter(x => x.startsWith('plan-group:')),
    ['plan-group:1:1','plan-group:2:1']);
  assert.deepEqual(callbacks(planGroupList(catalog,2)).filter(x => x.startsWith('plan:')),
    ['plan:D004','plan:D005']);
  assert.ok(callbacks(planDetail(catalog.plans[2],catalog)).includes('plan-group:2:1'));
  assert.match(planGroupList(catalog,10).text, /در دسترس نیست/);
  const mixed = {...catalog, plans: [...catalog.plans, {...plan, plan_id:'D006'}]};
  assert.equal(planCategories(mixed).length, 0);
  assert.ok(callbacks(planList(mixed)).includes('plan:D001'));
});
