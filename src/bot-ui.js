import { planAppliesToProduct } from './plan-visibility.js';
import { quantities, qualifies, monetaryEvaluation } from './engine.js';
import { CONSULTATION_BUTTON_TEXT, CONSULTATION_CHAT_URL } from './consultation.js';

// Inline navigation; shopping cart is server-side and never exposes unpublished data.
export const PAGE_SIZE = 5;
export const fmt = value => Number(value).toLocaleString('fa-IR');
const digits = '۰۱۲۳۴۵۶۷۸۹';
const fa = value => String(value).replace(/[0-9]/g, c => digits[Number(c)]);
const key = (text, callback_data) => ({ text, callback_data });
const home = () => [key('🏠 منوی اصلی', 'menu')];
const pageButtons = (page, pages, prefix) => [
  ...(page > 1 ? [key('◀ قبلی', prefix + ':' + (page - 1))] : []),
  ...(page < pages ? [key('بعدی ▶', prefix + ':' + (page + 1))] : []),
];
function pageOf(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) return null;
  return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), pages };
}
export function card(text, rows = [], withHome = true) {
  // Share one row between Back and Home to avoid a tall navigation footer.
  // Copy the rows rather than mutating a caller's inline keyboard.
  const buttons = rows.map(row => [...row]);
  if (withHome) {
    const last = buttons.at(-1);
    if (last?.length === 1 && /^🔙/.test(last[0].text || '')) last.push(...home());
    else buttons.push(home());
  }
  return { text: String(text).slice(0, 3500),
    reply_markup: { inline_keyboard: buttons } };
}
export function mainMenu() {
  return card('🥤 منوی فروش خوشگوار\nبخش موردنظر را انتخاب کنید:', [
    [key('📦 محصولات', 'products:1')],
    [key('🎁 طرح‌های فروش', 'plans:1'), key('🛒 سبد خرید', 'cart')],
    [key('🔎 جستجو', 'search')],
    [{ text: CONSULTATION_BUTTON_TEXT, url: CONSULTATION_CHAT_URL }],
  ], false);
}
export function welcome() {
  return mainMenu();
}
// The approved P010 row is the one product-level nostalgic item with both
// flavors. Hide only the redundant, separately published legacy rows.
export function mergePublicCatalog(data) {
  const consolidated = data.products.find(p =>
    p.product_id === 'P010' && p.product_name === 'نوشابه نوستالژیک' &&
    p.variants?.includes('کوکاکولا') && p.variants?.includes('فانتا پرتقالی'));
  if (!consolidated) return data;
  return { ...data, products: data.products.filter(p =>
    p.product_id !== 'P001' && p.product_id !== 'P002') };
}
// Canonical base prices are in TOMAN; approved legacy/consumer values use IRR.
// Customer-facing prices are *always* whole toman, per bottle, rounded UP.
// Never round or overwrite source values or internally approved financial math.
function renderToman(numerator, divisor = 1n) {
  const n = BigInt(numerator), d = BigInt(divisor);
  if (n < 0n || d <= 0n) return null;
  const roundedUp = (n + d - 1n) / d;
  return fa(roundedUp.toLocaleString('en-US').replaceAll(',', '٬')) + ' تومان';
}
export const toman = amountIRR => renderToman(amountIRR, 10n);
// Parse source decimals as strings to avoid floating-point under-rounding.
export function sheetToman(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/.test(raw)) return null;
  const [integer, fraction = ''] = raw.split('.');
  return renderToman(BigInt(integer) + (/[1-9]/.test(fraction) ? 1n : 0n));
}
export function discountedToman(baseToman, percent) {
  if (!/^[1-9]\d*$/.test(String(baseToman)) ||
      !Number.isSafeInteger(Number(percent)) ||
      Number(percent) < 0 || Number(percent) > 100) return null;
  return renderToman(BigInt(baseToman) * BigInt(100 - Number(percent)), 100n);
}
// Divide internal pack inputs only to derive a per-bottle display amount.
// Ceil the exact rational *once*, at the final display step in whole toman.
function perBottleToman(numerator, unitsPerPack, sourceDivisor = 1n) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(numerator ?? '')) ||
      !/^[1-9]\d*$/.test(String(unitsPerPack ?? '')) ||
      BigInt(unitsPerPack) > 10000n) return null;
  return renderToman(BigInt(numerator), BigInt(unitsPerPack) * sourceDivisor);
}
export function discountedBottleToman(baseBoxToman, percent, unitsPerPack) {
  if (!/^[1-9]\d*$/.test(String(baseBoxToman)) ||
      !Number.isSafeInteger(Number(percent)) ||
      Number(percent) < 0 || Number(percent) > 100) return null;
  return perBottleToman(BigInt(baseBoxToman) * BigInt(100 - Number(percent)),
    unitsPerPack, 100n);
}
const consumerText = p => {
  if (!p.consumer_price) return null;
  const amount = p.consumer_price.basis === 'UNIT'
    ? toman(p.consumer_price.amountIRR)
    : p.consumer_price.basis === 'PACK'
      ? perBottleToman(p.consumer_price.amountIRR, p.units_per_pack, 10n)
      : null;
  return amount ? '💳 قیمت مصرف‌کننده هر بطری: ' + amount : null;
};
const unitBaseText = p => {
  const amount = p.box_base_price && perBottleToman(p.box_base_price.amountToman, p.units_per_pack);
  return amount ? '🏷 قیمت پایه هر بطری: ' + amount : null;
};
function compatiblePlans(p, data) {
  return data.plans.filter(plan => planAppliesToProduct(p, plan, data));
}

// One pack is eligible only if every published quantity condition passes.
// No quote is issued without verified tax-inclusive base and rounding policy.
export function approvedSinglePackOffer(product, data, env) {
  const entries = quantities([{product_id: product.product_id, qty: 1}], data);
  if (entries.length !== 1) return null;
  let best = null;
  for (const plan of compatiblePlans(product, data)) {
    // Only D001 is approved in the current business-rule catalogue for a
    // one-pack tier (original soda, 1–10 packs). Protect against a modified
    // Sheet requirement making a multi-pack plan look like a single-pack deal.
    if (plan.plan_id !== 'D001') continue;
    const requirements = data.requirements.filter(r => r.plan_id === plan.plan_id);
    if (requirements.length !== 1 || requirements[0].group_id !== 'ORIGINAL_CANADA_COMBINED' ||
        requirements[0].quantity_rule !== 'RANGE' ||
        Number(requirements[0].min_packs) !== 1 ||
        Number(requirements[0].max_packs) !== 10) continue;
    if (!qualifies(entries, plan, data)) continue;
    const result = monetaryEvaluation({plan, items: entries}, env);
    const priceIRR = result?.itemPrices?.[0]?.finalPricePerPackIRR;
    if (!/^[1-9]\d*$/.test(String(priceIRR ?? ''))) continue;
    if (!best || BigInt(priceIRR) < BigInt(best.priceIRR)) best = {plan, priceIRR};
  }
  return best;
}
// An approved pack amount is averaged only for customer display; the
// canonical display policy rounds up to whole toman per bottle. Internal
// pack-level invoice calculations and their approved rounding stay untouched.
function averageUnitToman(priceIRR, unitsPerPack) {
  return perBottleToman(priceIRR, unitsPerPack, 10n);
}

const catalogRules = [
  { id: 'original', name: 'نوشابه اورجینال', test: n => /^نوشابه اورجینال(?: |$)/.test(n) },
  { id: 'canada', name: 'نوشابه کانادا', test: n => /^نوشابه کانادا(?: |$)/.test(n) },
  { id: 'doogh', name: 'دوغ', test: n => /^دوغ(?: |$)/.test(n) },
  { id: 'sparkling-juice', name: 'آبمیوه گازدار', test: n => /^آبمیوه گازدار(?: |$)/.test(n) },
  { id: 'heyday', name: 'هی دی', test: n => /(?:^| )هی دی(?: |$)/.test(n) },
  { id: 'dasani', name: 'آب دسانی', test: n => /^آب دسانی(?: |$)/.test(n) },
  { id: 'lemonade', name: 'لیموناد', test: n => /^لیموناد(?: |$)/.test(n) },
  { id: 'milk', name: 'شیر', test: n => /^شیر(?: |$)/.test(n) },
  { id: 'soda', name: 'سودا', test: n => /^سودا(?: |$)/.test(n) },
  { id: 'energy', name: 'انرژی‌زا', test: n => /^انرژی ?زا(?: |$)/.test(n) },
  { id: 'ludvig', name: 'Ludvig', test: n => /^ludvig(?: |$)/i.test(n) },
  { id: 'oreng', name: 'Oreng', test: n => /^oreng(?: |$)/i.test(n) },
  { id: 'other-soda', name: 'سایر نوشابه‌ها', test: n => /^نوشابه(?: |$)/.test(n) },
  { id: 'other', name: 'سایر محصولات', test: () => true },
];
const normalizeCatalogName = value => String(value || '')
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
  .replace(/\s+/g, ' ').trim();
function catalogFamilyId(p) {
  const n = normalizeCatalogName(p.product_name);
  if (!n) return null;
  // Nostalgic is listed as an original soda in the approved source catalog.
  // Category metadata is only used for this unambiguous case; it never overrides
  // conflicting product names (e.g. an original soda tagged as Canada).
  if (/^نوشابه نوستالژیک(?: |$)/.test(n) &&
      normalizeCatalogName(p.category_name) === 'نوشابه اورجینال') return 'original';
  return catalogRules.find(rule => rule.test(n)).id;
}
// Family navigation only groups already-public products. These display-only
// families never grant plan eligibility or bypass group_verified checks.
export function productFamilies(data) {
  const groups = new Map(catalogRules.map(rule => [rule.id, {
    id: rule.id, name: rule.name, items: [],
  }]));
  for (const p of data.products) {
    const id = catalogFamilyId(p);
    if (id) groups.get(id).items.push(p);
  }
  return [...groups.values()].filter(group => group.items.length);
}
export function productList(data, page = 1) {
  const families = productFamilies(data);
  if (!families.length) return card('📦 محصول منتشرشده‌ای موجود نیست.');
  const v = pageOf(families, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('📦 خانواده‌های کالایی' +
    (v.pages > 1 ? ' | ' + fmt(page) + ' از ' + fmt(v.pages) : '') +
    '\nخانواده موردنظر را انتخاب کنید.', [
    ...v.items.map(f => [key(f.name, 'family:' + f.id + ':1')]),
    ...(pageButtons(page, v.pages, 'products').length ? [pageButtons(page, v.pages, 'products')] : []),
    [key('🔎 جستجوی محصول', 'search')],
  ]);
}
export function productFamilyList(data, familyId, page = 1) {
  const families = productFamilies(data);
  const index = families.findIndex(f => f.id === familyId);
  if (index < 0) return card('این خانواده کالایی در دسترس نیست.');
  const family = families[index], v = pageOf(family.items, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  const nameCounts = new Map();
  for (const item of family.items) {
    const name = normalizeCatalogName(item.product_name);
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  return card('📦 ' + family.name +
    (v.pages > 1 ? ' | ' + fmt(page) + ' از ' + fmt(v.pages) : '') +
    '\nمدل موردنظر را انتخاب کنید.', [
    ...v.items.map(p => {
      const name = normalizeCatalogName(p.product_name);
      const label = name.startsWith(family.name + ' ')
        ? name.slice(family.name.length + 1) : name;
      // Do not guess unapproved flavors to distinguish source duplicates.
      // Product IDs already identify each SKU and are safe to show when needed.
      const display = (nameCounts.get(name) || 0) > 1
        ? label + ' (کد ' + p.product_id + ')' : label;
      return [key(display, 'product:' + p.product_id)];
    }),
    ...(pageButtons(page, v.pages, 'family:' + family.id).length
      ? [pageButtons(page, v.pages, 'family:' + family.id)] : []),
    [key('🔙 خانواده‌ها', 'products:' + (Math.floor(index / PAGE_SIZE) + 1))],
  ]);
}
export function productDetail(p, data, env = {}) {
  const plans = compatiblePlans(p, data);
  // One compact, fixed-order product card; never fall back to unapproved
  // prices, plan rules, or raw flavor fields from the Sheet.
  const lines = ['🥤 ' + p.product_name];
  lines.push('📦 تعداد در بسته: ' +
    (/^[1-9]\d*$/.test(String(p.units_per_pack ?? ''))
      ? fmt(p.units_per_pack) + ' عدد' : 'نامشخص'));
  lines.push(consumerText(p) || '💳 قیمت مصرف‌کننده هر بطری: منتشر نشده');
  lines.push(unitBaseText(p) || '🏷 قیمت پایه هر بطری: منتشر نشده');

  const offer = approvedSinglePackOffer(p, data, env);
  if (offer) {
    const perBottle = averageUnitToman(offer.priceIRR, p.units_per_pack);
    if (perBottle) lines.push('💰 قیمت تمام‌شده هر بطری با تخفیف («' +
      offer.plan.plan_name + '»): ' + perBottle);
    else lines.push('💡 قیمت تخفیفی هر بطری قابل اعلام نیست.');
  } else if (plans.length > 1) {
    lines.push('💡 این محصول طرح‌های تخفیفی متنوع و ترکیبی دارد؛ شرایط را ببینید.');
  } else if (plans.length) {
    lines.push('💡 این محصول طرح تخفیفی دارد؛ قیمت هر بطری قابل اعلام نیست.');
  } else {
    lines.push('💡 قیمت تخفیفی یک‌بسته‌ای برای این محصول منتشر نشده است.');
  }
  // Variants must be filtered by the server before reaching this view.
  if (p.variants?.length) lines.push('🎨 طعم‌ها: ' + p.variants.join('، '));

  const family = productFamilies(data).find(f =>
    f.items.some(x => x.product_id === p.product_id));
  const familyIndex = family?.items.findIndex(x => x.product_id === p.product_id) ?? -1;
  const back = family ? 'family:' + family.id + ':' +
    (Math.floor(familyIndex / PAGE_SIZE) + 1) : 'products:1';
  return card(lines.join('\n'), [
    [key('➕ افزودن به سبد خرید', 'cart-add:' + p.product_id)],
    ...(plans.length ? [[key('🎁 تخفیف‌ها و قیمت هر بطری', 'final:' + p.product_id + ':1')]] : []),
    [key('🔙 بازگشت', back)],
  ]);
}
export function variantsList(p, page = 1) {
  const v = pageOf(p.variants || [], page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🎨 طعم‌های ' + p.product_name +
    '\n' + (v.items.length ? v.items.map(x => '• ' + x).join('\n') : 'طعم منتشرشده‌ای موجود نیست.') +
    '\n\nقیمت همه طعم‌های این محصول یکسان است.', [
    ...(pageButtons(page, v.pages, 'variants:' + p.product_id).length
      ? [pageButtons(page, v.pages, 'variants:' + p.product_id)] : []),
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
}
export function unitDetail(p) {
  if (!p.box_base_price) return card('برای این محصول قیمت پایه عمومی موجود نیست.');
  const unit = perBottleToman(p.box_base_price.amountToman, p.units_per_pack) || 'نامشخص';
  return card('🏷 ' + p.product_name + '\nپایه هر بطری: ' + unit, [
    [key('🔙 مشخصات', 'product:' + p.product_id)],
  ]);
}
// Categories are approved business data from the canonical Google Sheet.
// Incomplete classifications fall back to the flat list, never hiding a plan.
export function planCategories(data) {
  const entries = data.plans || [];
  if (!entries.length || entries.some(p => !p.plan_category_fa)) return [];
  const categories = new Map();
  for (const plan of entries) {
    const name = String(plan.plan_category_fa).trim();
    if (!name) return [];
    if (!categories.has(name)) categories.set(name, []);
    categories.get(name).push(plan);
  }
  return [...categories].map(([name, plans], i) => ({index: i + 1, name, plans}));
}
export function planList(data, page = 1) {
  if (!data.plans.length) return card('🏷 فعلاً طرح عمومی معتبر وجود ندارد.');
  const categories = planCategories(data);
  if (categories.length) {
    const v = pageOf(categories, page);
    if (!v) return card('این صفحه در دسترس نیست.');
    return card('🏷 دسته‌بندی طرح‌های فروش' +
      (v.pages > 1 ? ' | ' + fmt(page) + ' از ' + fmt(v.pages) : '') +
      '\nخانواده طرح موردنظر را انتخاب کنید.', [
      ...v.items.map(c => [key(c.name + ' | ' + [...new Set(c.plans.map(p=>fmt(p.discount_percent) + '٪'))].join('، '),
        'plan-group:' + c.index + ':1')]),
      ...(pageButtons(page, v.pages, 'plans').length ? [pageButtons(page, v.pages, 'plans')] : []),
    ]);
  }
  const v = pageOf(data.plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🏷 طرح‌های فروش | ' + fmt(page) + ' از ' + fmt(v.pages) +
    '\nبرای دیدن شرایط، طرح را انتخاب کنید.', [
    ...v.items.map(p => [key(p.plan_name + ' | ' + fmt(p.discount_percent) + '٪',
      'plan:' + p.plan_id)]),
    ...(pageButtons(page, v.pages, 'plans').length ? [pageButtons(page, v.pages, 'plans')] : []),
  ]);
}
export function planGroupList(data, categoryIndex, page = 1) {
  const category = planCategories(data)[categoryIndex - 1];
  if (!Number.isSafeInteger(categoryIndex) || !category) return card('این دسته طرح در دسترس نیست.');
  const rates = [...new Set(category.plans.map(p => Number(p.discount_percent)))].sort((a,b)=>a-b);
  const v = pageOf(rates, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🎁 ' + category.name + '\nدرصد تخفیف را انتخاب کنید.', [
    ...v.items.map(rate => {
      const matching = category.plans.filter(p=>Number(p.discount_percent)===rate);
      return [key(fmt(rate) + '٪' + (matching.length > 1 ? ' | ' + fmt(matching.length) + ' روش خرید' : ''),
        matching.length > 1 ? 'plan-rate:' + categoryIndex + ':' + rate : 'plan:' + matching[0].plan_id)];
    }),
    ...(pageButtons(page, v.pages, 'plan-group:' + categoryIndex).length
      ? [pageButtons(page, v.pages, 'plan-group:' + categoryIndex)] : []),
    [key('🔙 طرح‌های فروش','plans:' + (Math.floor((categoryIndex-1)/PAGE_SIZE)+1))],
  ]);
}
export function planRateList(data, categoryIndex, rate) {
  const category = planCategories(data)[categoryIndex-1];
  if (!category || !Number.isSafeInteger(rate) || rate<0 || rate>100)
    return card('این روش خرید در دسترس نیست.');
  const plans = category.plans.filter(p => Number(p.discount_percent) === rate);
  if (!plans.length) return card('این روش خرید در دسترس نیست.');
  return card('🎁 ' + fmt(rate) + '٪ | ' + category.name +
    '\nروش خرید را انتخاب کنید:', [
    ...plans.map(p => [key(String(p.plan_name).slice(0,55), 'plan:' + p.plan_id)]),
    [key('🔙 درصدهای تخفیف', 'plan-group:' + categoryIndex + ':1')],
  ]);
}
export function planDetail(plan, data) {
  const i = data.plans.findIndex(p => p.plan_id === plan.plan_id);
  const category = planCategories(data).find(c => c.plans.some(p => p.plan_id === plan.plan_id));
  const duplicates = category?.plans.filter(p => Number(p.discount_percent) === Number(plan.discount_percent));
  const back = category ? duplicates.length > 1
    ? 'plan-rate:' + category.index + ':' + Number(plan.discount_percent)
    : 'plan-group:' + category.index + ':1'
    : 'plans:' + (Math.floor(i/PAGE_SIZE)+1);
  return card('🎁 ' + plan.plan_name +
    '\nتخفیف: ' + fmt(plan.discount_percent) + '٪' +
    '\n\nشرایط: ' + String(plan.conditions || 'طبق شرایط طرح').slice(0,850) +
    '\n\nانتخاب مدل‌ها و محاسبه قیمت هر بطری در محصولات و سبد خرید انجام می‌شود.', [
    [key('📦 محصولات مشمول', 'plan-items:' + plan.plan_id + ':1')],
    [key('🛒 مشاهده سبد خرید', 'cart')],
    [key('🔙 طرح‌ها', back)],
  ]);
}
export function planProducts(plan, data, page = 1) {
  const items = data.products.filter(p => compatiblePlans(p, data)
    .some(q => q.plan_id === plan.plan_id));
  if (!items.length) return card('محصول عمومی مرتبط با این طرح منتشر نشده است.', [
    [key('🔙 شرایط طرح', 'plan:' + plan.plan_id)],
  ]);
  const v = pageOf(items, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('📦 محصولات مشمول ' + plan.plan_name +
    '\nبرای مشاهده قیمت و انتخاب مدل، وارد مشخصات محصول شوید.', [
    ...v.items.map(p => [key(p.product_name, 'product:' + p.product_id)]),
    ...(pageButtons(page, v.pages, 'plan-items:' + plan.plan_id).length
      ? [pageButtons(page, v.pages, 'plan-items:' + plan.plan_id)] : []),
    [key('🔙 شرایط طرح', 'plan:' + plan.plan_id)],
  ]);
}
export function productPlanList(p, data, page = 1) {
  const plans = compatiblePlans(p, data);
  if (!plans.length) return card('🏷 طرح منتشرشده مرتبط با این محصول موجود نیست.', [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  const v = pageOf(plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🏷 طرح‌های ' + p.product_name +
    '\nقیمت هر بطری، مستقل از طعم محاسبه می‌شود.', [
    ...v.items.map(plan => [key(plan.plan_name + ' | ' + fmt(plan.discount_percent) + '٪',
      'quote:' + p.product_id + ':' + plan.plan_id)]),
    ...(pageButtons(page, v.pages, 'product-plans:' + p.product_id).length
      ? [pageButtons(page, v.pages, 'product-plans:' + p.product_id)] : []),
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
}
export function planQuote(p, plan, data) {
  if (!compatiblePlans(p, data).some(x => x.plan_id === plan.plan_id))
    return card('این طرح برای محصول انتخابی منتشر نشده است.');
  const baseBottle = p.box_base_price && perBottleToman(p.box_base_price.amountToman, p.units_per_pack);
  const price = p.box_base_price
    ? discountedBottleToman(p.box_base_price.amountToman,
      plan.discount_percent, p.units_per_pack) : null;
  const lines = ['💰 ' + p.product_name, '🏷 ' + plan.plan_name +
    ' (' + fmt(plan.discount_percent) + '٪)'];
  if (baseBottle && price) {
    lines.push('قیمت پایه هر بطری: ' + baseBottle);
    lines.push('قیمت محاسباتی هر بطری پس از تخفیف: ' + price);
  } else lines.push('قیمت پایه تأییدشده هر بطری برای محاسبه موجود نیست.');
  lines.push('اعمال طرح منوط به رعایت تمام شروط آن است.');
  return card(lines.join('\n'), [
    [key('🏷 شرایط طرح', 'plan:' + plan.plan_id)],
    [key('🔙 طرح‌های محصول', 'product-plans:' + p.product_id + ':1')],
  ]);
}
export function finalPriceList(p, data, page = 1) {
  const plans = compatiblePlans(p, data);
  const baseBottle = p.box_base_price && perBottleToman(p.box_base_price.amountToman, p.units_per_pack);
  if (!baseBottle || !/^[1-9]\d*$/.test(String(p.units_per_pack ?? '')) ||
      BigInt(p.units_per_pack) > 10000n)
    return card('💰 قیمت هر بطری ' + p.product_name +
    '\nقیمت پایه با مجوز انتشار یا تعداد معتبر موجود نیست؛ محاسبه انجام نشد.', [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  if (!plans.length) return card('💰 ' + p.product_name +
    '\nطرح تخفیف عمومی مرتبط با این محصول ثبت نشده است.\nپایه هر بطری: ' +
    baseBottle, [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  const v = pageOf(plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  const lines = ['💰 ' + p.product_name, 'قیمت پایه هر بطری: ' +
    baseBottle, 'قیمت محاسباتی هر بطری پس از تخفیف:'];
  for (const plan of v.items) {
    const price = discountedBottleToman(p.box_base_price.amountToman,
      plan.discount_percent, p.units_per_pack);
    if (price) lines.push('• ' + plan.plan_name + ' (' +
      fmt(plan.discount_percent) + '٪): ' + price);
  }
  lines.push('🎨 تمام طعم‌های این محصول قیمت یکسان دارند.');
  lines.push('اعمال تخفیف منوط به رعایت تمام شروط طرح است.');
  return card(lines.join('\n'), [
    ...(pageButtons(page, v.pages, 'final:' + p.product_id).length
      ? [pageButtons(page, v.pages, 'final:' + p.product_id)] : []),
    [key('🏷 شرایط طرح‌ها', 'product-plans:' + p.product_id + ':1')],
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
}
export function searchPrompt() {
  return card('🔎 نام محصول را به صورت پیام بنویسید.\nمثال: فرشی دی یا نوستالژیک', [
    [key('📦 نمایش همه محصولات', 'products:1')],
  ]);
}
export function searchResults(term, data) {
  const q = String(term || '').trim().slice(0, 60);
  const matches = data.products.filter(p => p.product_name.includes(q));
  if (!q || !matches.length) return card('محصولی با این نام پیدا نشد.\nکلمه کوتاه‌تری بنویسید.', [
    [key('📦 همه محصولات', 'products:1')],
  ]);
  return card('🔎 نتیجه جستجو برای «' + q + '»' +
    (matches.length > PAGE_SIZE ? '\nنتایج اول نمایش داده شده؛ نام دقیق‌تری بنویسید.' : ''), [
    ...matches.slice(0, PAGE_SIZE).map(p => [key(p.product_name, 'product:' + p.product_id)]),
    [key('🔎 جستجوی دیگر', 'search')],
  ]);
}
