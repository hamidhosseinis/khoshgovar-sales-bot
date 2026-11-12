import test from 'node:test';
import assert from 'node:assert/strict';
import { productFamilies, productList, productFamilyList, productDetail } from '../src/bot-ui.js';
import { botReply } from '../src/bot.js';
import { publicData } from '../src/engine.js';

const product = (id, name, category = '') => ({
  product_id: id, product_name: name, category_name: category,
  variants: [], units_per_pack: '6', group_verified: 'FALSE',
});
const keys = view => view.reply_markup.inline_keyboard.flat()
  .filter(button => button.callback_data).map(button => button.callback_data);
const cb = data => ({ callback_query: { data, from: { id: 10 },
  message: { chat: { id: 10, type: 'private' }, message_id: 1 } } });

test('family names follow published product names, without requiring discount-group verification', () => {
  const rows = [
    product('P003','نوشابه اورجینال 2.5 لیتری'),
    product('P004','نوشابه اورجینال 1.5 لیتری'),
    product('P005','نوشابه اورجینال 300 سی سی'),
    product('P046','نوشابه کانادا 2.5 لیتری'),
    product('P050','نوشابه اورجینال شیشه یکبار مصرف','نوشابه کانادا'),
    product('P014','دوغ خانواده 1.5 لیتری'),
    product('P023','آبمیوه گازدار فرشی دی شیشه 250 سی سی'),
    product('P035','دلستر 1 لیتری هی‌دی'),
    product('P036','دلستر شیشه هی دی اکسترا مالت'),
    product('P011','آب دسانی 1.5 لیتری'),
    product('P024','لیموناد 1 لیتری خوشگوار'),
    product('P020','شیر طعم دار اوری دی 1 لیتری'),
    product('P028','سودا 1 لیتری'),
    product('P034','انرژی زا'),
    product('P042','ludvig shishe'),
    product('P044','oreng 1'),
    product('P090','محصول تازه آزمایشی'),
    product('P010','نوشابه نوستالژیک','نوشابه اورجینال'),
  ];
  const data = { products: rows };
  const families = productFamilies(data);
  const byId = id => families.find(f => f.id === id)?.items.map(p => p.product_id);
  assert.deepEqual(byId('original'), ['P003','P004','P005','P050','P010']);
  assert.deepEqual(byId('canada'), ['P046']);
  assert.deepEqual(byId('doogh'), ['P014']);
  assert.deepEqual(byId('sparkling-juice'), ['P023']);
  assert.deepEqual(byId('heyday'), ['P035','P036']);
  assert.deepEqual(byId('other'), ['P090']);
  assert.deepEqual(byId('ludvig'), ['P042']);
  assert.deepEqual(byId('oreng'), ['P044']);
  assert.equal(new Set(rows.map(p => p.product_id)).size,
    families.reduce((count,f) => count + f.items.length,0));
  assert.equal(keys(productFamilyList(data, 'original')).filter(k => k.startsWith('product:')).length,5);
  assert.ok(productFamilyList(data, 'original').reply_markup.inline_keyboard
    .some(row => row.some(button => button.text === '2.5 لیتری')));
  assert.ok(keys(productList(data)).includes('products:2'));
  assert.ok(keys(productFamilyList(data, 'other')).includes('product:P090'));
});
test('family navigation is fail-closed for unknown/empty families and stale pages', async () => {
  const data = { products: [product('P014','دوغ خانواده 1.5 لیتری')] , plans: [], links: [],
    targets: [], requirements: [] };
  const load = async () => data;
  const reply = value => botReply(cb(value), { ADMIN_TELEGRAM_USER_ID: '10' }, async () => {}, load);
  assert.match((await reply('family:original:1')).text, /در دسترس نیست/);
  assert.match((await reply('family:doogh:2')).text, /در دسترس نیست/);
  const listing = await reply('family:doogh:1');
  assert.ok(keys(listing).includes('product:P014'));
  const detail = productDetail(data.products[0], data);
  assert.ok(keys(detail).includes('family:doogh:1'));
});
test('publication filters are applied before family discovery', () => {
  const raw = { Products: [
    { ...product('P001','دوغ خانواده'),approved_for_public:'TRUE',publish_status:'PUBLISHED' },
    { ...product('P002','آبمیوه گازدار خصوصی'),approved_for_public:'FALSE',publish_status:'PUBLISHED' },
    { ...product('P003','دلستر هی دی مخفی'),approved_for_public:'TRUE',publish_status:'DRAFT' },
  ] };
  const data = publicData(raw,'2026-11-08');
  assert.deepEqual(productFamilies(data).map(f => f.name),['دوغ']);
  const btns = keys(productList(data));
  assert.deepEqual(btns.filter(k => k.startsWith('family:')),['family:doogh:1']);
});
