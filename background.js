importScripts("core.js");

const Core = globalThis.IrancellCore;
const GREEN = "#20c86b";
const RED = "#ed4545";
const GRAY = "#7d8794";
const ACCOUNT_API = "https://my.irancell.ir/api/sim/v3/account";
const PROFILE_API = "https://my.irancell.ir/api/sim/v1/profile";
const CATALOG_API = "https://my.irancell.ir/api/catalog/v2/offers?type=data&category=normal";
const OFFICIAL_ORIGIN = "https://my.irancell.ir";
const SESSION_KEY = "irancellSession";
const APP_VERSION_KEY = "irancellAppVersion";
const HISTORY_KEY = "irancellHistory";
const BALANCE_HISTORY_KEY = "irancellBalanceHistory";
const CATALOG_HISTORY_KEY = "irancellCatalogHistory";
const SETTINGS_KEY = "irancellSettings";
const NOTIFIED_KEY = "irancellNotificationLedger";
const LAST_HEALTH_KEY = "lastHealth";
const DASHBOARD_CACHE_KEY = "irancellDashboardCache";
const CATALOG_CACHE_KEY = "irancellCatalogCache";
const SESSION_MODE_KEY = "irancellSessionMode";
const POLLING_PAUSED_KEY = "irancellPollingPaused";
const SCHEMA_VERSION_KEY = "irancellSchemaVersion";
const REJECTED_TOKEN_HASH_KEY = "irancellRejectedTokenHash";
const LAST_SUCCESSFUL_FETCH_KEY = "lastSuccessfulFetch";
const AUTH_NOTIFICATION_ID = "irancell-auth-expired";
const DEFAULT_SETTINGS = { lowDataPercent: 20, expiryDays: 3, enableNotifications: true, remainingProgress: false };
const FETCH_TIMEOUT_MS = 14000;
const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const DASHBOARD_STALE_AFTER_MS = 5 * 60 * 1000;
const UI_HISTORY_LIMIT = 96;
const CURRENT_SCHEMA_VERSION = 6;
const HISTORY_LIMIT = 1500;
const CATALOG_HISTORY_LIMIT = 45;
const CATALOG_OFFERS_PER_SNAPSHOT = 100;
const NOTIFICATION_LEDGER_LIMIT = 200;
let inFlightFetch = null;
let clearingLocalData = false;
let storageWriteQueue = Promise.resolve();
const tabRefreshTimes = new Map();
const tabCaptureInFlight = new Map();

// Keep local extension data unavailable to any content scripts. The extension
// currently has none, but this is safer if content scripts are added in future.
try {
  chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  chrome.storage.session?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
} catch { /* Optional API in older Chromium implementations. */ }

function withStorageWriteLock(task) {
  const run = storageWriteQueue.then(task, task);
  storageWriteQueue = run.catch(() => {});
  return run;
}

async function getSessionMode() {
  const stored = await chrome.storage.local.get([SESSION_MODE_KEY, SESSION_KEY]);
  if (stored[SESSION_MODE_KEY] === "local" || stored[SESSION_MODE_KEY] === "session") {
    return stored[SESSION_MODE_KEY];
  }
  // Upgrade old versions safely: move any legacy persistent token into session storage.
  const legacySession = stored[SESSION_KEY];
  if (legacySession?.accessToken && chrome.storage.session) {
    await chrome.storage.session.set({ [SESSION_KEY]: legacySession });
    await chrome.storage.local.remove(SESSION_KEY);
  }
  await chrome.storage.local.set({ [SESSION_MODE_KEY]: "session" });
  return "session";
}

async function resumePolling() {
  await chrome.storage.local.remove(POLLING_PAUSED_KEY);
  await ensureAlarm();
  try { await chrome.notifications.clear(AUTH_NOTIFICATION_ID); } catch { /* Optional. */ }
}

async function pausePolling(reason, notify = false) {
  const stored = await chrome.storage.local.get(POLLING_PAUSED_KEY);
  const alreadyPaused = Boolean(stored[POLLING_PAUSED_KEY]);
  await chrome.storage.local.set({ [POLLING_PAUSED_KEY]: { reason, at: Date.now() } });
  try { await chrome.alarms.clear("irancell-session-check"); } catch { /* Optional. */ }
  if (notify && !alreadyPaused) {
    try {
      await chrome.notifications.create(AUTH_NOTIFICATION_ID, {
        type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "نشست ایرانسل نیاز به ورود مجدد دارد",
        message: "برای توقف درخواست‌های ناموفق، بررسی خودکار متوقف شد. سایت ایرانسل را باز کنید و دوباره وارد شوید."
      });
    } catch { /* Notifications are optional. */ }
  }
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return Core.sanitizeSettings(stored[SETTINGS_KEY], DEFAULT_SETTINGS);
}

function parseExpiry(value) {
  return Core.parseApiDate(value);
}

function calculateHistoryTrend(sample, history) {
  // Consumption is calculated independently for each eligibility window. Never
  // forecast from the sum of regular + nightly package balances.
  const buckets = Core.analyzeUsageBuckets(history, sample, sample.at);
  sample.usageBuckets = buckets;
  // Retain the legacy fields for old exports, but intentionally disable the
  // combined forecast so no UI can accidentally reuse a misleading aggregate.
  sample.usagePerDayMb = null;
  sample.forecastSampleCount = Math.max(0, ...buckets.map(bucket => bucket.sampleCount || 0));
  sample.forecastElapsedHours = Math.max(0, ...buckets.map(bucket => bucket.elapsedHours || 0));
  sample.forecastConfidence = buckets.some(bucket => bucket.confidence === "high") ? "high"
    : buckets.some(bucket => bucket.confidence === "medium") ? "medium"
      : buckets.some(bucket => bucket.confidence === "low") ? "low" : "none";
  return {
    usagePerDayMb: null,
    sampleCount: sample.forecastSampleCount,
    elapsedHours: sample.forecastElapsedHours,
    confidence: sample.forecastConfidence,
    buckets
  };
}

async function saveSnapshot(data, offers) {
  return withStorageWriteLock(async () => {
  const now = Date.now();
  const stored = await chrome.storage.local.get([HISTORY_KEY, CATALOG_HISTORY_KEY, BALANCE_HISTORY_KEY]);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const sample = Core.createSample(data, history, now);
  const estimate = calculateHistoryTrend(sample, history);
  const historyTrimmed = [...history, sample].slice(-HISTORY_LIMIT);

  const catalogHistory = (Array.isArray(stored[CATALOG_HISTORY_KEY]) ? stored[CATALOG_HISTORY_KEY] : [])
    .slice(-CATALOG_HISTORY_LIMIT);
  const normalizedOffers = Core.normalizeCatalogHistory(offers, CATALOG_OFFERS_PER_SNAPSHOT);
  const currentFingerprint = Core.catalogFingerprint(offers, CATALOG_OFFERS_PER_SNAPSHOT);
  const previousEntry = catalogHistory[catalogHistory.length - 1];
  const changed = !previousEntry || previousEntry.fingerprint !== currentFingerprint;
  const dueForPeriodicSnapshot = !previousEntry || now - Number(previousEntry.at || 0) >= 24 * Core.DAY_MS;
  let catalogTrimmed = catalogHistory;
  if (normalizedOffers.length && (changed || dueForPeriodicSnapshot)) {
    const entry = { at: now, fingerprint: currentFingerprint, offers: normalizedOffers };
    catalogTrimmed = [...catalogHistory, entry].slice(-CATALOG_HISTORY_LIMIT);
  }
  // Compact daily ledger: multiple refreshes replace today's row, never duplicate it.
  const rawBalance = Core.readNumber(data?.main_account_balance);
  const balanceHistory = Array.isArray(stored[BALANCE_HISTORY_KEY]) ? stored[BALANCE_HISTORY_KEY] : [];
  const iranDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(now));
  let dailyBalanceHistory = balanceHistory.slice();
  if (rawBalance != null && rawBalance >= 0) {
    const row = { day: iranDay, at: now, balance: rawBalance / 10 };
    const existingIndex = dailyBalanceHistory.findIndex(item => item?.day === iranDay);
    if (existingIndex >= 0) dailyBalanceHistory[existingIndex] = row;
    else dailyBalanceHistory.push(row);
    dailyBalanceHistory = dailyBalanceHistory.slice(-730);
  }
  await chrome.storage.local.set({
    [HISTORY_KEY]: historyTrimmed,
    [CATALOG_HISTORY_KEY]: catalogTrimmed,
    [BALANCE_HISTORY_KEY]: dailyBalanceHistory
  });
  return { sample, history: historyTrimmed, catalogHistory: catalogTrimmed, estimate };
  });
}

async function maybeNotify(sample, history) {
  const settings = await readSettings();
  if (!settings.enableNotifications || !sample) return;
  const stored = await chrome.storage.local.get(NOTIFIED_KEY);
  const ledger = Array.isArray(stored[NOTIFIED_KEY]) ? stored[NOTIFIED_KEY] : [];
  const notified = new Set(ledger);
  const rememberAndNotify = async (key, title, message, idPrefix) => {
    if (notified.has(key)) return;
    try {
      await chrome.notifications.create(`${idPrefix}-${Core.hashString(key)}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title,
        message
      });
      notified.add(key);
    } catch (error) {
      // Notifications are optional; never fail a successful API refresh because of them.
      console.warn("Irancell notification could not be displayed.", error?.message || "unknown error");
    }
  };

  // Low-volume alerts are bucket-specific. A large night bundle must not mask
  // an almost-empty regular bundle (or vice versa).
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const previousBuckets = Array.isArray(previous?.usageBuckets) ? previous.usageBuckets : [];
  for (const bucket of Array.isArray(sample.usageBuckets) ? sample.usageBuckets : []) {
    if (bucket.remainingMb == null || !(bucket.totalMb > 0)) continue;
    const pct = bucket.remainingMb / bucket.totalMb * 100;
    const prior = previousBuckets.find(item => item.key === bucket.key && item.signature === bucket.signature);
    const previousPct = prior?.remainingMb != null && prior?.totalMb > 0
      ? prior.remainingMb / prior.totalMb * 100 : null;
    const crossed = previousPct == null ? pct <= settings.lowDataPercent :
      previousPct > settings.lowDataPercent && pct <= settings.lowDataPercent;
    const notificationKey = `low|${bucket.key}|${bucket.signature}|${settings.lowDataPercent}`;
    if (crossed) {
      const label = bucket.kind === "night" ? `بسته شبانه (${bucket.windowLabel})` : "بسته عادی";
      await rememberAndNotify(
        notificationKey,
        `حجم ${label} رو به اتمام است`,
        `حدود ${Math.round(pct)}٪ از حجم همین گروه بسته باقی مانده است.`,
        "irancell-low-data"
      );
    }
  }

  const previousPackages = Array.isArray(previous?.packages) ? previous.packages : [];
  for (const activePackage of Array.isArray(sample.packages) ? sample.packages : []) {
    if (!activePackage.expiry) continue;
    const expiry = parseExpiry(activePackage.expiry);
    if (!Number.isFinite(expiry)) continue;
    const days = (expiry - Date.now()) / Core.DAY_MS;
    if (days < 0 || days > settings.expiryDays) continue;
    const packageKey = `${activePackage.id}|${activePackage.expiry}|${settings.expiryDays}`;
    const matchingPrevious = previousPackages.find(item => item.id === activePackage.id && item.expiry === activePackage.expiry);
    const previousExpiry = matchingPrevious ? parseExpiry(matchingPrevious.expiry) : NaN;
    const previousDays = Number.isFinite(previousExpiry) && Number.isFinite(previous?.at)
      ? (previousExpiry - previous.at) / Core.DAY_MS : NaN;
    // Trigger on first observation inside the selected window, or when crossing it.
    if (!matchingPrevious || !Number.isFinite(previousDays) || previousDays > settings.expiryDays) {
      await rememberAndNotify(
        `expiry|${packageKey}`,
        "یکی از بسته‌های اینترنت نزدیک انقضاست",
        `${activePackage.name}: حدود ${Math.ceil(Math.max(0, days))} روز تا پایان اعتبار باقی مانده است.`,
        "irancell-expiry"
      );
    }
  }

  await chrome.storage.local.set({ [NOTIFIED_KEY]: [...notified].slice(-NOTIFICATION_LEDGER_LIMIT) });
}

async function setState(state, title) {
  const color = state === "ok" ? GREEN : state === "bad" ? RED : GRAY;
  // A text badge is cheap and avoids fetching/rasterizing four icon sizes on every state change.
  try {
    await chrome.action.setBadgeText({ text: state === "ok" ? "✓" : state === "bad" ? "!" : "" });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* Toolbar badges are a non-critical enhancement. */ }
  try { await chrome.action.setTitle({ title }); } catch { /* Browser may restrict toolbar updates. */ }
}

function isOfficialIrancellTab(tab) {
  try {
    return new URL(tab?.url || "").origin === OFFICIAL_ORIGIN;
  } catch {
    return false;
  }
}

// Read the session only from the official My Irancell origin. Never log or return
// the token to the popup. The value remains in extension-local storage.
async function captureSessionFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isOfficialIrancellTab(tab)) return false;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        try {
          const store = JSON.parse(localStorage.getItem("NGMI-Sessions") || "null");
          const index = Number.isInteger(store?.active) ? store.active : 0;
          const session = store?.list?.[index];
          if (typeof session?.access_token !== "string" || !session.access_token.trim()) return null;
          return {
            accessToken: session.access_token,
            appVersion: localStorage.getItem("NGMI-appVersion") || "9.81.1"
          };
        } catch { return null; }
      }
    });
    const session = results?.[0]?.result;
    if (typeof session?.accessToken !== "string" || !session.accessToken.trim() || session.accessToken.length > 8192) return false;
    const rejected = await chrome.storage.local.get(REJECTED_TOKEN_HASH_KEY);
    if (rejected[REJECTED_TOKEN_HASH_KEY] && rejected[REJECTED_TOKEN_HASH_KEY] === Core.hashString(session.accessToken)) return false;
    const mode = await getSessionMode();
    const sessionRecord = { accessToken: session.accessToken, capturedAt: Date.now() };
    if (mode === "local") {
      await chrome.storage.local.set({ [SESSION_KEY]: sessionRecord });
      await chrome.storage.session?.remove(SESSION_KEY);
    } else {
      await chrome.storage.session.set({ [SESSION_KEY]: sessionRecord });
      await chrome.storage.local.remove(SESSION_KEY);
    }
    await chrome.storage.local.set({ [APP_VERSION_KEY]: String(session.appVersion || "9.81.1").slice(0, 80) });
    await chrome.storage.local.remove(REJECTED_TOKEN_HASH_KEY);
    await resumePolling();
    return true;
  } catch {
    return false;
  }
}

async function findAndCaptureOpenTab() {
  try {
    const tabs = await chrome.tabs.query({ url: [`${OFFICIAL_ORIGIN}/*`] });
    const tab = tabs.find(item => item.status === "complete") || tabs[0];
    if (!tab?.id || !isOfficialIrancellTab(tab)) return false;
    // Give the site's SPA a moment to write the session after login/navigation.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await captureSessionFromTab(tab.id)) return true;
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  } catch { /* No open tab or restricted scripting context. */ }
  return false;
}

async function getStoredSession() {
  const mode = await getSessionMode();
  const tokenStore = mode === "local" ? chrome.storage.local : chrome.storage.session;
  const [stored, meta] = await Promise.all([
    tokenStore.get(SESSION_KEY), chrome.storage.local.get(APP_VERSION_KEY)
  ]);
  return { session: stored[SESSION_KEY], appVersion: meta[APP_VERSION_KEY] || "9.81.1", mode };
}

async function changeSessionMode(mode) {
  if (mode !== "local" && mode !== "session") return { ok: false, error: "INVALID_MODE" };
  const current = await getStoredSession();
  await chrome.storage.local.set({ [SESSION_MODE_KEY]: mode });
  if (current.session?.accessToken) {
    if (mode === "local") await chrome.storage.local.set({ [SESSION_KEY]: current.session });
    else await chrome.storage.session.set({ [SESSION_KEY]: current.session });
  }
  if (mode === "local") await chrome.storage.session.remove(SESSION_KEY);
  else await chrome.storage.local.remove(SESSION_KEY);
  return { ok: true, mode };
}

async function ensureStorageSchema() {
  const stored = await chrome.storage.local.get([SCHEMA_VERSION_KEY, HISTORY_KEY]);
  const previousVersion = Number(stored[SCHEMA_VERSION_KEY] || 0);
  if (previousVersion < CURRENT_SCHEMA_VERSION) {
    // Before schema v6, package.remainingMb could have originated from the
    // ambiguous global_data_remaining field. Keep history and package metadata,
    // but invalidate unproven per-package balances rather than carry a false
    // normal/night split forward after an upgrade.
    const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    let changedHistory = false;
    const migrated = history.map(sample => {
      if (!Array.isArray(sample?.packages)) {
        if (sample?.remainingMb == null && sample?.usagePerDayMb == null) return sample;
        changedHistory = true;
        return { ...sample, remainingMb: null, usagePerDayMb: null, usageBuckets: [] };
      }
      let changedSample = false;
      const packages = sample.packages.map(item => {
        if (item.remainingSource === "package" || item.remainingSource === "unknown" || item.remainingSource === "invalid-package-field") return item;
        changedSample = true;
        return { ...item, remainingMb: null, remainingSource: "legacy-unverified" };
      });
      if (!changedSample) return sample;
      changedHistory = true;
      return {
        ...sample,
        packages,
        remainingMb: null,
        usageBuckets: Core.createUsageBuckets(packages),
        usagePerDayMb: null,
        forecastSampleCount: 0,
        forecastElapsedHours: 0,
        forecastConfidence: "none"
      };
    });
    const updates = { [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION };
    if (changedHistory) updates[HISTORY_KEY] = migrated;
    await chrome.storage.local.set(updates);
  }
  await getSessionMode(); // Migrates a legacy persistent token to session-only storage.
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, headers) {
  let lastError;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET", credentials: "include", headers, cache: "no-store",
        redirect: "follow", signal: controller.signal
      });
      if (attempt < maxAttempts - 1 && (response.status === 429 || response.status >= 500)) {
        let retryAfterMs = 0;
        const retryAfter = response.headers?.get?.("Retry-After");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const parsedDate = Date.parse(retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = seconds * 1000;
          else if (Number.isFinite(parsedDate)) retryAfterMs = Math.max(0, parsedDate - Date.now());
        }
        clearTimeout(timer);
        try { await response.body?.cancel(); } catch { /* Response body is optional. */ }
        const exponential = 300 * (2 ** attempt);
        await sleep(Math.min(5000, Math.max(retryAfterMs, exponential + Math.floor(Math.random() * 250))));
        continue;
      }
      const bodyText = await response.text();
      clearTimeout(timer);
      return { status: response.status, ok: response.ok, headers: response.headers, bodyText };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(300 * (2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
    }
  }
  if (lastError?.name === "AbortError") {
    const error = new Error("Request timeout"); error.code = "TIMEOUT"; throw error;
  }
  const error = new Error("Network request failed"); error.code = "NETWORK"; throw error;
}

async function fetchCatalogIfStale(headers) {
  const stored = await chrome.storage.local.get(CATALOG_CACHE_KEY);
  const cached = stored[CATALOG_CACHE_KEY];
  const cachedOffers = Array.isArray(cached?.offers) ? cached.offers : [];
  const cacheAge = cached?.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
  if (cachedOffers.length && cacheAge >= 0 && cacheAge < CATALOG_CACHE_TTL_MS) {
    return { response: { status: cached.status || 200, ok: true, cached: true }, offers: cachedOffers,
      cached: true, fetchedAt: cached.fetchedAt, ageMs: cacheAge, error: null };
  }
  const lastAttemptAt = Number(cached?.lastAttemptAt || 0);
  if (lastAttemptAt > 0 && Date.now() - lastAttemptAt >= 0 &&
      Date.now() - lastAttemptAt < CATALOG_FAILURE_BACKOFF_MS) {
    return { response: null, offers: cachedOffers, cached: cachedOffers.length > 0,
      fetchedAt: cached?.fetchedAt || null, ageMs: cached?.fetchedAt ? Date.now() - cached.fetchedAt : null,
      error: cached?.lastError || "CATALOG_BACKOFF" };
  }
  // Record the attempt before network I/O so an offline endpoint does not get
  // hammered each time a user presses refresh. Keep the previous cache intact.
  const attemptedAt = Date.now();
  await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
    ...(cached || {}), lastAttemptAt: attemptedAt
  } });
  try {
    const response = await fetchWithRetry(CATALOG_API, headers);
    if (!response.ok) {
      await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
        ...(cached || {}), lastAttemptAt: attemptedAt, lastError: Core.classifyHttpStatus(response.status)
      } });
      return { response, offers: cachedOffers, cached: cachedOffers.length > 0,
        fetchedAt: cached?.fetchedAt || null, ageMs: cached?.fetchedAt ? Date.now() - cached.fetchedAt : null,
        error: Core.classifyHttpStatus(response.status) };
    }
    let payload;
    try { payload = await safeJson(response); }
    catch (error) {
      await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
        ...(cached || {}), lastAttemptAt: attemptedAt, lastError: error.code || "NOT_JSON"
      } });
      return { response, offers: cachedOffers, cached: cachedOffers.length > 0,
        fetchedAt: cached?.fetchedAt || null, ageMs: cached?.fetchedAt ? Date.now() - cached.fetchedAt : null,
        error: error.code || "NOT_JSON" };
    }
    const extracted = Core.extractCatalogOffers(payload, 3000);
    // Drop raw API objects before persistence; store only fields needed by comparison UI.
    const offers = extracted.slice(0, 1200).map(item => ({
      id: String(item.id || item.offer_id || ""), offer_id: String(item.offer_id || item.id || ""),
      title: String(item.title || "بسته اینترنت").slice(0, 240), price: Number(item.price),
      volume: Number(item.volume), pricePerGb: Number(item.pricePerGb), isNight: item.isNight === true,
      duration: Number(item.duration) > 0 ? Number(item.duration) : null,
      duration_unit: String(item.duration_unit || "").slice(0, 24)
    }));
    if (offers.length) {
      const fetchedAt = Date.now();
      await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
        fetchedAt, lastAttemptAt: fetchedAt, lastError: null, status: response.status, offers
      } });
      return { response, offers, cached: false, fetchedAt, ageMs: 0, error: null };
    }
    await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
      ...(cached || {}), lastAttemptAt: attemptedAt, lastError: "EMPTY_CATALOG"
    } });
    return { response, offers: cachedOffers, cached: cachedOffers.length > 0,
      fetchedAt: cached?.fetchedAt || null, ageMs: cached?.fetchedAt ? Date.now() - cached.fetchedAt : null,
      error: "EMPTY_CATALOG" };
  } catch (error) {
    await chrome.storage.local.set({ [CATALOG_CACHE_KEY]: {
      ...(cached || {}), lastAttemptAt: attemptedAt, lastError: error?.code || "NETWORK"
    } });
    return { response: null, offers: cachedOffers, cached: cachedOffers.length > 0,
      fetchedAt: cached?.fetchedAt || null, ageMs: cached?.fetchedAt ? Date.now() - cached.fetchedAt : null,
      error: error?.code || "NETWORK" };
  }
}

async function safeJson(response) {
  if (!response) return null;
  try {
    if (typeof response.bodyText === "string") return JSON.parse(response.bodyText);
    return await response.json();
  } catch {
    const error = new Error("Invalid JSON response"); error.code = "NOT_JSON"; throw error;
  }
}

async function storeHealth(health) {
  const normalized = { at: Date.now(), ...health };
  await chrome.storage.local.set({ [LAST_HEALTH_KEY]: normalized });
  return normalized;
}

function publicOffer(offer) {
  if (!offer) return null;
  return {
    offer_id: String(offer.id || offer.offer_id || ""),
    title: String(offer.title || offer.name || "بسته اینترنت").slice(0, 240),
    price: Number(offer.price),
    volume: Number(offer.volume),
    pricePerGb: Number(offer.pricePerGb),
    duration: Number(offer.duration) > 0 ? Number(offer.duration) : null,
    duration_unit: String(offer.duration_unit || "").slice(0, 24),
    isNight: offer.isNight === true
  };
}

async function performFetch(allowSessionRecovery = true) {
  const initial = await getStoredSession();
  if (!initial.session?.accessToken) await findAndCaptureOpenTab();
  const latest = await getStoredSession();
  if (!latest.session?.accessToken) {
    await pausePolling("NO_SESSION", false);
    await setState("bad", "ایرانسل‌یار: برای دریافت اطلاعات، ابتدا وارد سایت ایرانسل شوید");
    return { ok: false, error: "NO_STORED_SESSION" };
  }

  const headers = {
    Accept: "application/json, text/plain, */*", "Accept-Language": "fa",
    Authorization: latest.session.accessToken,
    "x-app-version": latest.appVersion || initial.appVersion || "9.81.1"
  };

  // Ask for account data first. If the session is invalid, do not spend more
  // requests on profile/catalog endpoints.
  let accountResponse;
  try {
    accountResponse = await fetchWithRetry(ACCOUNT_API, headers);
  } catch (error) {
    const code = error?.code === "TIMEOUT" ? "TIMEOUT" : "NETWORK";
    await storeHealth({ accountStatus: null, profileStatus: null, catalogStatus: null, error: code });
    await setState("bad", "ایرانسل‌یار: ارتباط مستقیم با API برقرار نشد");
    return { ok: false, error: code };
  }

  if (accountResponse.status === 401) {
    const oldToken = latest.session.accessToken;
    const tokenStore = latest.mode === "local" ? chrome.storage.local : chrome.storage.session;
    await chrome.storage.local.set({ [REJECTED_TOKEN_HASH_KEY]: Core.hashString(oldToken) });
    await tokenStore.remove(SESSION_KEY);
    if (allowSessionRecovery && await findAndCaptureOpenTab()) {
      const refreshed = await getStoredSession();
      if (refreshed.session?.accessToken && refreshed.session.accessToken !== oldToken) {
        return performFetch(false);
      }
      const latestStore = refreshed.mode === "local" ? chrome.storage.local : chrome.storage.session;
      await latestStore.remove(SESSION_KEY);
    }
    await storeHealth({ accountStatus: 401, profileStatus: null, catalogStatus: null, error: "AUTH" });
    await pausePolling("AUTH", true);
    await setState("bad", "ایرانسل‌یار: نشست منقضی شده است؛ دوباره وارد سایت شوید");
    return { ok: false, error: "AUTH" };
  }
  if (!accountResponse.ok) {
    const error = Core.classifyHttpStatus(accountResponse.status);
    await storeHealth({ accountStatus: accountResponse.status, profileStatus: null, catalogStatus: null, error });
    await setState("bad", `ایرانسل‌یار: API خطای ${accountResponse.status} برگرداند`);
    return { ok: false, error: "HTTP", status: accountResponse.status };
  }

  let data;
  try { data = await safeJson(accountResponse); }
  catch (error) {
    await storeHealth({ accountStatus: accountResponse.status, profileStatus: null, catalogStatus: null, error: error.code || "NOT_JSON" });
    await setState("bad", "ایرانسل‌یار: پاسخ API قابل خواندن نیست");
    return { ok: false, error: error.code || "NOT_JSON" };
  }
  const hasActiveOffers = !!data && typeof data === "object" && Object.hasOwn(data, "active_offers");
  const hasBalance = !!data && typeof data === "object" && Object.hasOwn(data, "main_account_balance");
  const malformedOffers = hasActiveOffers && data.active_offers != null && !Array.isArray(data.active_offers);
  const malformedBalance = hasBalance && data.main_account_balance != null && Core.readNumber(data.main_account_balance) == null;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (!hasActiveOffers && !hasBalance) || malformedOffers || malformedBalance) {
    await storeHealth({ accountStatus: accountResponse.status, profileStatus: null, catalogStatus: null, error: "API_FORMAT" });
    await setState("bad", "ایرانسل‌یار: ساختار پاسخ API تغییر کرده است");
    return { ok: false, error: "API_FORMAT" };
  }

  const settled = await Promise.allSettled([
    fetchWithRetry(PROFILE_API, headers), fetchCatalogIfStale(headers)
  ]);
  const profileResponse = settled[0].status === "fulfilled" ? settled[0].value : null;
  const catalogResult = settled[1].status === "fulfilled" ? settled[1].value : {
    response: null, offers: [], cached: false, error: "NETWORK", ageMs: null, fetchedAt: null
  };
  const catalogResponse = catalogResult.response;
  let profile = null;
  if (profileResponse?.ok) {
    try { profile = await safeJson(profileResponse); } catch { profile = null; }
  }
  const offers = Array.isArray(catalogResult.offers) ? catalogResult.offers : [];
  const cheapestOffer = Core.rankOffers(offers);
  const publicCheapestOffer = {
    night: publicOffer(cheapestOffer.night), normal: publicOffer(cheapestOffer.normal)
  };

  let snapshotResult;
  try {
    snapshotResult = await saveSnapshot(data, offers);
    await maybeNotify(snapshotResult.sample, snapshotResult.history);
  } catch (error) {
    // Account data remains available even if a local history write fails.
    console.warn("Local insights could not be updated.", error?.message || "unknown error");
    const fallbackSample = Core.createSample(data, [], Date.now());
    snapshotResult = { sample: fallbackSample, history: [], catalogHistory: [], estimate: {
      usagePerDayMb: null, sampleCount: 0, elapsedHours: 0, confidence: "none"
    } };
  }

  const fetchedAt = Date.now();
  const health = await storeHealth({
    accountStatus: accountResponse.status,
    profileStatus: profileResponse?.status ?? null,
    catalogStatus: catalogResponse?.status ?? (catalogResult.cached ? 200 : null),
    catalogCount: offers.length,
    catalogCached: catalogResult.cached === true,
    catalogAgeMs: catalogResult.ageMs ?? 0,
    catalogError: catalogResult.error || null,
    error: null
  });
  await chrome.storage.local.set({
    [DASHBOARD_CACHE_KEY]: { data, profile, cheapestOffer: publicCheapestOffer, catalogOffers: offers, fetchedAt },
    [LAST_SUCCESSFUL_FETCH_KEY]: fetchedAt
  });
  await resumePolling();
  await setState("ok", "ایرانسل‌یار: اطلاعات حساب با موفقیت دریافت شد");
  return {
    ok: true, data, profile, cheapestOffer: publicCheapestOffer, catalogOffers: offers, fetchedAt,
    insights: {
      sample: snapshotResult.sample,
      history: snapshotResult.history.slice(-UI_HISTORY_LIMIT),
      catalogHistory: snapshotResult.catalogHistory,
      usagePerDayMb: snapshotResult.estimate.usagePerDayMb,
      forecast: snapshotResult.estimate, health
    },
    catalogCached: catalogResult.cached === true,
    catalogError: catalogResult.error || null
  };
}

async function fetchIrancellData() {
  if (clearingLocalData) return { ok: false, error: "BUSY" };
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = performFetch(true).catch(async error => {
    const code = error?.code === "TIMEOUT" ? "TIMEOUT" : "NETWORK";
    try {
      await storeHealth({ accountStatus: null, profileStatus: null, catalogStatus: null, error: code });
      await setState("bad", "ایرانسل‌یار: دریافت اطلاعات ناموفق بود");
    } catch { /* Return a controlled error even if status indicators fail. */ }
    return { ok: false, error: code };
  }).finally(() => { inFlightFetch = null; });
  return inFlightFetch;
}

async function getInsights(includeFullHistory = false) {
  const stored = await chrome.storage.local.get([
    HISTORY_KEY, CATALOG_HISTORY_KEY, LAST_HEALTH_KEY, SETTINGS_KEY, SESSION_MODE_KEY
  ]);
  const fullHistory = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const history = includeFullHistory ? fullHistory : fullHistory.slice(-UI_HISTORY_LIMIT);
  const rawLatest = fullHistory[fullHistory.length - 1] || null;
  // Do not trust legacy balances without source metadata, even if this message
  // arrives before the onInstalled schema migration completes. Keep metadata,
  // but require a fresh API sample to restore per-package remaining balances.
  let latest = rawLatest;
  if (rawLatest && Array.isArray(rawLatest.packages)) {
    const hasUnverifiedBalance = rawLatest.packages.some(item => item.remainingSource !== "package");
    if (!Array.isArray(rawLatest.usageBuckets) || hasUnverifiedBalance) {
      const packages = rawLatest.packages.map(item => item.remainingSource === "package"
        ? item : { ...item, remainingMb: null, remainingSource: item.remainingSource || "legacy-unverified" });
      latest = {
        ...rawLatest,
        packages,
        remainingMb: hasUnverifiedBalance ? null : rawLatest.remainingMb,
        usageBuckets: Core.createUsageBuckets(packages),
        usagePerDayMb: null,
        forecastSampleCount: 0,
        forecastElapsedHours: 0,
        forecastConfidence: "none"
      };
    }
  }
  return {
    history,
    catalogHistory: Array.isArray(stored[CATALOG_HISTORY_KEY]) ? stored[CATALOG_HISTORY_KEY] : [],
    health: stored[LAST_HEALTH_KEY] || null,
    settings: Core.sanitizeSettings(stored[SETTINGS_KEY], DEFAULT_SETTINGS),
    sample: latest,
    sessionMode: stored[SESSION_MODE_KEY] || await getSessionMode(),
    // No combined forecast is returned anymore; consumers must read the
    // independent sample.usageBuckets analytics instead.
    usagePerDayMb: null,
    forecast: null
  };
}

async function getCachedDashboard() {
  const stored = await chrome.storage.local.get(DASHBOARD_CACHE_KEY);
  const cache = stored[DASHBOARD_CACHE_KEY];
  if (!cache?.data || !Number.isFinite(cache.fetchedAt)) return { ok: false, error: "NO_CACHE" };
  return {
    ok: true, data: cache.data, profile: cache.profile || null,
    cheapestOffer: cache.cheapestOffer || { night: null, normal: null }, catalogOffers: Array.isArray(cache.catalogOffers) ? cache.catalogOffers : [],
    fetchedAt: cache.fetchedAt, ageMs: Math.max(0, Date.now() - cache.fetchedAt),
    insights: await getInsights(false)
  };
}

async function clearLocalData() {
  clearingLocalData = true;
  try {
    if (inFlightFetch) await inFlightFetch.catch(() => {});
    await withStorageWriteLock(async () => {
      await chrome.storage.local.remove([
        SESSION_KEY, APP_VERSION_KEY, HISTORY_KEY, CATALOG_HISTORY_KEY, BALANCE_HISTORY_KEY, LAST_HEALTH_KEY, NOTIFIED_KEY,
        DASHBOARD_CACHE_KEY, CATALOG_CACHE_KEY, LAST_SUCCESSFUL_FETCH_KEY, POLLING_PAUSED_KEY,
        REJECTED_TOKEN_HASH_KEY
      ]);
      await chrome.storage.session.remove(SESSION_KEY);
    });
    await pausePolling("NO_SESSION", false);
    await setState("idle", "ایرانسل‌یار: داده‌های محلی پاک شدند؛ برای ادامه دوباره وارد شوید");
    return { ok: true };
  } finally {
    clearingLocalData = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  if (message?.type === "IRANCELL_GET_DATA") {
    fetchIrancellData().then(sendResponse).catch(() => sendResponse({ ok: false, error: "NETWORK" }));
    return true;
  }
  if (message?.type === "IRANCELL_GET_INSIGHTS") {
    getInsights(false).then(sendResponse).catch(() => sendResponse({ history: [], catalogHistory: [], health: null,
      settings: DEFAULT_SETTINGS, sample: null, usagePerDayMb: null, forecast: null, sessionMode: "session" }));
    return true;
  }
  if (message?.type === "IRANCELL_GET_CACHED_DATA") {
    getCachedDashboard().then(sendResponse).catch(() => sendResponse({ ok: false, error: "CACHE_READ" }));
    return true;
  }
  if (message?.type === "IRANCELL_SAVE_SESSION_MODE") {
    changeSessionMode(message.mode).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "IRANCELL_SAVE_SETTINGS") {
    const settings = Core.sanitizeSettings(message.settings, DEFAULT_SETTINGS);
    chrome.storage.local.set({ [SETTINGS_KEY]: settings })
      .then(() => sendResponse({ ok: true, settings }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "IRANCELL_EXPORT_HISTORY") {
    getInsights(true).then(result => sendResponse({ ok: true, history: result.history }))
      .catch(() => sendResponse({ ok: false, history: [] }));
    return true;
  }
  if (message?.type === "IRANCELL_CLEAR_LOCAL_DATA") {
    clearLocalData().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "IRANCELL_CAPTURE_SESSION") {
    const tabId = sender?.tab?.id ?? message.tabId;
    if (Number.isInteger(tabId)) {
      captureSessionFromTab(tabId).then(ok => sendResponse({ ok }));
      return true;
    }
    findAndCaptureOpenTab().then(ok => sendResponse({ ok }));
    return true;
  }
});

async function ensureAlarm() {
  try {
    const state = await chrome.storage.local.get(POLLING_PAUSED_KEY);
    if (state[POLLING_PAUSED_KEY]) return;
    const alarm = await chrome.alarms.get("irancell-session-check");
    if (!alarm) await chrome.alarms.create("irancell-session-check", { periodInMinutes: 30 });
  } catch { /* Alarms are a convenience; manual refresh remains available. */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorageSchema();
  await ensureAlarm();
  try {
    const captured = await findAndCaptureOpenTab();
    if (!captured) {
      const session = await getStoredSession();
      if (!session.session?.accessToken) await pausePolling("NO_SESSION", false);
    }
  } catch { /* Installation does not depend on a logged-in tab. */ }
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureStorageSchema();
  await ensureAlarm();
  const stored = await chrome.storage.local.get(POLLING_PAUSED_KEY);
  if (!stored[POLLING_PAUSED_KEY]) fetchIrancellData();
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== "irancell-session-check") return;
  const state = await chrome.storage.local.get(POLLING_PAUSED_KEY);
  if (state[POLLING_PAUSED_KEY]) return;
  const stored = await getStoredSession();
  if (!stored.session?.accessToken) {
    await pausePolling("NO_SESSION", false);
    return;
  }
  fetchIrancellData();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isOfficialIrancellTab(tab)) return;
  const now = Date.now();
  if (now - (tabRefreshTimes.get(tabId) || 0) < 8000) return;
  if (tabCaptureInFlight.has(tabId)) return;
  tabRefreshTimes.set(tabId, now);
  const task = captureSessionFromTab(tabId).then(ok => { if (ok) fetchIrancellData(); })
    .catch(() => {}).finally(() => tabCaptureInFlight.delete(tabId));
  tabCaptureInFlight.set(tabId, task);
});
chrome.notifications.onClicked?.addListener?.(notificationId => {
  if (notificationId === AUTH_NOTIFICATION_ID) {
    chrome.tabs.create({ url: `${OFFICIAL_ORIGIN}/sessions/add` }).catch(() => {});
  }
});
