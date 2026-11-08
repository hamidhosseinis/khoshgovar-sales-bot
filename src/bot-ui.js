import { inGroup, bestPlan, suggestions } from './engine.js';
import { CONSULTATION_BUTTON_TEXT, CONSULTATION_CHAT_URL } from './consultation.js';

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📦 محصولات' }, { text: '🏷 طرح‌های فروش' }],
    [{ text: '💰 لیست قیمت' }, { text: '🛒 سبد خرید' }],
    [{ text: CONSULTATION_BUTTON_TEXT }],
  ],
  resize_keyboard: true,
};

const groupNames = {
  ORIGINAL_SODA: 'نوشابه اورجینال', CANADA_SODA: 'نوشابه کانادا',
  NON_SODA: 'محصول غیرنوشابه', NON_SODA_NON_DASANI: 'محصول غیرنوشابه و غیردسانی',
  KHOSH_LEMONADE: 'لیموناد خوشگوار', DASANI_WATER: 'آب دسانی',
  ENERGY_DRINK: 'انرژی‌زا', DOOGH_MILK: 'دوغ یا شیر',
  DIVERSITY_EXCL_CORE: 'تنوع مجاز غیر از نوشابه، آب و شیر',
  ORIGINAL_CANADA_COMBINED: 'نوشابه اورجینال یا کانادا',
  VARIETY_NON_WATER_NON_MILK: 'تنوع به‌جز آب و شیر',
};

export const fmt = n => Number(n).toLocaleString('fa-IR');
const key = (text, callback_data) => ({ text, callback_data });
const home = () => [key('🏠 منوی اصلی', 'menu')];
const pager = (page, pages, section) => {
  const row = [];
  if (page > 1) row.push(key('◀️ قبلی', section + ':' + (page - 1)));
  if (page < pages) row.push(key('بعدی ▶️', section + ':' + (page + 1)));
  return row;
};
export function card(text, rows = [], showHome = true) {
  const buttons = showHome ? [...rows, home()] : [...rows];
  return { text: String(text).slice(0, 3500), reply_markup: { inline_keyboard: buttons } };
}
export function welcome() {
  return {
    text: '🥤 به دستیار فروش خوشگوار خوش آمدید.\nلطفاً یکی از گزینه‌های منو را انتخاب کنید.',
    reply_markup: MAIN_KEYBOARD,
  };
}
export function mainMenu() {
  return card('🥤 دستیار فروش خوشگوار\nبخش موردنظر را انتخاب کنید.', [
    [key('📦 محصولات', 'products:1'), key('🏷 طرح‌ها', 'plans:1')],
    [key('💰 قیمت‌ها', 'prices:1'), key('🛒 سبد خرید', 'cart')],
    [{ text: CONSULTATION_BUTTON_TEXT, url: CONSULTATION_CHAT_URL }],
  ], false);
}
export const PAGE_SIZE = 5;
function paginate(list, page) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) return null;
  return { page, pages, items: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}
function itemPage(data, id) {
  const index = data.products.findIndex(p => p.product_id === id);
  return index < 0 ? 1 : Math.floor(index / PAGE_SIZE) + 1;
}
export function productList(data, page = 1) {
  if (!data.products.length) return card('📦 هنوز محصول تأییدشده‌ای منتشر نشده است.');
  const view = paginate(data.products, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('📦 محصولات — صفحه ' + fmt(page) + ' از ' + fmt(view.pages) +
    '\nبرای مشاهده مشخصات، محصول را انتخاب کنید.', [
    ...view.items.map(p => [key(p.product_name, 'product:' + p.product_id)]),
    ...(pager(page, view.pages, 'products').length ? [pager(page, view.pages, 'products')] : []),
  ]);
}
function consumer(p) {
  if (!p.consumer_price) return null;
  return '💰 مصرف‌کننده ' + (p.consumer_price.basis === 'PACK' ? 'هر بسته' : 'هر عدد') +
    ': ' + fmt(p.consumer_price.amountIRR) + ' ریال';
}
function base(p) {
  return p.box_base_price ? '🏷 پایه هر بسته (غیرقطعی): ' + fmt(p.box_base_price.amountIRR) + ' ریال' : null;
}
export function priceList(data, page = 1) {
  const priced = data.products.filter(p => p.consumer_price || p.box_base_price);
  if (!priced.length) return card('💰 هنوز قیمت دارای مجوز انتشار موجود نیست.');
  const view = paginate(priced, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('💰 لیست قیمت — صفحه ' + fmt(page) + ' از ' + fmt(view.pages) +
    '\nمحصول را برای مشاهده قیمت‌های مجاز انتخاب کنید.', [
    ...view.items.map(p => [key(p.product_name + ' | ' + (
      p.consumer_price ? 'مصرف‌کننده ' + (p.consumer_price.basis === 'PACK' ? 'بسته ' : 'عدد ') + fmt(p.consumer_price.amountIRR) :
      'پایه بسته ' + fmt(p.box_base_price.amountIRR)) + ' ریال', 'price:' + p.product_id)]),
    ...(pager(page, view.pages, 'prices').length ? [pager(page, view.pages, 'prices')] : []),
  ]);
}
export function productDetail(p, data, fromPrices = false) {
  const lines = ['🥤 ' + p.product_name];
  if (Number(p.units_per_pack) > 0) lines.push('📦 هر بسته: ' + fmt(p.units_per_pack) + ' عدد');
  if (consumer(p)) lines.push(consumer(p));
  if (base(p)) lines.push(base(p));
  if (!consumer(p) && !base(p)) lines.push('قیمت عمومی برای این محصول موجود نیست.');
  return card(lines.join('\n'), [
    [key('🏷 طرح‌های این محصول', 'product-plans:' + p.product_id + ':1')],
    [key('🛒 افزودن ۱ بسته', 'add:' + p.product_id + ':1'), key('➕ ۵ بسته', 'add:' + p.product_id + ':5')],
    [
      ...(p.variants?.length ? [key('🎨 طعم‌ها', 'variants:' + p.product_id + ':1')] : []),
      ...(p.box_base_price ? [key('🔎 ریز قیمت', 'unit:' + p.product_id)] : []),
    ].filter(Boolean),
    [key('🔙 بازگشت', fromPrices ? 'prices:' + (Math.floor(data.products.filter(x => x.consumer_price || x.box_base_price).findIndex(x => x.product_id === p.product_id) / PAGE_SIZE) + 1) : 'products:' + itemPage(data, p.product_id))],
  ].filter(row => row.length));
}
export function unitDetail(p) {
  const raw = Number(p.box_base_price?.unitRawIRR);
  const lines = ['🔎 ' + p.product_name];
  if (!p.box_base_price) lines.push('ریز قیمت مجاز موجود نیست.');
  else {
    lines.push('پایه هر بسته: ' + fmt(p.box_base_price.amountIRR) + ' ریال');
    if (Number.isFinite(raw) && raw > 0)
      lines.push('پایه هر عدد (تقریبی): ' + raw.toLocaleString('fa-IR', { maximumFractionDigits: 3 }) + ' ریال');
    lines.push('وضعیت شمول مالیات تأیید نشده است.');
  }
  return card(lines.join('\n'), [[key('🔙 مشخصات محصول', 'product:' + p.product_id)]]);
}
export function variantsList(p, page = 1) {
  const view = paginate(p.variants || [], page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('🎨 طعم‌های ' + p.product_name + '\n' +
    (view.items.length ? view.items.map(v => '• ' + v).join('\n') : 'طعم تأییدشده‌ای ثبت نشده است.'), [
    ...(pager(page, view.pages, 'variants:' + p.product_id).length ? [pager(page, view.pages, 'variants:' + p.product_id)] : []),
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
}
export function planList(data, page = 1) {
  if (!data.plans.length) return card('🏷 فعلاً طرح عمومی معتبر و تأییدشده‌ای وجود ندارد.');
  const view = paginate(data.plans, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('🏷 طرح‌های عمومی — صفحه ' + fmt(page) + ' از ' + fmt(view.pages), [
    ...view.items.map(p => [key(p.plan_name + ' — ' + fmt(p.discount_percent) + '٪', 'plan:' + p.plan_id)]),
    ...(pager(page, view.pages, 'plans').length ? [pager(page, view.pages, 'plans')] : []),
  ]);
}
export function planDetail(p, data, back = 'plans') {
  const index = data.plans.findIndex(x => x.plan_id === p.plan_id);
  const returnTo = back === 'plans' ? 'plans:' + (Math.floor(index / PAGE_SIZE) + 1) : back;
  return card('🏷 ' + p.plan_name + '\nتخفیف: ' + fmt(p.discount_percent) +
    '٪\nشرایط: ' + String(p.conditions || 'در سبد خرید بررسی می‌شود.').slice(0, 1200) +
    '\n✅ اعمال تخفیف فقط پس از تطبیق ترکیب سبد است.', [
    [key('🛒 بررسی در سبد خرید', 'cart')],
    [key('🔙 بازگشت', returnTo)],
  ]);
}
export function productPlanList(p, data, page = 1) {
  const plans = data.plans.filter(plan =>
    data.links.some(l => l.product_id === p.product_id && l.plan_id === plan.plan_id) &&
    data.targets.some(t => t.plan_id === plan.plan_id && inGroup(p, t.group_id)));
  if (!plans.length) return card('🏷 برای این محصول طرح عمومی مرتبطی ثبت نشده است.', [
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
  const view = paginate(plans, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('🏷 طرح‌های مرتبط با ' + p.product_name + '\nشرایط و تعداد در سبد بررسی می‌شود.', [
    ...view.items.map(plan => [key(plan.plan_name + ' — ' + fmt(plan.discount_percent) + '٪', 'plan:' + plan.plan_id)]),
    ...(pager(page, view.pages, 'product-plans:' + p.product_id).length ? [pager(page, view.pages, 'product-plans:' + p.product_id)] : []),
    [key('🔙 مشخصات محصول', 'product:' + p.product_id)],
  ]);
}
export function cartSummary(items, data, env) {
  const valid = items.filter(x => data.products.some(p => p.product_id === x.product_id));
  if (!valid.length) return card('🛒 سبد خرید شما خالی است.', [
    [key('📦 انتخاب محصول', 'products:1')],
  ]);
  const evaluation = bestPlan(valid, data, env);
  const total = valid.reduce((n, x) => n + x.qty, 0);
  const lines = ['🛒 سبد خرید: ' + fmt(total) + ' بسته (' + fmt(valid.length) + ' محصول)'];
  const products = new Map(data.products.map(p => [p.product_id, p]));
  for (const x of valid.slice(0, 3)) lines.push('• ' + products.get(x.product_id).product_name + ': ' + fmt(x.qty));
  if (valid.length > 3) lines.push('و ' + fmt(valid.length - 3) + ' محصول دیگر…');
  if (evaluation.winner) {
    lines.push('✅ طرح منطبق: ' + evaluation.winner.plan.plan_name);
    lines.push('مبلغ اقلام مشمول: ' + fmt(evaluation.winner.money.totalIRR) + ' ریال');
  } else if (evaluation.list.length) {
    lines.push('🏷 ' + fmt(evaluation.list.length) + ' طرح منطبق؛ قیمت نهایی هنوز تأیید نشده.');
  } else lines.push('فعلاً طرح منطبق با کل ترکیب قابل اعمال نیست.');
  return card(lines.join('\n'), [
    [key('📦 مدیریت اقلام', 'cart:items:1'), key('💰 محاسبه قیمت', 'cart:prices:1')],
    [key('💡 پیشنهاد تخفیف بیشتر', 'suggest:1')],
    [key('➕ افزودن محصول', 'products:1'), key('🗑 خالی کردن سبد', 'cart:confirm-clear')],
  ]);
}
export function cartItems(items, data, page = 1) {
  const products = new Map(data.products.map(p => [p.product_id, p]));
  const valid = items.filter(x => products.has(x.product_id));
  if (!valid.length) return cartSummary([], data, {});
  const view = paginate(valid, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  return card('📦 اقلام سبد — صفحه ' + fmt(page) + ' از ' + fmt(view.pages) +
    '\nبرای تغییر تعداد، محصول را انتخاب کنید.', [
    ...view.items.map(x => [key(products.get(x.product_id).product_name + ' × ' + fmt(x.qty), 'cart:item:' + x.product_id)]),
    ...(pager(page, view.pages, 'cart:items').length ? [pager(page, view.pages, 'cart:items')] : []),
    [key('🔙 بازگشت به سبد', 'cart')],
  ]);
}
export function cartItem(item, p, notice = '') {
  const lines = ['📦 ' + p.product_name, 'تعداد در سبد: ' + fmt(item?.qty || 0) + ' بسته'];
  if (notice) lines.push(notice);
  return card(lines.join('\n'), [
    [key('➕ ۱ بسته', 'add:' + p.product_id + ':1'), key('➕ ۵ بسته', 'add:' + p.product_id + ':5'), key('➕ ۱۰ بسته', 'add:' + p.product_id + ':10')],
    [key('➖ ۱ بسته', 'remove:' + p.product_id + ':1'), key('➖ ۵ بسته', 'remove:' + p.product_id + ':5')],
    [key('🛒 مشاهده سبد', 'cart')],
  ]);
}
export function clearConfirm() {
  return card('🗑 همه اقلام سبد حذف شوند؟', [
    [key('✅ بله، حذف شود', 'cart:clear'), key('انصراف', 'cart')],
  ]);
}
export function cartPrices(items, data, env, page = 1) {
  const evaluation = bestPlan(items, data, env);
  if (!evaluation.list.length) return card('💰 فعلاً طرح منطبق برای این ترکیب وجود ندارد.', [
    [key('🔙 بازگشت به سبد', 'cart')],
  ]);
  if (!evaluation.winner) return card('💰 مبلغ نهایی قابل اعلام نیست.\nمبنای قیمت، مجوز انتشار و قوانین مالیات/گردکردن باید تأیید شوند.', [
    [key('🔙 بازگشت به سبد', 'cart')],
  ]);
  const money = evaluation.winner.money;
  const view = paginate(money.itemPrices, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  const products = new Map(data.products.map(p => [p.product_id, p]));
  const lines = ['💰 محاسبه طرح: ' + evaluation.winner.plan.plan_name,
    'جمع اقلام مشمول: ' + fmt(money.totalIRR) + ' ریال',
    'صرفه‌جویی: ' + fmt(money.savingIRR) + ' ریال'];
  for (const x of view.items)
    lines.push('• ' + products.get(x.product_id).product_name + ': ' +
      fmt(x.qty) + ' × ' + fmt(x.finalPricePerPackIRR) + ' ریال');
  lines.push('⚠️ این مبلغ فقط اقلام مشمول طرح است، نه کل سبد.');
  return card(lines.join('\n'), [
    ...(pager(page, view.pages, 'cart:prices').length ? [pager(page, view.pages, 'cart:prices')] : []),
    [key('🔙 بازگشت به سبد', 'cart')],
  ]);
}
export function upsellPage(items, data, page = 1) {
  if (!items.length) return card('ابتدا محصولی به سبد اضافه کنید.', [
    [key('📦 انتخاب محصول', 'products:1')],
  ]);
  const list = suggestions(items, data);
  if (!list.length) return card('💡 پیشنهاد تأییدشده دیگری برای این ترکیب یافت نشد.', [
    [key('🔙 بازگشت به سبد', 'cart')],
  ]);
  const view = paginate(list, page);
  if (!view) return card('این صفحه در دسترس نیست.');
  const lines = ['💡 پیشنهادهای افزایش تخفیف'];
  for (const x of view.items) {
    lines.push('🏷 ' + x.plan.plan_name + ' — ' + fmt(x.plan.discount_percent) + '٪');
    lines.push('اضافه کنید: ' + x.adds.map(a => fmt(a.packs) + ' بسته ' +
      (groupNames[a.group_id] || 'از گروه مجاز')).join(' + '));
  }
  lines.push('درصد بیشتر لزوماً فاکتور ارزان‌تر نیست؛ شرایط نهایی در سبد بررسی می‌شود.');
  return card(lines.join('\n'), [
    ...(pager(page, view.pages, 'suggest').length ? [pager(page, view.pages, 'suggest')] : []),
    [key('📦 انتخاب محصول', 'products:1'), key('🔙 سبد خرید', 'cart')],
  ]);
}
