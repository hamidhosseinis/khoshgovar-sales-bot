import { inGroup } from './engine.js';
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
  return { text: String(text).slice(0, 3500),
    reply_markup: { inline_keyboard: withHome ? [...rows, home()] : rows } };
}
export function mainMenu() {
  return card('🥤 دستیار فروش خوشگوار\nیکی از بخش‌ها را انتخاب کنید:', [
    [key('📦 محصولات', 'products:1'), key('🏷 طرح‌های فروش', 'plans:1')],
    [key('💰 لیست قیمت', 'prices:1'), key('🔎 جستجوی محصول', 'search')],
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
// Keep currency conversion exact: all approved source amounts use IRR.
// The divisor is 10 for source IRR, 1000 for (IRR × whole discount percent).
function renderToman(numerator, divisor = 10n) {
  const n = BigInt(numerator), whole = n / divisor, fraction = n % divisor;
  const places = divisor.toString().length - 1;
  const decimal = fraction.toString().padStart(places, '0').replace(/0+$/, '');
  return fa(whole.toLocaleString('en-US')) + (decimal ? '٫' + fa(decimal) : '') + ' تومان';
}
export const toman = amountIRR => renderToman(amountIRR);
export function discountedToman(baseIRR, percent) {
  if (!/^[1-9]\d*$/.test(String(baseIRR)) ||
      !Number.isSafeInteger(Number(percent)) ||
      Number(percent) < 0 || Number(percent) > 100) return null;
  return renderToman(BigInt(baseIRR) * BigInt(100 - Number(percent)), 1000n);
}
const consumerText = p => p.consumer_price
  ? '💳 مصرف‌کننده هر ' + (p.consumer_price.basis === 'PACK' ? 'بسته' : 'عدد') +
    ': ' + toman(p.consumer_price.amountIRR) : null;
const baseText = p => p.box_base_price
  ? '🏷 پایه هر بسته: ' + toman(p.box_base_price.amountIRR) : null;
function pricedProducts(data) {
  return data.products.filter(p => p.consumer_price || p.box_base_price);
}
function compatiblePlans(p, data) {
  return data.plans.filter(plan =>
    data.links.some(l => l.product_id === p.product_id && l.plan_id === plan.plan_id) &&
    data.targets.some(t => t.plan_id === plan.plan_id && inGroup(p, t.group_id)));
}
export function productList(data, page = 1) {
  if (!data.products.length) return card('📦 محصول منتشرشده‌ای موجود نیست.');
  const v = pageOf(data.products, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('📦 محصولات | ' + fmt(page) + ' از ' + fmt(v.pages) +
    '\nبرای دیدن مشخصات، محصول را انتخاب کنید.', [
    ...v.items.map(p => [key(p.product_name, 'product:' + p.product_id)]),
    ...(pageButtons(page, v.pages, 'products').length ? [pageButtons(page, v.pages, 'products')] : []),
    [key('🔎 جستجوی نام محصول', 'search')],
  ]);
}
export function priceList(data, page = 1) {
  const items = pricedProducts(data), v = pageOf(items, page);
  if (!items.length) return card('💰 هنوز قیمت عمومی قابل انتشار وجود ندارد.');
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('💰 قیمت‌ها به تومان | ' + fmt(page) + ' از ' + fmt(v.pages), [
    ...v.items.map(p => [key(p.product_name + ' | ' +
      (p.consumer_price ? toman(p.consumer_price.amountIRR) : toman(p.box_base_price.amountIRR)),
    'price:' + p.product_id)]),
    ...(pageButtons(page, v.pages, 'prices').length ? [pageButtons(page, v.pages, 'prices')] : []),
  ]);
}
export function productDetail(p, data, fromPrices = false) {
  const lines = ['🥤 ' + p.product_name];
  if (Number(p.units_per_pack) > 0) lines.push('📦 هر بسته: ' + fmt(p.units_per_pack) + ' عدد');
  if (consumerText(p)) lines.push(consumerText(p));
  if (baseText(p)) lines.push(baseText(p));
  if (!consumerText(p) && !baseText(p)) lines.push('قیمت عمومی برای این محصول ثبت نشده است.');
  if (p.variants?.length > 1) lines.push('🎨 قیمت برای تمام طعم‌های این محصول یکسان است.');
  const index = (fromPrices ? pricedProducts(data) : data.products)
    .findIndex(x => x.product_id === p.product_id);
  return card(lines.join('\n'), [
    [key('💰 قیمت تمام‌شده', 'final:' + p.product_id + ':1')],
    [key('🏷 طرح‌های محصول', 'product-plans:' + p.product_id + ':1'),
      ...(p.variants?.length ? [key('🎨 طعم‌ها', 'variants:' + p.product_id + ':1')] : [])],
    [key('🔙 بازگشت', (fromPrices ? 'prices:' : 'products:') +
      (Math.floor(index / PAGE_SIZE) + 1))],
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
  const raw = Number(p.box_base_price.unitRawIRR);
  const unit = Number.isFinite(raw) && raw > 0
    ? (raw / 10).toLocaleString('fa-IR', { maximumFractionDigits: 3 }) + ' تومان' : 'نامشخص';
  return card('🏷 ' + p.product_name + '\nپایه هر بسته: ' +
    toman(p.box_base_price.amountIRR) +
    '\nپایه هر عدد (تقریبی): ' + unit +
    '\nوضعیت شمول مالیات تأیید نشده است.', [
    [key('🔙 مشخصات', 'product:' + p.product_id)],
  ]);
}
export function planList(data, page = 1) {
  if (!data.plans.length) return card('🏷 فعلاً طرح عمومی معتبر وجود ندارد.');
  const v = pageOf(data.plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  return card('🏷 طرح‌های فروش | ' + fmt(page) + ' از ' + fmt(v.pages) +
    '\nبرای دیدن شرایط، طرح را انتخاب کنید.', [
    ...v.items.map(p => [key(p.plan_name + ' | ' + fmt(p.discount_percent) + '٪',
      'plan:' + p.plan_id)]),
    ...(pageButtons(page, v.pages, 'plans').length ? [pageButtons(page, v.pages, 'plans')] : []),
  ]);
}
export function planDetail(plan, data) {
  const i = data.plans.findIndex(p => p.plan_id === plan.plan_id);
  return card('🏷 ' + plan.plan_name +
    '\nتخفیف: ' + fmt(plan.discount_percent) + '٪' +
    '\n\nشرایط: ' + String(plan.conditions || 'طبق شرایط طرح').slice(0, 850) +
    '\n\nتخفیف فقط پس از تحقق تمام شروط طرح قابل اعمال است.', [
    [key('💰 قیمت محصولات این طرح', 'plan-items:' + plan.plan_id + ':1')],
    [key('🔙 طرح‌ها', 'plans:' + (Math.floor(i / PAGE_SIZE) + 1))],
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
    ? discountedToman(p.box_base_price.amountIRR, plan.discount_percent) : null;
  const lines = ['💰 ' + p.product_name, '🏷 ' + plan.plan_name +
    ' (' + fmt(plan.discount_percent) + '٪)'];
  if (p.box_base_price && price) {
    lines.push('پایه هر بسته: ' + toman(p.box_base_price.amountIRR));
    lines.push('پس از کسر تخفیف: ' + price);
  } else lines.push('قیمت پایه تأییدشده برای محاسبه موجود نیست.');
  lines.push('⚠️ فقط محاسبه بر مبنای قیمت پایه است؛ قیمت نهایی با مالیات و گردکردن هنوز قطعی نیست.');
  lines.push('اعمال طرح منوط به رعایت تمام شروط آن است.');
  return card(lines.join('\n'), [
    [key('🏷 شرایط طرح', 'plan:' + plan.plan_id)],
    [key('🔙 قیمت‌های این محصول', 'final:' + p.product_id + ':1')],
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
    toman(p.box_base_price.amountIRR), [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  const v = pageOf(plans, page);
  if (!v) return card('این صفحه در دسترس نیست.');
  const lines = ['💰 ' + p.product_name, 'پایه هر بسته: ' +
    toman(p.box_base_price.amountIRR), 'قیمت هر بسته پس از تخفیف:'];
  for (const plan of v.items) {
    const price = discountedToman(p.box_base_price.amountIRR, plan.discount_percent);
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
