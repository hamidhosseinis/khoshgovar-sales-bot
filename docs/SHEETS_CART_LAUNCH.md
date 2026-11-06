# راه‌اندازی سبد هوشمند — انتشار کنترل‌شده

## وضعیت این تغییر
- کد اتصال زنده Google Sheets، سبد خرید D1، ارزیابی طرح‌های دقیق و پیشنهاد تکمیل سبد در مخزن آماده است.
- عکس و ارسال تصویر عمداً در این نسخه وجود ندارد.
- وجود کد به معنی فعال بودن بات تلگرام یا منتشر شدن طرح‌ها نیست.
- هر ردیف با مجوز انتشار FALSE، وضعیت DRAFT یا تاریخ اعتبار نامشخص محرمانه می‌ماند.
- اتصال به Google Sheets به معنی انتشار خودکار همه ردیف‌ها نیست.

## اتصال Google Sheets در Cloudflare
1. یک Service Account فقط با دسترسی خواندن Google Sheets ایجاد کنید. کلید JSON آن را خارج از GitHub/گفتگو، در Cloudflare Worker Secret با نام GOOGLE_SERVICE_ACCOUNT_JSON ثبت کنید.
2. ایمیل Service Account را با دسترسی Viewer فقط به شیت «Khoshgovar Sales Database» بدهید.
3. SALES_SPREADSHEET_ID را به عنوان متغیر Worker (نه secret) با شناسه واقعی شیت پیکربندی کنید.
4. ساختار تب‌ها: Products، Discount_Plans، Product_Plans، Plan_Requirements، Plan_Discount_Targets. هدرهای موجود قرارداد API هستند.
5. Worker فقط scope خواندن Google Sheets می‌گیرد، هر ۶۰ ثانیه اطلاعات عمومی معتبر را دوباره می‌خواند و در صورت خطای دسترسی، اطلاعات قدیمی را منتشر نمی‌کند.
6. تغییر واقعی در شیت پس از حداکثر ۶۰ ثانیه قابل مشاهده است، تنها اگر تمام مجوزها و شروط تاریخ اعتبار آن معتبر باشند.

## ضوابط انتشار
- Products: publish_status=PUBLISHED و approved_for_public=TRUE (برای شرکت در طرح، group_verified=TRUE و group_id معتبر نیز لازم است).
- Discount_Plans: is_active=TRUE، approved_for_public=TRUE، review_status=APPROVED، و valid_from/valid_to روزهای میلادی معتبر، بازه شامل تاریخ جاری.
- Product_Plans: برای هر محصول و طرح هر دو فیلد is_active و approved_for_public برابر TRUE.
- وضعیت‌های فوق تنها پس از بازبینی انسانی، تعیین منطقه/اعتبار، و مجوز صریح ناشر تغییر داده شوند.
- قیمت خرید نهایی: بدون base_price_irr معتبر و base_price_basis=PACK_WITH_TAX برای همه اقلام، و نیز تأیید کامل سیاست شرکت، اعلام نمی‌شود. پس از تأیید مالیات، مبنای واحد و گردکردن، PRICE_POLICY_APPROVED=true و ROUNDING_RULE=HALF_UP_IRR تنظیم شود. این مقادیر فعلاً فعال نشوند.
- عدم تخصیص پاره‌ای از سفارش به مضرب‌ها و عدم هم‌پوشانی تخفیف روی یک بسته عمدی است. چند طرح روی بسته‌های مستقل هنوز تأیید نشده‌اند.

## D1
پایگاه khoshgovar-sales-cart باید با binding CART_DB در Worker اتصال داشته باشد. جدول لازم:
CREATE TABLE IF NOT EXISTS cart_items (chat_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty>0 AND qty<=10000), PRIMARY KEY(chat_id,product_id));

جدول تنها Telegram chat id و شناسه محصول و تعداد نگهداری می‌کند.

## Telegram
- TELEGRAM_BOT_TOKEN (توکن تازه و چرخش‌داده‌شده) و TELEGRAM_WEBHOOK_SECRET در Cloudflare Secrets باشند.
- بعد از اطمینان از Worker فعال روی host عمومی، به صورت امن setWebhook تلگرام با مسیر /telegram/webhook، Secret token و allowed_updates=["message"] فراخوانی شود.
- هرگز توکن را در پیام یا PR قرار ندهید. تست آماده بودن را با /health انجام دهید؛ /health تنها وجود Worker را اثبات می‌کند، نه اتصال تلگرام.
- /start، /products، /plans، /add P001 1، /remove P001 1، /cart، /clear، /suggest قابل استفاده‌اند.
- عکس و اتصالات Google Drive product image فعلاً غیرفعال‌اند.

## آزمون‌ها
npm test کنترل محرمانگی، پله‌های ۴+۱/۸+۲، ۱۰n+۳n، ۱۰n+۵n، حداقل ۱۱ بسته، پیشنهادی ۱۰ کانادا → ۵ لیموناد، و منع خروج قیمت نهایی بدون مبنای تأییدشده را بررسی می‌کند.
