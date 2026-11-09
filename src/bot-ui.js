import { planAppliesToProduct } from './plan-visibility.js';
import { quantities, qualifies, monetaryEvaluation } from './engine.js';
import { CONSULTATION_BUTTON_TEXT, CONSULTATION_CHAT_URL } from './consultation.js';

// All customer navigation is inline. No reply keyboard or cart UI.
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
    [key('🏷 طرح‌های فروش', 'plans:1'), key('🔎 جستجو', 'search')],
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
// Consumer and legacy monetary-evaluation amounts use IRR. The canonical
// base_price_per_box and box_unit_base_price columns use TOMAN, not IRR.
// Never divide those source amounts by 10 when displaying them.
function renderToman(numerator, divisor = 10n) {
  const n = BigInt(numerator), whole = n / divisor, fraction = n % divisor;
  const places = divisor.toString().length - 1;
  const decimal = fraction.toString().padStart(places, '0').replace(/0+$/, '');
  return fa(whole.toLocaleString('en-US').replaceAll(',', '٬')) + (decimal ? '٫' + fa(decimal) : '') + ' تومان';
}
export const toman = amountIRR => renderToman(amountIRR);
// Preserve the exact decimal string provided by the canonical Sheet, including
// formula precision. Only add thousands separators and Persian digits.
export function sheetToman(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/.test(raw)) return null;
  const [integer, fraction] = raw.split('.');
  return fa(BigInt(integer).toLocaleString('en-US').replaceAll(',', '٬')) +
    (fraction ? '٫' + fa(fraction) : '') + ' تومان';
}
export function discountedToman(baseToman, percent) {
  if (!/^[1-9]\d*$/.test(String(baseToman)) ||
      !Number.isSafeInteger(Number(percent)) ||
      Number(percent) < 0 || Number(percent) > 100) return null;
  // A whole-percent discount on integer toman is exact to 0.01 toman.
  return renderToman(BigInt(baseToman) * BigInt(100 - Number(percent)), 100n);
}
const consumerText = p => p.consumer_price
  ? '💳 مصرف‌کننده هر ' + (p.consumer_price.basis === 'PACK' ? 'بسته' : 'عدد') +
    ': ' + toman(p.consumer_price.amountIRR) : null;
const baseText = p => p.box_base_price
  ? '🏷 پایه هر بسته: ' + sheetToman(p.box_base_price.amountToman) : null;
const unitBaseText = p => p.box_base_price
  ? '🏷 پایه هر عدد: ' + sheetToman(p.box_base_price.unitRawToman) : null;
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
    if (requirements.length !== 1 || requirements[0].group_id !== 'ORIGINAL_SODA' ||
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
function prospectiveMargin(product, priceIRR) {
  const consumer = product.consumer_price;
  if (!consumer || !/^[1-9]\d*$/.test(String(consumer.amountIRR ?? '')) ||
      !['UNIT', 'PACK'].includes(consumer.basis)) return null;
  const qty = String(product.units_per_pack ?? '');
  if (consumer.basis === 'UNIT' &&
      (!/^[1-9]\d*$/.test(qty) || BigInt(qty) > 10000n)) return null;
  const sale = BigInt(consumer.amountIRR) *
    (consumer.basis === 'PACK' ? 1n : BigInt(qty));
  if (sale <= 0n || sale > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const spread = sale - BigInt(priceIRR);
  const abs = spread < 0n ? -spread : spread;
  // Percent is display-only and rounded to two decimal places.
  const hundredths = (abs * 10000n + sale / 2n) / sale;
  const pct = fa((hundredths / 100n).toString() + '٫' +
    (hundredths % 100n).toString().padStart(2, '0')) + '٪';
  return {amount: (spread < 0n ? '−' : '') + toman(abs),
    percent: (spread < 0n ? '−' : '') + pct};
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
  const lines = ['🥤 ' + p.product_name];
  if (Number(p.units_per_pack) > 0) lines.push('📦 هر بسته: ' + fmt(p.units_per_pack) + ' عدد');
  // Only per-variant approved flavors from the canonical Sheet reach this view.
  // Keep them in the product message, not only behind a separate button.
  if (p.variants?.length) lines.push('🎨 این محصول شامل طعم‌های زیر است:\n' + p.variants.join('، '));
  if (consumerText(p)) lines.push(consumerText(p));
  if (baseText(p)) lines.push(baseText(p));
  if (unitBaseText(p)) lines.push(unitBaseText(p));
  if (!consumerText(p) && !baseText(p))
    lines.push('قیمت عمومی برای این محصول ثبت نشده است.');
  const offer = approvedSinglePackOffer(p, data, env);
  if (offer) {
    lines.push('🛍️ قیمت خرید یک بسته با «' + offer.plan.plan_name + '»: ' +
      toman(offer.priceIRR));
    lines.push('✅ تخفیف این طرح با خرید یک بسته هم اعمال می‌شود.');
    const margin = prospectiveMargin(p, offer.priceIRR);
    if (margin) lines.push('📈 حاشیه سود ناخالص احتمالی: ' + margin.amount +
      ' (' + margin.percent + ')');
    else lines.push('📈 حاشیه سود: قیمت مصرف‌کننده معتبر برای محاسبه موجود نیست.');
    lines.push('حاشیه سود با فرض فروش به قیمت مصرف‌کننده و پیش از سایر هزینه‌هاست.');
  } else lines.push('💡 قیمت خرید یک بسته و حاشیه سود پس از تأیید طرح و قوانین محاسبه اعلام می‌شود.');
  if (compatiblePlans(p, data).length)
    lines.push('🏷 برای تخفیف بیشتر، سایر طرح‌ها و شرایط آن‌ها را ببینید.');
  if (p.variants?.length > 1)
    lines.push('🎨 قیمت برای تمام طعم‌های این محصول یکسان است.');
  const family = productFamilies(data).find(f =>
    f.items.some(x => x.product_id === p.product_id));
  const familyIndex = family?.items.findIndex(x => x.product_id === p.product_id) ?? -1;
  const back = family ? 'family:' + family.id + ':' +
    (Math.floor(familyIndex / PAGE_SIZE) + 1) : 'products:1';
  return card(lines.join('\n'), [
    [key('🏷 طرح‌های تخفیف بیشتر', 'product-plans:' + p.product_id + ':1'),
      ...(p.variants?.length ? [key('🎨 طعم‌ها', 'variants:' + p.product_id + ':1')] : [])],
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
  const unit = sheetToman(p.box_base_price.unitRawToman) || 'نامشخص';
  return card('🏷 ' + p.product_name + '\nپایه هر بسته: ' +
    sheetToman(p.box_base_price.amountToman) +
    '\nپایه هر عدد: ' + unit +
    '\nوضعیت شمول مالیات تأیید نشده است.', [
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
      ...v.items.map(c => [key(c.name + ' (' + fmt(c.plans.length) + ' طرح)',
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
  const v = pageOf(category.plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🏷 ' + category.name +
    (v.pages > 1 ? ' | ' + fmt(page) + ' از ' + fmt(v.pages) : '') +
    '\nطرح و درصد تخفیف را انتخاب کنید.', [
    ...v.items.map(p => [key(p.plan_name + ' | ' + fmt(p.discount_percent) + '٪',
      'plan:' + p.plan_id)]),
    ...(pageButtons(page, v.pages, 'plan-group:' + categoryIndex).length
      ? [pageButtons(page, v.pages, 'plan-group:' + categoryIndex)] : []),
    [key('🔙 دسته‌های طرح', 'plans:' + (Math.floor((categoryIndex - 1) / PAGE_SIZE) + 1))],
  ]);
}
export function planDetail(plan, data) {
  const i = data.plans.findIndex(p => p.plan_id === plan.plan_id);
  const categories = planCategories(data);
  const category = categories.find(c => c.plans.some(p => p.plan_id === plan.plan_id));
  const inCategory = category ? category.plans.findIndex(p => p.plan_id === plan.plan_id) : -1;
  const back = category ? 'plan-group:' + category.index + ':' +
    (Math.floor(inCategory / PAGE_SIZE) + 1) : 'plans:' + (Math.floor(i / PAGE_SIZE) + 1);
  return card('🏷 ' + plan.plan_name +
    '\nتخفیف: ' + fmt(plan.discount_percent) + '٪' +
    '\n\nشرایط: ' + String(plan.conditions || 'طبق شرایط طرح').slice(0, 850) +
    '\n\nتخفیف فقط پس از تحقق تمام شروط طرح قابل اعمال است.', [
    [key('💰 قیمت محصولات این طرح', 'plan-items:' + plan.plan_id + ':1')],
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
  return card('💰 ' + plan.plan_name +
    '\nمحصول را برای محاسبه قیمت هر بسته انتخاب کنید.\n' +
    'مبالغ تنها در صورت تحقق شرایط طرح معتبرند.', [
    ...v.items.map(p => [key(p.product_name, 'quote:' + p.product_id + ':' + plan.plan_id)]),
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
    '\nقیمت هر بسته، مستقل از طعم محاسبه می‌شود.', [
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
  const price = p.box_base_price
    ? discountedToman(p.box_base_price.amountToman, plan.discount_percent) : null;
  const lines = ['💰 ' + p.product_name, '🏷 ' + plan.plan_name +
    ' (' + fmt(plan.discount_percent) + '٪)'];
  if (p.box_base_price && price) {
    lines.push('پایه هر بسته: ' + sheetToman(p.box_base_price.amountToman));
    lines.push('پس از کسر تخفیف: ' + price);
  } else lines.push('قیمت پایه تأییدشده برای محاسبه موجود نیست.');
  lines.push('⚠️ فقط محاسبه بر مبنای قیمت پایه است؛ قیمت نهایی با مالیات و گردکردن هنوز قطعی نیست.');
  lines.push('اعمال طرح منوط به رعایت تمام شروط آن است.');
  return card(lines.join('\n'), [
    [key('🏷 شرایط طرح', 'plan:' + plan.plan_id)],
    [key('🔙 طرح‌های محصول', 'product-plans:' + p.product_id + ':1')],
  ]);
}
export function finalPriceList(p, data, page = 1) {
  const plans = compatiblePlans(p, data);
  if (!p.box_base_price) return card('💰 قیمت تمام‌شده ' + p.product_name +
    '\nقیمت پایه با مجوز انتشار موجود نیست؛ محاسبه انجام نشد.', [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  if (!plans.length) return card('💰 ' + p.product_name +
    '\nطرح تخفیف عمومی مرتبط با این محصول ثبت نشده است.\nپایه هر بسته: ' +
    sheetToman(p.box_base_price.amountToman), [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  const v = pageOf(plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  const lines = ['💰 ' + p.product_name, 'پایه هر بسته: ' +
    sheetToman(p.box_base_price.amountToman), 'قیمت هر بسته پس از تخفیف:'];
  for (const plan of v.items) {
    const price = discountedToman(p.box_base_price.amountToman, plan.discount_percent);
    if (price) lines.push('• ' + plan.plan_name + ' (' +
      fmt(plan.discount_percent) + '٪): ' + price);
  }
  lines.push('🎨 تمام طعم‌های این محصول قیمت یکسان دارند.');
  lines.push('⚠️ محاسبه از پایه است؛ مالیات/گردکردن تأیید نشده و شروط طرح الزامی‌اند.');
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
