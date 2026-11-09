import test from 'node:test';
import assert from 'node:assert/strict';
import { botReply } from '../src/bot.js';

const product = (id, name = 'نوشابه اورجینال محصول ' + id) => ({
  product_id: id, product_name: name, units_per_pack: '6',
  variants: ['کوکاکولا','فانتا پرتقالی'],
  consumer_price: {amountIRR:'100000',basis:'UNIT'},
  box_base_price: {amountToman:'654107',unitRawToman:'109017.83333333333'},
  group_id:'ORIGINAL_SODA',group_verified:'TRUE',
});
const p = Array.from({length:6}, (_,n) => product('P'+String(n+3).padStart(3,'0')));
p.push(product('P001', 'نوشابه نوستالژیک - کوکاکولا'));
p.push(product('P002', 'نوشابه نوستالژیک - فانتا پرتقالی'));
p.push({...product('P010', 'نوشابه نوستالژیک'), category_name:'نوشابه اورجینال'});
p.push(product('P023','آبمیوه گازدار فرشی دی شیشه 250 سی سی'));
const data = {
  products:p,
  plans:[{plan_id:'D001',plan_name:'طرح ۱',discount_percent:'10',conditions:'۱ تا ۱۰ بسته'}],
  links:[{product_id:'P003',plan_id:'D001'}],
  targets:[{plan_id:'D001',group_id:'ORIGINAL_SODA'}],requirements:[],
};
const message = text => ({message:{chat:{id:123,type:'private'},from:{id:123},text}});
const callback = text => ({callback_query:{from:{id:123},data:text,
  message:{chat:{id:123,type:'private'},message_id:100}}});
const calls = reply => reply.reply_markup.inline_keyboard.flat()
  .map(x => x.callback_data).filter(Boolean);
const replyTo = (u,env={}) => botReply(u,env,async()=>{},async()=>data);

test('catalog entry opens families and every model remains accessible with search',async()=>{
  const list=await replyTo(message('/products'));
  assert.ok(calls(list).includes('family:original:1'));
  assert.ok(calls(list).includes('family:sparkling-juice:1'));
  const models=await replyTo(callback('family:original:1'));
  assert.ok(calls(models).includes('product:P003'));
  assert.ok(calls(models).includes('family:original:2'));
  const second=await replyTo(callback('family:original:2'));
  assert.ok(calls(second).includes('product:P008'));
  const result=await replyTo(message('فرشی دی'));
  assert.ok(calls(result).includes('product:P023'));
  const detail=await replyTo(callback('product:P023'));
  assert.match(detail.text,/فرشی دی/);
  assert.ok(calls(detail).includes('family:sparkling-juice:1'));
});
test('consolidated nostalgic shows approved flavors inline; legacy flavor route works',async()=>{
  const list=await replyTo(callback('family:original:2'));
  assert.ok(calls(list).includes('product:P010'));
  assert.ok(!calls(list).includes('product:P001'));
  assert.ok(!calls(list).includes('product:P002'));
  const detail=await replyTo(callback('product:P001'));
  assert.match(detail.text,/🥤 نوشابه نوستالژیک\n/);
  assert.match(detail.text, /🎨 طعم‌ها: کوکاکولا، فانتا پرتقالی/);
  assert.ok(!calls(detail).includes('variants:P010:1'));
  const variants=await replyTo(callback('variants:P010:1'));
  assert.match(variants.text,/کوکاکولا/);
  assert.match(variants.text,/فانتا پرتقالی/);
});
test('final-price button and plan route are at SKU level, not flavor level',async()=>{
  const detail=await replyTo(callback('product:P003'));
  assert.match(detail.text,/تومان/);
  assert.ok(calls(detail).includes('final:P003:1'));
  assert.ok(!calls(detail).some(x=>x.startsWith('cart')));
  const quote=await replyTo(callback('final:P003:1'));
  assert.match(quote.text,/۹۸٬۱۱۷ تومان/);
  assert.doesNotMatch(quote.text,/ریال/);
  const plan=await replyTo(callback('plan:D001'));
  assert.ok(calls(plan).includes('plan-items:D001:1'));
  const planItems=await replyTo(callback('plan-items:D001:1'));
  assert.ok(calls(planItems).includes('product:P003'));
});
test('legacy cart actions return the menu without accessing runtime storage',async()=>{
  const env={CART_DB:{prepare(){throw Error('cart storage must not be accessed');}}};
  for (const old of ['cart','/cart','🛒 سبد خرید','cart-add:P003',
      'cart-v:P003:1','cart-clear','cart-plus:0:10','cart-gap:D001:0:1',
      '/add P003 1','/remove P003 1','/clear','/suggest','suggest:D001']) {
    const view=await replyTo(callback(old),env);
    assert.match(view.text,/منوی فروش خوشگوار/);
    assert.ok(!calls(view).some(x=>x.startsWith('cart')));
  }
  assert.match((await replyTo(message('🛒 سبد خرید'),env)).text,/منوی فروش خوشگوار/);
});
test('forged callers and unapproved products remain inaccessible',async()=>{
  const forged=callback('quote:P003:D001');
  forged.callback_query.from.id=999;
  assert.equal(await replyTo(forged),null);
  assert.match((await replyTo(callback('quote:PRIVATE:D001'))).text,/در دسترس نیست/);
  assert.match((await replyTo(callback('quote:P004:D001'))).text,/منتشر نشده/);
});

test('menu shortcut and old search text button use the inline flow', async () => {
  const menu = await replyTo(message('/menu'));
  assert.match(menu.text, /منوی فروش خوشگوار/);
  assert.ok(calls(menu).includes('products:1'));
  assert.ok(!calls(menu).includes('prices:1'));
  const oldPrice = await replyTo(callback('prices:1'));
  assert.match(oldPrice.text, /خانواده‌های کالایی/);
  const search = await replyTo(message('🔎 جستجوی محصول'));
  assert.match(search.text, /نام محصول را به صورت پیام بنویسید/);
  assert.ok(calls(search).includes('menu'));
});
