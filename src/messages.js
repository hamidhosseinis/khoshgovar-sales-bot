import { MAIN_KEYBOARD } from './bot-ui.js';

// Only fixed public copy is returned until an authorized catalog is connected.
export const CUSTOMER_KEYBOARD = MAIN_KEYBOARD;

const TEXT = Object.freeze({
  welcome: '🥤 به دستیار فروش خوشگوار خوش آمدید.\nاز منوی پایین، بخش موردنظر را انتخاب کنید.\nفعلاً اطلاعات تأییدشده‌ای برای انتشار فعال نیست.',
  products: '📦 هنوز کاتالوگ تأییدشده‌ای برای نمایش عمومی منتشر نشده است.',
  offers: '🏷 فعلاً طرح فروش معتبر و تأییدشده‌ای منتشر نشده است.',
  pricing: '💰 محاسبه قیمت پس از تأیید مبنا و قوانین فروش فعال می‌شود.\nفعلاً مبلغی نمایش داده نمی‌شود.',
  cart: '🛒 سبد خرید فعلاً در دسترس نیست.',
  help: 'از دکمه‌های منو استفاده کنید.\nفقط اطلاعات دارای مجوز انتشار نمایش داده می‌شود.',
  adminDenied: 'این بخش در دسترس نیست.',
  adminPending: 'هویت مدیر تأیید شد. امکانات مدیریت هنوز فعال نشده‌اند؛ هیچ داده داخلی در این نسخه قابل دریافت یا ویرایش نیست.',
});
export function isAuthorizedAdmin(message, env) {
  const adminId = env.ADMIN_TELEGRAM_USER_ID;
  return typeof adminId === 'string' && /^[1-9][0-9]*$/.test(adminId) &&
    message.chat?.type === 'private' && Number.isSafeInteger(message.from?.id) &&
    String(message.from.id) === adminId;
}
export function publicReply(message, env) {
  const content = typeof message.text === 'string' ? message.text.trim() : '';
  let text = TEXT.help;
  switch (content) {
    case '/start':
    case '/help':
      text = TEXT.welcome; break;
    case '📦 محصولات':
      text = TEXT.products; break;
    case '🏷 طرح‌های فروش':
    case '🏷 طرح‌های عمومی':
      text = TEXT.offers; break;
    case '💰 لیست قیمت':
    case '💰 قیمت‌ها':
    case '🧮 محاسبه قیمت':
      text = TEXT.pricing; break;
    case '🛒 سبد خرید':
      text = TEXT.cart; break;
    case '/admin':
      text = isAuthorizedAdmin(message, env) ? TEXT.adminPending : TEXT.adminDenied; break;
  }
  return { text, reply_markup: CUSTOMER_KEYBOARD };
}
