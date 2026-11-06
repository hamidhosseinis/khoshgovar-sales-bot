import { PUBLIC_PRODUCT } from './public-catalog.js';

/**
 * Public messages use ONLY a whitelisted, approved catalog. Draft/internal
 * records must never be imported into this module or sent to customers.
 */
export const CUSTOMER_KEYBOARD = {
  keyboard: [
    [{ text: '📦 محصولات' }, { text: '🏷 طرح‌های عمومی' }],
    [{ text: '🧮 محاسبه قیمت' }, { text: 'ℹ️ راهنما' }],
  ],
  resize_keyboard: true,
};

const formatIRR = (n) => n.toLocaleString('fa-IR') + ' ریال';
const basisNote = 'توجه: مبنای واحد مبلغ (هر بطری یا هر بسته) هنوز تعیین نشده است؛ از این ارقام برای محاسبه تعداد استفاده نشود.';
const dateNote = 'تاریخ اعتبار و محدوده اجرای طرح‌ها اعلام نشده‌اند؛ پیش از سفارش استعلام کنید.';

function publicProductText() {
  if (!PUBLIC_PRODUCT.publication.approvedForPublicDisplay) return 'محصول تأییدشده‌ای برای نمایش موجود نیست.';
  return [
    '📦 ' + PUBLIC_PRODUCT.name,
    'طعم‌ها: ' + PUBLIC_PRODUCT.flavors.join(' و '),
    'تعداد در بسته: ' + PUBLIC_PRODUCT.unitsPerCase.toLocaleString('fa-IR') + ' عدد',
    'مدت مصرف اعلام‌شده: ' + PUBLIC_PRODUCT.shelfLifeMonths.toLocaleString('fa-IR') + ' ماه',
    'قیمت مصرف‌کننده (مبلغ اعلام‌شده): ' + formatIRR(PUBLIC_PRODUCT.consumerPriceIRR),
    basisNote,
    '📷 مشاهده تصویر محصول: ' + PUBLIC_PRODUCT.imageViewUrl,
  ].join('\n');
}

function publicOffersText() {
  if (!PUBLIC_PRODUCT.publication.approvedForPublicDisplay) return 'طرح تأییدشده‌ای برای نمایش موجود نیست.';
  return [
    '🏷 طرح‌های عمومی ' + PUBLIC_PRODUCT.name,
    ...PUBLIC_PRODUCT.offers.map((offer) => [
      offer.name + ' — ' + offer.discountLabel,
      'قیمت خرید اعلام‌شده با مالیات: ' + formatIRR(offer.finalBuyerPriceIncludesTaxIRR),
      'شرایط: ' + offer.condition,
    ].join('\n')),
    basisNote,
    dateNote,
  ].join('\n\n');
}

const TEXT = Object.freeze({
  welcome: 'به دستیار فروش خوشگوار خوش آمدید!\n\nبرای مشاهده نوشابه نوستالژیک و طرح‌های اعلام‌شده از دکمه‌های منو استفاده کنید. مبنای قیمت هنوز تعیین نشده و محاسبه خودکار قیمت فعال نیست.',
  pricing: 'قیمت‌های اعلام‌شده در بخش «طرح‌های عمومی» قابل مشاهده‌اند؛ چون مبنای واحد قیمت تعیین نشده است، محاسبه خودکار یا مبلغ سفارش انجام نمی‌شود.',
  help: 'از دکمه‌های منو برای مشاهده مشخصات محصول و قیمت‌های اعلام‌شده استفاده کنید. اطلاعات قیمت بدون مبنای واحد یا محاسبه سفارش ارائه می‌شوند.',
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
      text = publicProductText();
      break;
    case '🏷 طرح‌های عمومی':
      text = publicOffersText();
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
