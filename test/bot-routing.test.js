import test from 'node:test';
import assert from 'node:assert/strict';
import { botReply } from '../src/bot.js';

const approved = id => ({
  product_id: id,
  product_name: 'محصول ' + id,
  units_per_pack: '6',
  variants: [],
  consumer_price: { amountIRR: '100000', basis: 'UNIT' },
  box_base_price: null,
  group_id: 'ORIGINAL_SODA', group_verified: 'TRUE',
});
const data = {
  products: Array.from({length: 6}, (_, n) => approved('P' + String(n + 1).padStart(3, '0'))),
  plans: [], links: [], targets: [], requirements: [],
};
function db() {
  const items = new Map();
  return {
    items,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return {qty:items.get(args[0] + '/' + args[1]) || 0};
            },
            async all() {
              return { results: Array.from(items.entries())
                .filter(([k]) => k.startsWith(args[0] + '/'))
                .map(([k, qty]) => ({product_id:k.split('/')[1],qty})) };
            },
            async run() {
              if (sql.startsWith('INSERT')) items.set(args[0] + '/' + args[1], args[2]);
              else if (sql.startsWith('DELETE') && args.length === 2)
                items.delete(args[0] + '/' + args[1]);
              else if (sql.startsWith('DELETE')) {
                for (const k of items.keys()) if (k.startsWith(args[0] + '/')) items.delete(k);
              }
              return {success:true};
            },
          };
        },
      };
    },
  };
}
const message = text => ({message: {chat:{id:123,type:'private'},from:{id:123},text}});
const callback = text => ({callback_query: {from:{id:123},data:text,
  message:{chat:{id:123,type:'private'},message_id:100}}});
const calls = (reply) => reply.reply_markup.inline_keyboard.flat()
  .map(x => x.callback_data).filter(Boolean);
const replyTo = (update, env) => botReply(update,env,async()=>{},async()=>data);

test('catalog navigation uses real inline buttons and five-product pages', async () => {
  const env = {};
  const list = await replyTo(message('📦 محصولات'),env);
  assert.ok(calls(list).includes('product:P001'));
  assert.ok(calls(list).includes('products:2'));
  assert.ok(!calls(list).includes('product:P006'));
  const details = await replyTo(callback('product:P001'),env);
  assert.match(details.text, /۱۰۰٬۰۰۰/);
  assert.ok(calls(details).includes('add:P001:1'));
});
test('add/remove via callback changes only the private caller cart', async () => {
  const storage = db(), env = {CART_DB:storage};
  assert.match((await replyTo(callback('add:P001:10'),env)).text,/۱۰ بسته/);
  assert.equal(storage.items.get('123/P001'),10);
  assert.match((await replyTo(callback('cart'),env)).text,/۱۰ بسته/);
  assert.match((await replyTo(callback('remove:P001:5'),env)).text,/۵ بسته/);
  assert.equal(storage.items.get('123/P001'),5);
  assert.match((await replyTo(callback('cart:confirm-clear'),env)).text,/حذف شوند/);
  assert.equal(storage.items.get('123/P001'),5);
  await replyTo(callback('cart:clear'),env);
  assert.equal(storage.items.size,0);
});
test('an unknown product and forged caller cannot modify the cart', async () => {
  const storage = db(), env={CART_DB:storage};
  assert.match((await replyTo(callback('add:PRIVATE:1'),env)).text,/در دسترس نیست/);
  assert.equal(storage.items.size,0);
  const forged = callback('add:P001:10');
  forged.callback_query.from.id=999;
  assert.equal(await replyTo(forged,env),null);
  assert.equal(storage.items.size,0);
});
