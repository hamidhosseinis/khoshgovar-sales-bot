import { sheetCatalog } from './sheets.js';
import {
  card, welcome, mainMenu, mergePublicCatalog, productList, priceList,
  productDetail, unitDetail, variantsList, planList, planDetail,
  productPlanList, planProducts, planQuote, finalPriceList, searchPrompt, searchResults,
} from './bot-ui.js';

const idPattern = '[A-Za-z0-9_-]{1,40}';
const match = (value, pattern) => value.match(new RegExp(pattern, 'i'));
const page = value => Number(value);
const notFound = () => card('این محصول یا طرح برای نمایش عمومی در دسترس نیست.');
const cartRemoved = () => card('🛒 سبد خرید فعلاً از بات حذف شده است.\nقیمت‌ها و طرح‌ها را از منوی اصلی ببینید.');

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
  if (content === '/admin') return card('دسترسی مدیریت از این مسیر فعال نیست.');

  let data;
  try { data = mergePublicCatalog(await loadCatalog(env, requestFetch)); }
  catch { return card('اتصال به فهرست تأییدشده برقرار نیست.\nاطلاعات تأییدنشده نمایش داده نمی‌شود.'); }
  const canonical = id => (id === 'P001' || id === 'P002') &&
    data.products.some(p => p.product_id === 'P010') ? 'P010' : id;
  const findProduct = id => data.products.find(p => p.product_id === canonical(id));
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
  if ((m = match(content, '^final:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? finalPriceList(p, data, page(m[2])) : notFound();
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
    const plan = findPlan(m[1]);
    return plan ? planDetail(plan, data) : notFound();
  }
  if ((m = match(content, '^plan-items:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const plan = findPlan(m[1]);
    return plan ? planProducts(plan, data, page(m[2])) : notFound();
  }
  if ((m = match(content, '^quote:(' + idPattern + '):(' + idPattern + ')$'))) {
    const p = findProduct(m[1]), plan = findPlan(m[2]);
    return p && plan ? planQuote(p, plan, data) : notFound();
  }

  if (content === 'search' || content === '/search') return searchPrompt();
  if ((m = match(content, '^/search\\s+(.{2,60})$'))) return searchResults(m[1], data);

  // Old callbacks and commands no longer write to D1 or modify cart state.
  if (content === 'cart' || content === '/cart' || content === '🛒 سبد خرید' ||
      content === '🧮 محاسبه قیمت' || content === '/suggest' ||
      content.startsWith('cart:') || content.startsWith('suggest:') ||
      content.startsWith('add:') || content.startsWith('remove:') ||
      /^\/(?:add|remove|clear)(?:\s|$)/i.test(content)) return cartRemoved();

  if (!cb && content && !content.startsWith('/')) return searchResults(content, data);
  return mainMenu();
}
