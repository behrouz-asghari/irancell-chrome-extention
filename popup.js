// Convert Latin digits to Persian digits for display only.
function toPersianDigits(value) {
  return String(value).replace(/[0-9]/g, digit => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}


// Confirm the bundled font is loaded; useful for troubleshooting popup rendering.
document.fonts.load('16px "Vazirmatn"').then((faces) => {
  console.info("[Irancell Yaar UI] Vazirmatn font loaded:", faces.length > 0,
    "status:", document.fonts.check('16px "Vazirmatn"'));
}).catch((error) => {
  console.error("[Irancell Yaar UI] Vazirmatn font load failed:", error);
});

const $ = (id) => document.getElementById(id);
let remainingProgressEnabled = false;

// Clicking the SIM artwork opens the account details accordion and brings it into view.
document.querySelectorAll(".balance-card .balance-sim-icon").forEach((image) => {
  image.setAttribute("role", "button");
  image.setAttribute("tabindex", "0");
  image.setAttribute("aria-label", "نمایش اطلاعات حساب");
  image.title = "نمایش اطلاعات حساب";

  const openAccountDetails = () => {
    const accountSection = document.querySelector(".accordion-section.account-section");
    if (!accountSection) return;
    accountSection.open = true;
    accountSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const summary = accountSection.querySelector("summary");
    summary?.focus({ preventScroll: true });
  };

  image.addEventListener("click", openAccountDetails);
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAccountDetails();
    }
  });
});

function applyProgressDisplayMode(enabled = remainingProgressEnabled) {
  remainingProgressEnabled = enabled === true;
  document.querySelectorAll(".package-slide").forEach((slide) => {
    const bar = slide.querySelector(".progress-bar");
    const label = slide.querySelector(".used-percent");
    if (!bar || !label || bar.dataset.hasRemaining !== "true") return;
    const used = Number(bar.dataset.usedPct);
    const remaining = Math.max(0, Math.min(100, 100 - used));
    const value = remainingProgressEnabled ? remaining : used;
    bar.style.width = `${value}%`;
    label.textContent = remainingProgressEnabled
      ? `${formatNumber(remaining, 1)}٪ باقی‌مانده`
      : `${formatNumber(used, 1)}٪ مصرف شده`;
  });
}

function setStatus(message, kind = "") {
  const el = $("status");
  el.textContent = message;
  el.className = `status ${kind}`.trim();
  el.setAttribute("role", kind === "error" ? "alert" : "status");
}
function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits }).format(value);
}
function mbToGb(mb) { return mb / 1024; }
function formatDate(value) {
  if (!value) return "تاریخ انقضا ثبت نشده";
  const timestamp = globalThis.IrancellCore?.parseApiDate(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran", year: "numeric", month: "short", day: "numeric"
  }).format(date);
}
function showLoginHelp(show) {
  $("login-help").classList.toggle("hidden", !show);
}

function displayAccountProfile(profile) {
  $("account-name").textContent = [profile?.first_name, profile?.last_name]
    .filter(Boolean).join(" ") || "ثبت نشده";
  $("account-type").textContent =
    profile?.customer_type === "prepaid" ? "اعتباری" :
    profile?.customer_type === "postpaid" ? "دائمی" :
    profile?.customer_type || "ثبت نشده";
  $("account-email").textContent = profile?.email || "ثبت نشده";
  $("account-activation").textContent = profile?.activation_date
    ? formatDate(profile.activation_date)
    : "ثبت نشده";
  const active = profile?.operation_status === "active";
  $("account-state").textContent = active ? "فعال" :
    profile?.operation_status || "وضعیت نامشخص";
  $("account-state").classList.toggle("inactive", !active);
}


let bestOfferSlides = [];
let bestOfferIndex = 0;

function renderCheapestOffer(offers) {
  const track = $("best-offer-track");
  const prototype = track.querySelector(".best-offer-slide");
  track.replaceChildren();
  bestOfferSlides = [];
  bestOfferIndex = 0;
  const entries = [
    { kind: "شبانه", offer: offers?.night },
    { kind: "عادی", offer: offers?.normal }
  ];
  entries.forEach(({kind, offer}) => {
    const slide = prototype.cloneNode(true);
    slide.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    slide.querySelector("h2").textContent = offer
      ? toPersianDigits(offer.title || offer.name || offer.description || offer.offer_name || offer.display_name || "بسته اینترنت")
      : `بسته ${kind} در کاتالوگ پیدا نشد`;
    const validity = slide.querySelector(".best-offer-validity");
    if (validity) {
      const duration = Number(offer?.duration);
      const unit = String(offer?.duration_unit || "").toLowerCase();
      const units = { day: "روز", days: "روز", week: "هفته", weeks: "هفته", month: "ماه", months: "ماه", hour: "ساعت", hours: "ساعت" };
      validity.textContent = offer && Number.isFinite(duration) && duration > 0
        ? `مدت اعتبار: ${formatNumber(duration, 0)} ${units[unit] || unit || "واحد نامشخص"}`
        : "مدت اعتبار در API مشخص نشده است";
    }
    const metrics = slide.querySelectorAll(".best-offer-metrics strong");
    if (offer) {
      const volumeGb = Number(offer.volume) / 1024;
      metrics[0].textContent = formatNumber(Number(offer.price) / 10, 0);
      metrics[1].textContent = `${formatNumber(volumeGb, 2)} GB`;
      metrics[2].textContent = formatNumber(Number(offer.pricePerGb) / 10, 0);
    } else {
      metrics.forEach(el => el.textContent = "—");
    }
    slide.dataset.kind = kind;
    track.appendChild(slide);
    bestOfferSlides.push({kind, offer, slide});
  });
  renderBestOfferDots();
  updateBestOfferCarousel();
}

function renderBestOfferDots() {
  const dots = $("best-offer-dots");
  dots.replaceChildren();
  bestOfferSlides.forEach(({kind}, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "package-dot";
    dot.setAttribute("aria-label", `نمایش بسته ${kind}`);
    dot.addEventListener("click", () => {
      bestOfferIndex = index;
      updateBestOfferCarousel();
    });
    dots.appendChild(dot);
  });
}

function updateBestOfferCarousel() {
  $("best-offer-track").style.transform = `translateX(${bestOfferIndex * 100}%)`;
  $("best-offer-kind").textContent = `بسته ${bestOfferSlides[bestOfferIndex]?.kind || "اینترنت"}`;
  bestOfferSlides.forEach(({ slide }, i) => {
    const inactive = i !== bestOfferIndex;
    slide.setAttribute("aria-hidden", String(inactive));
    slide.toggleAttribute("inert", inactive);
  });
  $("best-offer-dots").querySelectorAll(".package-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === bestOfferIndex);
    dot.setAttribute("aria-current", i === bestOfferIndex ? "true" : "false");
  });
}
$("best-offer-prev").addEventListener("click", () => {
  if (!bestOfferSlides.length) return;
  bestOfferIndex = (bestOfferIndex - 1 + bestOfferSlides.length) % bestOfferSlides.length;
  updateBestOfferCarousel();
});
$("best-offer-next").addEventListener("click", () => {
  if (!bestOfferSlides.length) return;
  bestOfferIndex = (bestOfferIndex + 1) % bestOfferSlides.length;
  updateBestOfferCarousel();
});
let bestOfferTouchStartX = null;
$("best-offer-viewport").addEventListener("touchstart", e => {
  bestOfferTouchStartX = e.changedTouches[0]?.clientX ?? null;
}, {passive:true});
$("best-offer-viewport").addEventListener("touchend", e => {
  if (bestOfferTouchStartX == null) return;
  const delta = e.changedTouches[0].clientX - bestOfferTouchStartX;
  if (Math.abs(delta) > 35) {
    bestOfferIndex = (bestOfferIndex + (delta < 0 ? 1 : -1) + bestOfferSlides.length) % bestOfferSlides.length;
    updateBestOfferCarousel();
  }
  bestOfferTouchStartX = null;
}, {passive:true});

let packageSlides = [];
let packageIndex = 0;
let packageTouchStartX = null;
let packageOffers = [];
let pinnedActivePackageKey = null;
const PINNED_PACKAGE_STORAGE_KEY = "irancellPinnedActivePackage";

function activePackageKey(offer) {
  const id = offer?.id ?? offer?.offer_id ?? offer?.package_id ?? offer?.product_id ?? offer?.code ?? offer?.service_id;
  if (id != null && String(id).trim()) return `id:${String(id).trim()}`;
  // Fallback to stable package attributes when the API does not expose an ID.
  return `pkg:${JSON.stringify([
    String(offer?.name ?? offer?.title ?? offer?.description ?? "").trim(),
    String(offer?.total_amount ?? ""),
    String(offer?.expiry_date ?? ""),
    String(offer?.type ?? "")
  ])}`;
}

async function savePinnedActivePackage(key) {
  pinnedActivePackageKey = key;
  try {
    await chrome.storage.local.set({ [PINNED_PACKAGE_STORAGE_KEY]: key });
  } catch (error) {
    console.warn("Could not save pinned active package:", error?.message || "unknown error");
  }
  renderPackageCarousel(packageOffers);
}


function normalizeOfferMatchText(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function offerNameTokens(value) {
  const ignored = new Set(["بسته", "اینترنت", "گیگابایت", "گیگ", "مگابایت", "روز", "روزه", "ساعت", "ساعته", "با", "از", "تا", "برای"]);
  return normalizeOfferMatchText(value).split(/\s+/).filter(token => token.length > 1 && !ignored.has(token));
}
function isNightPackageName(value) {
  return /شبانه|شب\b|۲\s*تا\s*۶|2\s*تا\s*6|۲\s*تا\s*۱۲|2\s*تا\s*12|00:00|۰۲:۰۰|02:00/i.test(normalizeOfferMatchText(value));
}
function findCatalogMatchForActivePackage(activeOffer, totalAmount, catalogOffers) {
  const activeName = activeOffer?.name || activeOffer?.title || "";
  const activeTokens = offerNameTokens(activeName);
  const activeVolume = Number(totalAmount);
  if (!(activeVolume > 0) || !Array.isArray(catalogOffers) || !catalogOffers.length) return null;
  const activeNight = isNightPackageName(activeName);
  const candidates = catalogOffers.map(item => {
    const price = Number(item?.price);
    const volume = Number(item?.volume);
    if (!(price > 0) || !(volume > 0)) return null;
    const volumeDelta = Math.abs(volume - activeVolume) / Math.max(volume, activeVolume);
    if (volumeDelta > 0.035) return null;
    const tokens = offerNameTokens(item.title || item.name || "");
    const overlap = activeTokens.length
      ? activeTokens.filter(token => tokens.includes(token)).length / Math.max(1, Math.min(activeTokens.length, tokens.length))
      : 0;
    const nightMismatch = activeNight !== (item.isNight === true);
    // A near-identical volume alone is not enough: require some name similarity,
    // or an exact-volume match with the same day/night category.
    if (overlap < 0.25 && (volumeDelta > 0.005 || nightMismatch)) return null;
    const score = overlap * 3 - volumeDelta * 10 - (nightMismatch ? 0.75 : 0);
    return { item, score, volumeDelta, overlap };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return candidates[0]?.item || null;
}
function renderPackageCarousel(offers, catalogOffers = []) {
  // Keep the API's original order separately so unpinning restores it.
  packageOffers = Array.isArray(offers) ? [...offers] : [];
  const orderedOffers = [...packageOffers];
  const pinnedIndex = pinnedActivePackageKey
    ? orderedOffers.findIndex(offer => activePackageKey(offer) === pinnedActivePackageKey)
    : -1;
  if (pinnedIndex > 0) {
    const [pinnedOffer] = orderedOffers.splice(pinnedIndex, 1);
    orderedOffers.unshift(pinnedOffer);
  }
  offers = orderedOffers;
  const track = $("package-track");
  const viewport = $("package-viewport");
  const prototype = track.querySelector(".package-slide");
  track.replaceChildren();
  packageSlides = [];
  packageIndex = 0;

  if (!offers.length) {
    const slide = prototype.cloneNode(true);
    slide.querySelector(".package-name").textContent = "بسته اینترنت فعالی پیدا نشد";
    slide.querySelector(".remaining").textContent = "—";
    slide.querySelector(".total").textContent = "—";
    slide.querySelector(".progress-bar").style.width = "0%";
    slide.querySelector(".used-percent").textContent = "اطلاعات مصرف موجود نیست";
    slide.querySelector(".expiry").textContent = "";
    slide.querySelector(".package-state").textContent = "بدون بسته";
    track.appendChild(slide);
    packageSlides = [];
  } else {
    offers.forEach((offer, index) => {
      const slide = prototype.cloneNode(true);
      slide.setAttribute("aria-label", `بسته ${index + 1}`);
      const total = globalThis.IrancellCore?.readNumber(offer.total_amount) ?? 0;
      // Only display a package-specific remaining balance. A global account
      // balance must not be repeated on every active package card.
      const rawRemaining = globalThis.IrancellCore?.getPackageRemainingData(offer)?.value ?? null;
      const hasRemaining = rawRemaining != null && Number.isFinite(rawRemaining) && total > 0;
      const remaining = hasRemaining ? Math.min(total, Math.max(0, rawRemaining)) : null;
      const usedPct = hasRemaining ? Math.min(100, Math.max(0, (total - remaining) / total * 100)) : 0;
      slide.querySelector(".package-name").textContent = toPersianDigits(offer.name || offer.title || "بسته اینترنت");
      const unitPriceEl = slide.querySelector(".active-package-unit-price");
      // Active-offer payloads often omit price. Match the active package to the
      // closest equivalent in the public offers catalog, then calculate toman/GB.
      const directPrice = globalThis.IrancellCore?.readNumber(offer.price);
      const catalogMatch = directPrice > 0
        ? null
        : findCatalogMatchForActivePackage(offer, total, catalogOffers);
      const rawPrice = directPrice > 0 ? directPrice : globalThis.IrancellCore?.readNumber(catalogMatch?.price);
      const volumeGb = total > 0 ? mbToGb(total) : 0;
      if (unitPriceEl) {
        if (rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0 && volumeGb > 0) {
          const tomanPerGb = (rawPrice / 10) / volumeGb;
          unitPriceEl.textContent = `هر گیگ ${formatNumber(tomanPerGb, 0)} تومان`;
          unitPriceEl.classList.remove("is-unavailable");
          unitPriceEl.title = catalogMatch
            ? `قیمت از بسته مشابه در فهرست پیشنهادها محاسبه شده: ${catalogMatch.title || "بسته مشابه"}`
            : "محاسبه بر اساس قیمت ثبت‌شده بسته";
        } else {
          unitPriceEl.textContent = "قیمت بسته مشابه پیدا نشد";
          unitPriceEl.classList.add("is-unavailable");
          unitPriceEl.removeAttribute("title");
        }
      }
      slide.querySelector(".remaining").textContent = hasRemaining ? `${formatNumber(mbToGb(remaining), 2)} GB` : "نامشخص";
      slide.querySelector(".total").textContent = total > 0 ? `${formatNumber(mbToGb(total), 2)} GB` : "نامشخص";
      const progressBar = slide.querySelector(".progress-bar");
      progressBar.dataset.usedPct = String(usedPct);
      progressBar.dataset.hasRemaining = String(hasRemaining);
      progressBar.style.width = hasRemaining
        ? `${remainingProgressEnabled ? 100 - usedPct : usedPct}%`
        : "0%";
      slide.querySelector(".used-percent").textContent = hasRemaining
        ? (remainingProgressEnabled
          ? `${formatNumber(100 - usedPct, 1)}٪ باقی‌مانده`
          : `${formatNumber(usedPct, 1)}٪ مصرف شده`)
        : "اطلاعات مصرف در دسترس نیست";
      slide.querySelector(".expiry").textContent = `انقضا: ${formatDate(offer.expiry_date)}`;
      slide.querySelector(".package-state").textContent = offer.is_gift ? "هدیه" : "فعال";
      const packageKey = activePackageKey(offer);
      const pinButton = slide.querySelector(".package-pin-button");
      const isPinned = packageKey === pinnedActivePackageKey;
      pinButton.classList.toggle("is-pinned", isPinned);
      pinButton.setAttribute("aria-pressed", String(isPinned));
      pinButton.setAttribute("aria-label", isPinned ? "برداشتن اولویت این بسته" : "نمایش این بسته در اولویت اول");
      pinButton.title = isPinned ? "حذف از اولویت اول" : "نمایش در اولویت اول";
      pinButton.addEventListener("click", () => {
        void savePinnedActivePackage(isPinned ? null : packageKey);
      });
      track.appendChild(slide);
      packageSlides.push(slide);
    });
  }
  $("package-prev").disabled = packageSlides.length < 2;
  $("package-next").disabled = packageSlides.length < 2;
  renderPackageDots();
  updatePackageCarousel();
}

function renderPackageDots() {
  const dots = $("package-dots");
  dots.replaceChildren();
  packageSlides.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "package-dot";
    dot.setAttribute("aria-label", `نمایش بسته ${index + 1}`);
    dot.addEventListener("click", () => {
      packageIndex = index;
      updatePackageCarousel();
    });
    dots.appendChild(dot);
  });
}

function updatePackageCarousel() {
  const track = $("package-track");
  track.style.transform = `translateX(${packageIndex * 100}%)`;
  packageSlides.forEach((slide, i) => {
    const inactive = i !== packageIndex;
    slide.setAttribute("aria-hidden", String(inactive));
    slide.toggleAttribute("inert", inactive);
  });
  $("package-counter").textContent = `${formatNumber(packageSlides.length ? packageIndex + 1 : 0, 0)} از ${formatNumber(packageSlides.length, 0)}`;
  $("package-prev").disabled = packageSlides.length < 2;
  $("package-next").disabled = packageSlides.length < 2;
  $("package-dots").querySelectorAll(".package-dot").forEach((dot, index) => {
    dot.classList.toggle("active", index === packageIndex);
    dot.setAttribute("aria-current", index === packageIndex ? "true" : "false");
  });
}

$("package-prev").addEventListener("click", () => {
  if (packageSlides.length > 1) {
    packageIndex = (packageIndex - 1 + packageSlides.length) % packageSlides.length;
    updatePackageCarousel();
  }
});
$("package-next").addEventListener("click", () => {
  if (packageSlides.length > 1) {
    packageIndex = (packageIndex + 1) % packageSlides.length;
    updatePackageCarousel();
  }
});
$("package-viewport").addEventListener("touchstart", event => {
  packageTouchStartX = event.changedTouches[0]?.clientX ?? null;
}, {passive: true});
$("package-viewport").addEventListener("touchend", event => {
  if (packageTouchStartX == null || packageSlides.length < 2) return;
  const delta = event.changedTouches[0].clientX - packageTouchStartX;
  if (Math.abs(delta) > 35) {
    // RTL: swipe left advances to the next package.
    packageIndex = delta < 0
      ? (packageIndex + 1) % packageSlides.length
      : (packageIndex - 1 + packageSlides.length) % packageSlides.length;
    updatePackageCarousel();
  }
  packageTouchStartX = null;
}, {passive: true});

function render(data, profile, cheapestOffer, fetchedAt = Date.now(), catalogOffers = []) {
  $("dashboard").classList.remove("hidden");
  showLoginHelp(false);
  displayAccountProfile(profile);
  renderCheapestOffer(cheapestOffer);

  const balance = globalThis.IrancellCore?.readNumber(data?.main_account_balance);
  // API currency is assumed to be rial based on observed responses; compare with official UI.
  $("balance").textContent = balance != null ? formatNumber(balance / 10, 0) : "نامشخص";
  // The refresh timestamp lives with the balance instead of being repeated in the footer.
  $("updated-at").textContent = new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(fetchedAt));

  const offers = Array.isArray(data?.active_offers)
    ? data.active_offers.filter(item => String(item?.type || "").toLowerCase() === "data" &&
      (globalThis.IrancellCore?.readNumber(item.total_amount) ?? 0) > 0)
    : [];
  renderPackageCarousel(offers, catalogOffers);
  setStatus("اطلاعات حساب با موفقیت دریافت شد.", "success");
}

let dataFetchInProgress = false;

function showFetchError(result) {
  if (result.error === "NO_STORED_SESSION") {
    setStatus("برای دریافت اطلاعات، در سایت رسمی ایرانسل وارد حساب شوید و دوباره تلاش کنید.", "error");
    showLoginHelp(true);
    return;
  }
  if (result.error === "AUTH") {
    setStatus("نشست ورود پذیرفته نشد یا منقضی شده است. سایت ایرانسل را باز کنید، دوباره وارد شوید و سپس تلاش کنید.", "error");
    showLoginHelp(true);
    return;
  }
  if (result.error === "HTTP") {
    if (result.status === 403) {
      setStatus("ایرانسل دسترسی به درخواست را نپذیرفت (403). اگر VPN یا Proxy روشن است، آن را خاموش و دوباره تلاش کنید؛ در غیر این صورت سایت ایرانسل را باز و وضعیت ورود را بررسی کنید.", "error");
    } else if (result.status === 429) {
      setStatus("درخواست‌ها موقتاً محدود شده‌اند (429). چند دقیقه صبر کنید و دوباره تلاش کنید.", "error");
    } else if (result.status >= 500) {
      setStatus("سرور ایرانسل موقتاً پاسخ‌گو نیست. چند دقیقه بعد دوباره تلاش کنید.", "error");
    } else {
      setStatus(`API ایرانسل خطای HTTP ${result.status} برگرداند. اتصال و وضعیت نشست را بررسی کنید.`, "error");
    }
    return;
  }
  if (result.error === "RATE_LIMIT") {
    setStatus("تعداد درخواست‌ها موقتاً محدود شده است. کمی صبر کنید و دوباره تلاش کنید.", "error");
    return;
  }
  if (result.error === "SERVER") {
    setStatus("سرور ایرانسل موقتاً در دسترس نیست. بعداً دوباره تلاش کنید.", "error");
    return;
  }
  if (result.error === "NOT_JSON") {
    setStatus("پاسخ API قابل خواندن نیست؛ ممکن است نشست منقضی شده یا صفحه ورود به‌جای اطلاعات بازگشته باشد.", "error");
    showLoginHelp(true);
    return;
  }
  if (result.error === "API_FORMAT") {
    setStatus("ساختار پاسخ API ایرانسل تغییر کرده است. داده‌ای نمایش داده نشد تا اطلاعات اشتباه ارائه نشود.", "error");
    return;
  }
  if (result.error === "TIMEOUT") {
    setStatus("پاسخ API دیرتر از حد انتظار رسید. اگر VPN یا Proxy روشن است خاموشش کنید؛ سپس اتصال اینترنت را بررسی و دوباره تلاش کنید.", "error");
    return;
  }
  if (result.error === "NETWORK") {
    setStatus("ارتباط با API ایرانسل برقرار نشد. اگر VPN یا Proxy روشن است، خاموشش کنید و دوباره تلاش کنید؛ سپس اتصال اینترنت و دسترسی به my.irancell.ir را بررسی کنید.", "error");
    return;
  }
  setStatus("دریافت اطلاعات ناموفق بود. اتصال اینترنت و وضعیت ورود به سایت ایرانسل را بررسی کنید.", "error");
}

function renderDashboardResult(result, fromCache = false) {
  render(result.data, result.profile, result.cheapestOffer, result.fetchedAt || Date.now(), result.catalogOffers || []);
  if (result.insights) renderInsights(result.insights);
  if (fromCache) {
    const ageMinutes = Math.max(0, Math.floor((Date.now() - (result.fetchedAt || Date.now())) / 60000));
    setStatus(`اطلاعات ذخیره‌شده نمایش داده شد؛ آخرین دریافت ${formatNumber(ageMinutes, 0)} دقیقه پیش بود.`, "success");
  } else if (result.catalogCached || result.catalogError) {
    setStatus("اطلاعات حساب به‌روز شد؛ کاتالوگ از نسخه ذخیره‌شده استفاده می‌کند.", "warning");
  }
}

async function fetchFromOpenIrancellTab({ silent = false } = {}) {
  if (dataFetchInProgress) return;
  dataFetchInProgress = true;
  const refresh = $("refresh");
  refresh.disabled = true;
  refresh.setAttribute("aria-busy", "true");
  if (!silent) {
    showLoginHelp(false);
    setStatus("در حال دریافت مستقیم اطلاعات از API ایرانسل…");
  }
  try {
    const result = await chrome.runtime.sendMessage({ type: "IRANCELL_GET_DATA" });
    if (!result) throw new Error("EMPTY_RESULT");
    if (!result.ok) {
      if (!silent) showFetchError(result);
      else setStatus("اطلاعات ذخیره‌شده نمایش داده می‌شود؛ به‌روزرسانی پس‌زمینه انجام نشد. برای جزئیات، تازه‌سازی دستی را بزنید.", "warning");
      return;
    }
    renderDashboardResult(result, false);
    await loadInsights();
  } catch (error) {
    console.warn("Irancell Yaar refresh failed:", error?.message || "unknown error");
    if (!silent) setStatus("ارتباط با API ایرانسل ناموفق بود. اگر VPN یا Proxy روشن است، خاموشش کنید؛ سپس اتصال اینترنت و نشست سایت ایرانسل را بررسی کنید.", "error");
    else setStatus("اطلاعات ذخیره‌شده نمایش داده می‌شود؛ امکان به‌روزرسانی فعلی وجود نداشت.", "warning");
  } finally {
    dataFetchInProgress = false;
    refresh.disabled = false;
    refresh.removeAttribute("aria-busy");
  }
}

async function refreshFromCache() {
  try {
    const cached = await chrome.runtime.sendMessage({ type: "IRANCELL_GET_CACHED_DATA" });
    if (cached?.ok) {
      renderDashboardResult(cached, true);
      if (cached.ageMs >= 5 * 60 * 1000) fetchFromOpenIrancellTab({ silent: true });
    }
  } catch { /* Cache refresh is best-effort while the side panel stays open. */ }
}

async function bootstrapDashboard() {
  try {
    const cached = await chrome.runtime.sendMessage({ type: "IRANCELL_GET_CACHED_DATA" });
    if (cached?.ok) {
      renderDashboardResult(cached, true);
      await loadInsights();
      if (cached.ageMs >= 5 * 60 * 1000) await fetchFromOpenIrancellTab({ silent: true });
      return;
    }
  } catch { /* First launch proceeds to the live request. */ }
  await fetchFromOpenIrancellTab();
  await loadInsights();
}
$("refresh").addEventListener("click", () => fetchFromOpenIrancellTab());

if (chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.irancellDashboardCache && !dataFetchInProgress) refreshFromCache();
    if (areaName === "local" && (changes.irancellSettings || changes.irancellSessionMode)) loadInsights();
    if (areaName === "local" && changes[PINNED_PACKAGE_STORAGE_KEY]) {
      pinnedActivePackageKey = typeof changes[PINNED_PACKAGE_STORAGE_KEY].newValue === "string"
        ? changes[PINNED_PACKAGE_STORAGE_KEY].newValue
        : null;
      renderPackageCarousel(packageOffers);
    }
  });
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshFromCache();
});

// Open the persistent side panel from a direct user gesture in the toolbar popup.
// Cache the current window ID before a click so sidePanel.open() is invoked synchronously
// from the click handler, as required by Chromium's user-activation policy.
const openSidePanelButton = $("open-sidepanel");
if (openSidePanelButton && chrome.sidePanel?.open && chrome.windows?.getCurrent) {
  let popupWindowId = null;
  chrome.windows.getCurrent((currentWindow) => {
    if (Number.isInteger(currentWindow?.id)) popupWindowId = currentWindow.id;
  });
  openSidePanelButton.addEventListener("click", () => {
    if (!Number.isInteger(popupWindowId)) {
      setStatus("شناسه پنجره مرورگر در دسترس نیست؛ پنجره افزونه را ببندید و دوباره باز کنید.", "error");
      return;
    }
    chrome.sidePanel.open({ windowId: popupWindowId }).catch((error) => {
      console.warn("Could not open Irancell Yaar side panel:", error?.message || "unknown error");
      setStatus("بازکردن سایدبار ناموفق بود. مرورگر را بررسی کنید و دوباره تلاش کنید.", "error");
    });
  });
} else if (openSidePanelButton) {
  openSidePanelButton.disabled = true;
  openSidePanelButton.title = "سایدبار در این مرورگر پشتیبانی نمی‌شود";
}

$("open-site").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://my.irancell.ir/sessions/add" });
});
(async () => {
  try {
    const stored = await chrome.storage.local.get(PINNED_PACKAGE_STORAGE_KEY);
    pinnedActivePackageKey = typeof stored?.[PINNED_PACKAGE_STORAGE_KEY] === "string"
      ? stored[PINNED_PACKAGE_STORAGE_KEY]
      : null;
  } catch (error) {
    console.warn("Could not load pinned active package:", error?.message || "unknown error");
  }
  await bootstrapDashboard();
})();


function statusLabel(status) {
  if (status == null) return "نامشخص";
  return status >= 200 && status < 300 ? `موفق (${status})` : `خطا (${status})`;
}
function countCyclesUntilExpiry(bucket, packageItem, now) {
  const expiryAt = packageItem?.expiry ? globalThis.IrancellCore?.parseApiDate(packageItem.expiry) : NaN;
  if (!Number.isFinite(expiryAt) || expiryAt <= now) return null;
  if (bucket.kind === "night") {
    if (!bucket.scheduleKnown || !bucket.window || typeof globalThis.IrancellCore?.countUsageCyclesUntil !== "function") return null;
    const count = globalThis.IrancellCore.countUsageCyclesUntil(now, expiryAt, bucket.window);
    return count > 0 ? count : null;
  }
  return Math.max(0, (expiryAt - now) / 86400000);
}

function getBucketDailyBudget(bucket, sample, now = Date.now()) {
  const packageIds = new Set(Array.isArray(bucket.packageIds) ? bucket.packageIds : []);
  const packages = (Array.isArray(sample?.packages) ? sample.packages : []).filter(item => packageIds.has(item.id));
  let budgetMb = 0;
  let count = 0;
  for (const item of packages) {
    const remaining = Number(item.remainingMb);
    if (!Number.isFinite(remaining) || remaining < 0) continue;
    const cycles = countCyclesUntilExpiry(bucket, item, now);
    if (!(cycles > 0)) continue;
    budgetMb += remaining / cycles;
    count++;
  }
  return count ? { budgetMb, count, totalCount: bucket.packageCount || packages.length } : null;
}

function appendUsageMetric(parent, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "usage-metric";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  wrapper.append(labelEl, valueEl);
  parent.appendChild(wrapper);
}

function renderUsageBreakdown(sample) {
  const container = $("usage-breakdown");
  container.replaceChildren();
  const buckets = Array.isArray(sample?.usageBuckets) ? sample.usageBuckets : [];
  if (!buckets.length) {
    const empty = document.createElement("p");
    empty.className = "subnote";
    empty.textContent = "بسته اینترنت فعالی برای تحلیل پیدا نشد.";
    container.appendChild(empty);
    $("usage-confidence").textContent = "بدون بسته فعال";
    $("usage-explanation").textContent = "حجم کل حساب به‌تنهایی برای پیش‌بینی کافی نیست. پس از دریافت اطلاعات بسته‌های فعال، تحلیل تفکیک‌شده نمایش داده می‌شود.";
    return;
  }

  const now = Date.now();
  let estimatedCount = 0;
  for (const bucket of buckets) {
    const card = document.createElement("section");
    card.className = `usage-bucket ${bucket.kind === "night" ? "usage-bucket-night" : "usage-bucket-normal"}`;
    const heading = document.createElement("div");
    heading.className = "usage-bucket-heading";
    const title = document.createElement("h3");
    title.textContent = bucket.kind === "night"
      ? `بسته شبانه · ${bucket.windowLabel || "ساعت نامشخص"}`
      : (Array.isArray(bucket.excludedWindows) && bucket.excludedWindows.length
        ? "بسته عادی · ساعات غیرشبانه"
        : "بسته‌های عادی");
    const countTag = document.createElement("span");
    countTag.className = "small-tag";
    countTag.textContent = `${formatNumber(bucket.packageCount || 0, 0)} بسته`;
    heading.append(title, countTag);
    card.appendChild(heading);

    const metricGrid = document.createElement("div");
    metricGrid.className = "usage-metric-grid";
    const remaining = bucket.remainingMb == null
      ? "نامشخص"
      : `${formatNumber(bucket.remainingMb / 1024, 2)} GB`;
    appendUsageMetric(metricGrid, "حجم باقی‌مانده همین گروه", remaining);

    const cycleName = bucket.kind === "night" ? "هر شبِ مجاز" : "در هر روز";
    const usageValue = Number(bucket.usagePerCycleMb);
    const hasForecast = bucket.scheduleKnown && bucket.remainingMb != null && Number.isFinite(usageValue) && usageValue > 0;
    appendUsageMetric(metricGrid, bucket.kind === "night" ? "مصرف تخمینی هر پنجره شبانه" : "مصرف تخمینی در ساعات عادی",
      hasForecast ? `${formatNumber(usageValue / 1024, 2)} GB / ${cycleName}` : "داده کافی نیست");

    const cycles = Number(bucket.cyclesToExhaust);
    let exhaustion = "—";
    if (bucket.remainingMb === 0) exhaustion = "حجم باقی‌مانده صفر است";
    else if (hasForecast && Number.isFinite(cycles) && cycles >= 0) {
      const unit = bucket.kind === "night" ? "شب" : "روز";
      exhaustion = cycles < 1 ? `کمتر از ۱ ${unit}` : `حدود ${formatNumber(Math.ceil(cycles), 0)} ${unit}`;
    }
    appendUsageMetric(metricGrid, bucket.kind === "night" ? "برآورد شب‌های مصرف تا اتمام" : "برآورد روزهای مصرف تا اتمام", exhaustion);

    const budget = getBucketDailyBudget(bucket, sample, now);
    const budgetUnit = bucket.kind === "night" ? "GB / هر شب" : "GB / روز";
    appendUsageMetric(metricGrid, "سقف پیشنهادی تا انقضا",
      budget ? `${formatNumber(budget.budgetMb / 1024, 2)} ${budgetUnit}${budget.count < budget.totalCount ? ` · بر پایه ${formatNumber(budget.count, 0)} بسته` : ""}` : "تاریخ انقضا یا پنجره کافی نیست");
    card.appendChild(metricGrid);

    const names = document.createElement("p");
    names.className = "usage-bucket-packages";
    names.textContent = (bucket.packageNames || []).join("، ") || "نام بسته ثبت نشده";
    card.appendChild(names);

    const foot = document.createElement("p");
    foot.className = "usage-bucket-note";
    if (!bucket.scheduleKnown) foot.textContent = bucket.scheduleReason || "بازه زمانی مجاز مشخص نیست؛ پیش‌بینی انجام نمی‌شود.";
    else if (bucket.remainingMb == null) foot.textContent = "API ماندهٔ مستقل همه بسته‌های این گروه را ارائه نکرده است؛ پیش‌بینی غیرفعال است.";
    else if (hasForecast) {
      estimatedCount++;
      const confidence = bucket.confidence === "high" ? "اطمینان بالاتر" : bucket.confidence === "medium" ? "اطمینان متوسط" : "تخمینی؛ نمونه کم";
      const exposureHours = Number(bucket.exposureHours) || 0;
      let expiryWarning = "";
      const packageIds = new Set(bucket.packageIds || []);
      const selectedPackages = (sample?.packages || []).filter(item => packageIds.has(item.id));
      const expiryCycles = selectedPackages.map(item => countCyclesUntilExpiry(bucket, item, now)).filter(value => value > 0);
      if (expiryCycles.length && Number.isFinite(cycles) && cycles > Math.min(...expiryCycles)) {
        expiryWarning = " دست‌کم یکی از بسته‌ها پیش از اتمام برآوردی منقضی می‌شود.";
      }
      foot.textContent = `${confidence} · بر پایه ${formatNumber(bucket.sampleCount || 0, 0)} نمونه و ${formatNumber(exposureHours, 1)} ساعت در پنجره مجاز.${expiryWarning}`;
    } else foot.textContent = bucket.forecastReason || "مصرف قابل‌اندازه‌گیری در ساعات مجاز این بسته هنوز ثبت نشده است.";
    card.appendChild(foot);
    container.appendChild(card);
  }

  $("usage-confidence").textContent = estimatedCount ? "تحلیل تفکیک‌شده" : "در حال جمع‌آوری داده";
  $("usage-explanation").textContent = "بسته عادی و شبانه جداگانه تحلیل می‌شوند. برای بسته شبانه فقط زمان هم‌پوشان با ساعت مجاز (مثلاً ۰۲:۰۰ تا ۰۷:۰۰) لحاظ می‌شود؛ مصرف گروه عادی نیز از حجم شبانه جمع نمی‌شود. پس از اضافه‌شدن/تمدید بسته یا تغییر ساعات، برای جلوگیری از پیش‌بینی نادرست داده‌های جدید جمع‌آوری می‌شود.";
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function jalaliDateLabel(date, options = { year: "numeric", month: "long", day: "numeric" }) {
  try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", options).format(date); }
  catch { return new Intl.DateTimeFormat("fa-IR", options).format(date); }
}

function renderActivityHeatmap(history = [], catalogHistory = []) {
  const host = $("activity-heatmap");
  if (!host) return;
  host.replaceChildren();

  const usageByDay = new Map();
  for (const sample of Array.isArray(history) ? history : []) {
    const timestamp = Number(sample?.at);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const key = localDayKey(new Date(timestamp));
    usageByDay.set(key, (usageByDay.get(key) || 0) + 1);
  }

  const priceChangeDays = new Set();
  const catalogs = Array.isArray(catalogHistory) ? catalogHistory : [];
  for (let i = 1; i < catalogs.length; i++) {
    const current = catalogs[i];
    const previous = catalogs[i - 1];
    const currentAt = Number(current?.at);
    if (!Number.isFinite(currentAt) || currentAt <= 0) continue;
    const oldPrices = new Map((Array.isArray(previous?.offers) ? previous.offers : []).map(offer => [String(offer.id), Number(offer.price)]));
    const changed = (Array.isArray(current?.offers) ? current.offers : []).some(offer => {
      const id = String(offer?.id ?? "");
      const price = Number(offer?.price);
      return id && oldPrices.has(id) && Number.isFinite(price) && Number.isFinite(oldPrices.get(id)) && price !== oldPrices.get(id);
    });
    if (changed) priceChangeDays.add(localDayKey(new Date(currentAt)));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  // Iranian calendar weeks begin on Saturday. Extend through the current week.
  const daysSinceSaturday = (end.getDay() + 1) % 7;
  end.setDate(end.getDate() + (6 - daysSinceSaturday));
  const start = new Date(end);
  start.setDate(start.getDate() - (26 * 7 - 1));
  start.setHours(0, 0, 0, 0);
  const startOffset = (start.getDay() + 1) % 7;
  start.setDate(start.getDate() - startOffset);

  const monthRow = document.createElement("div");
  monthRow.className = "activity-months";
  const monthNames = new Map();
  const days = [];
  for (let i = 0; i < 26 * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push(date);
  }
  for (let col = 0; col < 26; col++) {
    const date = days[col * 7];
    const monthName = jalaliDateLabel(date, { month: "long" });
    const previousName = col > 0 ? jalaliDateLabel(days[(col - 1) * 7], { month: "long" }) : "";
    if (monthName !== previousName) monthNames.set(col, { name: monthName, number: jalaliDateLabel(date, { month: "numeric" }) });
  }
  // Keep month markers on one baseline, centered within each month's week-span.
  // Month spans naturally vary between four and five weeks; centering avoids labels
  // appearing to bunch up at the left edge while preserving their chronological position.
  const monthColumns = [...monthNames.keys()].sort((a, b) => a - b);
  for (const col of monthColumns) {
    const month = monthNames.get(col);
    const nextMonthColumn = monthColumns.find(nextCol => nextCol > col) ?? 26;
    const label = document.createElement("span");
    label.className = "activity-month-label";
    label.style.gridColumn = `${col + 1} / ${nextMonthColumn + 1}`;
    label.textContent = month.number;
    label.title = month.name;
    label.setAttribute("aria-label", month.name);
    monthRow.appendChild(label);
  }
  host.appendChild(monthRow);

  const body = document.createElement("div");
  body.className = "activity-heatmap-grid";
  const weekdayLabels = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  const weekdayCol = document.createElement("div");
  weekdayCol.className = "activity-weekday-labels";
  weekdayLabels.forEach((label, index) => {
    const cell = document.createElement("span");
    cell.textContent = index % 2 === 0 ? label : "";
    weekdayCol.appendChild(cell);
  });
  body.appendChild(weekdayCol);
  const grid = document.createElement("div");
  grid.className = "activity-day-grid";
  days.forEach((date, index) => {
    const key = localDayKey(date);
    const count = usageByDay.get(key) || 0;
    const hasPriceChange = priceChangeDays.has(key);
    const cell = document.createElement("span");
    cell.className = `activity-day heat-level-${count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4}${hasPriceChange ? " has-price-change" : ""}`;
    const future = date > today;
    if (future) cell.classList.add("activity-day-future");
    const details = [jalaliDateLabel(date), count ? `${formatNumber(count, 0)} رکورد تحلیل مصرف` : "رکورد مصرفی ثبت نشده", hasPriceChange ? "تغییر قیمت بسته ثبت شده" : "بدون تغییر قیمت ثبت‌شده"];
    cell.title = details.join(" · ");
    cell.setAttribute("aria-label", details.join("، "));
    cell.style.gridColumn = String(Math.floor(index / 7) + 1);
    cell.style.gridRow = String((index % 7) + 1);
    grid.appendChild(cell);
  });
  body.append(weekdayCol, grid);
  host.appendChild(body);
  const range = $("activity-range-label");
  if (range) range.textContent = `${jalaliDateLabel(days[0], { month: "short", year: "numeric" })} تا امروز`;
}

function renderInsights(insights) {
  const sample = insights?.sample;
  renderUsageBreakdown(sample);
  renderActivityHeatmap(insights?.history || [], insights?.catalogHistory || []);
  const snapshots = insights?.catalogHistory || [];
  $("catalog-history-count").textContent = `${formatNumber(snapshots.length, 0)} نمونه`;
  if (snapshots.length < 2) {
    $("catalog-trend").textContent = "هنوز برای مقایسهٔ زمانی داده کافی نیست. با دریافت‌های بعدی، تغییر قیمت بسته‌ها ذخیره می‌شود.";
  } else {
    const latest = snapshots[snapshots.length - 1];
    const prior = snapshots[snapshots.length - 2];
    const priorById = new Map((prior.offers || []).map(o => [o.id, o]));
    const changes = (latest.offers || []).map(o => {
      const p = priorById.get(o.id);
      return p ? { ...o, delta: o.price - p.price, oldPrice: p.price } : null;
    }).filter(Boolean);
    const changed = changes.filter(o => o.delta !== 0);
    if (!changed.length) {
      $("catalog-trend").textContent = `در دو نمونهٔ اخیر، قیمت ${formatNumber(changes.length, 0)} بستهٔ مشترک تغییر نکرده است.`;
    } else {
      const cheapestChange = changed.sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta))[0];
      const direction = cheapestChange.delta > 0 ? "افزایش" : "کاهش";
      $("catalog-trend").textContent = `${formatNumber(changed.length,0)} بسته تغییر قیمت داشته‌اند. بیشترین تغییر مربوط به «${toPersianDigits(cheapestChange.title)}» است: ${direction} ${formatNumber(Math.abs(cheapestChange.delta),0)} ریال.`;
    }
  }

  const health = insights?.health;
  if (health) {
    $("health-account").textContent = statusLabel(health.accountStatus);
    $("health-profile").textContent = statusLabel(health.profileStatus);
    $("health-catalog").textContent = health.catalogStatus == null ? "ناموجود" : statusLabel(health.catalogStatus);
    $("health-time").textContent = new Intl.DateTimeFormat("fa-IR", {hour:"2-digit",minute:"2-digit"}).format(new Date(health.at));
    const healthy = health.accountStatus >= 200 && health.accountStatus < 300 && !health.error;
    $("health-state").textContent = healthy ? "سالم" : health.error === "NETWORK" || health.error === "TIMEOUT" ? "خطای ارتباط" : "نیاز به بررسی";
    $("health-state").classList.toggle("health-bad", !healthy);
  } else {
    $("health-state").textContent = "هنوز بررسی نشده";
  }
}
async function loadInsights() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "IRANCELL_GET_INSIGHTS" });
    if (result) {
      renderInsights({
        history: result.history,
        catalogHistory: result.catalogHistory,
        health: result.health,
        sample: result.sample,
        usagePerDayMb: result.usagePerDayMb,
        forecast: result.forecast
      });
      const s = result.settings || {};
      $("low-data-threshold").value = s.lowDataPercent ?? 20;
      $("threshold-label").textContent = `${toPersianDigits($("low-data-threshold").value)}٪`;
      $("expiry-threshold").value = String(s.expiryDays ?? 3);
      $("notifications-enabled").checked = s.enableNotifications !== false;
      const remainingProgress = $("remaining-progress");
      if (remainingProgress) {
        remainingProgress.checked = s.remainingProgress === true;
        applyProgressDisplayMode(remainingProgress.checked);
      }
      const persistSession = $("persist-session");
      if (persistSession) persistSession.checked = result.sessionMode === "local";
    }
  } catch (e) { console.warn("Could not load insights", e); }
}
$("low-data-threshold").addEventListener("input", () => {
  $("threshold-label").textContent = `${toPersianDigits($("low-data-threshold").value)}٪`;
});

$("persist-session").addEventListener("change", async () => {
  const checkbox = $("persist-session");
  checkbox.disabled = true;
  $("session-storage-status").textContent = "در حال تغییر روش نگهداری نشست…";
  try {
    const result = await chrome.runtime.sendMessage({
      type: "IRANCELL_SAVE_SESSION_MODE", mode: checkbox.checked ? "local" : "session"
    });
    if (!result?.ok) throw new Error("SESSION_MODE_FAILED");
    $("session-storage-status").textContent = checkbox.checked
      ? "نشست در فضای محلی مرورگر می‌ماند و ممکن است پس از بستن مرورگر نیز باقی بماند."
      : "نشست فقط تا پایان نشست مرورگر نگهداری می‌شود؛ ممکن است پس از راه‌اندازی مجدد نیاز به ورود دوباره باشد.";
  } catch {
    checkbox.checked = !checkbox.checked;
    $("session-storage-status").textContent = "تغییر روش ذخیره نشست ناموفق بود.";
  } finally { checkbox.disabled = false; }
});
$("save-settings").addEventListener("click", async () => {
  const settings = {
    lowDataPercent: Number($("low-data-threshold").value),
    expiryDays: Number($("expiry-threshold").value),
    enableNotifications: $("notifications-enabled").checked,
    remainingProgress: $("remaining-progress")?.checked === true
  };
  const button = $("save-settings");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "IRANCELL_SAVE_SETTINGS", settings });
    $("settings-status").textContent = result?.ok ? "تنظیمات ذخیره شد." : "ذخیره تنظیمات ناموفق بود.";
    if (result?.ok) applyProgressDisplayMode(settings.remainingProgress);
  } catch {
    $("settings-status").textContent = "ذخیره تنظیمات ناموفق بود؛ افزونه را دوباره باز کنید.";
  } finally { button.disabled = false; }
});

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // prevent spreadsheet formula injection
  return `"${text.replace(/"/g, '""')}"`;
}

$("export-history").addEventListener("click", async () => {
  const button = $("export-history");
  button.disabled = true;
  $("export-status").textContent = "در حال آماده‌سازی فایل…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "IRANCELL_EXPORT_HISTORY" });
    if (!result?.ok || !Array.isArray(result.history) || result.history.length === 0) {
      $("export-status").textContent = "هنوز تاریخچه‌ای برای خروجی وجود ندارد.";
      return;
    }
    const header = [
      "زمان نمونه ISO", "زمان نمونه شمسی تهران", "مانده ریالی",
      "حجم کل MiB (صرفاً نمایشی)", "حجم باقی‌مانده کل MiB (مبنای پیش‌بینی نیست)",
      "مصرف پیش‌بینی‌شده عادی MiB در روز", "مانده عادی MiB", "روزهای مصرف عادی تا اتمام",
      "تحلیل بسته‌های شبانه (پنجره؛ مانده MiB؛ MiB در هر شب؛ شب تا اتمام)",
      "تعداد بسته فعال", "نام بسته‌ها", "نزدیک‌ترین انقضا"
    ];
    const rows = result.history.map(item => {
      const buckets = Array.isArray(item.usageBuckets) ? item.usageBuckets : [];
      const normal = buckets.find(bucket => bucket.kind === "normal");
      const nightText = buckets.filter(bucket => bucket.kind === "night").map(bucket => {
        const remaining = bucket.remainingMb == null ? "نامشخص" : formatNumber(bucket.remainingMb, 0);
        const rate = Number.isFinite(bucket.usagePerCycleMb) ? formatNumber(bucket.usagePerCycleMb, 2) : "نامشخص";
        const cycles = Number.isFinite(bucket.cyclesToExhaust) ? formatNumber(bucket.cyclesToExhaust, 1) : "نامشخص";
        return `${bucket.windowLabel || "ساعت نامشخص"}; ${remaining}; ${rate}; ${cycles}`;
      }).join(" | ");
      return [
        item.at ? new Date(item.at).toISOString() : "",
        item.at ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.at)) : "",
        item.balance,
        item.totalMb,
        item.remainingMb,
        normal?.usagePerCycleMb ?? "",
        normal?.remainingMb ?? "",
        normal?.cyclesToExhaust ?? "",
        nightText,
        item.activePackageCount,
        item.packageName,
        item.expiry
      ];
    });
    const csv = "\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `irancell-yaar-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $("export-status").textContent = `خروجی ${formatNumber(rows.length, 0)} نمونه آماده شد.`;
  } catch {
    $("export-status").textContent = "ساخت خروجی ناموفق بود؛ دوباره تلاش کنید.";
  } finally { button.disabled = false; }
});

$("clear-local-data").addEventListener("click", async () => {
  const accepted = confirm("نشست ذخیره‌شده، تاریخچه مصرف، نمونه‌های قیمت و وضعیت اتصال پاک شوند؟ تنظیمات هشدار حفظ می‌شوند.");
  if (!accepted) return;
  const button = $("clear-local-data");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "IRANCELL_CLEAR_LOCAL_DATA" });
    $("clear-data-status").textContent = result?.ok
      ? "نشست و تاریخچه پاک شد. برای دریافت اطلاعات دوباره وارد سایت ایرانسل شوید."
      : "پاک‌سازی کامل نشد؛ دوباره تلاش کنید.";
  } catch {
    $("clear-data-status").textContent = "پاک‌سازی ناموفق بود؛ افزونه را دوباره باز کنید.";
  } finally { button.disabled = false; }
});


// Main account balance history: one sample per Tehran day, stored locally.
(function initBalanceHistorySparkline() {
  const toggle = document.getElementById("balance-history-toggle");
  const panel = document.getElementById("balance-sparkline-panel");
  const card = document.querySelector(".balance-card");
  if (!toggle || !panel || !card) return;

  const fmt = value => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value);
  const dateFmt = day => {
    if (!day) return "—";
    const date = new Date(`${day}T12:00:00+03:30`);
    return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran", month: "short", day: "numeric"
    }).format(date);
  };

  async function renderBalanceHistory() {
    const stored = await chrome.storage.local.get("irancellBalanceHistory");
    const rows = (Array.isArray(stored.irancellBalanceHistory) ? stored.irancellBalanceHistory : [])
      .filter(row => row && Number.isFinite(Number(row.balance)) && row.day)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .slice(-30);
    const svg = document.getElementById("balance-sparkline");
    const start = document.getElementById("balance-history-start");
    const end = document.getElementById("balance-history-end");
    const current = document.getElementById("balance-history-current");
    const range = document.getElementById("balance-history-range");
    if (!svg) return;
    if (!rows.length) {
      svg.innerHTML = '<text x="140" y="33" text-anchor="middle" fill="#9da6b2" font-size="11">پس از دریافت اطلاعات، نمودار ساخته می‌شود</text>';
      start.textContent = "بدون داده";
      end.textContent = "—";
      current.textContent = "—";
      range.textContent = "هنوز ثبت نشده";
      return;
    }
    const values = rows.map(row => Number(row.balance));
    const min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(1, max - min);
    const points = values.map((value, index) => {
      const x = rows.length === 1 ? 140 : 5 + index * 270 / (rows.length - 1);
      const y = 48 - ((value - min) / span) * 36;
      return [x, y];
    });
    const line = points.map(point => point.join(",")).join(" ");
    const area = `5,54 ${line} 275,54`;
    const last = points[points.length - 1];
    svg.innerHTML = `<polygon class="sparkline-area" points="${area}"></polygon>
      <polyline class="sparkline-line" points="${line}"></polyline>
      <circle class="sparkline-dot" cx="${last[0]}" cy="${last[1]}" r="3.5"></circle>`;
    start.textContent = dateFmt(rows[0].day);
    end.textContent = dateFmt(rows[rows.length - 1].day);
    current.textContent = `${fmt(values[values.length - 1])} تومان`;
    range.textContent = `${fmt(rows.length)} روز`;
  }

  toggle.addEventListener("click", async () => {
    const opening = panel.hidden;
    if (opening) await renderBalanceHistory();
    panel.hidden = !opening;
    card.classList.toggle("history-open", opening);
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.setAttribute("aria-label", opening ? "بستن نمودار تاریخچه شارژ" : "نمایش نمودار تاریخچه شارژ");
  });
  panel.addEventListener("click", event => {
    if (event.target.closest("svg")) return;
    panel.hidden = true;
    card.classList.remove("history-open");
    toggle.setAttribute("aria-expanded", "false");
  });
})();
