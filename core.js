/* Pure, dependency-free logic shared by the service worker and automated tests. */
(function attachIrancellCore(root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  if (root) root.IrancellCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
  const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  const DAY_MS = 86400000;

  function digitsToAscii(value) {
    return String(value ?? "")
      .replace(/[۰-۹]/g, digit => String(PERSIAN_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)));
  }

  function readNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value && typeof value === "object") {
      value = value.amount ?? value.value ?? value.price ?? value.total ?? value.number ?? value.volume;
    }
    if (typeof value === "string") {
      value = digitsToAscii(value)
        .replace(/[٬,،\s]/g, "")
        .replace(/[٫]/g, ".");
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // The observed API commonly emits date strings without a timezone. Interpret
  // these as Iran local time, which is UTC+03:30, rather than the PC's timezone.
  function parseApiDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value !== "string" || !value.trim()) return NaN;
    const input = value.trim();
    let normalized = input.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)/, "$1T$2");
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T00:00:00";
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    const candidate = !hasZone && /^\d{4}-\d{2}-\d{2}T/.test(normalized)
      ? `${normalized}+03:30`
      : normalized;
    const timestamp = Date.parse(candidate);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function getPackageRemainingData(item) {
    if (!item || typeof item !== "object") return { value: null, source: "unknown" };
    const keys = ["remained_amount", "remaining_amount", "remainingAmount", "remainedAmount"];
    for (const key of keys) {
      if (item[key] === null || item[key] === undefined || item[key] === "") continue;
      const value = readNumber(item[key]);
      return value == null
        ? { value: null, source: "invalid-package-field" }
        : { value, source: "package" };
    }
    // Intentionally do not use global_data_remaining here. Without a separate
    // per-offer balance, there is no safe way to assign an account-wide value to
    // normal and night packages.
    return { value: null, source: "unknown" };
  }

  function getActiveDataPackages(data) {
    const items = Array.isArray(data?.active_offers) ? data.active_offers : [];
    return items.filter(item => String(item?.type || "").toLowerCase() === "data")
      .map(item => {
        const total = readNumber(item.total_amount);
        if (total == null || total <= 0) return null;
        // Only consume fields that describe this offer. `global_data_remaining`
        // may be account-wide; assigning it to every active offer duplicates one
        // shared balance across packages and corrupts per-bucket analysis.
        const remainingData = getPackageRemainingData(item);
        const remaining = remainingData.value == null ? null : Math.min(total, Math.max(0, remainingData.value));
        const name = String(item.name || item.title || "بسته اینترنت").slice(0, 180);
        const expiry = typeof item.expiry_date === "string" && item.expiry_date.trim()
          ? item.expiry_date.trim().slice(0, 80) : null;
        const id = String(item.offer_id ?? item.package_id ?? item.id ?? item.upc_code ?? `${name}|${total}|${expiry || ""}`).slice(0, 180);
        const category = isNightOffer(item) ? "night" : "normal";
        const usageWindow = category === "night" ? extractUsageWindow(item) : null;
        return {
          id, name, totalMb: total, remainingMb: remaining, remainingSource: remainingData.source, expiry,
          isGift: item.is_gift === true, category, usageWindow,
          usageWindowLabel: usageWindow ? formatUsageWindow(usageWindow) : null
        };
      }).filter(Boolean);
  }

  function packageSignature(packages) {
    return (Array.isArray(packages) ? packages : [])
      .map(item => [item.id, item.name, item.totalMb, item.expiry || ""].join("\u001f"))
      .sort()
      .join("\u001e");
  }

  function legacySignature(sample) {
    if (typeof sample?.packageSignature === "string" && sample.packageSignature) return sample.packageSignature;
    if (!sample?.packageName || sample?.totalMb == null) return null;
    return `${sample.packageName}|${sample.totalMb}`;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function estimateUsage(history, currentSample, now = Date.now()) {
    if (!currentSample || currentSample.remainingMb == null || currentSample.totalMb == null || currentSample.totalMb <= 0) {
      return { usagePerDayMb: null, sampleCount: 0, elapsedHours: 0, confidence: "none" };
    }
    const signature = legacySignature(currentSample);
    if (!signature) return { usagePerDayMb: null, sampleCount: 0, elapsedHours: 0, confidence: "none" };
    const all = [...(Array.isArray(history) ? history : []), currentSample]
      .filter(sample => sample && Number.isFinite(sample.at) && sample.remainingMb != null &&
        sample.totalMb != null && sample.totalMb > 0 && legacySignature(sample) === signature &&
        sample.at <= now && sample.at >= now - 7 * DAY_MS)
      .sort((a, b) => a.at - b.at);
    const unique = all.filter((sample, index) => index === 0 || sample.at !== all[index - 1].at);
    if (unique.length < 2) return { usagePerDayMb: null, sampleCount: unique.length, elapsedHours: 0, confidence: "none" };

    const pairRates = [];
    // Only compare monotonic samples; any increase likely represents a refill/reset,
    // so only intervals after the latest increase should be used.
    let segmentStart = 0;
    for (let i = 1; i < unique.length; i++) {
      if (unique[i].remainingMb > unique[i - 1].remainingMb + 0.5) segmentStart = i;
    }
    const segment = unique.slice(segmentStart);
    for (let i = 1; i < segment.length; i++) {
      const hours = (segment[i].at - segment[i - 1].at) / 3600000;
      const consumed = segment[i - 1].remainingMb - segment[i].remainingMb;
      if (hours >= 0.15 && consumed > 0 && consumed <= segment[i - 1].totalMb) {
        const rate = consumed / (hours / 24);
        if (Number.isFinite(rate) && rate > 0 && rate <= segment[i - 1].totalMb * 24) pairRates.push(rate);
      }
    }
    const first = segment[0];
    const last = segment[segment.length - 1];
    const elapsedHours = Math.max(0, (last.at - first.at) / 3600000);
    let usagePerDayMb = null;
    if (elapsedHours >= 0.5 && last.remainingMb < first.remainingMb && pairRates.length) {
      const aggregate = (first.remainingMb - last.remainingMb) / (elapsedHours / 24);
      const robustMedian = median(pairRates);
      // Blend aggregate trend with interval median to limit single-sample noise.
      usagePerDayMb = pairRates.length >= 3 && Number.isFinite(robustMedian)
        ? (aggregate * 0.7 + robustMedian * 0.3)
        : aggregate;
      if (!Number.isFinite(usagePerDayMb) || usagePerDayMb <= 0) usagePerDayMb = null;
    }
    const confidence = usagePerDayMb == null ? "none"
      : unique.length >= 5 && elapsedHours >= 24 ? "high"
        : unique.length >= 3 && elapsedHours >= 2 ? "medium" : "low";
    return { usagePerDayMb, sampleCount: segment.length, elapsedHours, confidence };
  }

  function createSample(data, history = [], now = Date.now()) {
    const packages = getActiveDataPackages(data);
    // These totals are retained for history/export only. Never use them to
    // forecast consumption when daily and time-restricted packages coexist.
    const totalMb = packages.reduce((sum, item) => sum + item.totalMb, 0);
    const allRemainingKnown = packages.length > 0 && packages.every(item => item.remainingMb != null);
    const remainingMb = allRemainingKnown
      ? packages.reduce((sum, item) => sum + item.remainingMb, 0)
      : null;
    const earliestExpiry = packages.map(item => ({ value: item.expiry, at: parseApiDate(item.expiry) }))
      .filter(item => item.value && Number.isFinite(item.at))
      .sort((a, b) => a.at - b.at)[0];
    const balance = readNumber(data?.main_account_balance);
    const sample = {
      at: now,
      balance: balance == null ? null : balance,
      totalMb: totalMb > 0 ? totalMb : null,
      remainingMb,
      expiry: earliestExpiry?.value || null,
      packageName: packages.map(item => item.name).sort().join(" + ") || null,
      packageSignature: packageSignature(packages) || null,
      activePackageCount: packages.length,
      packages,
      usageBuckets: createUsageBuckets(packages)
    };
    // Deprecated aggregate forecast is deliberately disabled. Per-bucket
    // estimates are attached by analyzeUsageBuckets() in the service worker.
    sample.usagePerDayMb = null;
    sample.forecastSampleCount = 0;
    sample.forecastElapsedHours = 0;
    sample.forecastConfidence = "none";
    return sample;
  }

  function getOfferLabel(offer) {
    const values = [
      offer?.title, offer?.name, offer?.description, offer?.offer_name, offer?.offerName,
      offer?.display_name, offer?.displayName, offer?.name_fa, offer?.nameFa,
      offer?.title_fa, offer?.titleFa, offer?.package_name, offer?.packageName,
      offer?.product_name, offer?.productName, offer?.short_description,
      offer?.shortDescription, ...(Array.isArray(offer?.tags) ? offer.tags : [])
    ];
    return values.filter(value => typeof value === "string" && value.trim()).join(" ").slice(0, 600);
  }

  function getOfferTitle(offer) {
    const candidates = [
      offer?.title, offer?.name, offer?.display_name, offer?.displayName,
      offer?.name_fa, offer?.nameFa, offer?.title_fa, offer?.titleFa,
      offer?.package_name, offer?.packageName, offer?.product_name, offer?.productName,
      offer?.offer_name, offer?.offerName, offer?.description,
      offer?.short_description, offer?.shortDescription
    ];
    const title = candidates.find(value => typeof value === "string" && value.trim());
    return String(title || "بسته اینترنت").trim().slice(0, 240);
  }

  function normalizeLabel(value) {
    return digitsToAscii(String(value || "").normalize("NFKC"))
      .replace(/[ـ_]/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function isNightOffer(offer) {
    const label = normalizeLabel(getOfferLabel(offer));
    const textualNight = /شبانه|بامداد|نیمه\s*شب|فقط\s*شب|night(?:ly)?|overnight/.test(label) ||
      /(?:^|\D)2\s*(?:تا|الی|[-–—])\s*7\s*(?:صبح|بامداد|am)(?:\D|$)/.test(label) ||
      /(?:^|\D)2\s*(?:am)?\s*(?:تا|الی|[-–—]|to)\s*7\s*(?:am|صبح|بامداد)(?:\D|$)/.test(label) ||
      /(?:^|\D)0?2\s*:\s*00\s*(?:تا|الی|[-–—]|to)\s*0?7\s*:\s*00(?:\D|$)/.test(label);
    const window = extractUsageWindow(label);
    return textualNight || Boolean(window && window.startMinute > window.endMinute);
  }

  const IRAN_OFFSET_MS = 210 * 60 * 1000;
  const MINUTE_MS = 60000;

  function parseClock(hourValue, minuteValue, marker, fallbackMarker = "") {
    let hour = Number(hourValue);
    const minute = minuteValue == null || minuteValue === "" ? 0 : Number(minuteValue);
    const period = String(marker || fallbackMarker || "").toLowerCase();
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 24) return null;
    if (hour === 24 && minute === 0) return 1440;
    if (hour > 23) return null;
    const isPm = /شب|عصر|pm/.test(period);
    const isAm = /صبح|بامداد|am/.test(period);
    if (isPm) hour = (hour % 12) + 12;
    else if (isAm) hour %= 12;
    return hour * 60 + minute;
  }

  function extractUsageWindow(offerOrLabel) {
    const raw = typeof offerOrLabel === "string" ? offerOrLabel : getOfferLabel(offerOrLabel);
    const label = normalizeLabel(raw);
    // Accept explicit ranges such as "۲ تا ۷ صبح", "11 شب تا 7 صبح",
    // "02:00-07:00" and "23:00 تا 07:00". A generic word like شبانه is
    // not sufficient to assume a specific window.
    const clockRange = label.match(/(?:^|\D)(\d{1,2}):(\d{2})\s*(?:تا|الی|[-–—]|to)\s*(\d{1,2}):(\d{2})(?:\D|$)/i);
    if (clockRange) {
      let startMinute = parseClock(clockRange[1], clockRange[2], "");
      const endMinute = parseClock(clockRange[3], clockRange[4], "");
      const nightLabel = /شبانه|بامداد|نیمه\s*شب|فقط\s*شب|night|overnight/.test(label);
      const startHour = Number(clockRange[1]), endHour = Number(clockRange[3]);
      if (nightLabel && startHour >= 1 && startHour <= 12 && startHour > endHour && endHour <= 12) startMinute = (startHour % 12 + 12) % 12 * 60 + 720;
      if (startMinute != null && endMinute != null && startMinute < 1440 && endMinute < 1440 && startMinute !== endMinute) {
        return { startMinute, endMinute, source: "explicit-24h" };
      }
    }
    const range = label.match(/(?:^|\D)(\d{1,2})(?::(\d{2}))?\s*(صبح|بامداد|شب|عصر|am|pm)?\s*(?:تا|الی|[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(صبح|بامداد|شب|عصر|am|pm)(?:\D|$)/i);
    if (!range) return null;
    const startHour = Number(range[1]);
    const startMinutePart = range[2] || "0";
    const startMarker = range[3] || "";
    const endHour = Number(range[4]);
    const endMinutePart = range[5] || "0";
    const endMarker = range[6] || "";
    const nightLabel = /شبانه|بامداد|نیمه\s*شب|فقط\s*شب|night|overnight/.test(label);
    let effectiveStartMarker = startMarker;
    if (!effectiveStartMarker) {
      // In "2 تا 7 صبح", the endpoint's morning marker applies to both.
      if (/صبح|بامداد|am/.test(endMarker) && startHour <= 12 && startHour <= endHour) effectiveStartMarker = endMarker;
      // In "11 تا 7 صبح" on a night package, 11 is the preceding evening.
      else if (/صبح|بامداد|am/.test(endMarker) && nightLabel && startHour <= 12 && startHour > endHour) effectiveStartMarker = "شب";
      else if (startHour > 12) effectiveStartMarker = ""; // unambiguous 24-hour time
      else effectiveStartMarker = endMarker;
    }
    const start = parseClock(startHour, startMinutePart, effectiveStartMarker);
    const end = parseClock(endHour, endMinutePart, endMarker);
    if (start == null || end == null || start >= 1440 || end >= 1440 || start === end) return null;
    return { startMinute: start, endMinute: end, source: "explicit-period" };
  }

  function formatUsageWindow(window) {
    if (!window) return "ساعت مجاز نامشخص";
    const clock = minutes => {
      const normalized = ((minutes % 1440) + 1440) % 1440;
      return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
    };
    return `${clock(window.startMinute)} تا ${clock(window.endMinute)}`;
  }

  function windowDurationMinutes(window) {
    if (!window) return 0;
    const duration = (window.endMinute - window.startMinute + 1440) % 1440;
    return duration || 1440;
  }

  function unionWindowDurationMinutes(windows) {
    const minutes = new Uint8Array(1440);
    for (const window of Array.isArray(windows) ? windows : []) {
      if (!window) continue;
      const duration = windowDurationMinutes(window);
      for (let offset = 0; offset < duration; offset++) minutes[(window.startMinute + offset) % 1440] = 1;
    }
    let total = 0;
    for (const value of minutes) total += value;
    return total;
  }

  function overlapMinutesForWindows(from, to, windows) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
    const validWindows = (Array.isArray(windows) ? windows : []).filter(window =>
      window && Number.isFinite(window.startMinute) && Number.isFinite(window.endMinute) &&
      window.startMinute >= 0 && window.startMinute < 1440 && window.endMinute >= 0 && window.endMinute < 1440 &&
      window.startMinute !== window.endMinute);
    if (!validWindows.length) return 0;
    const firstIranDay = Math.floor((from + IRAN_OFFSET_MS) / DAY_MS) - 1;
    const lastIranDay = Math.floor((to + IRAN_OFFSET_MS) / DAY_MS) + 1;
    const intervals = [];
    for (let day = firstIranDay; day <= lastIranDay; day++) {
      const iranMidnightUtc = day * DAY_MS - IRAN_OFFSET_MS;
      for (const window of validWindows) {
        const start = iranMidnightUtc + window.startMinute * MINUTE_MS;
        let end = iranMidnightUtc + window.endMinute * MINUTE_MS;
        if (end <= start) end += DAY_MS;
        const overlapStart = Math.max(from, start);
        const overlapEnd = Math.min(to, end);
        if (overlapEnd > overlapStart) intervals.push([overlapStart, overlapEnd]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let totalMs = 0, activeStart = null, activeEnd = null;
    for (const [start, end] of intervals) {
      if (activeStart == null) { activeStart = start; activeEnd = end; }
      else if (start <= activeEnd) activeEnd = Math.max(activeEnd, end);
      else { totalMs += activeEnd - activeStart; activeStart = start; activeEnd = end; }
    }
    if (activeStart != null) totalMs += activeEnd - activeStart;
    return totalMs / MINUTE_MS;
  }

  function countUsageCyclesUntil(from, to, window) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !window) return 0;
    const firstIranDay = Math.floor((from + IRAN_OFFSET_MS) / DAY_MS) - 1;
    const lastIranDay = Math.floor((to + IRAN_OFFSET_MS) / DAY_MS) + 1;
    let count = 0;
    for (let day = firstIranDay; day <= lastIranDay; day++) {
      const iranMidnightUtc = day * DAY_MS - IRAN_OFFSET_MS;
      const start = iranMidnightUtc + window.startMinute * MINUTE_MS;
      let end = iranMidnightUtc + window.endMinute * MINUTE_MS;
      if (end <= start) end += DAY_MS;
      if (end > from && start < to) count++;
    }
    return count;
  }

  function createUsageBuckets(packages) {
    // Re-classify legacy snapshots written before schedule-aware analysis was introduced.
    const items = (Array.isArray(packages) ? packages : []).map(item => {
      const category = item.category || (isNightOffer({ title: item.name }) ? "night" : "normal");
      const usageWindow = item.usageWindow || (category === "night" ? extractUsageWindow({ title: item.name }) : null);
      return { ...item, category, usageWindow };
    });
    const nightPackages = items.filter(item => item.category === "night");
    const normalPackages = items.filter(item => item.category !== "night");
    const knownNightWindows = nightPackages.filter(item => item.usageWindow).map(item => item.usageWindow);
    const unknownNightWindow = nightPackages.some(item => !item.usageWindow);
    const windowKeys = [...new Set(knownNightWindows.map(w => `${w.startMinute}-${w.endMinute}`))].sort();
    const excludedWindows = windowKeys.map(key => {
      const [startMinute, endMinute] = key.split("-").map(Number);
      return { startMinute, endMinute };
    });
    const buckets = [];
    const buildBucket = (kind, key, selectedPackages, window, exclusions, scheduleKnown, reason = null) => {
      const allKnown = selectedPackages.length > 0 && selectedPackages.every(item => item.remainingMb != null);
      const remainingMb = allKnown ? selectedPackages.reduce((sum, item) => sum + item.remainingMb, 0) : null;
      const totalMb = selectedPackages.reduce((sum, item) => sum + item.totalMb, 0);
      const expectedExposureMinutes = kind === "night"
        ? (window ? windowDurationMinutes(window) : 0)
        : scheduleKnown ? 1440 - unionWindowDurationMinutes(exclusions) : 0;
      const packageSig = packageSignature(selectedPackages);
      const scheduleSig = kind === "night"
        ? (window ? `${window.startMinute}-${window.endMinute}` : "unknown-window")
        : scheduleKnown ? `outside:${windowKeys.join(",")}` : "unknown-exclusions";
      const signature = `${packageSig}|kind=${kind}|schedule=${scheduleSig}`;
      const expiryEntries = selectedPackages.map(item => ({ id: item.id, remainingMb: item.remainingMb, expiry: item.expiry }));
      return {
        key, kind,
        title: kind === "night" ? "بسته شبانه" : "بسته عادی",
        window: window || null,
        windowLabel: window ? formatUsageWindow(window) : (kind === "night" ? "ساعت مجاز نامشخص" : "تمام ساعات"),
        excludedWindows: exclusions || [],
        scheduleKnown,
        scheduleReason: reason,
        expectedExposureHoursPerDay: expectedExposureMinutes / 60,
        packageIds: selectedPackages.map(item => item.id),
        packageNames: selectedPackages.map(item => item.name),
        expiryEntries,
        earliestExpiry: selectedPackages.map(item => ({ value: item.expiry, at: parseApiDate(item.expiry) }))
          .filter(item => item.value && Number.isFinite(item.at)).sort((a, b) => a.at - b.at)[0]?.value || null,
        totalMb: totalMb > 0 ? totalMb : null,
        remainingMb,
        packageCount: selectedPackages.length,
        signature
      };
    };
    if (normalPackages.length) {
      const scheduleKnown = !unknownNightWindow;
      buckets.push(buildBucket("normal", "normal", normalPackages, null,
        scheduleKnown ? excludedWindows : [], scheduleKnown,
        unknownNightWindow ? "ساعت بسته شبانه فعال مشخص نیست؛ مصرف عادی از نظر زمانی قابل تفکیک نیست." : null));
    }
    const nightGroups = new Map();
    for (const item of nightPackages) {
      const key = item.usageWindow ? `night:${item.usageWindow.startMinute}-${item.usageWindow.endMinute}` : `night:unknown`;
      if (!nightGroups.has(key)) nightGroups.set(key, []);
      nightGroups.get(key).push(item);
    }
    for (const [key, group] of nightGroups) {
      const window = group.every(item => item.usageWindow &&
        item.usageWindow.startMinute === group[0].usageWindow.startMinute &&
        item.usageWindow.endMinute === group[0].usageWindow.endMinute) ? group[0].usageWindow : null;
      buckets.push(buildBucket("night", key, group, window, [], Boolean(window),
        window ? null : "عنوان بسته ساعت دقیق استفاده را مشخص نمی‌کند؛ پیش‌بینی مصرف غیرفعال است."));
    }
    return buckets;
  }

  function exposureMinutesBetween(from, to, bucket) {
    if (!bucket?.scheduleKnown || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    const elapsed = (to - from) / MINUTE_MS;
    if (bucket.kind === "night") return overlapMinutesForWindows(from, to, [bucket.window]);
    if (bucket.kind === "normal") {
      const excluded = overlapMinutesForWindows(from, to, bucket.excludedWindows || []);
      return Math.max(0, elapsed - excluded);
    }
    return null;
  }

  function analyzeUsageBuckets(history, currentSample, now = Date.now()) {
    const currentBuckets = Array.isArray(currentSample?.usageBuckets) ? currentSample.usageBuckets : [];
    return currentBuckets.map(bucket => {
      const base = { ...bucket, usagePerCycleMb: null, cyclesToExhaust: null, sampleCount: 0,
        elapsedHours: 0, exposureHours: 0, confidence: "none", forecastReason: null };
      if (!bucket.scheduleKnown) {
        base.forecastReason = bucket.scheduleReason || "ساعت مجاز مصرف مشخص نیست.";
        return base;
      }
      if (bucket.remainingMb == null || bucket.totalMb == null || bucket.totalMb <= 0) {
        base.forecastReason = "مانده مستقل این گروه از بسته‌ها در API مشخص نیست.";
        return base;
      }
      const points = (Array.isArray(history) ? history : []).map(sample => {
        const match = Array.isArray(sample?.usageBuckets)
          ? sample.usageBuckets.find(item => item.key === bucket.key && item.signature === bucket.signature)
          : null;
        return match && match.remainingMb != null && Number.isFinite(sample.at) && sample.at <= now && sample.at >= now - 14 * DAY_MS
          ? { at: sample.at, remainingMb: match.remainingMb, totalMb: match.totalMb } : null;
      }).filter(Boolean);
      points.push({ at: currentSample.at, remainingMb: bucket.remainingMb, totalMb: bucket.totalMb });
      points.sort((a, b) => a.at - b.at);
      const unique = points.filter((point, index) => index === 0 || point.at !== points[index - 1].at);
      if (unique.length < 2) {
        base.sampleCount = unique.length;
        base.forecastReason = "برای هر نوع بسته جداگانه، حداقل دو نمونه در زمان‌های مختلف لازم است.";
        return base;
      }
      let segmentStart = 0;
      for (let i = 1; i < unique.length; i++) {
        if (unique[i].remainingMb > unique[i - 1].remainingMb + 0.5) segmentStart = i;
      }
      const segment = unique.slice(segmentStart);
      let consumptionMb = 0;
      let exposureMs = 0;
      let elapsedMs = 0;
      let validIntervals = 0;
      for (let i = 1; i < segment.length; i++) {
        const prev = segment[i - 1], next = segment[i];
        const elapsed = next.at - prev.at;
        if (elapsed <= 0 || elapsed > 7 * DAY_MS) continue;
        const exposureMinutes = exposureMinutesBetween(prev.at, next.at, bucket);
        if (exposureMinutes == null) continue;
        const consumed = prev.remainingMb - next.remainingMb;
        const elapsedMinutes = elapsed / MINUTE_MS;
        // For regular bundles, a balance drop across both eligible and excluded
        // night time cannot be attributed to daytime safely, so omit that pair.
        const crossesExcludedTime = bucket.kind === "normal" && exposureMinutes < elapsedMinutes - 1;
        if (consumed > 0.5 && (crossesExcludedTime || (bucket.kind === "night" && exposureMinutes < 1))) continue;
        exposureMs += exposureMinutes * MINUTE_MS;
        elapsedMs += elapsed;
        validIntervals++;
        if (consumed > 0 && consumed <= prev.totalMb + 1) consumptionMb += consumed;
      }
      const exposureHours = exposureMs / 3600000;
      const expectedHours = Number(bucket.expectedExposureHoursPerDay);
      base.sampleCount = segment.length;
      base.elapsedHours = elapsedMs / 3600000;
      base.exposureHours = exposureHours;
      if (segment.length < 3 || validIntervals < 2 || exposureHours < 2 || !(consumptionMb > 0) || !(expectedHours > 0)) {
        base.forecastReason = "برای تخمین، حداقل سه نمونه و دو ساعت داده در ساعات مجاز همین بسته لازم است.";
        return base;
      }
      const usagePerCycleMb = (consumptionMb / exposureHours) * expectedHours;
      if (!Number.isFinite(usagePerCycleMb) || usagePerCycleMb <= 0) {
        base.forecastReason = "روند مصرف هنوز قابل برآورد نیست.";
        return base;
      }
      base.usagePerCycleMb = usagePerCycleMb;
      base.cyclesToExhaust = bucket.remainingMb / usagePerCycleMb;
      base.confidence = segment.length >= 6 && exposureHours >= (bucket.kind === "night" ? 8 : 24) ? "high"
        : segment.length >= 3 && exposureHours >= (bucket.kind === "night" ? 2 : 4) ? "medium" : "low";
      base.forecastReason = null;
      return base;
    });
  }

  function extractCatalogOffers(payload, maxOffers = 3000) {
    const candidates = [];
    const seenObjects = new Set();
    const visited = new Set();
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== "object" || visited.has(value) || depth > 30 || candidates.length >= maxOffers) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      const hasIdentity = value.offer_id != null || value.upc_code != null;
      const type = String(value.offer_type ?? value.type ?? "").toLowerCase();
      const price = readNumber(value.price ?? value.final_price ?? value.finalPrice);
      const volume = readNumber(value.volume ?? value.data_volume ?? value.dataVolume);
      if (hasIdentity && (!type || type === "data") && price > 0 && volume > 0) {
        const id = String(value.offer_id ?? value.upc_code);
        const duplicateKey = `${id}|${price}|${volume}`;
        if (!seenObjects.has(duplicateKey)) {
          seenObjects.add(duplicateKey);
          candidates.push({
            id,
            offer_id: id,
            title: getOfferTitle(value),
            price,
            volume,
            pricePerGb: price / (volume / 1024),
            duration: readNumber(value.duration ?? value.validity ?? value.duration_value),
            duration_unit: String(value.duration_unit ?? value.durationUnit ?? value.validity_unit ?? "").slice(0, 24),
            isNight: isNightOffer(value),
            raw: value
          });
        }
      }
      for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(payload);
    return candidates;
  }

  function rankOffers(offers) {
    const eligible = (Array.isArray(offers) ? offers : []).map(offer => {
      const price = readNumber(offer.price);
      const volume = readNumber(offer.volume);
      if (!(price > 0) || !(volume > 0)) return null;
      return { ...offer, price, volume, pricePerGb: price / (volume / 1024) };
    }).filter(Boolean);
    const night = eligible.filter(offer => offer.isNight === true || isNightOffer(offer.raw || offer))
      .sort((a, b) => a.pricePerGb - b.pricePerGb);
    const normal = eligible.filter(offer => !(offer.isNight === true || isNightOffer(offer.raw || offer)))
      .sort((a, b) => a.pricePerGb - b.pricePerGb);
    return { night: night[0] || null, normal: normal[0] || null };
  }

  function normalizeCatalogHistory(offers, maxItems = 150) {
    return (Array.isArray(offers) ? offers : [])
      .filter(offer => Number(offer?.price) > 0 && Number(offer?.volume) > 0)
      .map(offer => ({
        id: String(offer.offer_id || offer.id || offer.upc_code || offer.title || "").slice(0, 180),
        title: String(offer.title || offer.description || "بسته").slice(0, 180),
        price: Number(offer.price),
        volume: Number(offer.volume),
        pricePerGb: Number(offer.price) / (Number(offer.volume) / 1024)
      }))
      .sort((a, b) => a.pricePerGb - b.pricePerGb)
      .slice(0, maxItems);
  }

  function catalogFingerprint(offers, maxItems = 150) {
    return JSON.stringify(normalizeCatalogHistory(offers, maxItems)
      .map(offer => [offer.id, offer.title, offer.price, offer.volume])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }

  function sanitizeSettings(incoming, defaults = { lowDataPercent: 20, expiryDays: 3, enableNotifications: true, remainingProgress: false }) {
    const source = incoming && typeof incoming === "object" ? incoming : {};
    const low = Number(source.lowDataPercent ?? defaults.lowDataPercent);
    const expiry = Number(source.expiryDays ?? defaults.expiryDays);
    return {
      lowDataPercent: Math.min(50, Math.max(5, Number.isFinite(low) ? low : defaults.lowDataPercent)),
      expiryDays: Math.min(30, Math.max(0, Number.isFinite(expiry) ? expiry : defaults.expiryDays)),
      enableNotifications: source.enableNotifications === undefined
        ? defaults.enableNotifications : source.enableNotifications === true,
      remainingProgress: source.remainingProgress === undefined
        ? defaults.remainingProgress === true : source.remainingProgress === true
    };
  }

  function hashString(value) {
    // Small stable FNV-1a hash; used only for local notification IDs, not security.
    let hash = 0x811c9dc5;
    for (let i = 0; i < String(value).length; i++) {
      hash ^= String(value).charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function classifyHttpStatus(status) {
    if (status === 401) return "AUTH";
    if (status === 403) return "FORBIDDEN";
    if (status === 429) return "RATE_LIMIT";
    if (status >= 500) return "SERVER";
    return "HTTP";
  }

  return {
    DAY_MS,
    digitsToAscii,
    readNumber,
    parseApiDate,
    getActiveDataPackages,
    getPackageRemainingData,
    packageSignature,
    estimateUsage,
    createSample,
    extractUsageWindow,
    formatUsageWindow,
    createUsageBuckets,
    analyzeUsageBuckets,
    overlapMinutesForWindows,
    countUsageCyclesUntil,
    getOfferLabel,
    getOfferTitle,
    isNightOffer,
    extractCatalogOffers,
    rankOffers,
    normalizeCatalogHistory,
    catalogFingerprint,
    sanitizeSettings,
    hashString,
    classifyHttpStatus
  };
});
