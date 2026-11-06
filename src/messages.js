/**
 * The public bot only displays fixed, publishable interface copy until a
 * separately reviewed and authorized publication source is connected.
 */
export const CUSTOMER_KEYBOARD = {
  keyboard: [
    [{ text: '📦 محصولات' }, { text: '🏷 طرح‌های عمومی' }],
    [{ text: '🧮 محاسبه قیمت' }, { text: 'ℹ️ راهنما' }],
  ],
  resize_keyboard: true,
};

const TEXT = Object.freeze({
  welcome: 'به دستیار فروش خوشگوار خوش آمدید!\n\nاینجا می‌توانید پس از انتشار رسمی اطلاعات مجاز، محصولات و طرح‌های عمومی را ببینید و قیمت خرید را محاسبه کنید.\n\nدر حال حاضر هیچ قیمت یا طرحی برای نمایش عمومی فعال نشده است.',
  products: 'هنوز کاتالوگ تأییدشده‌ای برای نمایش عمومی منتشر نشده است.',
  offers: 'در حال حاضر طرح فروش معتبر و تأییدشده‌ای برای نمایش عمومی موجود نیست.',
  pricing: 'محاسبه قیمت پس از ثبت قیمت پایه و قوانین طرحِ تأییدشده فعال می‌شود. فعلاً مبلغی نمایش داده نمی‌شود.',
  help: 'از دکمه‌های منو برای مشاهده محصولات، طرح‌های عمومی یا محاسبه قیمت استفاده کنید. محتوای تأییدنشده نمایش داده نمی‌شود.',
  adminDenied: 'این بخش در دسترس نیست.',
  adminPending: 'هویت مدیر تأیید شد. امکانات مدیریت هنوز فعال نشده‌اند؛ هیچ داده داخلی در این نسخه قابل دریافت یا ویرایش نیست.',
});

export function isAuthorizedAdmin(message, env) {
  const adminId = env.ADMIN_TELEGRAM_USER_ID;
  return (
    typeof adminId === 'string' &&
    /^[1-9][0-9]*$/.test(adminId) &&
    message.chat?.type === 'private' &&
    Number.isSafeInteger(message.from?.id) &&
    String(message.from.id) === adminId
  );
}

export function publicReply(message, env) {
  const content = typeof message.text === 'string' ? message.text.trim() : '';
  let text;
  switch (content) {
    case '/start':
    case '/help':
      text = TEXT.welcome;
      break;
    case '📦 محصولات':
      text = TEXT.products;
      break;
    case '🏷 طرح‌های عمومی':
      text = TEXT.offers;
      break;
    case '🧮 محاسبه قیمت':
      text = TEXT.pricing;
      break;
    case '/admin':
      text = isAuthorizedAdmin(message, env) ? TEXT.adminPending : TEXT.adminDenied;
      break;
    default:
      text = TEXT.help;
  }
  return { text, reply_markup: CUSTOMER_KEYBOARD };
}
