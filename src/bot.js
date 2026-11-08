import { sheetCatalog } from './sheets.js';
import {
  card, welcome, mainMenu, productList, priceList, productDetail, unitDetail,
  variantsList, planList, planDetail, productPlanList, cartSummary, cartItems,
  cartItem, cartPrices, clearConfirm, upsellPage,
} from './bot-ui.js';

const maxQty = 10000;
const idPattern = '[A-Za-z0-9_-]{1,40}';
const dbReady = env => Boolean(env.CART_DB?.prepare);
const noCart = () => card('سبد خرید فعلاً در دسترس نیست.\nمی‌توانید محصولات و قیمت‌های عمومی را مشاهده کنید.');

async function cartFor(db, id) {
  const r = await db.prepare('SELECT product_id, qty FROM cart_items WHERE chat_id=? LIMIT 100')
    .bind(String(id)).all();
  return (r.results || []).map(x => ({ product_id: x.product_id, qty: Number(x.qty) }))
    .filter(x => Number.isSafeInteger(x.qty) && x.qty > 0 && x.qty <= maxQty);
}
async function changeCart(db, chatId, productId, delta) {
  const row = await db.prepare('SELECT qty FROM cart_items WHERE chat_id=? AND product_id=?')
    .bind(String(chatId), productId).first();
  const old = Number(row?.qty || 0);
  if (!Number.isSafeInteger(old) || old < 0) return false;
  const total = old + delta;
  if (total > maxQty) return false;
  if (total <= 0) {
    await db.prepare('DELETE FROM cart_items WHERE chat_id=? AND product_id=?')
      .bind(String(chatId), productId).run();
  } else {
    await db.prepare('INSERT INTO cart_items (chat_id,product_id,qty) VALUES (?,?,?) ON CONFLICT(chat_id,product_id) DO UPDATE SET qty=excluded.qty')
      .bind(String(chatId), productId, total).run();
  }
  return true;
}
function match(content, pattern) {
  return content.match(new RegExp(pattern, 'i'));
}
const page = value => Number(value);
const notFound = () => card('این محصول یا طرح برای نمایش عمومی در دسترس نیست.');

export async function botReply(update, env, requestFetch = fetch, loadCatalog = sheetCatalog) {
  const cb = update?.callback_query;
  const message = cb?.message || update?.message;
  const user = cb?.from || message?.from;
  if (!message || message.chat?.type !== 'private' ||
      !Number.isSafeInteger(message.chat?.id) ||
      !Number.isSafeInteger(user?.id) || user.id !== message.chat.id) return null;
  const content = cb?.data || (typeof message.text === 'string' ? message.text.trim() : '');
  if (content === '/start' || content === '/help' || content === 'ℹ️ راهنما') return welcome();
  if (content === 'menu') return mainMenu();

  let data;
  try { data = await loadCatalog(env, requestFetch); }
  catch { return card('اتصال به فهرست تأییدشده برقرار نیست.\nاطلاعات تأییدنشده نمایش داده نمی‌شود.'); }
  const findProduct = id => data.products.find(p => p.product_id === id);
  const findPlan = id => data.plans.find(p => p.plan_id === id);

  let m;
  if (content === '📦 محصولات' || content === '/products') return productList(data);
  if ((m = match(content, '^products:([1-9]\\d{0,2})$')) ||
      (m = match(content, '^/products\\s+([1-9]\\d{0,2})$')))
    return productList(data, page(m[1]));

  if (['💰 لیست قیمت', '💰 قیمت‌ها', '/prices'].includes(content)) return priceList(data);
  if ((m = match(content, '^prices:([1-9]\\d{0,2})$')) ||
      (m = match(content, '^/prices\\s+([1-9]\\d{0,2})$')))
    return priceList(data, page(m[1]));

  if ((m = match(content, '^product:(' + idPattern + ')$')) ||
      (m = match(content, '^/product\\s+(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? productDetail(p, data) : notFound();
  }
  if ((m = match(content, '^price:(' + idPattern + ')$')) ||
      (m = match(content, '^/price\\s+(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? productDetail(p, data, true) : notFound();
  }
  if ((m = match(content, '^unit:(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? unitDetail(p) : notFound();
  }
  if ((m = match(content, '^variants:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? variantsList(p, page(m[2])) : notFound();
  }
  if ((m = match(content, '^product-plans:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? productPlanList(p, data, page(m[2])) : notFound();
  }
  if (['🏷 طرح‌های فروش', '🏷 طرح‌های عمومی', '/plans'].includes(content)) return planList(data);
  if ((m = match(content, '^plans:([1-9]\\d{0,2})$')))
    return planList(data, page(m[1]));
  if ((m = match(content, '^plan:(' + idPattern + ')$')) ||
      (m = match(content, '^/plan\\s+(' + idPattern + ')$'))) {
    const p = findPlan(m[1]);
    return p ? planDetail(p, data) : notFound();
  }

  const needsCart = content === '🛒 سبد خرید' || content === '/cart' || content === 'cart' ||
    content === '🧮 محاسبه قیمت' || content === '/suggest' ||
    content === '💡 پیشنهاد تخفیف بیشتر' || content.startsWith('cart:') ||
    content.startsWith('suggest:') || content.startsWith('add:') ||
    content.startsWith('remove:') || /^\/(?:add|remove|clear)(?:\s|$)/i.test(content);
  if (needsCart && !dbReady(env)) return noCart();
  const chatId = message.chat.id;
  if (['🛒 سبد خرید', '/cart', 'cart'].includes(content)) {
    return cartSummary(await cartFor(env.CART_DB, chatId), data, env);
  }
  if ((m = match(content, '^cart:items:([1-9]\\d{0,2})$')))
    return cartItems(await cartFor(env.CART_DB, chatId), data, page(m[1]));
  if ((m = match(content, '^cart:item:(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    if (!p) return notFound();
    const cart = await cartFor(env.CART_DB, chatId);
    return cartItem(cart.find(x => x.product_id === p.product_id), p);
  }
  if (content === '🧮 محاسبه قیمت') return cartPrices(await cartFor(env.CART_DB, chatId), data, env);
  if ((m = match(content, '^cart:prices:([1-9]\\d{0,2})$')))
    return cartPrices(await cartFor(env.CART_DB, chatId), data, env, page(m[1]));
  if (content === 'cart:confirm-clear') return clearConfirm();
  if (content === 'cart:clear' || content === '/clear') {
    await env.CART_DB.prepare('DELETE FROM cart_items WHERE chat_id=?')
      .bind(String(chatId)).run();
    return cartSummary([], data, env);
  }
  if (content === '/suggest' || content === '💡 پیشنهاد تخفیف بیشتر')
    return upsellPage(await cartFor(env.CART_DB, chatId), data);
  if ((m = match(content, '^suggest:([1-9]\\d{0,2})$')))
    return upsellPage(await cartFor(env.CART_DB, chatId), data, page(m[1]));

  m = match(content, '^(add|remove):(' + idPattern + '):(1|5|10)$') ||
    match(content, '^/(add|remove)\\s+(' + idPattern + ')\\s+([0-9]{1,5})$');
  if (m) {
    const action = m[1].toLowerCase(), id = m[2], qty = Number(m[3]);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > maxQty)
      return card('تعداد مجاز بین ۱ تا ۱۰٬۰۰۰ بسته است.');
    const p = findProduct(id);
    // sheetCatalog already returns only rows approved for public release.
    if (!p) return notFound();
    const done = await changeCart(env.CART_DB, chatId, id, action === 'add' ? qty : -qty);
    if (!done) return card('تعداد درخواستی از سقف مجاز سبد بیشتر است.');
    const cart = await cartFor(env.CART_DB, chatId);
    return cartItem(cart.find(x => x.product_id === id), p,
      action === 'add' ? '✅ به سبد اضافه شد.' : '✅ تعداد به‌روزرسانی شد.');
  }

  if (content === '/admin') return card('دسترسی مدیریت از این مسیر فعال نیست.');
  return mainMenu();
}
