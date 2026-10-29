## 3.3.20
- Fixed the balance history panel sizing so it fills the balance card rather than inheriting the card content column's max-width.
- Replaced the corner dot with an animated yellow triangular marker and a pulsing triangular halo.
- Kept the history panel above the card artwork/content and preserved the existing card dimensions.

# Changelog

## 3.3.19
- Added a local daily main-account balance ledger (one row per Tehran calendar day; refreshes update today's row instead of duplicating it).
- Added a compact theme-matched sparkline, opened from the pulsing yellow corner of the main balance card.
- Kept up to 730 daily balance points; the chart shows the latest 30 days.

## 3.3.17
- Replaced potentially overlapping Jalali month names with compact Persian month numbers on a single aligned baseline. Full month names remain available as hover titles and accessible labels.

# Changelog

## 3.3.15
- Aligned Jalali month labels with the heatmap day columns by accounting for the weekday-label gutter; the fix is shared by Popup and Side Panel.


## 3.3.14
- Added a compact Persian/Jalali activity heatmap to the footer of “تحلیل مصرف و تاریخچه قیمت”.
- Cell fill intensity represents the number of saved consumption-analysis snapshots per day.
- Yellow cell borders indicate a recorded price change between catalog snapshots.
- Added Persian date tooltips and a compact legend; existing analytics and exports remain unchanged.

- Moved the balance SIM artwork upward by setting `bottom: -10px` in Popup and Side Panel.
- Blurred account values by default; hovering/focusing an account row reveals them.

## 3.3.6
- Calculate active package unit price by matching it to a similar offer in the offers catalog when the active package API omits price.
- Cache the normalized catalog offer list with dashboard data so matching works after reopening the popup/side panel.
- Show a clear message only when no sufficiently similar catalog offer can be matched.

# تغییرات

## 3.3.0 — تحلیل مصرف تفکیک‌شده بر اساس نوع بسته و ساعت مجاز
- حذف پیش‌بینی مصرف بر پایه جمع مانده همه بسته‌ها؛ جمع کل فقط برای نمایش/تاریخچه نگه داشته می‌شود.
- تفکیک بسته‌های عادی و شبانه بر اساس نام بسته و استخراج پنجره زمانی صریح از عنوان‌هایی مانند «۲ تا ۷ صبح».
- محاسبه مستقل مانده، نرخ مصرف و تخمین زمان اتمام برای بسته‌های عادی و هر گروه بسته شبانه با پنجره زمانی یکسان.
- محاسبه مصرف شبانه با هم‌پوشانی واقعی بازه نمونه‌ها با ساعات مجاز در ساعت ایران؛ برای مثال ۰۲:۰۰ تا ۰۷:۰۰ برابر ۵ ساعت مصرف مجاز در شب.
- وقتی بازه شبانه در عنوان مشخص نیست، پیش‌بینی شبانه و پیش‌بینی ساعات عادی که ممکن است با آن تداخل داشته باشد متوقف می‌شود؛ ساعت به‌صورت حدسی تعیین نمی‌شود.
- جلوگیری از نسبت‌دادن کاهش حجم عادی به ساعات خارج از پنجره عادی در نمونه‌هایی که بازه زمانی‌شان از مرز شبانه عبور می‌کند.
- جلوگیری از استفاده از `global_data_remaining` به‌عنوان مانده هر بسته؛ این فیلد ممکن است کلی باشد و نباید روی چند بسته تکثیر شود.
- افزودن مهاجرت schema که مانده‌های قدیمیِ بدون منشأ تأییدشده را نامشخص می‌کند، به‌جای حفظ تقسیم‌بندی بالقوه اشتباه؛ نام و اطلاعات بسته‌ها و تاریخچه حفظ می‌شوند.
- تفکیک هشدار کمبود حجم برای هر گروه به‌جای مقایسه درصد ماندهٔ جمع‌شده همه بسته‌ها.
- بازطراحی تحلیل در popup و side panel با کارت‌های مستقل، بودجه تا انقضا و نمایش علت نبود تخمین.
- گسترش خروجی CSV تا نرخ‌ها و مانده‌های عادی/شبانه در ستون‌های مستقل صادر شوند.
- سازگاری نمایشی با تاریخچه نسخه قبلی؛ برای پیش‌بینی باید بعد از ارتقا نمونه‌های جدید جمع‌آوری شوند.
- افزودن تست‌های پنجره زمانی، هم‌پوشانی ساعت ایران، تفکیک نرخ و شمارش شب‌های مجاز.

## 3.2.0 — سخت‌سازی شبکه و حریم خصوصی
- نمایش stale-while-revalidate: ابتدا داده ذخیره‌شده نمایش داده می‌شود؛ داده حساب فقط پس از گذشت ۵ دقیقه به‌طور خودکار تازه‌سازی می‌شود.
- کش کاتالوگ بسته‌ها با مهلت ۲۴ ساعت؛ درخواست حساب در صورت نیاز جداگانه به‌روز می‌شود. در صورت شکست تازه‌سازی کاتالوگ، تا ۱۰ دقیقه از تکرار درخواست ناموفق جلوگیری می‌شود.
- توکن به‌صورت پیش‌فرض در `chrome.storage.session` نگهداری می‌شود؛ حالت ذخیره ماندگار اختیاری است.
- capture نشست در `ISOLATED` world، بلوکه‌کردن توکن ردشده پس از 401 و توقف polling تا ورود مجدد.
- درخواست‌های حساب قبل از پروفایل و کاتالوگ انجام می‌شوند تا در حالت نشست نامعتبر، درخواست‌های غیرضروری اجرا نشوند.
- retry محدود با backoff نمایی و jitter و احترام محدود به `Retry-After`.
- تاریخچه ارسال‌شده به UI به ۹۶ نمونه محدود شده، اما خروجی CSV کل تاریخچه را حفظ می‌کند.
- صف نوشتن برای تاریخچه، کنترل پاک‌سازی هم‌زمان، schema version و استفاده واقعی از timestamp آخرین دریافت.
- بودجه مصرف روزانه بر مبنای انقضای هر بسته، مدت اعتبار پیشنهادها و تاریخ شمسی در CSV.
- حذف MutationObserver سراسری و رندر مجدد آیکون در هر تغییر وضعیت؛ افزودن `storage.onChanged` برای تازه‌شدن سایدبار.
- دسترس‌پذیری کاروسل (inert/aria-hidden) و یک نشان بصری مستقل که از لوگوی تقلیدی اپراتور استفاده نمی‌کند.
- اعتبارسنجی سخت‌گیرانه‌تر ساختار فیلدهای مهم API، با پذیرش `active_offers: null` به‌عنوان نبود بسته فعال.
- سیاست حریم خصوصی و تست‌های اضافه برای کش، نشست، backoff و وضعیت polling.

## 3.1.0
- افزودن داشبورد Side Panel در کنار پنجره کوچک قبلی.
- حفظ قابلیت‌های نسخه 3.0.0 و اشتراک منطق رابط میان popup و side panel.

## 3.0.0
- جداسازی منطق قابل‌آزمون، مدیریت خطا، تاریخچه، CSV و سخت‌سازی محاسبات پایه.


## 3.3.1 — UI polish
- Refined dark theme, card hierarchy, spacing, contrast, and interactive states.
- Added subtle edge fade and consistent rounding to the balance illustration.
- Corrected active-package progress fill to represent the displayed consumed percentage.
- Kept existing DOM IDs, API logic, settings, and interactions intact.


## 3.3.4 — Active package priority pin
- Added a pin control to each active internet package in Popup and Side Panel.
- A pinned package moves to the first carousel position and remains prioritized after refresh/reopen.
- Pin preference is stored separately in `chrome.storage.local`; click the active pin again to unpin.


## 3.3.5
- Moved the last successful fetch timestamp into the balance card and removed the duplicate footer metadata.
- Added per-GB price to active package cards when a valid package price is present in the active-offer API payload.
- Shows an explicit unavailable message rather than inventing a unit price when the API does not include price.
