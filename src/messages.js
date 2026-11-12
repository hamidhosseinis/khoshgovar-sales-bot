import { mainMenu } from './bot-ui.js';

// Only fixed public copy is returned until an authorized catalog is connected.
export const CUSTOMER_KEYBOARD = mainMenu().reply_markup;

const TEXT = Object.freeze({
  welcome: '🥤 به دستیار فروش خوشگوار خوش آمدید.\nاز دکمه‌های شیشه‌ای پیام استفاده کنید.\nفعلاً اطلاعات تأییدشده‌ای برای انتشار فعال نیست.',
  products: '📦 هنوز کاتالوگ تأییدشده‌ای برای نمایش عمومی منتشر نشده است.',
  offers: '🏷 فعلاً طرح فروش معتبر و تأییدشده‌ای منتشر نشده است.',
  pricing: '💰 محاسبه قیمت پس از تأیید مبنا و قوانین فروش فعال می‌شود.\nفعلاً مبلغی نمایش داده نمی‌شود.',
  help: 'از دکمه‌های شیشه‌ای پیام استفاده کنید.\nفقط اطلاعات دارای مجوز انتشار نمایش داده می‌شود.',
  adminDenied: 'این بخش در دسترس نیست.',
  adminPending: 'هویت مدیر تأیید شد. امکانات مدیریت هنوز فعال نشده‌اند؛ هیچ داده داخلی در این نسخه قابل دریافت یا ویرایش نیست.',
});
// The numeric Telegram user ID must be configured server-side; usernames are
// mutable and cannot serve as authorization. Missing/invalid configuration
// denies EVERYONE, including requests for the public catalog.
export function hasConfiguredOwner(env) {
  const ownerId = env?.ADMIN_TELEGRAM_USER_ID;
  return typeof ownerId === 'string' && /^[1-9][0-9]*$/.test(ownerId) &&
    Number.isSafeInteger(Number(ownerId));
}
export function isAuthorizedOwner(user, env) {
  return hasConfiguredOwner(env) && Number.isSafeInteger(user?.id) &&
    user.id === Number(env.ADMIN_TELEGRAM_USER_ID);
}
export function isAuthorizedAdmin(message, env) {
  return message?.chat?.type === 'private' && isAuthorizedOwner(message?.from, env);
}
export function publicReply(message, env) {
  const content = typeof message.text === 'string' ? message.text.trim() : '';
  let text = TEXT.help;
  switch (content) {
    case '/start':
    case '/help':
    case '/menu':
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
    case '/admin':
      text = isAuthorizedAdmin(message, env) ? TEXT.adminPending : TEXT.adminDenied; break;
  }
  return { text, reply_markup: CUSTOMER_KEYBOARD };
}
