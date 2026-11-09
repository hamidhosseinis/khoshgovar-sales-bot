import { sheetCatalog } from './sheets.js';
import {
  card, welcome, mainMenu, mergePublicCatalog, productList, productFamilyList,
  productDetail, unitDetail, variantsList, planList, planGroupList, planRateList, planDetail,
  productPlanList, planProducts, planQuote, finalPriceList, searchPrompt, searchResults,
} from './bot-ui.js';
import {readCart, writeCart, changeQuantity} from './cart-storage.js';
import {cartSummary, chooseFlavor, missingGroupProducts, confirmClear} from './cart-ui.js';

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
      !Number.isSafeInteger(user?.id) || user.id !== message.chat.id) return null;
  const content = cb?.data || (typeof message.text === 'string' ? message.text.trim() : '');
  if (content === '/start' || content === '/help' || content === '/menu' ||
      content === 'ℹ️ راهنما') return welcome();
  if (content === 'menu') return mainMenu();
  if (content === '/admin') return card('دسترسی مدیریت از این مسیر فعال نیست.');

  let data;
  try { data = mergePublicCatalog(await loadCatalog(env, requestFetch)); }
  catch { return card('اتصال به فهرست تأییدشده برقرار نیست.\nاطلاعات تأییدنشده نمایش داده نمی‌شود.'); }
  const canonical = id => (id === 'P001' || id === 'P002') &&
    !data.products.some(p => p.product_id === id) &&
    data.products.some(p => p.product_id === 'P010') ? 'P010' : id;
  const findProduct = id => data.products.find(p => p.product_id === canonical(id));
  const findPlan = id => data.plans.find(p => p.plan_id === id);
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
  if ((m = match(content, '^final:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? finalPriceList(p, data, page(m[2])) : notFound();
  }
  if ((m = match(content, '^product-plans:(' + idPattern + '):([1-9]\\d{0,2})$'))) {
    const p = findProduct(m[1]);
    return p ? productPlanList(p, data, page(m[2])) : notFound();
  }

  if (['🎁 طرح‌های فروش', '🏷 طرح‌های فروش', '🏷 طرح‌های عمومی', '/plans'].includes(content)) return planList(data);
  if ((m = match(content, '^plans:([1-9]\\d{0,2})$')))
    return planList(data, page(m[1]));
  if ((m = match(content, '^plan-group:([1-9]\\d{0,2}):([1-9]\\d{0,2})$')))
    return planGroupList(data, page(m[1]), page(m[2]));
  if ((m = match(content, '^plan-rate:([1-9]\\d{0,2}):([0-9]{1,3})$')))
    return planRateList(data, page(m[1]), page(m[2]));
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

  if (['search', '/search', '🔎 جستجوی محصول', '🔎 جستجو'].includes(content))
    return searchPrompt();
  if ((m = match(content, '^/search\\s+(.{2,60})$'))) return searchResults(m[1], data);

  // The temporary customer cart is private and stored in D1, not in the
  // Google Sheets sales database. Every action is checked against publicData.
  const cartAction = content === 'cart' || content === '/cart' ||
    content === '🛒 سبد خرید' || content === 'cart-clear-confirm' ||
    content === 'cart-clear' || content.startsWith('cart-');
  if (cartAction) {
    let cart;
    try { cart = await readCart(env,user.id,data); }
    catch { return card('🛒 سبد خرید موقتاً در دسترس نیست؛ اطلاعات محصولات و طرح‌ها قابل مشاهده‌اند.'); }
    const display = () => cartSummary(cart,data,env);
    try {
      if (content === 'cart' || content === '/cart' || content === '🛒 سبد خرید')
        return display();
      if (content === 'cart-clear-confirm') return confirmClear();
      if (content === 'cart-clear') {
        cart=[];
        await writeCart(env,user.id,cart);
        return display();
      }
      if ((m=match(content,'^cart-flavors:('+idPattern+'):([1-9]\\d{0,2})$'))) {
        const p=findProduct(m[1]);
        return p?chooseFlavor(p,page(m[2])):notFound();
      }
      if ((m=match(content,'^cart-add:('+idPattern+')$'))) {
        const p=findProduct(m[1]);
        if(!p) return notFound();
        if(p.variants?.length) return chooseFlavor(p);
        cart=changeQuantity(cart,p.product_id,'',1);
        await writeCart(env,user.id,cart);
        return display();
      }
      if ((m=match(content,'^cart-v:('+idPattern+'):([1-9]\\d{0,2})$'))) {
        const p=findProduct(m[1]);
        const flavor=p?.variants?.[page(m[2])-1];
        if(!flavor) return notFound();
        cart=changeQuantity(cart,p.product_id,flavor,1);
        await writeCart(env,user.id,cart);
        return display();
      }
      if ((m=match(content,'^cart-(plus|minus):(\\d{1,2})$'))) {
        const i=Number(m[2]), item=cart[i];
        if(!item)return display();
        cart=changeQuantity(cart,item.product_id,item.variant,m[1]==='plus'?1:-1);
        await writeCart(env,user.id,cart);
        return display();
      }
      if ((m=match(content,'^cart-gap:('+idPattern+'):(\\d{1,2}):([1-9]\\d{0,2})$')))
        return missingGroupProducts(cart,data,m[1],Number(m[2]),page(m[3]));
    } catch {
      return card('سبد خرید ذخیره نشد. لطفاً دوباره تلاش کنید.');
    }
    return display();
  }
  if (content === '🧮 محاسبه قیمت' || content === '/suggest' ||
      content.startsWith('suggest:') || /^\/(?:add|remove|clear)(?:\s|$)/i.test(content))
    return card('برای انتخاب محصولات و بررسی تخفیف، وارد سبد خرید شوید.',[
      [{text:'🛒 سبد خرید',callback_data:'cart'}],
    ]);

  if (!cb && content && !content.startsWith('/')) return searchResults(content, data);
  return mainMenu();
}
)))
    return planGroupList(data, page(m[1]), page(m[2]));
  if ((m = match(content, '^plan-rate:([1-9]\\d{0,2}):([0-9]{1,3})
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

  if (['search', '/search', '🔎 جستجوی محصول', '🔎 جستجو'].includes(content))
    return searchPrompt();
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
)))
    return planRateList(data, page(m[1]), page(m[2]));
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

  if (['search', '/search', '🔎 جستجوی محصول', '🔎 جستجو'].includes(content))
    return searchPrompt();
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
