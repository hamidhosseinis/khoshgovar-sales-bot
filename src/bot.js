import { sheetCatalog } from './sheets.js';
import { isAuthorizedOwner, isAuthorizedUser } from './messages.js';
import {
  card, welcome, mainMenu, mergePublicCatalog, productList, productFamilyList,
  productDetail, unitDetail, variantsList, searchPrompt, searchResults,
} from './bot-ui.js';
import { planAnnouncementList, planAnnouncementDetail } from './plan-announcements.js';

const idPattern = '[A-Za-z0-9_-]{1,40}';
const match = (value, pattern) => value.match(new RegExp(pattern, 'i'));
const page = value => Number(value);
const notFound = () => card('این محصول یا طرح برای نمایش عمومی در دسترس نیست.');

export async function botReply(update, env, requestFetch = fetch, loadCatalog = sheetCatalog) {
  const cb = update?.callback_query;
  const message = cb?.message || update?.message;
  const user = cb?.from || message?.from;
  if (!message || message.chat?.type !== 'private' ||
      !Number.isSafeInteger(message.chat?.id) ||
      !Number.isSafeInteger(user?.id) || user.id !== message.chat.id ||
      !isAuthorizedUser(user, env)) return null;
  const content = cb?.data || (typeof message.text === 'string' ? message.text.trim() : '');
  if (content === '/start' || content === '/help' || content === '/menu' ||
      content === 'ℹ️ راهنما') return welcome();
  if (content === 'menu') return mainMenu();
  if (content === '/admin') return card('دسترسی مدیریت از این مسیر فعال نیست.');

  let data;
  try {
    const ownerOnly = isAuthorizedOwner(user, env);
    const catalog = await loadCatalog(env, requestFetch, Date.now(), { ownerOnly });
    // Defense in depth: even a stale/mis-scoped catalog may not expose
    // owner-only rates or unpublished consumer amounts to added users.
    const visible = ownerOnly ? catalog : {
      ...catalog,
      priceRates: [],
      products: catalog.products.map(p => ({ ...p, owner_consumer_price_raw: null })),
    };
    data = mergePublicCatalog(visible);
  }
  catch { return card('اتصال به فهرست تأییدشده برقرار نیست.\nاطلاعات تأییدنشده نمایش داده نمی‌شود.'); }
  const canonical = id => (id === 'P001' || id === 'P002') &&
    !data.products.some(p => p.product_id === id) &&
    data.products.some(p => p.product_id === 'P010') ? 'P010' : id;
  const findProduct = id => data.products.find(p => p.product_id === canonical(id));
  let m;
  if (content === '📦 محصولات' || content === '/products') return productList(data);
  if ((m = match(content, '^products:([1-9]\\d{0,2})$')) ||
      (m = match(content, '^/products\\s+([1-9]\\d{0,2})$')))
    return productList(data, page(m[1]));
  if ((m = match(content, '^family:([a-z0-9-]{1,40}):([1-9]\\d{0,2})$')))
    return productFamilyList(data, m[1], page(m[2]));

  // Old price shortcuts redirect to the catalog; the separate price menu is gone.
  if (['💰 لیست قیمت', '💰 قیمت‌ها', '/prices'].includes(content)) return productList(data);
  if ((m = match(content, '^prices:([1-9]\\d{0,2})$')) ||
      (m = match(content, '^/prices\\s+([1-9]\\d{0,2})$')))
    return productList(data, page(m[1]));

  if ((m = match(content, '^product:(' + idPattern + ')$')) ||
      (m = match(content, '^/product\\s+(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? productDetail(p, data, env) : notFound();
  }
  if ((m = match(content, '^price:(' + idPattern + ')$')) ||
      (m = match(content, '^/price\\s+(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? productDetail(p, data, env) : notFound();
  }
  if ((m = match(content, '^unit:(' + idPattern + ')$'))) {
    const p = findProduct(m[1]);
    return p ? unitDetail(p) : notFound();
  }
  if ((m = match(content, '^variants:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? variantsList(p, page(m[2])) : notFound();
  }
  // Retire all stale plan and quote callbacks, including old Telegram buttons.
  // Existing price shortcuts open the full percentage table on the product.
  if ((m = match(content, '^final:(' + idPattern + '):([1-9]\\d{0,2})$')) ||
      (m = match(content, '^product-plans:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? productDetail(p, data, env) : notFound();
  }
  if (['🎁 طرح‌های فروش', '🏷 طرح‌های فروش', '🏷 طرح‌های عمومی',
      '📋 لیست طرح‌ها', '/plans', 'plan-announcements'].includes(content))
    return planAnnouncementList(data);
  if ((m = match(content, '^plan-announcement:(' + idPattern + ')$')))
    return planAnnouncementDetail(data, m[1]);
  if (/^(?:plans:|plan:|plan-group:|plan-rate:|plan-items:|quote:|\/plan(?:\s|$))/i.test(content))
    return mainMenu();

  if (['search', '/search', '🔎 جستجوی محصول', '🔎 جستجو'].includes(content))
    return searchPrompt();
  if ((m = match(content, '^/search\\s+(.{2,60})$'))) return searchResults(m[1], data);

  // Old Telegram messages may still contain cart buttons. Retire every
  // legacy cart or basket-management command without reading or writing state.
  if (content === 'cart' || content === '/cart' || content === '🛒 سبد خرید' ||
      content.startsWith('cart-') || content.startsWith('cart:') ||
      content === '🧮 محاسبه قیمت' || content === '/suggest' ||
      content.startsWith('suggest:') || /^\/(?:add|remove|clear)(?:\s|$)/i.test(content))
    return mainMenu();

  if (!cb && content && !content.startsWith('/')) return searchResults(content, data);
  return mainMenu();
}

