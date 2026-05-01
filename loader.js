/* OctoRoute Loader v15.13 — Visual order optimized for AOV: main → upsell → gift (addons stay in fixed footer). Item TAG only shows highest unlocked % discount tier (free shipping never leaks into product tag). */
(async () => {
  // v15.0: expose version flag immediately so script-bootstrap can detect mismatch
  try { window.__OCTO_LOADER_VERSION = 'v15.12'; } catch(e) {}

  // v15.5 — PageFly / Blum / Dawn compatibility shim.
  // Some page builders (notably PageFly) call `theme.cart.forceUpdateCartStatus()`
  // after Add to Cart. When OctoRoute replaces the native theme cart, that object
  // is undefined and the page builder throws, blocking the entire add-to-cart flow
  // (observed on desktop product pages built with PageFly on Blum/Dawn themes).
  // We expose harmless stubs that delegate to our own drawer refresh, so the page
  // builder thinks the theme cart is alive and our drawer opens normally.
  try {
    window.theme = window.theme || {};
    window.theme.cart = window.theme.cart || {};
    var _stubRefresh = function(open){
      try {
        if (typeof window._cfDebouncedCartRefresh === 'function') {
          window._cfDebouncedCartRefresh(!!open);
        } else if (open && typeof window._cfOpenCart === 'function') {
          window._cfOpenCart();
        }
      } catch(e) {}
    };
    if (typeof window.theme.cart.forceUpdateCartStatus !== 'function') {
      window.theme.cart.forceUpdateCartStatus = function(){ _stubRefresh(true); };
    }
    if (typeof window.theme.cart.open !== 'function') {
      window.theme.cart.open = function(){ _stubRefresh(true); };
    }
    if (typeof window.theme.cart.refresh !== 'function') {
      window.theme.cart.refresh = function(){ _stubRefresh(false); };
    }
    if (typeof window.refreshCart !== 'function') {
      window.refreshCart = function(){ _stubRefresh(true); };
    }
  } catch(e) {}

  // v14.5 — Multi-layer fail-closed referrer cloak.
  // Rule: a Vitrine page must NEVER send its URL as Referer to a White checkout.
  // Both meta[name=referrer] AND meta[http-equiv=Referrer-Policy] are injected
  // because Safari/WebKit prefers http-equiv form. Attribution is preserved
  // through URL params + Shopify note attributes, not the browser Referer header.
  window.__octoCloakReferrer = function(){
    try {
      var head = document.head || document.documentElement;
      // Remove any existing referrer metas (could be set by theme with looser policy)
      var existing = head.querySelectorAll ? head.querySelectorAll('meta[name="referrer" i], meta[http-equiv="Referrer-Policy" i]') : [];
      for (var i=0; i<existing.length; i++) {
        try { existing[i].parentNode.removeChild(existing[i]); } catch(e) {}
      }
      // Layer A: <meta name="referrer">
      var m1 = document.createElement('meta');
      m1.name = 'referrer';
      m1.content = 'no-referrer';
      head.appendChild(m1);
      // Layer B: <meta http-equiv="Referrer-Policy"> — canonical W3C form, Safari respects
      var m2 = document.createElement('meta');
      m2.setAttribute('http-equiv', 'Referrer-Policy');
      m2.content = 'no-referrer';
      head.appendChild(m2);
    } catch(e) {}
  };
  // v14.5: cloak IMMEDIATELY at loader boot — not only pre-checkout.
  // Reduces window where any cross-origin fetch could send Referer.
  try { window.__octoCloakReferrer(); } catch(e) {}
  // v11.11: pending buffers — capture user intent BEFORE config is ready
  window._cfPendingAdds = window._cfPendingAdds || [];
  window._cfPendingOpen = false;
  window._cfConfigReady = false;

  // v11.12: image cache + preload — prevents flicker when cart re-renders
  // Browser network cache helps but DOM swap still causes paint flash without this.
  window._cfImageCache = window._cfImageCache || new Map();
  window._cfPreloadImages = function(urls){
    try {
      const list = (urls||[]).filter(u => u && typeof u === 'string' && !window._cfImageCache.has(u));
      if (!list.length) return Promise.resolve();
      return Promise.all(list.map(function(url){
        return new Promise(function(resolve){
          try {
            const img = new Image();
            img.decoding = 'async';
            img.onload = function(){
              window._cfImageCache.set(url, true);
              if (typeof img.decode === 'function') {
                img.decode().then(function(){ resolve(); }).catch(function(){ resolve(); });
              } else { resolve(); }
            };
            img.onerror = function(){ resolve(); };
            img.src = url;
          } catch(e){ resolve(); }
        });
      })).then(function(){});
    } catch(e){ return Promise.resolve(); }
  };
  // Inline placeholder + sync decode attrs for any <img> we render
  // (1x1 transparent gif keeps box stable until real img paints)
  window._cfImgAttrs = 'loading="eager" decoding="sync" fetchpriority="high"';


  // — Tracking capture (triple-layer: localStorage + cookie 30d + sessionStorage) —
  (function(){
    var keys=['fbclid','ttclid','gclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','wbraid','gbraid','tikclid','irclickid','msclkid','li_fat_id','twclid','sccid','epik','ref','source'];
    var trunc=function(v){return typeof v==='string'&&v.length>200?v.substring(0,200):v};

    // Triple-layer restore: localStorage > cookie > sessionStorage
    var t={};
    try{t=JSON.parse(localStorage.getItem('_octo_tracking')||'{}')}catch(e){}
    if(!Object.keys(t).length){
      try{var ck=(document.cookie.match(/(?:^|; )_octo_tracking=([^;]*)/)||[])[1];if(ck)t=JSON.parse(decodeURIComponent(ck))}catch(e){}
    }
    if(!Object.keys(t).length){
      try{t=JSON.parse(sessionStorage.getItem('_octo_tracking')||'{}')}catch(e){}
    }

    // 1. URL params (primary)
    var p=new URLSearchParams(window.location.search);
    keys.forEach(function(k){var v=p.get(k);if(v)t[k]=trunc(v)});

    // 2. Hash params (e.g. #?utm_source=...)
    try{var hashQ=window.location.hash.split('?')[1];if(hashQ){var hp=new URLSearchParams(hashQ);keys.forEach(function(k){if(!t[k]){var v=hp.get(k);if(v)t[k]=trunc(v)}})}}catch(e){}

    // 3. Referrer UTM extraction (fallback like OctoRoute)
    // v14.5: NEVER store referrer hostname — it leaks Vitrine domain into checkout
    // attributes and Shopify order notes. Only extract UTM params from the referrer URL.
    if(document.referrer){
      try{
        var refUrl=new URL(document.referrer);
        var rp=refUrl.searchParams;
        keys.forEach(function(k){if(!t[k]){var v=rp.get(k);if(v)t[k]=trunc(v)}});
        // v14.5: removed t['referrer_domain'] — anti-correlation rule.
      }catch(e){}
    }
    // v14.5: scrub any legacy referrer_domain that may exist in stored payload
    try { delete t['referrer_domain']; delete t['referrer']; } catch(e) {}

    // Cookies: _fbp, _fbc, _ttp
    var fbp=(document.cookie.match(/(?:^|; )_fbp=([^;]*)/)||[])[1];
    var fbc=(document.cookie.match(/(?:^|; )_fbc=([^;]*)/)||[])[1];
    if(fbp)t['_fbp']=decodeURIComponent(fbp);
    if(fbc)t['_fbc']=decodeURIComponent(fbc);
    if(t.fbclid&&!t['_fbc'])t['_fbc']='fb.1.'+Date.now()+'.'+t.fbclid;
    var ttp=(document.cookie.match(/(?:^|; )_ttp=([^;]*)/)||[])[1];
    if(ttp)t['ttp']=decodeURIComponent(ttp);


    // Persistent visitor ID
    var vid=localStorage.getItem('_octo_vid');
    if(!vid){try{vid=crypto.randomUUID()}catch(e){vid='xxxx-xxxx'.replace(/x/g,function(){return(Math.random()*16|0).toString(16)})}localStorage.setItem('_octo_vid',vid);}
    // v13: prefer HTTP-only cookie mirror injected by script-bootstrap (resists Safari ITP — 1 year vs 7 days for JS cookies)
    if (window.__octoVid && window.__octoVid !== vid) {
      vid = window.__octoVid;
      try { localStorage.setItem('_octo_vid', vid); } catch(e) {}
    }
    try { window.__octoVid = vid; } catch(e) {} // ensure mirror exists even without bootstrap

    // Triple-layer persist
    var json=JSON.stringify(t);
    try{localStorage.setItem('_octo_tracking',json)}catch(e){}
    try{document.cookie='_octo_tracking='+encodeURIComponent(json)+';path=/;max-age=2592000;SameSite=Lax;Secure'}catch(e){}
    try{sessionStorage.setItem('_octo_tracking',json)}catch(e){}
  })();


  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';

  if (!TOKEN) { console.warn('[CartFlow] data-token not found'); return; }

  // Preconnect hint for API domain
  try {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://pdeontahcfqcvlxjtnka.supabase.co';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  } catch(e) {}

  let _cartReady = false;
  let _pendingOpen = false;
  let _spActive = false;
  let _gwActive = false;
  let _lastSkus = '';
  let _vitrineSkuMap = null;
  let _lastCart = null;
  let _upsellPending = false;
  let _hadInteraction = false;
  let _addedUpsellSkus = new Set();
  let _refreshTimer = null;
  const SCALE_MAP = { small: 1, medium: 1.15, large: 1.3 };
  let _fontScale = 1.15;
  const fs = (base) => Math.round(base * _fontScale);

  // ============ SESSION ID (v4) ============
  let _sessionId = null;
  try {
    _sessionId = sessionStorage.getItem('_octo_sid');
    if (!_sessionId) {
      _sessionId = 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('_octo_sid', _sessionId);
    }
  } catch(e) { _sessionId = 'sid_' + Date.now().toString(36); }


  // ============ TRACKING QUEUE (v14.6 — fetch keepalive, no sendBeacon) ============
  // v14.6: sendBeacon ignores meta Referrer-Policy in some engines and always
  // leaks the page URL as Referer. fetch with referrerPolicy:'no-referrer' is
  // honored by all engines; keepalive:true is the modern equivalent for unload.
  let _trackQueue = [];
  let _trackFlushTimer = null;

  function flushTrackQueue() {
    if (_trackQueue.length === 0) return;
    const batch = _trackQueue.splice(0);
    const payload = JSON.stringify({ events: batch });
    try {
      (window._cfOrigFetch || fetch)(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        credentials: 'omit'
      }).catch(() => {});
    } catch(e) {}
  }

  // v14.6: client-side scrub of correlation fields before they reach the wire.
  // Mirrors FORBIDDEN_KEYS in supabase/functions/store-checkout-attributes
  // so the client never even tries to emit hostnames or referrer metadata.
  function __octoScrubTracking(obj) {
    var FORBIDDEN = ['referrer_domain','referrer','referer','vitrine_url',
                     'source_url','landing_url','page_url','store_url',
                     'origin_store','host','hostname','origin'];
    var HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
    var out = {};
    Object.keys(obj || {}).forEach(function(k){
      if (FORBIDDEN.indexOf(String(k).toLowerCase()) !== -1) return;
      var v = obj[k];
      if (typeof v === 'string' && k.charAt(0) !== '_' && HOSTNAME_RE.test(v)) return;
      out[k] = v;
    });
    return out;
  }
  try { window.__octoScrubTracking = __octoScrubTracking; } catch(e) {}

  function trackEvent(type, amount=0, metadata={}) {
    // v13: propagate visitor_id top-level + in metadata so shopify-webhook can do first-touch lookup
    var __vid = (typeof window !== 'undefined' && window.__octoVid) || null;
    _trackQueue.push({
      token: TOKEN,
      event_type: type,
      amount,
      session_id: _sessionId,
      visitor_id: __vid,
      metadata: { ...metadata, user_agent: navigator.userAgent, visitor_id: __vid }
    });
    clearTimeout(_trackFlushTimer);
    _trackFlushTimer = setTimeout(flushTrackQueue, 1500);
  }

  // Flush on page unload
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTrackQueue();
    });
    window.addEventListener('pagehide', flushTrackQueue);
  } catch(e) {}

  // page_view tracking removed — not used by analytics dashboard

  // ============ BFCACHE RESET (v11) ============
  function resetCheckoutBtn() {
    const btn = document.getElementById('cf-checkout');
    if (btn) {
      btn.disabled = false;
      if (btn._origHtml) btn.innerHTML = btn._origHtml;
    }
  }
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      resetCheckoutBtn();
      fetchShopifyCart().then(cart => {
        window._lastCart = cart;
        if (window._cfConfig) renderCart(cart, window._cfConfig);
      }).catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resetCheckoutBtn();
    }
  });


  // ============ CART OPEN TIME TRACKING (v4) ============
  let _cartOpenedAt = null;

  // ============ CURRENCY CONVERSION (v15.0 — Shopify rates) ============
  // Source of truth: Shopify's /services/javascripts/currencies.js (auto-updated 2x/day,
  // ~150 currencies). No hardcoded fallback rates: if Shopify CDN is unreachable
  // (extremely rare — same uptime as Shopify itself), the drawer simply renders
  // prices in the store's native currency. Showing stale/wrong conversion would
  // be worse than showing native currency.
  const CURRENCY_LOCALE = {
    USD: 'en-US', BRL: 'pt-BR', EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP',
    CNY: 'zh-CN', AUD: 'en-AU', CAD: 'en-CA', CHF: 'de-CH', SEK: 'sv-SE',
    NOK: 'nb-NO', DKK: 'da-DK', PLN: 'pl-PL', MXN: 'es-MX', ARS: 'es-AR',
    INR: 'en-IN', KRW: 'ko-KR', SGD: 'en-SG', HKD: 'zh-HK', NZD: 'en-NZ',
    ZAR: 'en-ZA', TRY: 'tr-TR', RUB: 'ru-RU', AED: 'ar-AE', SAR: 'ar-SA',
    ILS: 'he-IL', THB: 'th-TH', MYR: 'ms-MY', IDR: 'id-ID', PHP: 'en-PH',
    VND: 'vi-VN', CZK: 'cs-CZ', HUF: 'hu-HU', RON: 'ro-RO', CLP: 'es-CL',
    COP: 'es-CO', PEN: 'es-PE',
  };
  const GEO_API = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/geo';
  const GEO_CACHE_KEY = '_octo_geo_cache';
  const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
  const CURRENCY_OVERRIDE_KEY = '_octo_currency';
  const RATES_CACHE_KEY = '_octo_rates_cache';
  const RATES_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h
  const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD';
  const HARDCODED_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.79, BRL: 5.48, CAD: 1.36,
    AUD: 1.53, JPY: 149.5, CHF: 0.90, SEK: 10.4, NOK: 10.6,
    DKK: 6.88, PLN: 3.97, MXN: 17.2, ARS: 870, CLP: 897,
    COP: 3950, PEN: 3.71, INR: 83.1, KRW: 1325, SGD: 1.34,
    HKD: 7.82, NZD: 1.63, ZAR: 18.6, TRY: 32.1, AED: 3.67,
    SAR: 3.75, ILS: 3.69, THB: 35.1, MYR: 4.71, IDR: 15650,
    PHP: 56.4, VND: 24850, CZK: 22.8, HUF: 356, RON: 4.58,
  };

  let _storeCurrency = 'USD';
  let _visitorCurrency = 'USD';
  let _shopifyRates = null; // normalized as USD base: { USD: 1, BRL: 5.48, ... }

  function normalizeRates(rawRates, source) {
    const raw = rawRates && typeof rawRates === 'object' ? rawRates : null;
    if (!raw || Object.keys(raw).length === 0) return null;
    const usd = Number(raw.USD || 1) || 1;
    const normalized = { USD: 1 };
    Object.keys(raw).forEach((code) => {
      const val = Number(raw[code]);
      if (!code || !isFinite(val) || val <= 0) return;
      // Shopify currencies.js rates are USD-per-currency (BRL≈0.20), while Frankfurter
      // uses currency-per-USD (BRL≈5.0). Normalize every source to currency-per-USD.
      normalized[code] = source === 'shopify' ? usd / val : val / usd;
    });
    normalized.USD = 1;
    return normalized;
  }

  function applyRates(rawRates, source) {
    const normalized = normalizeRates(rawRates, source);
    if (!normalized) return false;
    _shopifyRates = normalized;
    try { window.__octoRatesSource = source; } catch(e) {}
    return true;
  }

  // v15.5 — Single source of truth: Frankfurter (ECB daily rates).
  // We DO NOT inject Shopify's /services/javascripts/currencies.js anymore — it
  // conflicts with PageFly's `_pf_handleBlumTheme` which expects `theme.cart` to
  // be the original theme object. Frankfurter covers all currencies our merchants
  // use (USD/EUR/BRL/GBP/...) with <0.5% intra-day variance vs Shopify Payments.
  // If `window.Currency.rates` already exists (theme loaded it natively), we
  // happily use it — but we never trigger that load ourselves.
  async function loadShopifyRates() {
    try {
      // Opportunistic: if the theme natively exposed Shopify rates, prefer them.
      if (window.Currency && window.Currency.rates && Object.keys(window.Currency.rates).length > 0) {
        if (applyRates(window.Currency.rates, 'shopify-native')) return true;
      }

      // Cache (24h is fine — daily ECB rates don't move enough to matter).
      try {
        const raw = localStorage.getItem(RATES_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.rates && (Date.now() - (cached.ts || 0)) < RATES_CACHE_TTL && applyRates(cached.rates, 'cache')) return true;
        }
      } catch(e) {}

      // Frankfurter (free, no rate limit, ECB-backed).
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(FRANKFURTER_URL, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
        clearTimeout(t);
        if (r.ok) {
          const data = await r.json();
          if (data && data.rates && typeof data.rates === 'object') {
            const rates = { USD: 1, ...data.rates };
            if (applyRates(rates, 'frankfurter')) {
              try { localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates, ts: Date.now(), source: 'frankfurter' })); } catch(e) {}
              return true;
            }
          }
        }
      } catch(e) {}

      // Last resort: hardcoded snapshot (won't drift more than a few % over months).
      applyRates(HARDCODED_RATES, 'hardcoded');
      return true;
    } catch(e) {
      applyRates(HARDCODED_RATES, 'hardcoded');
      return true;
    }
  }

  async function detectVisitorCurrency() {
    // 1. Manual override (customer toggled in drawer)
    try {
      const ov = localStorage.getItem(CURRENCY_OVERRIDE_KEY);
      if (ov) return ov;
    } catch(e) {}
    // 2. localStorage cache
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.currency && (Date.now() - (c.ts||0)) < GEO_CACHE_TTL) {
          return c.currency;
        }
      }
    } catch(e) {}
    // 3. Edge function geo lookup
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1800);
      const r = await fetch(GEO_API, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        if (d && d.currency) {
          try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: d.country, currency: d.currency, ts: Date.now() })); } catch(e) {}
          return d.currency;
        }
      }
    } catch(e) {}
    // 4. Default: store currency
    return _storeCurrency;
  }

  // amountCents = integer cents in _storeCurrency. Returns Number in _visitorCurrency.
  function convertPrice(cents) {
    const native = cents / 100;
    if (!_shopifyRates || _storeCurrency === _visitorCurrency) return native;
    const rateFrom = _shopifyRates[_storeCurrency];
    const rateTo = _shopifyRates[_visitorCurrency];
    if (!rateFrom || !rateTo) return native; // unknown currency → no conversion
    return (native / rateFrom) * rateTo;
  }

  function formatPrice(amount) {
    const cur = _visitorCurrency || _storeCurrency || 'USD';
    const locale = CURRENCY_LOCALE[cur] || 'en-US';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(amount) || 0);
    } catch(e) {
      return `${cur} ${(Number(amount)||0).toFixed(2)}`;
    }
  }

  function formatPriceCents(cents) {
    return formatPrice(convertPrice(cents));
  }

  function onCartReady() {
    _cartReady = true;
    if (_pendingOpen) {
      _pendingOpen = false;
      fetchShopifyCart().then(cart => {
        if (window._cfConfig) {
          window._lastCart = cart;
          renderCart(cart, window._cfConfig);
          openCart();
          fetchUpsells(cart).then(() => {
            if (window._cfConfig && window._lastCart) {
              renderCart(window._lastCart, window._cfConfig);
            }
          }).catch(() => {});
        }
      });
    }
  }

  // v15.1: convert before formatting. `val` is a number in store-currency units (not cents).
  // Without this, only the currency symbol changed (R$ 49.90 instead of R$ 273.45 for $49.90 USD).
  function formatPriceDollars(val) {
    const cents = Math.round(Number(val) * 100);
    return formatPrice(convertPrice(cents));
  }

  function contrastText(hex) {
    if (!hex || hex.length < 7) return '#000000';
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 > 0.5 ? '#000000' : '#FFFFFF';
  }

  function parseRewardPercent(text) {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
    return match ? Number(match[1].replace(',', '.')) : null;
  }

  function parseRewardCurrency(text) {
    const match = text.match(/(?:R\$|\$)\s*(\d+(?:[.,]\d+)?)/i);
    if (!match) return null;
    const raw = match[1];
    const normalized = raw.includes(',') && raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
    return Number(normalized);
  }

  function getRewardDiscountAmount(tier, baseSubtotal, fallbackItemPrice) {
    const rewardText = [tier.reward_description, tier.title_after].filter(Boolean).join(' ');
    if (tier.reward_type === 'discount') {
      const percent = parseRewardPercent(rewardText);
      if (percent !== null) return baseSubtotal * (percent / 100);
      const fixed = parseRewardCurrency(rewardText);
      if (fixed !== null) return fixed;
    }
    if (tier.reward_type === 'free_product') return fallbackItemPrice;
    return 0;
  }

  const SVG_ICONS = {
    truck: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
    gift: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    shield: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    minus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    lock: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    close: (sw) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    check: '<svg width="10" height="10" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spin: '<svg style="animation:cf-spin 0.8s linear infinite;width:18px;height:18px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>',
  };

  const PRESETS = {
    returns_warranty: 'Free returns + 30-day warranty',
    secure_delivery: 'Secure payment + Guaranteed delivery',
    protected_support: 'Protected purchase + 24/7 support',
  };

  // ============ CONFIG CACHE WITH LOCALSTORAGE (v11.7 — 30s TTL + version-based invalidation) ============
  // NEW v11.7: TTL reduzido 5min -> 30s; também invalida por `version` (visual_config.updated_at)
  const CONFIG_CACHE_KEY = `cf_config_${TOKEN}`;
  const CONFIG_CACHE_TTL = 30 * 1000; // NEW v11.7: 30 seconds (was 5 minutes)
  const GIFT_VARIANTS_CACHE_KEY = `cf_gift_variants_${TOKEN}`;

  function _cfReadKnownGiftVariants() {
    try {
      const raw = localStorage.getItem(GIFT_VARIANTS_CACHE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String).filter(Boolean) : []);
    } catch(e) { return new Set(); }
  }

  function _cfWriteKnownGiftVariants(set) {
    try { localStorage.setItem(GIFT_VARIANTS_CACHE_KEY, JSON.stringify([...set].filter(Boolean))); } catch(e) {}
  }

  function _cfRememberGiftVariants(gifts) {
    try {
      const known = _cfReadKnownGiftVariants();
      (Array.isArray(gifts) ? gifts : []).forEach(g => {
        const vid = String(g && g.gift_shopify_variant_id || '');
        if (vid) known.add(vid);
      });
      _cfWriteKnownGiftVariants(known);
    } catch(e) {}
  }

  function getCachedConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CONFIG_CACHE_TTL) return data;
      return data; // stale but usable for stale-while-revalidate
    } catch(e) { return null; }
  }

  function setCachedConfig(data) {
    try {
      localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch(e) {}
  }

  function isCacheFresh() {
    try {
      const raw = localStorage.getItem(CONFIG_CACHE_KEY);
      if (!raw) return false;
      const { ts } = JSON.parse(raw);
      return Date.now() - ts < CONFIG_CACHE_TTL;
    } catch(e) { return false; }
  }

  // NEW v11.7: Lightweight version probe — checks if remote version differs from cached
  async function checkRemoteVersion() {
    try {
      const cached = getCachedConfig();
      const cachedVersion = cached?.version || null;
      const r = await fetch(`${API_URL}?token=${TOKEN}&probe=1`, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!r.ok) return null;
      const fresh = await r.json();
      if (!fresh) return null;
      if (cachedVersion && fresh.version && cachedVersion !== fresh.version) {
        // Version mismatch: invalidate cache immediately
        try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch(e) {}
      }
      return fresh;
    } catch(e) { return null; }
  }

async function getConfig(skus) {
    // Try localStorage first (persistent across page loads)
    const cached = getCachedConfig();
    if (cached) {
      _spActive = cached.visual?.sp_pre_checked || false;
      _gwActive = cached.visual?.gw_pre_checked || false;
      _storeCurrency = cached.visual?.store_currency || 'USD';
      // Background refresh if stale
      if (!isCacheFresh()) {
        // NEW v11.7: bypass HTTP cache on background refresh
        fetch(`${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' })
          .then(r => r.ok ? r.json() : null)
          .then(fresh => {
            if (fresh) {
              // NEW v11.7: if version changed, force re-render with new config
              const cachedVersion = cached?.version || null;
              const versionChanged = cachedVersion && fresh.version && cachedVersion !== fresh.version;
              setCachedConfig(fresh);
              sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(fresh));
              window._cfConfig = fresh;
              _spActive = fresh.visual?.sp_pre_checked || false;
              _gwActive = fresh.visual?.gw_pre_checked || false;
              _storeCurrency = fresh.visual?.store_currency || 'USD';
              // NEW v11.7: hot-reload styles + re-render if version changed
              if (versionChanged) {
                try { document.getElementById('cartflow-styles')?.remove(); injectStyles(fresh.visual||{}); } catch(e) {}
                try { if (window._lastCart) renderCart(window._lastCart, fresh); } catch(e) {}
              }
            }
          }).catch(()=>{});
      }
      return cached;
    }
    // Also check sessionStorage (original behavior)
    try {
      const sessionCached = sessionStorage.getItem(`cf_config_${TOKEN}`);
      if (sessionCached) {
        const parsed = JSON.parse(sessionCached);
        _spActive = parsed.visual?.sp_pre_checked || false;
        _gwActive = parsed.visual?.gw_pre_checked || false;
        _storeCurrency = parsed.visual?.store_currency || 'USD';
        setCachedConfig(parsed);
        fetch(`${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`, { referrerPolicy: 'no-referrer', credentials: 'omit' })
          .then(r => r.ok ? r.json() : null)
          .then(fresh => { if (fresh) { setCachedConfig(fresh); sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(fresh)); window._cfConfig = fresh; _spActive = fresh.visual?.sp_pre_checked || false; _gwActive = fresh.visual?.gw_pre_checked || false; _storeCurrency = fresh.visual?.store_currency || 'USD'; } }).catch(()=>{});
        return parsed;
      }
    } catch(e) {}
    // Fresh fetch with hard timeout so a slow /config never blocks ATC.
    try {
      const ctrl = new AbortController();
      const tmo = setTimeout(() => { try { ctrl.abort(); } catch(_) {} }, 3500);
      const r = await fetch(`${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`, { referrerPolicy: 'no-referrer', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(tmo);
      if (!r.ok) { return null; }
      const data = await r.json();
      setCachedConfig(data);
      sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(data));
      _spActive = data.visual?.sp_pre_checked || false;
      _gwActive = data.visual?.gw_pre_checked || false;
      _storeCurrency = data.visual?.store_currency || 'USD';
      return data;
    } catch(e) { return null; }
  }

  async function getVitrineSkuMap() {
    if (_vitrineSkuMap) return _vitrineSkuMap;
    try {
      _vitrineSkuMap = {};
      let page = 1;
      while (true) {
        const res = await (window._cfOrigFetch || fetch)(`/products.json?limit=250&page=${page}`, { referrerPolicy: 'no-referrer' });
        const data = await res.json();
        if (!data.products || data.products.length === 0) break;
        for (const p of data.products) {
          for (const vr of p.variants) {
            if (vr.sku) {
              _vitrineSkuMap[vr.sku.toUpperCase()] = {
                id: vr.id,
                price: parseFloat(vr.price || '0'),
                compare_at_price: vr.compare_at_price ? parseFloat(vr.compare_at_price) : null
              };
            }
          }
        }
        if (data.products.length < 250) break;
        page++;
      }
    } catch(e) {
      _vitrineSkuMap = {};
    }
    return _vitrineSkuMap;
  }

  async function fetchUpsells(cart) {
    const skus = (cart.items || [])
      .map(i => i.sku)
      .filter(s => s && !_addedUpsellSkus.has(s))
      .join(',');
    if (!skus) { _lastSkus = ''; return; }
    if (skus === _lastSkus) return;
    _lastSkus = skus;
    try {
      const r = await window._cfOrigFetch(`${API_URL}?token=${TOKEN}&skus=${skus}`, { referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (r.ok) {
        const data = await r.json();
        if (window._cfConfig) {
          const incoming = Array.isArray(data.upsells) ? data.upsells : [];
          const current = Array.isArray(window._cfConfig.upsells) ? window._cfConfig.upsells : [];
          // If backend returned upsells, replace; otherwise keep current to avoid clearing on race.
          if (incoming.length > 0 || current.length === 0) {
            window._cfConfig.upsells = incoming;
            if (incoming.length > 0) window._originalUpsells = incoming.slice();
          }
        }
      }
    } catch(e) {}
  }

  async function fetchShopifyCart() {
    const res = await (window._cfOrigFetch || fetch)('/cart.js', { referrerPolicy: 'no-referrer' });
    return await res.json();
  }

  function getDrawerWidth(v) {
    const dw = v.cart_width_desktop || 'default';
    return dw === 'narrow' ? '360px' : dw === 'wide' ? '500px' : '420px';
  }

  let _timerInterval = null;
  let _timerSeconds = 0;

  function startTimer(raw) {
    if (_timerInterval) clearInterval(_timerInterval);
    const parts = (raw || '').split(':').map(Number);
    if (!parts.every(p => !isNaN(p)) || parts.length < 2) { _timerSeconds = 0; return; }
    if (parts.length === 4) _timerSeconds = parts[0]*86400 + parts[1]*3600 + parts[2]*60 + parts[3];
    else if (parts.length === 3) _timerSeconds = parts[0]*3600 + parts[1]*60 + parts[2];
    else _timerSeconds = parts[0]*60 + parts[1];
    _timerInterval = setInterval(() => { if (_timerSeconds > 0) { _timerSeconds--; updateTimerDisplay(); } else clearInterval(_timerInterval); }, 1000);
  }

  function formatTimer(s) {
    const days = Math.floor(s/86400), hours = Math.floor((s%86400)/3600);
    const mins = Math.floor((s%3600)/60), secs = s%60;
    if (days > 0) return `${String(days).padStart(2,'0')}:${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    return `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }

  function updateTimerDisplay() {
    const v = window._cfConfig?.visual || {};
    const inlineEl = document.getElementById('cf-timer-value');
    if (inlineEl) inlineEl.textContent = formatTimer(_timerSeconds);
    const blockEl = document.getElementById('cf-timer-blocks');
    if (blockEl) renderTimerBlocks(blockEl, v);
  }

  function renderTimerBlocks(container, v) {
    const labels = (v.announcement_timer_labels || 'DIAS,HORAS,MIN,SEG').split(',').map(l => l.trim());
    const blockBg = v.announcement_timer_block_bg || '#000000';
    const textColor = v.announcement_timer_text_color || '#FFFFFF';
    const annTextColor = v.announcement_text_color || '#333';
    const days = Math.floor(_timerSeconds/86400), hours = Math.floor((_timerSeconds%86400)/3600);
    const mins = Math.floor((_timerSeconds%3600)/60), secs = _timerSeconds%60;
    const segments = [];
    if (days > 0) segments.push({ value: days, label: labels[0]||'DIAS' });
    segments.push({ value: hours, label: labels[1]||'HORAS' });
    segments.push({ value: mins, label: labels[2]||'MIN' });
    segments.push({ value: secs, label: labels[3]||'SEG' });
    container.innerHTML = segments.map((seg, i) => `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="display:flex;align-items:center;justify-content:center;border-radius:6px;font-weight:700;width:36px;height:36px;font-size:16px;background:${blockBg};color:${textColor}">${String(seg.value).padStart(2,'0')}</div>
        <span style="font-size:9px;margin-top:2px;opacity:0.7;color:${annTextColor}">${seg.label}</span>
      </div>
      ${i < segments.length-1 ? `<span style="font-size:18px;font-weight:700;margin-top:-12px;color:${annTextColor}">:</span>` : ''}
    `).join('');
  }

  function injectStyles(v) {
    const dw = getDrawerWidth(v);
    // NEW v11.7: support 'full' mobile width explicitly + correct default = 90vw
    const cwm = v.cart_width_mobile || 'full';
    const mw = cwm === 'default' ? '90vw' : (cwm === 'narrow' ? '85vw' : '100vw'); // 'full' or anything else -> 100vw
    const footerBg = v.accent_color || '#f6f6f7';
    // Overlay with configurable backdrop blur (v4)
    const overlayColor = v.overlay_color || 'rgba(0,0,0,0.5)';
    const overlayBlur = v.overlay_blur != null ? v.overlay_blur : 4;
    const overlayEnabled = v.overlay_enabled !== false;
    const backdropFilter = overlayEnabled && overlayBlur > 0 ? `backdrop-filter:blur(${overlayBlur}px);-webkit-backdrop-filter:blur(${overlayBlur}px);` : '';
    const style = document.createElement('style');
    style.id = 'cartflow-styles';
    style.textContent = `
      #cf-overlay { display:none;position:fixed;inset:0;background:${overlayEnabled ? overlayColor : 'rgba(0,0,0,0.5)'};${backdropFilter}z-index:999998;transition:opacity 0.3s ease;opacity:0; }
      #cf-overlay.open { display:block;opacity:1; }
      #cf-drawer {
        position:fixed;top:0;right:-${dw};width:${dw};max-width:100vw;height:100%;
        background:${v.bg_color||'#FFFFFF'};color:${v.text_color||'#000000'};
        z-index:999999;transition:right 0.3s ease;display:flex;flex-direction:column;
        box-shadow:-4px 0 24px rgba(0,0,0,0.12);
        font-family:${v.inherit_fonts ? 'inherit' : 'system-ui,sans-serif'};
        /* FIX v11.10 - mobile flicker: promote drawer to its own compositor layer to isolate repaints */
        will-change: transform;
        transform: translateZ(0);
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        contain: layout paint style;
      }
      /* FIX v11.10 - mobile flicker: kill backdrop-blur on mobile (huge cost at 100vw) */
      @media (max-width:768px) {
        #cf-overlay {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
      }
      /* NEW v11.8: !important to beat mobile rules + force visible position when open */
      #cf-drawer.open { right:0 !important; }
      #cf-body { flex:1;overflow-y:auto;display:flex;flex-direction:column; }
      .cf-empty { text-align:center;padding:48px 16px;color:#999; }
      .cf-empty-icon { font-size:40px;margin-bottom:12px; }
      #cf-footer { flex-shrink:0;border-top:1px solid rgba(0,0,0,0.08);background:${footerBg} !important;color:${contrastText(footerBg)}; }
cart-drawer,cart-notification,cart-notification-drawer,side-cart,ajax-cart,
.cart-drawer,.cart-notification,#cart-drawer,#CartDrawer,
#cart-notification,[id*="cart-drawer" i],[id*="CartDrawer" i],[id*="cart-notification" i],
[class*="cart-drawer" i],[class*="mini-cart" i],
[data-section-type*="cart"],drawer-component[id*="cart"],
.shopify-section-cart-drawer,.mini-cart,.js-mini-cart,#mini-cart-wrapper,
.cart-flyout,.header-cart-flyout,.drawer--cart,#CartSpecialDrawer,.ajaxcart,.ajax-cart,
[data-cart-drawer],[data-mini-cart],.side-cart,.slide-cart,.cart-sidebar
      { display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important; }
      #cf-checkout {
        all: unset !important;box-sizing: border-box !important;width: 100% !important;
        display: flex !important;align-items: center !important;justify-content: center !important;
        gap: 8px !important;border: none !important;cursor: pointer !important;
        text-transform: uppercase !important;height: 46px !important;font-size: 14px !important;
        font-weight: 600 !important;background: ${v.button_color||'#000'} !important;
        color: ${v.button_text_color||'#fff'} !important;border-radius: ${v.button_radius||0}px !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important;
        transition: background-color 0.15s ease, opacity 0.15s ease !important;
      }
      #cf-overlay *, #cf-drawer * { box-sizing:border-box !important; }
      #cf-drawer *::before, #cf-drawer *::after,
      #cf-overlay *::before, #cf-overlay *::after { content:none !important; display:none !important; }
      #cf-drawer * {
        font-family: inherit;
        line-height: normal;
        letter-spacing: normal;
      }
      #cf-drawer button:not(#cf-checkout):not(#cf-close) {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box !important;
      }
    #cf-drawer .cf-loading-spinner { display:flex; justify-content:center; align-items:center; padding:40px 0; }
    #cf-drawer .cf-loading-spinner::after { content:""; width:32px; height:32px; border:3px solid rgba(0,0,0,0.1); border-top-color:#333; border-radius:50%; animation:cf-spin 0.6s linear infinite; }
      @keyframes cf-spin { to { transform: rotate(360deg); } }
      /* NEW v11.8: mobile fullscreen fix — when 'full', force 100vw + left:0 + no transform; .open beats closed state */
      @media (max-width:768px) {
        #cf-drawer {
          width:${mw}!important;
          max-width:${mw}!important;
          right:-${mw}!important;
          ${cwm === 'full' ? 'left:auto!important;transform:none!important;' : ''}
        }
        #cf-drawer.open {
          right:0!important;
          ${cwm === 'full' ? 'left:0!important;width:100vw!important;max-width:100vw!important;' : ''}
        }
      }
    `;
    document.head.appendChild(style);
  }

  function injectHTML(v) {
    const overlay = document.createElement('div');
    overlay.id = 'cf-overlay';
    const borderMap = { none:'0px', thin:'1px', normal:'2px', thick:'3px' };
    const bdr = borderMap[v.header_border_thickness] || '1px';
    const headingMap = { h2:{fs:22,fw:700}, h3:{fs:18,fw:600}, h4:{fs:16,fw:600} };
    const hd = headingMap[v.header_heading_level] || headingMap.h3;
    const closeMap = { small:'16px', medium:'20px', large:'24px' };
    const closeSz = closeMap[v.close_icon_size] || '16px';
    const closeSw = v.close_icon_thickness === 'bold' ? 3 : 2;
    const headerPy = v.header_height === 'tall' ? '20px' : '12px';
    const headerJustify = v.header_alignment === 'center' ? 'center' : v.header_alignment === 'right' ? 'flex-end' : 'flex-start';
    const isCloseLeft = v.close_button_position === 'left';
    const headerTitleHtml = v.header_title_type === 'logo' && v.header_logo_url
      ? `<img id="cf-header-logo" src="${v.header_logo_url}" alt="Logo" style="height:${v.header_logo_size||32}px;object-fit:contain;" />`
      : `<${v.header_heading_level||'h3'} id="cf-title-el" style="font-size:${hd.fs}px;font-weight:${hd.fw};margin:0;${v.header_text_color_override?'color:'+v.header_text_color_override+';':''}">Cart • 0</${v.header_heading_level||'h3'}>`;
    overlay.innerHTML = `
      <div id="cf-drawer">
        <div id="cf-header" style="padding:${headerPy} 16px;display:flex;align-items:center;flex-shrink:0;background:${v.header_bg_color||'#FFFFFF'};${v.header_border_thickness!=='none'?'border-bottom:'+bdr+' solid '+(v.header_border_color||'#e5e7eb')+';':''}${isCloseLeft?'flex-direction:row-reverse;':''}">
          <div style="flex:1;display:flex;align-items:center;justify-content:${headerJustify}">${headerTitleHtml}</div>
          <button id="cf-close" style="background:${v.close_bg_color||'transparent'};border:none;cursor:pointer;padding:4px;line-height:0;border-radius:4px;flex-shrink:0;width:${parseInt(closeSz)+8}px;height:${parseInt(closeSz)+8}px;display:flex;align-items:center;justify-content:center;color:${v.close_icon_color||'#000'};transition:all 0.15s;">
            ${SVG_ICONS.close(closeSw)}
          </button>
        </div>
        <div id="cf-body">
          <div id="cf-ann-before"></div>
          <div id="cf-rewards"></div>
          <div id="cf-upsells-top"></div>
          <div id="cf-items"></div>
          <div id="cf-ann-after"></div>
          <div id="cf-upsells-bottom"></div>
          <div id="cf-addon-section" style="margin-top:auto;padding-bottom:16px"></div>
        </div>
        <div id="cf-footer">
          <div id="cf-badges-top"></div>
          <div class="cf-footer-inner" style="padding:12px 16px;">
            <div id="cf-discounts-row" style="display:none;align-items:center;justify-content:space-between;font-size:${fs(12)}px;margin-bottom:8px;"></div>
            <div id="cf-subtotal-row" style="display:flex;justify-content:space-between;font-size:${fs(15)}px;margin-bottom:8px;">
              <span style="font-weight:500">Subtotal:</span>
              <span id="cf-subtotal" style="font-weight:700"></span>
            </div>
            <div id="cf-currency-note" style="display:none;font-size:11px;text-align:center;opacity:0.65;margin:0 0 8px 0;"></div>
            <button id="cf-checkout">${SVG_ICONS.lock} Secure Checkout</button>
            <div id="cf-continue-wrap"></div>
            <div id="cf-express-wrap"></div>
          </div>
          <div id="cf-badges-bottom"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const closeBtn = document.getElementById('cf-close');
    if (closeBtn) {
      closeBtn.onmouseenter = () => { closeBtn.style.background = v.close_bg_hover_color||'#f3f4f6'; closeBtn.style.color = v.close_icon_hover_color||'#666'; };
      closeBtn.onmouseleave = () => { closeBtn.style.background = v.close_bg_color||'transparent'; closeBtn.style.color = v.close_icon_color||'#000'; };
    }
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) {
      ckBtn.onmouseenter = () => { if (v.button_hover_color) ckBtn.style.setProperty('background', v.button_hover_color, 'important'); else ckBtn.style.setProperty('opacity', '0.85', 'important'); };
      ckBtn.onmouseleave = () => { ckBtn.style.setProperty('background', v.button_color||'#000', 'important'); ckBtn.style.setProperty('opacity', '1', 'important'); };
    }
  }

  function renderOptimisticItem(data) {
    const body = document.getElementById('cf-items');
    if (!body) return;
    // data can be a single item {id, title, image, price, quantity} or {items: [...]}
    const items = data.items ? data.items : [data];
    if (!items.length || !items[0].title) return;
    const v = window._cfConfig?.visual || {};
    const textColor = v.text_color || '#333';
    let html = '';
    for (const item of items) {
      const img = item.image || item.featured_image?.url || '';
      const title = item.title || item.product_title || '';
      const price = item.price ? formatPriceCents(item.price) : '';
      const qty = item.quantity || 1;
      const variant = item.variant_title && item.variant_title !== 'Default Title' ? item.variant_title : '';
      html += `<div style="display:flex;gap:12px;padding:12px 16px;align-items:center;opacity:0.85;animation:cfFadeIn .3s ease forwards;">
        ${img ? `<img src="${img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;background:#f5f5f5" loading="eager" decoding="sync" fetchpriority="high" />` : ''}
        <div style="flex:1;min-width:0;">
          <div style="font-size:${fs(14)}px;font-weight:500;color:${textColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
          ${variant ? `<div style="font-size:${fs(12)}px;color:${textColor};opacity:0.6;margin-top:2px;">${variant}</div>` : ''}
          <div style="font-size:${fs(13)}px;color:${textColor};margin-top:4px;">Qty: ${qty} · ${price}</div>
        </div>
      </div>`;
    }
    // Add a subtle loading indicator below the item
    html += '<div style="display:flex;justify-content:center;padding:8px 0;"><div class="cf-loading-spinner" style="width:20px;height:20px;border-width:2px;"></div></div>';
    body.innerHTML = html;
    body.classList.remove('cf-empty');
  }

  function showLoadingState() {
    const body = document.getElementById('cf-items');
    if (body) body.innerHTML = '<div class="cf-loading-spinner"></div>';
  }

  function openCart() {
    _hadInteraction = false;
    // v15.7: ensure the lightweight shell is removed before showing the real drawer.
    try { if (typeof window._cfCloseShellCart === 'function') window._cfCloseShellCart(); } catch(e) {}
    const overlay = document.getElementById('cf-overlay');
    const drawer = document.getElementById('cf-drawer');
    // Reset checkout button state
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) { const btnText = window._cfConfig?.visual?.checkout_button_text || 'Secure Checkout'; ckBtn.disabled = false; ckBtn.innerHTML = `${SVG_ICONS.lock} ${btnText}`; }
    if (overlay) { overlay.style.display = 'block'; requestAnimationFrame(() => { overlay.classList.add('open'); }); }
    if (drawer) drawer.classList.add('open');
    // v11.11: iOS-safe scroll lock — position:fixed prevents background scroll on iOS Safari
    try {
      const sy = window.scrollY || window.pageYOffset || 0;
      window._cfSavedScrollY = sy;
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + sy + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    } catch(e) { document.body.style.overflow = 'hidden'; }
    _cartOpenedAt = Date.now();
    // FIX v11.9 - upsell reaparece: força re-render dos upsells ao abrir o drawer.
    // Garante que mesmo após cache hit/pre-render, o bloco de upsells é re-injetado.
    window._cfPrevUpsellIds = '';
    if (window._cfConfig && window._lastCart) {
      try { renderCart(window._lastCart, window._cfConfig); } catch(e) {}
    }
    trackEvent('cart_opened', 0, (() => {
      const c = window._lastCart;
      if (!c) return {};
      return {
        items: (c.items||[]).map(i => ({ title: i.title, variant: i.variant_title||'', qty: i.quantity, price: (i.price||0)/100 })),
        item_count: c.item_count || 0,
        total: c.total_price ? c.total_price/100 : 0,
        addon_total: window._cfAddonTotal || 0,
        upsell_total: window._cfUpsellTotal || 0
      };
    })());
  }
  function closeCart() {
    // Reset checkout button state
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) { const btnText = window._cfConfig?.visual?.checkout_button_text || 'Secure Checkout'; ckBtn.disabled = false; ckBtn.innerHTML = `${SVG_ICONS.lock} ${btnText}`; }
    const overlay = document.getElementById('cf-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => { if (!overlay.classList.contains('open')) overlay.style.display = 'none'; }, 350);
    }
    document.getElementById('cf-drawer')?.classList.remove('open');
    // v11.11: restore iOS-safe scroll lock
    try {
      const sy = window._cfSavedScrollY || 0;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, sy);
      window._cfSavedScrollY = 0;
    } catch(e) { document.body.style.overflow = ''; }
    _cartOpenedAt = null;
    _lastSkus = '';
    // FIX v11.9 - upsell reaparece: força re-render dos upsells na próxima abertura.
    // Bug: _cfPrevUpsellIds persistia entre fechamentos; se algo limpava o innerHTML
    // dos containers, o bloco nunca re-injetava o HTML porque "upsellsChanged" virava false.
    window._cfPrevUpsellIds = '';
  }

  function buildUpsellVariantHtml(product, v) {
    const variants = product.variants || [];
    const meaningful = variants.filter(vr => {
      const val = (vr.option_value||'').trim();
      const name = (vr.option_name||'').trim();
      if (!val || val === 'Default' || val === 'Default Title') return false;
      if (name === 'Title') return false;
      return true;
    });
    if (meaningful.length === 0) {
      return '';
    }
    const optionGroups = new Map();
    for (const vr of meaningful) {
      const parts = (vr.option_value||'').split('/').map(p => p.trim());
      const name = vr.option_name||'Option';
      const names = name.split('/').map(n => n.trim());
      names.forEach((n, idx) => {
        if (!optionGroups.has(n)) optionGroups.set(n, new Set());
        if (parts[idx]) optionGroups.get(n).add(parts[idx]);
      });
    }
    const firstValues = (meaningful[0].option_value||'').split('/').map(val => val.trim());
    const defaultSku = meaningful[0].sku || variants[0]?.sku || '';
    let selectsHtml = '';
    let idx = 0;
    for (const [name, valuesSet] of optionGroups) {
      const values = [...valuesSet];
      const defaultVal = firstValues[idx]||values[0];
      const options = values.map(val => `<option value="${val}"${val===defaultVal?' selected':''}>${val}</option>`).join('');
      selectsHtml += `<select class="cf-upsell-select" data-cf-option="${name}" onchange="window.cfUpdateUpsellVariant(this)" style="font-size:11px;height:28px;padding:0 6px;border-radius:4px;border:1px solid rgba(0,0,0,0.25);background:${v.bg_color||'#fff'};color:${v.text_color||'#000'};flex:1;min-width:0">${options}</select>`;
      idx++;
    }
    return `<span data-cf-product-id="${product.id}" data-cf-selected-sku="${defaultSku}" style="display:flex;gap:8px;flex:1;min-width:0">${selectsHtml}</span>`;
  }

  window.cfUpdateUpsellVariant = function(selectEl) {
    const wrapper = selectEl.closest('[data-cf-product-id]');
    if (!wrapper) return;
    const productId = wrapper.getAttribute('data-cf-product-id');
    const upsells = window._cfConfig?.upsells || [];
    const product = upsells.find(p => p.id === productId);
    if (!product) return;
    const selects = wrapper.querySelectorAll('select[data-cf-option]');
    const selectedValues = [];
    selects.forEach(s => selectedValues.push(s.value));
    const selectedKey = selectedValues.join(' / ');
    const variants = product.variants || [];
    const match = variants.find(vr => {
      const vrKey = (vr.option_value||'').split('/').map(p => p.trim()).join(' / ');
      return vrKey === selectedKey;
    });
    if (match?.sku) {
      wrapper.setAttribute('data-cf-selected-sku', match.sku);
      if (match.image_url) {
        const pid = wrapper.getAttribute('data-cf-product-id');
        const img = document.getElementById(`cf-upsell-img-${pid}`);
        if (img) img.src = match.image_url;
      }
    }
  };

  // === Product Gifts (BXGY auto-add) ===
  // Detects trigger products in cart and auto-inserts the gift variant with
  // properties._gift = "1". Removes gift if trigger condition no
  // longer met. Shopify BXGY discount (already created server-side) zeroes
  // the price at checkout. Property name kept generic to avoid fingerprint.
  function _cfGetGiftConfigByVariant(item, config) {
    try {
      const cfg = config || window._cfConfig;
      const gifts = (cfg && Array.isArray(cfg.gifts)) ? cfg.gifts : [];
      if (!gifts.length || !item) return null;
      const vid = String(item.variant_id || item.id || '');
      return gifts.find(g => String(g.gift_shopify_variant_id || '') === vid) || null;
    } catch(e) { return null; }
  }

  // v15.11: centralized item classification — single source of truth for rewards/discount rules.
  // - main:   counts in rewards bar, receives reward discount, sends coupon to checkout
  // - upsell: counts in rewards bar; receives discount ONLY when v.exclude_upsells_from_discount === false
  // - addon:  shipping protection / gift wrap — never enters items[], handled separately
  // - gift:   never counts, never discounts
  function _cfIsUpsellItem(item) {
    if (!item) return false;
    const sku = item.sku || '';
    return _addedUpsellSkus.has(sku) || _addedUpsellSkus.has(sku.toUpperCase());
  }
  function _cfIsMainItem(item, config) {
    return !!item && !_cfIsGiftItem(item, config) && !_cfIsUpsellItem(item);
  }
  // Returns true if the item should receive reward discount (used for discountableSubtotal + per-item share).
  function _cfIsDiscountable(item, config) {
    if (!item || _cfIsGiftItem(item, config)) return false;
    if (_cfIsUpsellItem(item)) {
      var v = (config && config.visual) || {};
      return v.exclude_upsells_from_discount === false;
    }
    return true;
  }

  function _cfIsGiftItem(item, config) {
    // Primary: property flag
    if (item && item.properties && (
      item.properties._gift === '1' || item.properties._gift === 1 ||
      item.properties._octoroute_gift === '1' || item.properties._octoroute_gift === 1
    )) return true;
    try {
      if (!item) return false;
      const vid = String(item.variant_id || item.id || '');
      if (!vid) return false;
      if (_cfGetGiftConfigByVariant(item, config)) return true;
      // Last-known fallback lets the loader remove stale gifts after a promotion is disabled.
      return _cfReadKnownGiftVariants().has(vid);
    } catch(e) { return false; }
  }

  async function _cfSyncGifts(cart, config) {
    const gifts = (config && Array.isArray(config.gifts)) ? config.gifts : [];
    if (gifts.length) _cfRememberGiftVariants(gifts);
    if (window._cfGiftSyncing) return false;
    const items = (cart && cart.items) || [];

    // Build maps: trigger product_id -> {qty, total_cents}; gift variant -> item key
    // Also accumulate cart-wide totals (excluding gifts) for reward_tier free_product triggers.
    const triggerStats = new Map();
    const giftItemsByVariant = new Map();
    let cartTotalCents = 0;
    let cartTotalQty = 0;
    for (const it of items) {
      const pid = it.product_id != null ? String(it.product_id) : '';
      const vid = it.variant_id != null ? String(it.variant_id) : '';
      if (_cfIsGiftItem(it, config)) {
        if (vid) giftItemsByVariant.set(vid, it);
        continue;
      }
      const lineCents = Number(it.line_price != null ? it.line_price : (it.price * (it.quantity||1)));
      const qty = Number(it.quantity || 0);
      cartTotalCents += lineCents;
      cartTotalQty += qty;
      if (!pid) continue;
      const prev = triggerStats.get(pid) || { qty: 0, cents: 0 };
      prev.qty += qty;
      prev.cents += lineCents;
      triggerStats.set(pid, prev);
    }

    if (!gifts.length && giftItemsByVariant.size === 0) {
      _cfWriteKnownGiftVariants(new Set());
      return false;
    }

    const toAdd = [];
    const toRemove = [];
    const wantedVariants = new Set();
    for (const g of gifts) {
      const giftVid = String(g.gift_shopify_variant_id || '');
      if (!giftVid) continue;
      const trigPid = String(g.trigger_shopify_product_id || '');
      const condValue = Number(g.condition_value || 0);
      let conditionMet = false;
      if (!trigPid) {
        // Reward tier free_product: trigger by cart-wide total or quantity
        if (g.condition_type === 'cart_quantity') {
          conditionMet = cartTotalQty >= condValue;
        } else {
          // default: cart_total (in dollars)
          conditionMet = (cartTotalCents / 100) >= condValue;
        }
      } else {
        const stats = triggerStats.get(trigPid) || { qty: 0, cents: 0 };
        if (g.condition_type === 'min_value' || g.condition_type === 'min_amount') {
          conditionMet = (stats.cents / 100) >= condValue;
        } else {
          // default: min_quantity
          conditionMet = stats.qty >= Number(g.condition_value || 1);
        }
      }
      const alreadyInCart = giftItemsByVariant.has(giftVid);
      if (conditionMet) {
        wantedVariants.add(giftVid);
        if (!alreadyInCart) toAdd.push(giftVid);
      }
    }
    // Remove any gift in cart whose variant is no longer wanted or whose rule was disabled.
    for (const [vid, it] of giftItemsByVariant.entries()) {
      if (!wantedVariants.has(vid)) toRemove.push(it.key);
    }

    if (!toAdd.length && !toRemove.length) return false;

    window._cfGiftSyncing = true;
    window._cfAddInFlight = true;
    try {
      // Removes first to free slots, then adds
      for (const key of toRemove) {
        try {
          await (window._cfOrigFetch || fetch)('/cart/change.js?_cf=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: key, quantity: 0 }),
            referrerPolicy: 'no-referrer',
          });
        } catch (e) {}
      }
      for (const vid of toAdd) {
        try {
          await (window._cfOrigFetch || fetch)('/cart/add.js?_cf=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: Number(vid),
              quantity: 1,
              properties: { _gift: '1' },
            }),
            referrerPolicy: 'no-referrer',
          });
        } catch (e) {}
      }
      if (!gifts.length) _cfWriteKnownGiftVariants(new Set());
      return true;
    } finally {
      setTimeout(() => { window._cfGiftSyncing = false; window._cfAddInFlight = false; }, 300);
    }
  }

  function renderCart(cart, config) {
    // Auto-sync gifts BEFORE drawing. If mutated, refetch + re-render once.
    try {
      if (config && !window._cfGiftSyncing) {
        _cfSyncGifts(cart, config).then(mutated => {
          if (mutated) {
            (window._cfOrigFetch || fetch)('/cart.js', { referrerPolicy: 'no-referrer' })
              .then(r => r.json())
              .then(fresh => { window._lastCart = fresh; renderCart(fresh, config); })
              .catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (e) {}

    // v11.12: preload all cart item images so swap doesn't flicker
    try {
      if (cart && cart.items && window._cfPreloadImages) {
        const _urls = cart.items.map(function(it){ return it.image || (it.featured_image && it.featured_image.url) || ''; }).filter(Boolean);
        if (_urls.length) window._cfPreloadImages(_urls);
      }
    } catch(e) {}
    const v = config.visual || {};
    const items = cart.items || [];
    const count = items.reduce((a,i) => _cfIsGiftItem(i, config) ? a : a + i.quantity, 0);
    const accentColor = v.accent_color || '#f6f6f7';
    const accentTextColor = contrastText(accentColor);
    _fontScale = SCALE_MAP[v.font_scale] || 1.15;

    const titleEl = document.getElementById('cf-title-el');
    if (titleEl) titleEl.textContent = (v.header_title_text||'Cart • {{cart_quantity}}').replace('{{cart_quantity}}', count);

    const annBefore = document.getElementById('cf-ann-before');
    const annAfter = document.getElementById('cf-ann-after');
    if (annBefore) annBefore.innerHTML = '';
    if (annAfter) annAfter.innerHTML = '';
    if (v.announcement_enabled && v.announcement_text) {
      const annHeightPy = v.announcement_height==='compact'?'6px':v.announcement_height==='tall'?'16px':'10px';
      const annAlign = v.announcement_alignment||'center';
      const isBlocks = v.announcement_timer_style==='blocks';
      const inlineTimerHtml = _timerSeconds>0 && !isBlocks ? `<span style="font-weight:600">${formatTimer(_timerSeconds)}</span>` : '';
      const annText = (v.announcement_text||'').replace('{{timer}}', inlineTimerHtml);
      const blocksHtml = _timerSeconds>0 && isBlocks ? `<div id="cf-timer-blocks" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px;"></div>` : '';
      const annHtml = `<div style="padding:${annHeightPy} 16px;background:${v.announcement_bg_color||'#f2f2f2'};border-bottom:1px solid ${v.announcement_border_color||'#efefef'};color:${v.announcement_text_color||'#333'};font-size:${v.announcement_font_size||14}px;text-align:${annAlign};flex-shrink:0;"><div>${annText}</div>${blocksHtml}</div>`;
      const target = v.announcement_position==='after' ? annAfter : annBefore;
      if (target) {
        target.innerHTML = annHtml;
        if (_timerSeconds>0 && isBlocks) { const blockEl = document.getElementById('cf-timer-blocks'); if (blockEl) renderTimerBlocks(blockEl, v); }
      }
    }

    const rwEl = document.getElementById('cf-rewards');
    const tiers = config.rewards || [];
    const showOnEmpty = v.rewards_show_on_empty !== false;
    let rewardDiscount = 0;
    let activeRewardLabels = [];
    // v15.12: SINGLE eligibility rule — bar progress AND discount use the same item set.
    // Switch OFF: only main items count. Switch ON: main + upsells.
    // Addons and gifts never count.
    const eligibleItems = items.filter(i => _cfIsDiscountable(i, config));
    const hasEligibleItem = eligibleItems.length > 0;
    const eligibleSubtotalCents = eligibleItems.reduce((a,i) => a + i.price * i.quantity, 0);
    const eligibleSubtotal = eligibleSubtotalCents / 100;
    // Aliases kept for downstream code that still references these names.
    const discountableItems = eligibleItems;
    const discountableSubtotal = eligibleSubtotal;
    let activeDiscountLabel = '';
    if (rwEl) {
      rwEl.innerHTML = '';
      if (v.rewards_enabled && tiers.length > 0) {
        if (!hasEligibleItem) {
          // No eligible item → no progress, no coupon. Addons/upsells (when switch OFF) alone don't unlock.
          rewardDiscount = 0;
          activeRewardLabels = [];
          if (showOnEmpty || items.length > 0) {
            rwEl.innerHTML = `<div style="padding:10px 16px;border-bottom:1px solid rgba(0,0,0,0.08);text-align:center;font-size:${fs(v.rewards_font_size||14)}px;opacity:0.75">Add a product to unlock rewards</div>`;
          }
        } else if (count > 0 || showOnEmpty) {
          const isQty = (v.rewards_calculation||'cart_total') === 'quantity';
          // Bar progress = same eligibility as discount.
          const barTotalQty = eligibleItems.reduce((a,i) => a + Number(i.quantity || 0), 0);
          const barTotalValue = eligibleSubtotal;
          const simValue = Number(isQty ? barTotalQty : barTotalValue) || 0;
          const sorted = [...tiers].sort((a,b) => (Number(a.minimum_value)||0) - (Number(b.minimum_value)||0));
          const cheapestPrice = eligibleItems.length > 0 ? Math.min(...eligibleItems.map(i => i.price)) / 100 : 0;
          const unlockedTiers = sorted.filter(t => simValue >= (parseFloat(t.minimum_value)||0));
          // % tiers are mutually exclusive — apply only the highest unlocked.
          const unlockedDiscountTiers = unlockedTiers.filter(t => t.reward_type === 'discount');
          const highestDiscountTier = unlockedDiscountTiers.length > 0
            ? unlockedDiscountTiers.reduce((max, t) => (Number(t.minimum_value)||0) > (Number(max.minimum_value)||0) ? t : max)
            : null;
          if (highestDiscountTier) {
            rewardDiscount = getRewardDiscountAmount(highestDiscountTier, eligibleSubtotal, cheapestPrice);
            activeDiscountLabel = highestDiscountTier.reward_description || highestDiscountTier.reward_type || '';
            if (activeDiscountLabel) activeRewardLabels.push(activeDiscountLabel);
          }
          for (const tier of unlockedTiers) {
            if (tier.reward_type === 'shipping' || tier.reward_type === 'free_shipping') {
              if (!activeRewardLabels.includes(tier.reward_description)) activeRewardLabels.push(tier.reward_description);
            } else if (tier.reward_type === 'free_product') {
              const amt = getRewardDiscountAmount(tier, eligibleSubtotal, cheapestPrice);
              if (amt > 0) rewardDiscount += amt;
              if (!activeRewardLabels.includes(tier.reward_description)) activeRewardLabels.push(tier.reward_description);
            }
          }
          const nextT = sorted.find(t => (parseFloat(t.minimum_value)||0) > simValue);
          const rem = nextT ? (isQty ? `${(parseFloat(nextT.minimum_value)||0) - simValue}` : `${formatPriceDollars((parseFloat(nextT.minimum_value)||0) - simValue)}`) : null;
          let rawText = '';
          if (!nextT) {
            rawText = (v.rewards_complete_text || 'All rewards unlocked! 🎉').replace('{{count}}', String(barTotalQty));
          } else if (nextT.title_before) {
            rawText = nextT.title_before.replace('{remaining}', String(rem)).replace('{{remaining}}', String(rem)).replace('{{count}}', String(rem)).replace('{count}', String(rem));
          } else {
            rawText = `Add ${rem} more to unlock ${nextT.reward_description||'the next reward'}`;
          }
          let barHtml = '<div style="display:flex;align-items:center;gap:0">';
          let labelsHtml = '<div style="display:flex;align-items:flex-start;gap:0;margin-top:-2px">';
          sorted.forEach((tier, idx) => {
            const segStart = idx===0 ? 0 : parseFloat(sorted[idx-1].minimum_value)||0;
            const segEnd = parseFloat(tier.minimum_value)||0;
            const segRange = segEnd - segStart;
            const lp = segRange>0 ? Math.min(Math.max((simValue-segStart)/segRange,0),1)*100 : (simValue>=segEnd?100:0);
            const reached = simValue >= (parseFloat(tier.minimum_value)||0);
            const iconSvg = SVG_ICONS[tier.icon||'gift'] || SVG_ICONS.gift;
            const circleSize = reached ? 28 : 20;
            barHtml += `<div style="all:unset !important;box-sizing:border-box !important;display:block !important;flex:1 !important;border-radius:9999px !important;overflow:hidden !important;height:${v.rewards_bar_height||8}px !important;background:linear-gradient(to right,${v.rewards_bar_fg_color||'#303030'} ${lp}%,${v.rewards_bar_bg_color||'#efefef'} ${lp}%) !important"></div>`;
            barHtml += `<div style="flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 2px;transition:all 0.3s;width:${circleSize}px;height:${circleSize}px;background:${reached?v.rewards_bar_fg_color||'#303030':v.rewards_bar_bg_color||'#efefef'} !important;color:${reached?v.rewards_complete_icon_color||'#fff':v.rewards_incomplete_icon_color||'#4D4949'} !important">`;
            barHtml += reached ? iconSvg : `<span style="display:block;width:8px;height:8px;border-radius:50%;background:${v.rewards_incomplete_icon_color||'#4D4949'};opacity:0.4"></span>`;
            barHtml += '</div>';
            labelsHtml += '<div style="flex:1">\u200B</div>';
            labelsHtml += `<div style="flex-shrink:0;margin:0 4px;text-align:center;white-space:nowrap"><span style="font-size:9px;opacity:0.7;line-height:1.2;font-weight:500">${tier.reward_description||tier.reward_type||''}</span></div>`;
          });
          barHtml += '</div>'; labelsHtml += '</div>';
          rwEl.innerHTML = `<div style="padding:10px 16px;border-bottom:1px solid rgba(0,0,0,0.08);overflow:visible;"><div style="text-align:center;margin-bottom:6px;line-height:1.5;font-size:${fs(v.rewards_font_size||14)}px;min-height:40px;display:flex;align-items:center;justify-content:center"><span>${rawText}</span></div>${barHtml}${labelsHtml}</div>`;
        }
      }
    }

    if (!window._cfImgCache) window._cfImgCache = {};
    const allImgUrls = items.map(i => i.image || i.featured_image?.url || '')
      .concat((config.upsells || []).map(u => u.image_url || ''))
      .filter(Boolean);
    allImgUrls.forEach(url => { if (!window._cfImgCache[url]) { const img = new Image(); img.src = url; window._cfImgCache[url] = img; } });

    const itemsEl = document.getElementById('cf-items');
    if (itemsEl) {
      if (items.length === 0) {
        itemsEl.innerHTML = '<div class="cf-empty"><div class="cf-empty-icon">🛒</div><p>Your cart is empty</p></div>';
      } else {
        const emptyEl = itemsEl.querySelector('.cf-empty');
        if (emptyEl) emptyEl.remove();
        const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
        const rawSubtotalDollars = rawSubtotalCents / 100;
        const discSubDollars = discountableSubtotal;
        // Clear optimistic/loading content before reconciliation
        Array.from(itemsEl.children).forEach(n => { if (!n.hasAttribute("data-cf-item-key")) n.remove(); });
         const newKeys = new Set(items.map(i => String(i.key)));
         const existingNodes = itemsEl.querySelectorAll('[data-cf-item-key]');
         existingNodes.forEach(n => { if (!newKeys.has(n.dataset.cfItemKey)) n.remove(); });
         // v15.13: Visual order optimized for AOV — main → upsell → gift. Addons live outside items[] (fixed footer).
         // Stable sort: keeps original add-order within each group. Does NOT affect totals/eligibility (uses raw `items`).
         const _itemGroup = (it) => {
           if (_cfIsGiftItem(it, config)) return 2; // gift last (passive reward, doesn't compete with paid upsell)
           if (_cfIsUpsellItem(it)) return 1;       // upsell right after main — captures hot decision moment
           return 0;                                 // main on top — anchors value
         };
         const orderedItems = items
           .map((it, originalIdx) => ({ it, originalIdx }))
           .sort((a, b) => _itemGroup(a.it) - _itemGroup(b.it) || a.originalIdx - b.originalIdx)
           .map(x => x.it);
         orderedItems.forEach((item, idx) => {
          const lineTotal = item.price * item.quantity;
          const lineTotalDollars = lineTotal / 100;
          const isGift = _cfIsGiftItem(item, config);
          const giftCfg = isGift ? _cfGetGiftConfigByVariant(item, config) : null;
          const vitrineEntry = _vitrineSkuMap?.[item.sku?.toUpperCase()];
          const compareAtPriceDollars = !isGift && vitrineEntry?.compare_at_price ? vitrineEntry.compare_at_price * item.quantity : null;
          const shopifyOrigCents = item.original_price || item.price;
          const shopifyOrigDollars = shopifyOrigCents * item.quantity / 100;
          const giftUnitPriceDollars = Number(giftCfg?.gift_price || 0) || (item.price ? item.price / 100 : 0) || (item.original_price ? item.original_price / 100 : 0);
          const giftValueDollars = giftUnitPriceDollars * item.quantity;
          const lineCompareDollars = isGift ? giftValueDollars : (compareAtPriceDollars || shopifyOrigDollars);
          // v15.11: items where _cfIsDiscountable === true receive reward discount share.
          // Switch OFF: only main. Switch ON: main + upsell.
          const isDiscountable = _cfIsDiscountable(item, config);
          const itemShare = isDiscountable && discSubDollars > 0 ? lineTotalDollars / discSubDollars : 0;
          const itemRewardDiscount = isDiscountable ? rewardDiscount * itemShare : 0;
          const discountedTotal = Math.max(0, lineTotalDollars - itemRewardDiscount);
          const hasCompareDiscount = lineCompareDollars > lineTotalDollars;
          const hasRewardDiscount = isDiscountable && itemRewardDiscount > 0;
          const hasDis = hasCompareDiscount || hasRewardDiscount;
          const displayPrice = isGift ? 0 : (hasRewardDiscount ? discountedTotal : lineTotalDollars);
          const totalSavingsItem = isGift ? 0 : (lineCompareDollars - displayPrice);
          const productTitle = item.product_title || item.title;
          let variantLabel = '';
          if (item.options_with_values && item.options_with_values.length > 0) {
            const meaningful = item.options_with_values.filter(o => o.value !== 'Default Title');
            if (meaningful.length > 0) variantLabel = meaningful.map(o => `${o.name}: ${o.value}`).join(' / ');
          } else if (item.variant_title && item.variant_title !== 'Default Title') {
            variantLabel = item.variant_title;
          }
          const borderBottom = idx < items.length-1 ? 'border-bottom:1px solid rgba(0,0,0,0.08);' : '';
          let existing = itemsEl.querySelector(`[data-cf-item-key="${item.key}"]`);
          if (existing && existing.getAttribute('data-cf-gift') !== (isGift ? '1' : '0')) {
            existing.remove();
            existing = null;
          }
          if (existing) {
            const qtyEl = existing.querySelector('[data-cf-qty]');
            if (qtyEl) qtyEl.textContent = item.quantity;
            const priceEl = existing.querySelector('[data-cf-price]');
            if (priceEl) {
              priceEl.textContent = isGift ? 'FREE' : formatPriceDollars(displayPrice);
              if (isGift) priceEl.style.color = v.savings_color || '#22c55e';
            }
            const strikeEl = existing.querySelector('[data-cf-strike]');
            if (strikeEl) { if (v.show_strikethrough && (hasDis || (isGift && lineCompareDollars > 0))) { strikeEl.textContent = formatPriceDollars(lineCompareDollars); strikeEl.style.display = ''; } else { strikeEl.style.display = 'none'; } }
            const saveEl = existing.querySelector('[data-cf-save]');
            if (saveEl) { if (v.show_strikethrough && totalSavingsItem > 0.01) { saveEl.textContent = `Save ${formatPriceDollars(totalSavingsItem)}`; saveEl.style.display = ''; } else { saveEl.style.display = 'none'; } }
            const minusBtn = existing.querySelector('[data-cf-minus]');
            if (minusBtn) minusBtn.setAttribute('onclick', `cfQty('${item.key}',${item.quantity-1})`);
            const plusBtn = existing.querySelector('[data-cf-plus]');
            if (plusBtn) plusBtn.setAttribute('onclick', `cfQty('${item.key}',${item.quantity+1})`);
            const delBtn = existing.querySelector('[data-cf-del]');
            if (delBtn) delBtn.setAttribute('onclick', `cfQty('${item.key}',0)`);
            const tagEl = existing.querySelector('[data-cf-reward-tag]');
            if (tagEl) { if (hasRewardDiscount && activeDiscountLabel) { tagEl.textContent = activeDiscountLabel; tagEl.style.display = 'inline-flex'; } else { tagEl.style.display = 'none'; } }
            existing.style.borderBottom = borderBottom ? '1px solid rgba(0,0,0,0.08)' : 'none';
            // v15.13: reposition existing node to match orderedItems order (main → upsell → gift).
            if (itemsEl.children[idx] !== existing) {
              if (itemsEl.children[idx]) itemsEl.insertBefore(existing, itemsEl.children[idx]);
              else itemsEl.appendChild(existing);
            }
           } else {
             const div = document.createElement('div');
             const giftSubtitleHtml = isGift ? `<p style="font-size:${fs(12)}px;font-weight:600;color:${v.savings_color||'#22c55e'};margin:2px 0 0 0;display:flex;align-items:center;gap:4px;"><span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;">${SVG_ICONS.gift}</span>Free gift${lineCompareDollars > 0 ? ` • You saved ${formatPriceDollars(lineCompareDollars)}` : ''}</p>` : '';
             const delHtml = isGift
              ? ''
              : `<span data-cf-del role="button" tabindex="0" onclick="cfQty('${item.key}',0)" style="all:unset;padding:2px;opacity:0.4;cursor:pointer;color:inherit;transition:opacity 0.15s;display:inline-flex;flex-shrink:0" onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='0.4'">${SVG_ICONS.trash}</span>`;
             const qtyControlsHtml = isGift
               ? ''
              : `<div style="display:inline-flex;align-items:center;border:1px solid rgba(0,0,0,0.25);border-radius:6px;overflow:hidden;width:fit-content;">
                    <span data-cf-minus role="button" tabindex="0" onclick="cfQty('${item.key}',${item.quantity-1})" style="all:unset;box-sizing:border-box;width:28px;min-width:28px;max-width:28px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;flex-shrink:0;">${SVG_ICONS.minus}</span>
                    <span data-cf-qty style="box-sizing:border-box;font-size:${fs(13)}px;width:28px;min-width:28px;max-width:28px;text-align:center;height:26px;line-height:26px;border-left:1px solid rgba(0,0,0,0.25);border-right:1px solid rgba(0,0,0,0.25);flex-shrink:0;">${item.quantity}</span>
                    <span data-cf-plus role="button" tabindex="0" onclick="cfQty('${item.key}',${item.quantity+1})" style="all:unset;box-sizing:border-box;width:28px;min-width:28px;max-width:28px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;flex-shrink:0;">${SVG_ICONS.plus}</span>
                  </div>`;
             const priceHtml = isGift
               ? `<span data-cf-strike style="font-size:${fs(12)}px;opacity:0.5;text-decoration:line-through;${v.show_strikethrough && lineCompareDollars > 0 ? '' : 'display:none'}">${formatPriceDollars(lineCompareDollars)}</span>
                  <span data-cf-price style="font-size:${fs(15)}px;font-weight:700;color:${v.savings_color||'#22c55e'}">FREE</span>`
               : `<span data-cf-strike style="font-size:${fs(12)}px;opacity:0.5;text-decoration:line-through;${v.show_strikethrough && hasDis ? '' : 'display:none'}">${formatPriceDollars(lineCompareDollars)}</span>
                  <span data-cf-price style="font-size:${fs(15)}px;font-weight:700">${formatPriceDollars(displayPrice)}</span>
                  <span data-cf-save style="font-size:${fs(12)}px;font-weight:600;color:${v.savings_color||'#22c55e'};${v.show_strikethrough && totalSavingsItem > 0.01 ? '' : 'display:none'}">(Save ${formatPriceDollars(totalSavingsItem)})</span>`;
             div.innerHTML = `
             <div data-cf-item-key="${item.key}" data-cf-gift="${isGift?'1':'0'}" style="display:flex;align-items:center;gap:12px;padding:16px;${borderBottom}">
               <div style="flex-shrink:0;width:80px;height:80px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;position:relative;">
                 <img src="${item.image||item.featured_image?.url||''}" onerror="this.style.display='none'" alt="${productTitle}" style="width:100%;height:100%;object-fit:cover;display:block" loading="eager" decoding="sync" fetchpriority="high" />
               </div>
               <div style="flex:1;min-width:0">
                 <div style="display:flex;justify-content:space-between;align-items:flex-start">
                   <p style="font-size:${fs(15)}px;font-weight:600;margin:0;word-break:break-word;white-space:normal;flex:1;min-width:0;padding-right:8px">${productTitle}</p>
                   ${delHtml}
                 </div>
                 ${isGift ? giftSubtitleHtml : (variantLabel ? `<p style="font-size:${fs(12)}px;opacity:0.6;margin:0 0 2px 0">${variantLabel}</p>` : '')}
                 <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                   ${priceHtml}
                 </div>
                <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
                  ${qtyControlsHtml}
                  <span data-cf-reward-tag style="display:${!isGift && hasRewardDiscount && activeDiscountLabel ? 'inline-flex' : 'none'};align-items:center;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;background:rgba(0,0,0,0.08);color:${v.text_color || '#1a1a1a'};">${activeDiscountLabel || ''}</span>
                </div>
               </div>
            </div>`;
            const newNode = div.firstElementChild;
            if (itemsEl.children[idx]) itemsEl.insertBefore(newNode, itemsEl.children[idx]);
            else itemsEl.appendChild(newNode);
          }
        });
      }
    }

    // Filter upsells: exclude products already in cart
    const upsells = config.upsells || [];
    const cartSkus = new Set(items.map(i => (i.sku||'').toUpperCase()).filter(Boolean));
    const cartTitles = new Set(items.map(i => (i.product_title||i.title||'').toUpperCase()).filter(Boolean));
    // Cleanup _addedUpsellSkus: remove SKUs no longer in cart
    for (const sku of _addedUpsellSkus) {
      const stillInCart = items.some(i => (i.sku||'').toUpperCase() === sku.toUpperCase());
      if (!stillInCart) _addedUpsellSkus.delete(sku);
    }
    // Restore upsells from snapshot so removed items reappear in the list
    if (Array.isArray(window._originalUpsells) && window._cfConfig) {
      window._cfConfig.upsells = window._originalUpsells.filter(u => {
        const allSkus = [u.sku, ...(u.variants||[]).map(v => v.sku)].filter(Boolean);
        return !allSkus.some(s => _addedUpsellSkus.has(s) || _addedUpsellSkus.has((s||'').toUpperCase()));
      });
    }
    const refreshedUpsells = (window._cfConfig && Array.isArray(window._cfConfig.upsells)) ? window._cfConfig.upsells : upsells;
    const visibleUpsells = refreshedUpsells.filter(u => {
      const allSkus = [u.sku, ...(u.variants||[]).map(v => v.sku)].filter(Boolean);
      for (const s of allSkus) {
        if (cartSkus.has(s.toUpperCase())) return false;
        if (_addedUpsellSkus.has(s) || _addedUpsellSkus.has((s||'').toUpperCase())) return false;
      }
      if (u.title && cartTitles.has(u.title.toUpperCase())) return false;
      return true;
    });

    const topEl = document.getElementById('cf-upsells-top');
    const btmEl = document.getElementById('cf-upsells-bottom');
    const upsellIds = visibleUpsells.map(u => u.id).sort().join(',');
    const prevUpsellIds = window._cfPrevUpsellIds || '';
    // FIX v11.9 - upsell reaparece: também re-renderiza se o container alvo está vazio
    // (caso comum após fechar/abrir o drawer, ou após hot-reload de config).
    const targetForCheck = (v.upsells_position||'bottom') === 'top' ? topEl : btmEl;
    const containerEmpty = targetForCheck && !targetForCheck.innerHTML.trim();
    const upsellsChanged = upsellIds !== prevUpsellIds || (visibleUpsells.length > 0 && containerEmpty);
    window._cfPrevUpsellIds = upsellIds;
    if (upsellsChanged) {
      // v11.12: preload upsell images BEFORE wiping DOM — browser cache hit → instant paint
      try {
        const _imgs = visibleUpsells.map(function(p){ return p.image_url || (p.variants && p.variants[0] && p.variants[0].image_url) || ''; }).filter(Boolean);
        if (_imgs.length && window._cfPreloadImages) window._cfPreloadImages(_imgs);
      } catch(e) {}
      if (topEl) topEl.innerHTML = '';
      if (btmEl) btmEl.innerHTML = '';
    }
    if (v.upsells_enabled && visibleUpsells.length > 0 && upsellsChanged) {
      const upsellBg = accentColor;
      const upsellText = accentTextColor;
      const isStack = (v.upsells_direction||'stack') !== 'inline';
      const html = `
        <div style="padding:12px 16px;border-top:1px solid rgba(0,0,0,0.08);margin-top:16px">
          <p style="font-size:${fs(v.upsells_title_font_size||14)}px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:center;opacity:0.6;margin:0 0 12px 0">${v.upsells_title||'RECOMMENDED FOR YOU'}</p>
          <div style="display:flex;${isStack?'flex-direction:column;gap:12px':'gap:8px;overflow-x:auto'}">
            ${visibleUpsells.map(p => {
              const hasCompare = v.upsells_show_strikethrough && p.compare_price && p.compare_price > (p.price||0);
              const variantHtml = buildUpsellVariantHtml(p, v);
              const imgSrc = p.image_url || p.variants?.[0]?.image_url || '';
              return `
                <div data-cf-upsell-card="${p.id}" style="display:flex;align-items:flex-start;gap:12px;border-radius:8px;background:${upsellBg};color:${upsellText};padding:12px">
                  ${imgSrc ? `<div style="width:80px;height:80px;border-radius:8px;overflow:hidden;flex-shrink:0;background:rgba(0,0,0,0.06)"><img id="cf-upsell-img-${p.id}" src="${imgSrc}" alt="${p.title}" style="width:100%;height:100%;object-fit:cover;display:block" loading="eager" decoding="sync" fetchpriority="high"/></div>` : `<div style="width:80px;height:80px;border-radius:8px;flex-shrink:0;background:rgba(255,255,255,0.2)"></div>`}
                  <div style="flex:1;min-width:0">
                    <p style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${p.title}</p>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                      ${hasCompare ? `<span style="font-size:12px;text-decoration:line-through;opacity:0.5">${formatPriceDollars(p.compare_price)}</span>` : ''}
                      <span style="font-size:12px;font-weight:600">${formatPriceDollars(p.price||0)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                      ${variantHtml}
                      <button id="cf-upsell-btn-${p.id}" onclick="window.cfAddUpsell('${p.id}')" style="all:unset;box-sizing:border-box;font-size:13px;height:32px;padding:0 16px;${variantHtml ? 'flex-shrink:0;' : 'width:100%;'}font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${v.button_color||'#000'};color:${v.button_text_color||'#fff'};border-radius:${v.button_radius||0}px;opacity:0.85;white-space:nowrap">${v.upsells_button_text||'+Add'}</button>
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
      const target = (v.upsells_position||'bottom') === 'top' ? topEl : btmEl;
      if (target) target.innerHTML = html;
    }

    const addonEl = document.getElementById('cf-addon-section');
    const addonStateKey = `${_spActive}-${_gwActive}`;
    const addonChanged = addonStateKey !== window._cfPrevAddonState;
    window._cfPrevAddonState = addonStateKey;
    if (addonEl && addonChanged) {
      addonEl.innerHTML = '';
      let addonHtml = '';
      if (v.shipping_protection_enabled) {
        const spTitle = v.sp_title||'Shipping Protection';
        const spDesc = v.sp_description||'Coverage against loss, damage, or theft.';
        const spPrice = Number(v.sp_price||4.99);
        const spPriceText = v.sp_price_type==='percentage' ? `${spPrice}%` : formatPriceDollars(spPrice);
        addonHtml += `<div style="padding:12px 16px 0 16px"><div id="cf-addon-sp" onclick="window.cfToggleAddon('sp')" style="border-radius:8px;padding:10px;cursor:pointer;user-select:none;transition:all 0.2s;border:1.5px solid ${_spActive?'#059669':'rgba(0,0,0,0.10)'};background:${_spActive?'rgba(5,150,105,0.04)':'transparent'}"><div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:8px"><div style="width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${_spActive?'background:#059669':'background:transparent;border:1.5px solid rgba(0,0,0,0.2)'}">${_spActive?SVG_ICONS.check:''}</div>${v.sp_icon?`<img src="${v.sp_icon}" alt="SP" style="width:28px;height:28px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'"/>`:''}<div><p style="font-size:${fs(12)}px;font-weight:600;margin:0">${spTitle}</p><p style="font-size:${fs(12)}px;opacity:0.6;margin:0">${spDesc}</p></div></div><span style="font-size:${fs(14)}px;font-weight:600;flex-shrink:0;margin-left:8px">${spPriceText}</span></div></div></div>`;
      }
      if (v.gift_wrap_enabled) {
        const gwTitle = v.gw_title||'Gift Wrapping';
        const gwDesc = v.gw_description||'Beautiful gift wrapping for your order.';
        const gwPrice = Number(v.gift_wrap_price||2.99);
        addonHtml += `<div style="padding:8px 16px 0 16px"><div id="cf-addon-gw" onclick="window.cfToggleAddon('gw')" style="border-radius:8px;padding:10px;cursor:pointer;user-select:none;transition:all 0.2s;border:1.5px solid ${_gwActive?'#059669':'rgba(0,0,0,0.10)'};background:${_gwActive?'rgba(5,150,105,0.04)':'transparent'}"><div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:8px"><div style="width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${_gwActive?'background:#059669':'background:transparent;border:1.5px solid rgba(0,0,0,0.2)'}">${_gwActive?SVG_ICONS.check:''}</div>${v.gw_icon?`<img src="${v.gw_icon}" alt="GW" style="width:28px;height:28px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'"/>`:''}<div><p style="font-size:${fs(12)}px;font-weight:600;margin:0">${gwTitle}</p><p style="font-size:${fs(12)}px;opacity:0.6;margin:0">${gwDesc}</p></div></div><span style="font-size:${fs(14)}px;font-weight:600;flex-shrink:0;margin-left:8px">${formatPriceDollars(gwPrice)}</span></div></div></div>`;
      }
      if (addonHtml) addonEl.innerHTML = addonHtml;
    }

    const badgesTop = document.getElementById('cf-badges-top');
    const badgesBot = document.getElementById('cf-badges-bottom');
    if (badgesTop) badgesTop.innerHTML = '';
    if (badgesBot) badgesBot.innerHTML = '';
    if (v.trust_badges_enabled) {
      const badgeImgUrl = v.trust_badges_image_url || '';
      const badgePreset = v.trust_badges_preset || '';
      const badgeSize = v.trust_badges_image_size || 100;
      const badgePos = v.trust_badges_position || 'below';
      const PRESET_IMAGES = {
        payment_icons: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/payment-icons-transparent.png',
        returns_warranty: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/free-return-guarantee-transparent.png',
      };
      let badgeHtml = '';
      if (badgeImgUrl) {
        badgeHtml = `<div style="text-align:center;padding:8px 16px"><img src="${badgeImgUrl}" alt="Trust Badge" style="width:${badgeSize}%;max-width:100%;object-fit:contain;display:block;margin:0 auto"/></div>`;
      } else if (PRESET_IMAGES[badgePreset]) {
        badgeHtml = `<div style="text-align:center;padding:8px 16px"><img src="${PRESET_IMAGES[badgePreset]}" alt="Trust Badge" style="width:${badgeSize}%;max-width:100%;object-fit:contain;display:block;margin:0 auto"/></div>`;
      } else if (PRESETS[badgePreset]) {
        badgeHtml = `<div style="text-align:center;padding:8px 16px;font-size:11px;opacity:0.6">${SVG_ICONS.shield} ${PRESETS[badgePreset]}</div>`;
      }
      if (badgeHtml) {
        const target = badgePos === 'above' ? badgesTop : badgesBot;
        if (target) target.innerHTML = badgeHtml;
      }
    }

    const rawSubtotalCents = items.reduce((a,i) => _cfIsGiftItem(i, config) ? a : a + i.price * i.quantity, 0);
    const rawSubtotalDollars = rawSubtotalCents / 100;
    // v15.8: upsell total is always tracked separately so the reward discount only applies to main items.
    const upsellTotalDollars = items.reduce((a,i) => _cfIsUpsellItem(i) ? a + i.price * i.quantity : a, 0) / 100;
    let addonTotal = 0;
    if (_spActive && v.shipping_protection_enabled) {
      const spPrice = Number(v.sp_price||4.99);
      addonTotal += v.sp_price_type==='percentage' ? rawSubtotalDollars*spPrice/100 : spPrice;
    }
    if (_gwActive && v.gift_wrap_enabled) addonTotal += Number(v.gift_wrap_price||2.99);
    window._cfAddonTotal = addonTotal;
    window._cfUpsellTotal = upsellTotalDollars;
    const finalSubtotal = Math.max(0, (rawSubtotalDollars - upsellTotalDollars) - rewardDiscount + upsellTotalDollars + addonTotal);
    const subtotalEl = document.getElementById('cf-subtotal');
    if (subtotalEl) subtotalEl.textContent = formatPriceDollars(finalSubtotal);

    // v15.6: currency disclosure removed — Shopify checkout auto-converts to visitor currency
    // when additional currencies are enabled, so the previous note was misleading.
    const curNoteEl = document.getElementById('cf-currency-note');
    if (curNoteEl) {
      curNoteEl.textContent = '';
      curNoteEl.style.display = 'none';
    }

    const discRow = document.getElementById('cf-discounts-row');
    if (discRow) {
      if (activeRewardLabels.length > 0) {
        discRow.style.display = 'flex';
        const textColor = v.text_color || '#000';
        const savingsColor = v.savings_color || '#22c55e';
        const labelsHtml = activeRewardLabels.map(label =>
          `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:4px;font-size:${fs(10)}px;font-weight:600;text-transform:uppercase;background:rgba(0,0,0,0.08);color:${textColor}">${label}</span>`
        ).join(' ');
        discRow.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="color:${savingsColor};font-weight:500">Discounts</span>
            ${labelsHtml}
          </div>
          ${rewardDiscount > 0 ? `<span style="color:${savingsColor};font-weight:600;white-space:nowrap">-${formatPriceDollars(rewardDiscount)}</span>` : ''}
        `;
      } else {
        discRow.style.display = 'none';
        discRow.innerHTML = '';
      }
    }

    const subtotalRow = document.getElementById('cf-subtotal-row');
    if (subtotalRow) subtotalRow.style.display = v.show_subtotal_line===false ? 'none' : 'flex';

    const contWrap = document.getElementById('cf-continue-wrap');
    if (contWrap) contWrap.innerHTML = v.show_continue_shopping ? `<button onclick="closeCart()" style="all:unset;box-sizing:border-box;width:100%;display:block;text-align:center;font-size:${fs(13)}px;margin-top:8px;cursor:pointer;opacity:0.6;text-decoration:underline">Continue Shopping</button>` : '';
  }

  async function buildCheckoutUrl(cartItems, config) {
    const routing = config?.routing || {};
    const skuMap = routing.sku_map || {};
    const activeDomain = routing.active_store?.domain;
    const v = config?.visual || {};
    if (!activeDomain) return "/checkout";
    const lineItems = [];
    for (const item of cartItems) {
      const mappedId = skuMap[item.sku];
      if (mappedId) lineItems.push(`${mappedId}:${item.quantity}`);
    }
    if (_spActive && v.sp_sku) { const m = skuMap[v.sp_sku]; if (m) lineItems.push(`${m}:1`); }
    if (_gwActive && v.gw_sku) { const m = skuMap[v.gw_sku]; if (m) lineItems.push(`${m}:1`); }
    if (lineItems.length === 0) return "/checkout";
    let checkoutUrl = `https://${activeDomain}/cart/${lineItems.join(",")}`;
    const tiers = config.rewards || [];
    const isQty = (v.rewards_calculation||"cart_total") === "quantity";
    // v15.12: SAME eligibility as cart — bar progress and coupon use _cfIsDiscountable.
    // Switch OFF: only main items count. Switch ON: main + upsells.
    const eligibleCheckoutItems = cartItems.filter(i => _cfIsDiscountable(i, config));
    const hasEligibleItem = eligibleCheckoutItems.length > 0;
    let bestCoupon = null;
    if (hasEligibleItem) {
      const simValue = isQty
        ? eligibleCheckoutItems.reduce((a,i) => a + i.quantity, 0)
        : eligibleCheckoutItems.reduce((a,i) => a + i.price * i.quantity, 0) / 100;
      const unlockedTiers = tiers.filter(t => simValue >= (Number(t.minimum_value)||0));
      // Highest unlocked % tier wins (mutually exclusive). Shipping/free_product are Automatic and don't need a code.
      const sortedByMin = [...unlockedTiers].sort((a,b) => (Number(b.minimum_value)||0) - (Number(a.minimum_value)||0));
      bestCoupon = sortedByMin.find(t => t.reward_type === 'discount' && (t.shopify_coupon || t.reward_description))
                || sortedByMin.find(t => (t.shopify_coupon || t.reward_description))
                || null;
    }
    // v14.6: Shopify-standard 10 attribution keys (6 UTMs + 4 click IDs).
    var trackingKeys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id","fbclid","gclid","ttclid","msclkid"];
    var storedTracking = {};
    try { storedTracking = JSON.parse(localStorage.getItem("_octo_tracking") || "{}"); } catch(e) {}
    if (!Object.keys(storedTracking).length) {
      try { var ck = (document.cookie.match(/(?:^|; )_octo_tracking=([^;]*)/)||[])[1]; if(ck) storedTracking = JSON.parse(decodeURIComponent(ck)); } catch(e) {}
    }
    if (!Object.keys(storedTracking).length) {
      try { storedTracking = JSON.parse(sessionStorage.getItem("_octo_tracking") || "{}"); } catch(e) {}
    }
    var pageParams = new URLSearchParams(window.location.search);
    var mergedTracking = Object.assign({}, storedTracking);
    pageParams.forEach(function(v, k) { if (v) mergedTracking[k] = v; });
    /* --- SERVER-SIDE ATTRIBUTION --- */
    var cleanTracking = {};
    trackingKeys.forEach(function(k) {
      var val = mergedTracking[k] || null;
      if (val) cleanTracking[k] = String(val).substring(0, 200);
    });
    cleanTracking["source"] = "web";
    // v12: SID estável (sessionStorage) — mesma sessão = mesmo SID em múltiplas tentativas
    var sid = null;
    try { sid = sessionStorage.getItem('_octo_sid_active'); } catch(e) {}
    if (!sid) {
      sid = "ocs_" + Date.now() + "_" + Math.random().toString(36).substring(2, 10);
      try { sessionStorage.setItem('_octo_sid_active', sid); } catch(e) {}
    }
    // v12: aguarda cookies de pixel hidratarem (FB/TikTok carregam async, até 800ms)
    await new Promise(function(resolve){
      var deadline = Date.now() + 800;
      (function check(){
        var hasFbp = /(?:^|; )_fbp=/.test(document.cookie);
        var hasFbc = /(?:^|; )_fbc=/.test(document.cookie) || !mergedTracking.fbclid;
        if ((hasFbp && hasFbc) || Date.now() >= deadline) return resolve();
        setTimeout(check, 100);
      })();
    });
    // Re-captura cookies após espera (pode ter chegado _fbp novo)
    try {
      var fbpNow = (document.cookie.match(/(?:^|; )_fbp=([^;]*)/)||[])[1];
      var fbcNow = (document.cookie.match(/(?:^|; )_fbc=([^;]*)/)||[])[1];
      if (fbpNow && !cleanTracking._fbp) cleanTracking._fbp = decodeURIComponent(fbpNow);
      if (fbcNow && !cleanTracking._fbc) cleanTracking._fbc = decodeURIComponent(fbcNow);
    } catch(e) {}
    // v12: POST com retry real (3 tentativas, backoff 300/700/1500ms, timeout 4s cada)
    var _octoPostRetry = async function(url, body, retries, backoffs) {
      for (var i = 0; i <= retries; i++) {
        try {
          var ctrl = new AbortController();
          var to = setTimeout(function(){ ctrl.abort(); }, 4000);
          var res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
            keepalive: true,
            referrerPolicy: 'no-referrer',
            credentials: 'omit'
          });
          clearTimeout(to);
          if (res.ok) return true;
        } catch(e) {}
        if (i < retries) await new Promise(function(r){ setTimeout(r, backoffs[i] || 1000); });
      }
      return false;
    };
    // v14.6: scrub correlation fields client-side before they ever leave the browser.
    try { cleanTracking = __octoScrubTracking(cleanTracking); } catch(e) {}
    try {
      await _octoPostRetry(
        "https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/store-checkout-attributes",
        { session_id: sid, store_id: config.store.id, tracking_data: cleanTracking },
        2,
        [300, 700, 1500]
      );
    } catch(e) { /* fallback adblocker abaixo cobre */ }
    /* --- HYBRID: pass ALL tracking attributes directly in URL (like OctoRoute) --- */
    var sep = checkoutUrl.includes("?") ? "&" : "?";
    for (var [ak, av] of Object.entries(cleanTracking)) {
      checkoutUrl += sep + "attributes[" + encodeURIComponent(ak) + "]=" + encodeURIComponent(av);
      sep = "&";
    }
    // v14.0: _octo_sid / _octo_vid / raw referrer no longer leak to public URL.
    // Session is still POST'd to backend (session_id: sid above); recovery uses
    // cart_token + customer_email Dual-Mode in shopify-webhook.
    if (bestCoupon) {
      var couponCode = bestCoupon.shopify_coupon || bestCoupon.reward_description || "";
      if (couponCode) checkoutUrl += "&discount=" + encodeURIComponent(couponCode);
    }

    // v14.7: removed UTM fallback entirely. Any fixed string (e.g. utm_campaign=octoroute_checkout)
    // becomes a fingerprint identifying the system across White stores. If no real source exists,
    // let Shopify classify as "direct" — that is innocent traffic, indistinguishable from a
    // customer typing the URL. No fallback is safer than any traceable fallback.

    // v14.0: removed top-level &fbclid / &ttclid duplicates — already in attributes[...] above.
    return checkoutUrl;
  }

  window.cfToggleAddon = (type) => {
    _hadInteraction = true;
    if (type === 'sp') { _spActive = !_spActive; trackEvent('addon_toggled', 0, { addon: 'shipping_protection', active: _spActive }); }
    if (type === 'gw') { _gwActive = !_gwActive; trackEvent('addon_toggled', 0, { addon: 'gift_wrap', active: _gwActive }); }
    fetchShopifyCart().then(cart => { if (window._cfConfig) renderCart(cart, window._cfConfig); });
  };

  // FIX v11.10 - mobile flicker: optimistic UI + debounced sync (no full re-render per click)
  window._cfQtyTimers = window._cfQtyTimers || {};
  window._cfQtyPending = window._cfQtyPending || {};
  window.cfQty = (key, qty) => {
    _hadInteraction = true;
    if (qty < 0) return;
    // Optimistic DOM update: bump qty + line price locally, no innerHTML swap
    try {
      const itemNode = document.querySelector(`[data-cf-item-key="${key}"]`);
      if (itemNode && window._lastCart) {
        const item = (window._lastCart.items||[]).find(i => String(i.key) === String(key));
        if (item) {
          if (qty === 0) {
            // Soft-hide the row immediately to avoid waiting for fetch
            itemNode.style.transition = 'opacity 0.15s ease, max-height 0.2s ease';
            itemNode.style.overflow = 'hidden';
            itemNode.style.opacity = '0.4';
          } else {
            const qtyEl = itemNode.querySelector('[data-cf-qty]');
            if (qtyEl) qtyEl.textContent = qty;
            const minusBtn = itemNode.querySelector('[data-cf-minus]');
            const plusBtn = itemNode.querySelector('[data-cf-plus]');
            if (minusBtn) minusBtn.setAttribute('onclick', `cfQty('${key}',${qty-1})`);
            if (plusBtn) plusBtn.setAttribute('onclick', `cfQty('${key}',${qty+1})`);
            // Update local cart so subsequent clicks read fresh qty
            item.quantity = qty;
          }
        }
      }
    } catch(e) {}
    // Debounce network sync: collapse rapid +/- clicks into one POST
    window._cfQtyPending[key] = qty;
    clearTimeout(window._cfQtyTimers[key]);
    window._cfQtyTimers[key] = setTimeout(async () => {
      const finalQty = window._cfQtyPending[key];
      delete window._cfQtyPending[key];
      delete window._cfQtyTimers[key];
      try {
        await (window._cfOrigFetch||fetch)('/cart/change.js', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:key,quantity:finalQty}),
          referrerPolicy: 'no-referrer'
        });
        const cart = await fetchShopifyCart();
        window._lastCart = cart;
        // Only do a full re-render if qty hit 0 (item removed) or if rewards/upsells need refresh
        if (window._cfConfig) renderCart(cart, window._cfConfig);
      } catch(err) {
        // On error, force a full re-render to reconcile with server truth
        try { const cart = await fetchShopifyCart(); window._lastCart = cart; if (window._cfConfig) renderCart(cart, window._cfConfig); } catch(e){}
      }
    }, 180);
  };

  window.cfAddUpsell = async (productId) => {
    _hadInteraction = true;
    if (!productId || _upsellPending) return;
    _upsellPending = true;
    const btn = document.getElementById(`cf-upsell-btn-${productId}`);
    const origBtnText = btn ? btn.innerHTML : '';
    if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; btn.innerHTML = SVG_ICONS.spin + ' Adding...'; }
    const resetBtn = () => { const b = document.getElementById(`cf-upsell-btn-${productId}`); if(b){b.style.opacity='0.85';b.style.pointerEvents='auto';b.innerHTML=origBtnText||(window._cfConfig?.visual?.upsells_button_text||'+Add');} };
    const upsells = window._cfConfig?.upsells || [];
    const product = upsells.find(p => p.id === productId);
    if (!product) { _upsellPending = false; resetBtn(); return; }
    const card = document.querySelector(`[data-cf-upsell-card="${productId}"]`);
    const wrapper = card?.querySelector('[data-cf-selected-sku]');
    let selectedSku = wrapper?.getAttribute('data-cf-selected-sku') || '';
    if (!selectedSku || selectedSku === 'null') selectedSku = product.variants?.[0]?.sku || product.sku || '';
    if (!selectedSku) { _upsellPending = false; resetBtn(); return; }
    const selectedVariant = (product.variants || []).find(v => v.sku === selectedSku);
    let vitrineVariantId = selectedVariant?.shopify_variant_id || null;
    if (!vitrineVariantId) {
      const vitrineMap = await getVitrineSkuMap();
      const vitrineEntry = vitrineMap[selectedSku.toUpperCase()];
      vitrineVariantId = vitrineEntry?.id || vitrineEntry;
    }
    if (!vitrineVariantId) { console.warn('[CartFlow] SKU não encontrado na vitrine:', selectedSku); _upsellPending = false; resetBtn(); return; }
    _addedUpsellSkus.add(selectedSku);
    _addedUpsellSkus.add((selectedSku||'').toUpperCase());
    // Optimistically remove ONLY the added upsell from local config so the rest stay visible
    if (!window._originalUpsells && Array.isArray(window._cfConfig?.upsells)) {
      window._originalUpsells = window._cfConfig.upsells.slice();
    }
    if (window._cfConfig && Array.isArray(window._cfConfig.upsells)) {
      window._cfConfig.upsells = window._cfConfig.upsells.filter(u => u.id !== productId);
    }
    // v14.3 — Helper: try /cart/add with a given variant id; returns true on success.
    const tryAdd = async (vid) => {
      try {
        const r = await (window._cfOrigFetch||fetch)('/cart/add.js?_cf=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ id: vid, quantity: 1 }] }),
          referrerPolicy: 'no-referrer'
        });
        return r.ok;
      } catch (e) { return false; }
    };
    let added = await tryAdd(vitrineVariantId);
    // v14.3 — If cached shopify_variant_id failed (likely belongs to White store, not Vitrine),
    // invalidate it and retry by resolving via Vitrine /products.json SKU map.
    if (!added) {
      console.warn('[CartFlow] Cached variant_id failed, retrying via Vitrine SKU map for', selectedSku);
      try {
        const vitrineMap = await getVitrineSkuMap();
        const vitrineEntry = vitrineMap[selectedSku.toUpperCase()];
        const fallbackId = vitrineEntry?.id || vitrineEntry;
        if (fallbackId && String(fallbackId) !== String(vitrineVariantId)) {
          added = await tryAdd(fallbackId);
        }
      } catch(_) {}
    }
    if (!added) {
      // Restore upsell visibility so user can retry
      if (window._originalUpsells && window._cfConfig) {
        window._cfConfig.upsells = window._originalUpsells.filter(u => !_addedUpsellSkus.has((u.sku||'').toUpperCase()));
      }
      _upsellPending = false; resetBtn(); return;
    }
    const cart = await fetchShopifyCart();
    window._lastCart = cart;
    if (window._cfConfig) {
      // Skip re-fetching upsells: we've already removed the added one locally.
      // Re-fetch is triggered later by debouncedCartRefresh if the user keeps interacting.
      renderCart(cart, window._cfConfig);
      trackEvent('upsell_added', product.price||0, { title: product.title, sku: selectedSku });
    }
    _upsellPending = false;
    resetBtn();
  };

  window.closeCart = closeCart;

  // Debounced cart refresh — v11: wait for confirmed data before opening
  function debouncedCartRefresh(openAfter) {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(async () => {
      try {
        let cart = await fetchShopifyCart();
        if (cart.item_count === 0 && openAfter) {
          await new Promise(r => setTimeout(r, 350));
          cart = await fetchShopifyCart();
        }
        window._lastCart = cart;
        if (window._cfConfig) {
          renderCart(cart, window._cfConfig);
          if (openAfter) openCart();
          fetchUpsells(cart).then(() => {
            if (window._cfConfig && window._lastCart) {
              renderCart(window._lastCart, window._cfConfig);
            }
          }).catch(() => {});
        } else if (openAfter) { _pendingOpen = true; }
      } catch(e) {
        if (openAfter && window._cfConfig) {
          try { openCart(); } catch(e2) {}
        }
      }
    }, 0);
  }
  // v15.5: expose for theme.cart shim (PageFly compatibility)
  try { window._cfDebouncedCartRefresh = debouncedCartRefresh; } catch(e) {}

  function interceptCart() {
    if (window._cfFetchPatched) return;
    window._cfFetchPatched = true;

    if (!window._cfOrigFetch) window._cfOrigFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]||'');
      // v15.7: if it's a real cart/add and config isn't ready yet, open the shell
      // immediately so the user sees feedback while we wait for config + drawer.
      if (url.includes('/cart/add') && !url.includes('_cf=1') && !window._cfConfigReady) {
        try { _cfOpenShellCart(); } catch(e) {}
      }
      const result = await window._cfOrigFetch.apply(window, args);
      if ((url.includes('/cart/add') || url.includes('/cart/change')) && !url.includes('track-event') && !url.includes('config') && !url.includes('_cf=1')) {
        try {
          const clone = await result.clone().json();
          if (clone?.id || clone?.items || clone?.item_count !== undefined) {
            window._cfAddInFlight = true;
            setTimeout(() => { window._cfAddInFlight = false; }, 500);
            // Track add_to_cart from fetch wrapper
            if (url.includes('/cart/add')) {
              try {
                const items = clone.items || (clone.id ? [clone] : []);
                items.forEach(i => {
                  trackEvent('add_to_cart', (i.price||0)/100, { title: i.title||'', variant_id: i.variant_id||i.id||'', price: (i.price||0)/100, qty: i.quantity||1 });
                });
              } catch(e) {}
            }
            // v15.7: mark intent so flushPending opens real drawer when config arrives.
            if (!window._cfConfigReady) { window._cfPendingOpen = true; }
            debouncedCartRefresh(true);
          }
        } catch(e){}
      }
      return result;
    };

    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._cfUrl = String(url);
      return origXHROpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const url = this._cfUrl || '';
      if ((url.includes('/cart/add') || url.includes('/cart/change')) && !url.includes('_cf=1')) {
        this.addEventListener('load', () => {
          window._cfAddInFlight = true;
          setTimeout(() => { window._cfAddInFlight = false; }, 500);
          debouncedCartRefresh(true);
        });
      }
      return origXHRSend.apply(this, arguments);
    };

    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.tagName !== 'FORM') return;
      const action = form.action || '';
      if (!action.includes('/cart/add')) return;

      e.preventDefault();

      // v15.7: open shell immediately so the user sees feedback before /cart/add returns.
      if (!window._cfConfigReady) {
        try { _cfOpenShellCart(); } catch(_) {}
        window._cfPendingOpen = true;
      }

      // If theme already added via fetch/XHR, don't duplicate
      if (window._cfAddInFlight) return;

      // Fallback: native form submit (no fetch), do manual POST
      const formData = new FormData(form);
      try {
        window._cfAddInFlight = true;
        await (window._cfOrigFetch || fetch)('/cart/add.js?_cf=1', {
          method: 'POST',
          body: formData,
          referrerPolicy: 'no-referrer'
        });
        debouncedCartRefresh(true);
      } catch(err) { console.warn('[CF] form submit error', err); }
      finally { setTimeout(() => { window._cfAddInFlight = false; }, 500); }
    }, { capture: true });

    document.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id==='cf-close'||t.closest('#cf-close')) { closeCart(); return; }
      if (t.id==='cf-checkout'||t.closest('#cf-checkout')) {
        e.preventDefault();
        _hadInteraction = true;
        const btn = document.getElementById('cf-checkout');
        if(!btn||btn.disabled) return;
        btn.disabled = true;
        btn._origHtml = btn._origHtml || btn.innerHTML;
        const origHtml = btn._origHtml;
        btn.innerHTML = `${SVG_ICONS.spin} SECURE CHECKOUT`;
        try {
          const cart = _upsellPending ? await fetchShopifyCart() : (window._lastCart || await fetchShopifyCart());
          window._lastCart = cart;
          const url = await buildCheckoutUrl(cart.items, window._cfConfig);
          trackEvent('checkout', cart.total_price/100, { addon_total: window._cfAddonTotal || 0, upsell_total: window._cfUpsellTotal || 0 });
          flushTrackQueue();
          await new Promise(r => setTimeout(r, 50));
          window.__octoCloakReferrer();        // v14.4: fail-closed cloak (never sends Vitrine Referer to White)
          window.location.href = url || '/checkout';
       } catch(e) {
          btn.disabled=false; btn.innerHTML=origHtml;
        }
        return;
      }
      const triggers = [
        '[href="/cart"]', '.cart-icon-bubble', '[data-cart-toggle]',
        '.header__icon--cart', '[aria-label="Cart"]', '[aria-label="Open cart"]',
        '.cart-count-bubble', '#cart-icon-bubble',
        '.js-cart-toggle', '.cart-link', '.site-header__cart',
        '.Header__CartIcon', '[data-action="toggle-cart"]',
        '.cart-toggle', '#mini-cart', '.js-drawer-open-right',
        '.cart-page-link', '.header-cart-btn', '.icon-cart',
        'a[href*="/cart"]',
      ];
if (triggers.some(sel => { try { return t.matches?.(sel)||t.closest?.(sel); } catch(e) { return false; } })) {
  const triggerEl = t.closest?.('a,button,[role="button"]') || t;
  const elText = (triggerEl.textContent || '').trim();
  const isAddToCart = /add|buy|comprar|adicionar/i.test(elText);
  const isSubmit = triggerEl.getAttribute('type') === 'submit' || triggerEl.getAttribute('name') === 'add';
  const isInProductCtx = triggerEl.closest('[data-section-type="product"], .product-form, product-info, form[action*="/cart/add"]');
  if (isAddToCart || isSubmit || isInProductCtx) return;
  e.preventDefault(); e.stopPropagation();
  if(window._cfConfig && window._lastCart) {
    renderCart(window._lastCart, window._cfConfig);
    openCart();
  }
  const cart = await fetchShopifyCart();
  window._lastCart = cart;
  if(window._cfConfig) {
    await fetchUpsells(cart);
    renderCart(cart, window._cfConfig);
    if (!document.getElementById('cf-overlay')?.classList.contains('open')) openCart();
  }
}
    }, { passive: false, capture: true });
  }

  // v11.11: interceptors-first — register fetch/XHR/submit/click capture BEFORE any await
  // so user clicks during config load are captured into _cfPendingAdds buffer.
  try {
    if (!window._cfOrigFetch) window._cfOrigFetch = window.fetch;
    interceptCart();
    // v15.7: signal __octoReady AS SOON AS interceptors are wired.
    // The bootstrap polls __octoReady to stop blocking add-to-cart submits.
    // We don't need the full config to be ready for that — only the interceptors.
    try { window.__octoReady = true; } catch(e) {}
  } catch(e) { console.warn('[CartFlow] early interceptCart failed', e); }

  // v15.7: minimal "shell" drawer — opens INSTANTLY on add-to-cart even before
  // config arrived. When config + cart are ready, the real drawer takes over
  // (renderCart() + openCart()) without the user noticing the swap.
  function _cfOpenShellCart() {
    try {
      if (document.getElementById('cf-shell-overlay')) return;
      if (document.getElementById('cf-overlay')) return; // real drawer already exists
      var ov = document.createElement('div');
      ov.id = 'cf-shell-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999998;opacity:1;transition:opacity .2s ease;';
      var dr = document.createElement('div');
      dr.id = 'cf-shell-drawer';
      dr.style.cssText = 'position:fixed;top:0;right:0;width:420px;max-width:100vw;height:100%;background:#fff;color:#111;z-index:999999;box-shadow:-4px 0 24px rgba(0,0,0,0.12);display:flex;flex-direction:column;font-family:system-ui,sans-serif;transform:translateX(0);transition:transform .25s ease;';
      dr.innerHTML = ''
        + '<div style="padding:14px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;">'
        +   '<strong style="font-size:16px;">Cart</strong>'
        +   '<button id="cf-shell-close" aria-label="Close" style="all:unset;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px;">&times;</button>'
        + '</div>'
        + '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;">'
        +   '<div style="width:32px;height:32px;border:3px solid rgba(0,0,0,0.1);border-top-color:#333;border-radius:50%;animation:cf-spin .7s linear infinite;"></div>'
        +   '<div style="font-size:13px;color:#666;text-align:center;">Updating your cart…</div>'
        + '</div>';
      // Mobile width
      try {
        if (window.matchMedia && window.matchMedia('(max-width:768px)').matches) {
          dr.style.width = '100vw';
          dr.style.maxWidth = '100vw';
        }
      } catch(e) {}
      // Inline keyframes (avoid relying on injected styles)
      var st = document.createElement('style');
      st.textContent = '@keyframes cf-spin{to{transform:rotate(360deg);}}';
      dr.appendChild(st);
      ov.appendChild(dr);
      document.body.appendChild(ov);
      // Lock scroll (lightweight; openCart() will do the iOS-safe version later)
      try { document.body.style.overflow = 'hidden'; } catch(e) {}
      var close = function(){
        try { document.body.style.overflow = ''; } catch(e) {}
        try { ov.remove(); } catch(e) {}
      };
      try { ov.querySelector('#cf-shell-close').addEventListener('click', close); } catch(e) {}
      try { ov.addEventListener('click', function(e){ if (e.target === ov) close(); }); } catch(e) {}
      window._cfShellOpen = true;
      window._cfCloseShellCart = close;
    } catch(e) {}
  }
  function _cfCloseShellCart() {
    try {
      if (typeof window._cfCloseShellCart === 'function' && window._cfCloseShellCart !== _cfCloseShellCart) {
        window._cfCloseShellCart();
      }
      var ov = document.getElementById('cf-shell-overlay');
      if (ov) ov.remove();
      try { document.body.style.overflow = ''; } catch(e) {}
      window._cfShellOpen = false;
    } catch(e) {}
  }
  try { window._cfOpenShellCart = _cfOpenShellCart; window._cfCloseShellCart = _cfCloseShellCart; } catch(e) {}

  // v11.11: expose synchronous opener so script-bootstrap queue can replay 'open' events
  // even before config is ready. Buffers the open intent until config arrives.
  window._cfOpenCart = function() {
    if (window._cfConfigReady && window._cfConfig && window._lastCart) {
      try { _cfCloseShellCart(); } catch(e) {}
      try { renderCart(window._lastCart, window._cfConfig); } catch(e) {}
      try { openCart(); } catch(e) {}
    } else {
      window._cfPendingOpen = true;
      // v15.7: open the shell immediately so the user sees feedback now.
      _cfOpenShellCart();
    }
  };

  // v11.11: drain pending buffer once config + cart are ready
  function _cfFlushPending() {
    try {
      const pending = (window._cfPendingAdds || []).slice();
      window._cfPendingAdds = [];
      if (pending.length) {
        // Fire each queued add via the standard cart endpoint; fetch wrapper will refresh drawer.
        pending.forEach(function(item) {
          try {
            const body = item.formData || item.body;
            if (body) {
              (window._cfOrigFetch || fetch)('/cart/add.js?_cf=1', { method: 'POST', body: body, referrerPolicy: 'no-referrer' })
                .then(function(){ try { debouncedCartRefresh(true); } catch(e) {} })
                .catch(function(){});
            }
          } catch(e) {}
        });
      }
      if (window._cfPendingOpen || window._cfShellOpen) {
        window._cfPendingOpen = false;
        if (window._cfConfig && window._lastCart) {
          try { _cfCloseShellCart(); } catch(e) {}
          try { renderCart(window._lastCart, window._cfConfig); } catch(e) {}
          try { openCart(); } catch(e) {}
        }
      }
    } catch(e) { console.warn('[CartFlow] flushPending error', e); }
  }

  try {
    const initialCart = await fetchShopifyCart();
    const initialSkus = (initialCart.items||[]).map(i => i.sku).filter(Boolean).join(',');
    _lastSkus = initialSkus;
    const config = await getConfig(initialSkus);
    getVitrineSkuMap();
    if (!config) { console.warn('[CartFlow] Config not found'); return; }
    window._cfConfig = config;
    _storeCurrency = config.visual?.store_currency || 'USD';

    // v15.4: only run currency detection/conversion when dashboard toggle is ON.
    // Critical: _storeCurrency now comes from the real Shopify shop currency
    // (visual.store_currency, set by config edge function). Without this, conversion
    // would multiply by wrong base. Re-render only fires if rates loaded successfully —
    // otherwise we keep visitor=store to avoid "symbol swap without conversion".
    if (config.visual?.currency_conversion_enabled === true) {
      Promise.all([detectVisitorCurrency(), loadShopifyRates()]).then(([visCur]) => {
        const target = visCur || _storeCurrency;
        try { window.__octoVisitorCurrency = target; window.__octoStoreCurrency = _storeCurrency; } catch(e) {}
        if (target && target !== _visitorCurrency) {
          _visitorCurrency = target;
          try { if (window._lastCart && window._cfConfig) renderCart(window._lastCart, window._cfConfig); } catch(e) {}
        }
      }).catch(() => { _visitorCurrency = _storeCurrency; });
    } else {
      _visitorCurrency = _storeCurrency;
      try { window.__octoVisitorCurrency = _visitorCurrency; window.__octoStoreCurrency = _storeCurrency; } catch(e) {}
    }

    _fontScale = SCALE_MAP[config.visual?.font_scale] || 1.15;
    injectStyles(config.visual||{});
    injectHTML(config.visual||{});
    if (config.visual?.announcement_timer) startTimer(config.visual.announcement_timer);
    window._lastCart = initialCart;
    renderCart(initialCart, config);
    onCartReady();
    // v11.11: mark ready and drain buffered intents
    window._cfConfigReady = true;
    _cfFlushPending();
    // cart_impression removed — dashboard uses cart_opened only
    // v14.7: removed production console.log (was leaking outdated version string)
  } catch(err) { console.error('[CartFlow] Init error:', err); }


  // NEW v11.8: Public hot-reload API + automatic version polling.
  window._cfHotReload = async function() {
    try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch(e) {}
    try { sessionStorage.removeItem(`cf_config_${TOKEN}`); } catch(e) {}
    try {
      const r = await fetch(`${API_URL}?token=${TOKEN}`, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!r.ok) return;
      const fresh = await r.json();
      if (!fresh) return;
      setCachedConfig(fresh);
      window._cfConfig = fresh;
      _spActive = fresh.visual?.sp_pre_checked || false;
      _gwActive = fresh.visual?.gw_pre_checked || false;
      try { document.getElementById('cartflow-styles')?.remove(); injectStyles(fresh.visual||{}); } catch(e) {}
      try { if (window._lastCart) renderCart(window._lastCart, fresh); } catch(e) {}
    } catch(e) {}
  };
  window.addEventListener('message', function(ev) {
    // v14.7: same-origin only — prevents third-party iframes from triggering hot-reload
    try { if (ev.origin !== window.location.origin) return; } catch(e) { return; }
    if (ev?.data === '__octo_hot_reload__') window._cfHotReload();
  });

  // NEW v11.8: Auto-invalidation — re-check version on tab focus / visibility change.
  // Combined with `Cache-Control: no-cache, must-revalidate` on /config edge function,
  // this means: user saves in dashboard → next focus on storefront tab → version mismatch
  // detected → cache cleared → fresh config rendered. No manual refresh needed.
  async function _cfAutoSync() {
    try {
      const cached = getCachedConfig();
      const r = await fetch(`${API_URL}?token=${TOKEN}`, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!r.ok) return;
      const fresh = await r.json();
      if (!fresh) return;
      const cv = cached?.version || null;
      const fv = fresh?.version || null;
      if (cv && fv && cv !== fv) {
        setCachedConfig(fresh);
        try { sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(fresh)); } catch(e) {}
        window._cfConfig = fresh;
        _spActive = fresh.visual?.sp_pre_checked || false;
        _gwActive = fresh.visual?.gw_pre_checked || false;
        _storeCurrency = fresh.visual?.store_currency || 'USD';
        // v15.1: re-evaluate currency conversion gate on auto-sync (toggle may have flipped).
        if (fresh.visual?.currency_conversion_enabled !== true) {
          _visitorCurrency = _storeCurrency;
        }
        try { document.getElementById('cartflow-styles')?.remove(); injectStyles(fresh.visual||{}); } catch(e) {}
        try { if (window._lastCart) renderCart(window._lastCart, fresh); } catch(e) {}
        // v14.7: removed production console.log
      } else if (!cv && fv) {
        // First seed of version
        setCachedConfig(fresh);
      }
    } catch(e) {}
  }
  // v14.8: debounce de 15s para evitar rajada de syncs (focus/visibilitychange/interval simultâneos)
  var _lastSyncAt = 0;
  var SYNC_MIN_INTERVAL = 15000;
  function _cfAutoSyncDebounced() {
    var now = Date.now();
    if (now - _lastSyncAt < SYNC_MIN_INTERVAL) return;
    _lastSyncAt = now;
    _cfAutoSync();
  }
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') _cfAutoSyncDebounced();
  });
  window.addEventListener('focus', _cfAutoSyncDebounced);
  // Periodic poll every 30s while tab is visible
  setInterval(function() { if (document.visibilityState === 'visible') _cfAutoSyncDebounced(); }, 30000);

  // ============ v14.0: READY SIGNAL ONLY ============
  // CSS gating do script-bootstrap foi removido em v14.0 (era fingerprint cruzado).
  // Não marcamos mais data-octo-checkout-cta no DOM — atributo era visível para
  // scanners e identificava o app em todas as Vitrines simultaneamente.
  // Mantemos apenas o sinal interno window.__octoReady, usado pelo replay
  // de _cfPendingAdds / _cfPendingOpen e por consumidores internos do loader.
  (function(){
    var fired = false;
    var fire = function(){
      if (fired) return;
      fired = true;
      try { window.__octoReady = true; } catch(e) {}
    };
    var checkReady = setInterval(function(){
      if (window._cfConfigReady || window._cfConfig) { clearInterval(checkReady); fire(); }
    }, 100);
    setTimeout(fire, 2000); // hard fallback
  })();

})();
