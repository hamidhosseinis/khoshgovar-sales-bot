// Runtime cart state only: sales data remains exclusively in the canonical Sheet.
// Never store base prices, discounts, plan rules or credentials in D1.
const dbKey = userId => 'khoshgovar:cart:' + userId;
function safeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 50).filter(x =>
    x && typeof x.product_id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.product_id) &&
    typeof x.variant === 'string' && x.variant.length <= 100 &&
    Number.isSafeInteger(x.qty) && x.qty > 0 && x.qty <= 999)
    .map(x => ({product_id:x.product_id, variant:x.variant, qty:x.qty}));
}
export async function readCart(env, userId, data) {
  if (!env.CART_DB) throw Error('cart_db_unavailable');
  const row = await env.CART_DB.prepare('SELECT value FROM bot_runtime WHERE key = ?')
    .bind(dbKey(userId)).first();
  let parsed=[];
  try { parsed = JSON.parse(row?.value || '[]'); } catch { parsed=[]; }
  const publicProducts=new Map(data.products.map(p=>[p.product_id,p]));
  return safeEntries(parsed).filter(x => {
    const p=publicProducts.get(x.product_id);
    return p && (!x.variant || p.variants?.includes(x.variant));
  });
}
export async function writeCart(env, userId, cart) {
  if (!env.CART_DB) throw Error('cart_db_unavailable');
  const safe=safeEntries(cart);
  if (safe.length>50) throw Error('cart_full');
  await env.CART_DB.prepare(
    'INSERT INTO bot_runtime(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(dbKey(userId), JSON.stringify(safe)).run();
}
export function changeQuantity(cart, productId, variant, change) {
  if (![1,-1].includes(change)) return cart;
  const result = cart.map(x=>({...x}));
  const i=result.findIndex(x=>x.product_id===productId && x.variant===variant);
  if (i<0) {
    if (change<0 || result.length>=50) return result;
    result.push({product_id:productId,variant,qty:1});
  } else {
    result[i].qty+=change;
    if (result[i].qty<=0) result.splice(i,1);
    else result[i].qty=Math.min(999,result[i].qty);
  }
  return result;
}
