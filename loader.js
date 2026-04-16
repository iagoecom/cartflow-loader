(async () => {

  // — Tracking capture (triple-layer: localStorage + cookie 30d + sessionStorage) —
  (function(){
    var keys=['fbclid','ttclid','gclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','wbraid','gbraid','tikclid','irclickid','ref','source'];
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

    // 3. Referrer UTM extraction (fallback like HeroCart)
    if(document.referrer){
      try{
        var refUrl=new URL(document.referrer);
        var rp=refUrl.searchParams;
        keys.forEach(function(k){if(!t[k]){var v=rp.get(k);if(v)t[k]=trunc(v)}});
        t['referrer_domain']=t['referrer_domain']||refUrl.hostname;
      }catch(e){}
    }

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

    // Triple-layer persist
    var json=JSON.stringify(t);
    try{localStorage.setItem('_octo_tracking',json)}catch(e){}
    try{document.cookie='_octo_tracking='+encodeURIComponent(json)+';path=/;max-age=2592000;SameSite=Lax'}catch(e){}
    try{sessionStorage.setItem('_octo_tracking',json)}catch(e){}
  })();


  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';

  if (!TOKEN) { console.warn('[CartFlow] data-token not found'); return; }

  // Save native fetch IMMEDIATELY — before any await — so interceptCart()
  // always has a clean reference even if the user clicks Add to Cart during init.
  if (!window._cfOrigFetch) window._cfOrigFetch = window.fetch;

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
  let _vitrineSkuMap = null;
  let _lastCart = null;
  let _upsellPending = false;
  let _hadInteraction = false;
  let _addedUpsellSkus = new Set();
  let _allUpsells = [];
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


  // ============ TRACKING QUEUE (v4 — sendBeacon batch) ============
  let _trackQueue = [];
  let _trackFlushTimer = null;

  function flushTrackQueue() {
    if (_trackQueue.length === 0) return;
    const batch = _trackQueue.splice(0);
    const payload = JSON.stringify({ events: batch });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'text/plain' });
        navigator.sendBeacon(TRACK_URL, blob);
      } else {
        (window._cfOrigFetch || fetch)(TRACK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: payload, keepalive: true
        }).catch(() => {});
      }
    } catch(e) {}
  }

  function trackEvent(type, amount=0, metadata={}) {
    _trackQueue.push({
      token: TOKEN,
      event_type: type,
      amount,
      session_id: _sessionId,
      metadata: { ...metadata, user_agent: navigator.userAgent }
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

  // --- Page view tracking (1x per session) ---
  try {
    if (!sessionStorage.getItem('_octo_pv')) {
      trackEvent('page_view', 0, { pathname: window.location.pathname, referrer: document.referrer || '' });
      sessionStorage.setItem('_octo_pv', '1');
    }
  } catch(e) {}

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
      // Detect checkout abandonment: user clicked checkout button, left, came back within 5min
      // _octo_checkout_clicked guards against false positives from unrelated tab switches
      try {
        const ts = sessionStorage.getItem('_octo_checkout_ts');
        const clicked = sessionStorage.getItem('_octo_checkout_clicked');
        if (ts && clicked && (Date.now() - parseInt(ts)) < 300000) {
          trackEvent('checkout_abandoned', 0, {
            cart_total: window._lastCart?.total_price ? window._lastCart.total_price / 100 : 0,
            item_count: window._lastCart?.item_count || 0
          });
          sessionStorage.removeItem('_octo_checkout_ts');
          sessionStorage.removeItem('_octo_checkout_clicked');
        }
      } catch(e) {}
    }
  });


  // ============ CART OPEN TIME TRACKING (v4) ============
  let _cartOpenedAt = null;

  // ============ CURRENCY CONVERSION (v4 — dynamic rates with fallback) ============
  const CURRENCY_RATES_FALLBACK = { USD: 1, BRL: 5.481, EUR: 0.899, GBP: 0.782 };
  let CURRENCY_RATES = { ...CURRENCY_RATES_FALLBACK };
  const CURRENCY_SYMBOLS = { USD: '$', BRL: 'R$', EUR: '€', GBP: '£' };

  // Fetch live rates once per session (fallback to hardcoded on any failure)
  (function fetchLiveRates() {
    const RATES_CACHE_KEY = '_octo_fx_rates';
    const RATES_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
    try {
      const raw = sessionStorage.getItem(RATES_CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < RATES_CACHE_TTL) { CURRENCY_RATES = { ...CURRENCY_RATES_FALLBACK, ...data }; return; }
      }
    } catch(e) {}
    // openexchangerates free tier — no key needed for latest.json with base USD
    fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json?.rates) return;
        const picked = {};
        ['BRL','EUR','GBP','USD'].forEach(c => { if (json.rates[c]) picked[c] = json.rates[c]; });
        CURRENCY_RATES = { ...CURRENCY_RATES_FALLBACK, ...picked };
        try { sessionStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ data: picked, ts: Date.now() })); } catch(e) {}
      })
      .catch(() => {}); // silently keep fallback rates
  })();
  const TZ_CURRENCY_MAP = {
    'America/Sao_Paulo': 'BRL', 'America/Fortaleza': 'BRL', 'America/Recife': 'BRL',
    'America/Bahia': 'BRL', 'America/Belem': 'BRL', 'America/Manaus': 'BRL',
    'America/Cuiaba': 'BRL', 'America/Campo_Grande': 'BRL', 'America/Porto_Velho': 'BRL',
    'America/Maceio': 'BRL', 'America/Araguaina': 'BRL', 'America/Noronha': 'BRL',
    'Europe/London': 'GBP', 'Europe/Paris': 'EUR', 'Europe/Berlin': 'EUR',
    'Europe/Madrid': 'EUR', 'Europe/Rome': 'EUR', 'Europe/Amsterdam': 'EUR',
    'Europe/Brussels': 'EUR', 'Europe/Vienna': 'EUR', 'Europe/Lisbon': 'EUR',
    'Europe/Dublin': 'EUR', 'Europe/Helsinki': 'EUR', 'Europe/Athens': 'EUR',
  };
  let _storeCurrency = 'USD';
  let _visitorCurrency = 'USD';

  function detectVisitorCurrency() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && TZ_CURRENCY_MAP[tz]) return TZ_CURRENCY_MAP[tz];
    } catch(e) {}
    return 'USD';
  }

  function convertPrice(cents) {
    const dollars = cents / 100;
    if (_storeCurrency === _visitorCurrency) return dollars;
    const rateFrom = CURRENCY_RATES[_storeCurrency] || 1;
    const rateTo = CURRENCY_RATES[_visitorCurrency] || 1;
    return Math.round(dollars / rateFrom * rateTo * 100) / 100;
  }

  function formatPrice(dollars) {
    const sym = CURRENCY_SYMBOLS[_visitorCurrency] || '$';
    if (_visitorCurrency === 'BRL') {
      return sym + dollars.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return sym + Number(dollars).toFixed(2);
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
          filterUpsellsForCart(cart);
        }
      });
    }
  }

  function formatPriceDollars(val) { return formatPrice(Number(val)); }

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

  // ============ CONFIG CACHE WITH LOCALSTORAGE (v4 — 5min TTL) ============
  const CONFIG_CACHE_KEY = `cf_config_${TOKEN}`;
  const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Cleanup orphan config keys from old/different tokens (keeps localStorage clean)
  // Runs async via setTimeout to never block init
  setTimeout(() => {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('cf_config_') && k !== CONFIG_CACHE_KEY) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
    } catch(e) {}
  }, 3000); // defer 3s — runs well after init is complete

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

async function getConfig() {
    // Try localStorage first (persistent across page loads)
    const cached = getCachedConfig();
    if (cached) {
      _spActive = cached.visual?.sp_pre_checked || false;
      _gwActive = cached.visual?.gw_pre_checked || false;
      _storeCurrency = cached.visual?.store_currency || 'USD';
      // Background refresh if stale
      if (!isCacheFresh()) {
        fetch(`${API_URL}?token=${TOKEN}`)
          .then(r => r.ok ? r.json() : null)
          .then(fresh => {
            if (fresh) {
              setCachedConfig(fresh);
              sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(fresh));
              window._cfConfig = fresh;
              _spActive = fresh.visual?.sp_pre_checked || false;
              _gwActive = fresh.visual?.gw_pre_checked || false;
              _storeCurrency = fresh.visual?.store_currency || 'USD';
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
        fetch(`${API_URL}?token=${TOKEN}`)
          .then(r => r.ok ? r.json() : null)
          .then(fresh => { if (fresh) { setCachedConfig(fresh); sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(fresh)); window._cfConfig = fresh; _spActive = fresh.visual?.sp_pre_checked || false; _gwActive = fresh.visual?.gw_pre_checked || false; _storeCurrency = fresh.visual?.store_currency || 'USD'; } }).catch(()=>{});
        return parsed;
      }
    } catch(e) {}
    // Fresh fetch
    try {
      const r = await fetch(`${API_URL}?token=${TOKEN}`);
      if (!r.ok) { trackEvent('error_config_load', 0, { status: r.status, message: 'HTTP ' + r.status }); return null; }
      const data = await r.json();
      setCachedConfig(data);
      sessionStorage.setItem(`cf_config_${TOKEN}`, JSON.stringify(data));
      _spActive = data.visual?.sp_pre_checked || false;
      _gwActive = data.visual?.gw_pre_checked || false;
      _storeCurrency = data.visual?.store_currency || 'USD';
      return data;
    } catch(e) { trackEvent('error_config_load', 0, { message: e.message || 'fetch failed' }); return null; }
  }

  async function getVitrineSkuMap() {
    if (_vitrineSkuMap) return _vitrineSkuMap;
    try {
      _vitrineSkuMap = {};
      let page = 1;
      const MAX_PAGES = 20; // safety cap — 20 × 250 = 5 000 products
      while (page <= MAX_PAGES) {
        const controller = new AbortController();
        const pageTimeout = setTimeout(() => controller.abort(), 5000); // 5s per page
        let data;
        try {
          const res = await (window._cfOrigFetch || fetch)(`/products.json?limit=250&page=${page}`, { signal: controller.signal });
          data = await res.json();
        } catch(pageErr) {
          break; // abort or network error — stop pagination gracefully
        } finally {
          clearTimeout(pageTimeout);
        }
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

  function filterUpsellsForCart(cart) {
    const cfg = window._cfConfig;
    if (!cfg || !cfg.upsell_triggers || !_allUpsells.length) { if (cfg) cfg.upsells = []; return; }
    const triggers = cfg.upsell_triggers;
    const upsellIds = new Set();
    const cartSkus = new Set((cart.items || []).map(i => (i.sku || '').toLowerCase()));
    for (const item of cart.items || []) {
      const pid = String(item.product_id);
      const list = triggers[pid];
      if (list) list.forEach(t => upsellIds.add(t.upsell_product_id));
    }
    // Filter: show upsells not already in cart (by SKU match) and not manually added
    const showIfInCart = cfg.visual?.upsells_show_if_in_cart !== false;
    cfg.upsells = _allUpsells.filter(u => {
      if (!upsellIds.has(u.id)) return false;
      if (_addedUpsellSkus.has(u.sku)) return false;
      if (!showIfInCart) {
        const uSku = (u.sku || '').toLowerCase();
        if (uSku && cartSkus.has(uSku)) return false;
      }
      return true;
    });
  }

  async function fetchShopifyCart() {
    try {
      const res = await (window._cfOrigFetch || fetch)('/cart.js');
      if (!res.ok) { trackEvent('error_cart_fetch', 0, { status: res.status, message: 'HTTP ' + res.status }); }
      return await res.json();
    } catch(err) {
      trackEvent('error_cart_fetch', 0, { message: err.message || 'fetch failed' });
      throw err;
    }
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
    const mw = v.cart_width_mobile === 'default' ? '90vw' : '100vw';
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
      }
      #cf-drawer.open { right:0; }
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
      @media (max-width:480px) { #cf-drawer { width:${mw};right:-${mw}; } }
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
          <div id="cf-addon-section" style="padding-bottom:16px"></div>
        </div>
        <div id="cf-footer">
          <div id="cf-badges-top"></div>
          <div class="cf-footer-inner" style="padding:12px 16px;">
            <div id="cf-discounts-row" style="display:none;align-items:center;justify-content:space-between;font-size:${fs(12)}px;margin-bottom:8px;"></div>
            <div id="cf-subtotal-row" style="display:flex;justify-content:space-between;font-size:${fs(15)}px;margin-bottom:8px;">
              <span style="font-weight:500">Subtotal:</span>
              <span id="cf-subtotal" style="font-weight:700"></span>
            </div>
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
        ${img ? `<img src="${img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;" />` : ''}
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
    const overlay = document.getElementById('cf-overlay');
    const drawer = document.getElementById('cf-drawer');
    // Reset checkout button state
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) { const btnText = window._cfConfig?.visual?.checkout_button_text || 'Secure Checkout'; ckBtn.disabled = false; ckBtn.innerHTML = `${SVG_ICONS.lock} ${btnText}`; }
    if (overlay) { overlay.style.display = 'block'; requestAnimationFrame(() => { overlay.classList.add('open'); }); }
    if (drawer) drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
    _cartOpenedAt = Date.now();
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
    // Track if user closed without any interaction
    if (!_hadInteraction && _cartOpenedAt) {
      trackEvent('cart_closed_no_action', 0, {
        duration_ms: Date.now() - _cartOpenedAt,
        item_count: window._lastCart?.item_count || 0
      });
    }
    // Reset checkout button state
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) { const btnText = window._cfConfig?.visual?.checkout_button_text || 'Secure Checkout'; ckBtn.disabled = false; ckBtn.innerHTML = `${SVG_ICONS.lock} ${btnText}`; }
    const overlay = document.getElementById('cf-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => { if (!overlay.classList.contains('open')) overlay.style.display = 'none'; }, 350);
    }
    document.getElementById('cf-drawer')?.classList.remove('open');
    document.body.style.overflow = '';
    // Track time in cart
    if (_cartOpenedAt) {
      const seconds = Math.round((Date.now() - _cartOpenedAt) / 1000);
      trackEvent('cart_closed', 0, { time_in_cart_seconds: seconds });
      _cartOpenedAt = null;
    }
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

  function renderCart(cart, config) {
    const v = config.visual || {};
    const items = cart.items || [];
    const count = items.reduce((a,i) => a + i.quantity, 0);
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
    const _excludeUpsells = v.exclude_upsells_from_discount === true;
    const _rawSubtotalCentsAll = items.reduce((a,i) => a + i.price * i.quantity, 0);
    const discountableSubtotalCents = _excludeUpsells
      ? items.reduce((a,i) => _addedUpsellSkus.has(i.sku) ? a : a + i.price * i.quantity, 0)
      : _rawSubtotalCentsAll;
    const discountableSubtotal = discountableSubtotalCents / 100;
    if (rwEl) {
      rwEl.innerHTML = '';
      if (v.rewards_enabled && tiers.length > 0 && (count > 0 || showOnEmpty)) {
        const isQty = (v.rewards_calculation||'cart_total') === 'quantity';
        const totalQty = count;
        const totalValue = cart.total_price / 100;
        const simValue = Number(isQty ? totalQty : totalValue)||0;
        const sorted = [...tiers].sort((a,b) => (Number(a.minimum_value)||0) - (Number(b.minimum_value)||0));
        const rawSubtotalCents = _rawSubtotalCentsAll;
        const rawSubtotal = rawSubtotalCents / 100;
        const cheapestPrice = items.length > 0 ? Math.min(...items.map(i => i.price)) / 100 : 0;
        const unlockedTiers = sorted.filter(t => simValue >= (parseFloat(t.minimum_value)||0));
        const byType = new Map();
        for (const tier of unlockedTiers) {
          const amount = getRewardDiscountAmount(tier, discountableSubtotal, cheapestPrice);
          const label = tier.reward_description || tier.reward_type;
          const existing = byType.get(tier.reward_type);
          if (!existing || amount > existing.amount) byType.set(tier.reward_type, { amount, label });
        }
        byType.forEach(({ amount, label }) => { rewardDiscount += amount; activeRewardLabels.push(label); });
        for (const tier of unlockedTiers) {
          if (tier.reward_type === 'shipping' || tier.reward_type === 'free_shipping') {
            if (!activeRewardLabels.includes(tier.reward_description)) activeRewardLabels.push(tier.reward_description);
          }
        }
        const nextT = sorted.find(t => (parseFloat(t.minimum_value)||0) > simValue);
        const rem = nextT ? (isQty ? `${(parseFloat(nextT.minimum_value)||0) - simValue}` : `${formatPriceDollars((parseFloat(nextT.minimum_value)||0) - simValue)}`) : null;
        let rawText = '';
        if (!nextT) {
          rawText = (v.rewards_complete_text || 'All rewards unlocked! 🎉').replace('{{count}}', String(totalQty));
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
        items.forEach((item, idx) => {
          const lineTotal = item.price * item.quantity;
          const lineTotalDollars = lineTotal / 100;
          const vitrineEntry = _vitrineSkuMap?.[item.sku?.toUpperCase()];
          const compareAtPriceDollars = vitrineEntry?.compare_at_price ? vitrineEntry.compare_at_price * item.quantity : null;
          const shopifyOrigCents = item.original_price || item.price;
          const shopifyOrigDollars = shopifyOrigCents * item.quantity / 100;
          const lineCompareDollars = compareAtPriceDollars || shopifyOrigDollars;
          const isExcludedUpsell = _excludeUpsells && _addedUpsellSkus.has(item.sku);
          const itemShare = isExcludedUpsell ? 0 : (discSubDollars > 0 ? lineTotalDollars / discSubDollars : 0);
          const itemRewardDiscount = isExcludedUpsell ? 0 : rewardDiscount * itemShare;
          const discountedTotal = Math.max(0, lineTotalDollars - itemRewardDiscount);
          const hasCompareDiscount = lineCompareDollars > lineTotalDollars;
          const hasRewardDiscount = !isExcludedUpsell && itemRewardDiscount > 0;
          const hasDis = hasCompareDiscount || hasRewardDiscount;
          const displayPrice = hasRewardDiscount ? discountedTotal : lineTotalDollars;
          const totalSavingsItem = lineCompareDollars - displayPrice;
          const productTitle = item.product_title || item.title;
          let variantLabel = '';
          if (item.options_with_values && item.options_with_values.length > 0) {
            const meaningful = item.options_with_values.filter(o => o.value !== 'Default Title');
            if (meaningful.length > 0) variantLabel = meaningful.map(o => `${o.name}: ${o.value}`).join(' / ');
          } else if (item.variant_title && item.variant_title !== 'Default Title') {
            variantLabel = item.variant_title;
          }
          const borderBottom = idx < items.length-1 ? 'border-bottom:1px solid rgba(0,0,0,0.08);' : '';
          const existing = itemsEl.querySelector(`[data-cf-item-key="${item.key}"]`);
          if (existing) {
            const qtyEl = existing.querySelector('[data-cf-qty]');
            if (qtyEl) qtyEl.textContent = item.quantity;
            const priceEl = existing.querySelector('[data-cf-price]');
            if (priceEl) priceEl.textContent = formatPriceDollars(displayPrice);
            const strikeEl = existing.querySelector('[data-cf-strike]');
            if (strikeEl) { if (v.show_strikethrough && hasDis) { strikeEl.textContent = formatPriceDollars(lineCompareDollars); strikeEl.style.display = ''; } else { strikeEl.style.display = 'none'; } }
            const saveEl = existing.querySelector('[data-cf-save]');
            if (saveEl) { if (v.show_strikethrough && totalSavingsItem > 0.01) { saveEl.textContent = `Save ${formatPriceDollars(totalSavingsItem)}`; saveEl.style.display = ''; } else { saveEl.style.display = 'none'; } }
            const minusBtn = existing.querySelector('[data-cf-minus]');
            if (minusBtn) minusBtn.setAttribute('onclick', `cfQty('${item.key}',${item.quantity-1})`);
            const plusBtn = existing.querySelector('[data-cf-plus]');
            if (plusBtn) plusBtn.setAttribute('onclick', `cfQty('${item.key}',${item.quantity+1})`);
            const delBtn = existing.querySelector('[data-cf-del]');
            if (delBtn) delBtn.setAttribute('onclick', `cfQty('${item.key}',0)`);
            const tagEl = existing.querySelector('[data-cf-reward-tag]');
            if (tagEl) { const lastLabel = activeRewardLabels[activeRewardLabels.length - 1] || ''; if (hasRewardDiscount && lastLabel) { tagEl.textContent = lastLabel; tagEl.style.display = 'inline-flex'; } else { tagEl.style.display = 'none'; } }
            existing.style.borderBottom = borderBottom ? '1px solid rgba(0,0,0,0.08)' : 'none';
          } else {
            const div = document.createElement('div');
            div.innerHTML = `
            <div data-cf-item-key="${item.key}" style="display:flex;align-items:center;gap:12px;padding:16px;${borderBottom}">
              <div style="flex-shrink:0;width:80px;height:80px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                <img src="${item.image||item.featured_image?.url||''}" onerror="this.style.display='none'" alt="${productTitle}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" />
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <p style="font-size:${fs(15)}px;font-weight:600;margin:0;word-break:break-word;white-space:normal;flex:1;min-width:0;padding-right:8px">${productTitle}</p>
                  <span data-cf-del role="button" tabindex="0" onclick="cfQty('${item.key}',0)" style="all:unset;padding:2px;opacity:0.4;cursor:pointer;color:inherit;transition:opacity 0.15s;display:inline-flex;flex-shrink:0" onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='0.4'">${SVG_ICONS.trash}</span>
                </div>
                ${variantLabel ? `<p style="font-size:${fs(12)}px;opacity:0.6;margin:0 0 2px 0">${variantLabel}</p>` : ''}
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                  <span data-cf-strike style="font-size:${fs(12)}px;opacity:0.5;text-decoration:line-through;${v.show_strikethrough && hasDis ? '' : 'display:none'}">${formatPriceDollars(lineCompareDollars)}</span>
                  <span data-cf-price style="font-size:${fs(15)}px;font-weight:700">${formatPriceDollars(displayPrice)}</span>
                  <span data-cf-save style="font-size:${fs(12)}px;font-weight:600;color:${v.savings_color||'#22c55e'};${v.show_strikethrough && totalSavingsItem > 0.01 ? '' : 'display:none'}">(Save ${formatPriceDollars(totalSavingsItem)})</span>
                </div>
                <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
                  <div style="display:inline-flex;align-items:center;border:1px solid rgba(0,0,0,0.25);border-radius:6px;overflow:hidden;width:fit-content;">
                    <span data-cf-minus role="button" tabindex="0" onclick="cfQty('${item.key}',${item.quantity-1})" style="all:unset;box-sizing:border-box;width:28px;min-width:28px;max-width:28px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;flex-shrink:0;">${SVG_ICONS.minus}</span>
                    <span data-cf-qty style="box-sizing:border-box;font-size:${fs(13)}px;width:28px;min-width:28px;max-width:28px;text-align:center;height:26px;line-height:26px;border-left:1px solid rgba(0,0,0,0.25);border-right:1px solid rgba(0,0,0,0.25);flex-shrink:0;">${item.quantity}</span>
                    <span data-cf-plus role="button" tabindex="0" onclick="cfQty('${item.key}',${item.quantity+1})" style="all:unset;box-sizing:border-box;width:28px;min-width:28px;max-width:28px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;flex-shrink:0;">${SVG_ICONS.plus}</span>
                  </div>
                  <span data-cf-reward-tag style="display:${hasRewardDiscount && activeRewardLabels.length > 0 ? 'inline-flex' : 'none'};align-items:center;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;background:rgba(0,0,0,0.08);color:${v.text_color || '#1a1a1a'};">${activeRewardLabels.length > 0 ? activeRewardLabels[activeRewardLabels.length - 1] : ''}</span>
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
    const visibleUpsells = upsells.filter(u => {
      const allSkus = [u.sku, ...(u.variants||[]).map(v => v.sku)].filter(Boolean);
      for (const s of allSkus) {
        if (cartSkus.has(s.toUpperCase())) return false;
        if (_addedUpsellSkus.has(s)) return false;
      }
      if (u.title && cartTitles.has(u.title.toUpperCase())) return false;
      return true;
    });

    const topEl = document.getElementById('cf-upsells-top');
    const btmEl = document.getElementById('cf-upsells-bottom');
    const upsellIds = visibleUpsells.map(u => u.id).sort().join(',');
    const prevUpsellIds = window._cfPrevUpsellIds || '';
    const upsellsChanged = upsellIds !== prevUpsellIds;
    window._cfPrevUpsellIds = upsellIds;
    if (upsellsChanged) {
      if (topEl) topEl.innerHTML = '';
      if (btmEl) btmEl.innerHTML = '';
    }
    if (v.upsells_enabled && visibleUpsells.length > 0 && upsellsChanged) {
      // Track upsell views (v4)
      visibleUpsells.forEach(p => trackEvent('upsell_viewed', p.price||0, { title: p.title, sku: p.sku }));
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
                  ${imgSrc ? `<div style="width:80px;height:80px;border-radius:8px;overflow:hidden;flex-shrink:0;background:rgba(0,0,0,0.06)"><img id="cf-upsell-img-${p.id}" src="${imgSrc}" alt="${p.title}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy"/></div>` : `<div style="width:80px;height:80px;border-radius:8px;flex-shrink:0;background:rgba(255,255,255,0.2)"></div>`}
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

    const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
    const rawSubtotalDollars = rawSubtotalCents / 100;
    const upsellTotalDollars = _excludeUpsells
      ? items.reduce((a,i) => _addedUpsellSkus.has(i.sku) ? a + i.price * i.quantity : a, 0) / 100
      : 0;
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
    const simValue = isQty ? cartItems.reduce((a,i) => a+i.quantity, 0) : cartItems.reduce((a,i) => a+i.price*i.quantity, 0)/100;
    const unlockedTiers = tiers.filter(t => simValue >= (Number(t.minimum_value)||0));
    const bestCoupon = [...unlockedTiers].reverse().find(t => t.shopify_coupon);
    var trackingKeys = ["fbclid","ttclid","gclid","utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id","wbraid","gbraid","tikclid","irclickid","_fbp","_fbc","ttp"];
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
    cleanTracking["source"] = "octoroute";
    var sid = "ocs_" + Date.now() + "_" + Math.random().toString(36).substring(2, 10);
    try {
      await Promise.race([
        fetch("https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/store-checkout-attributes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid, store_id: config.store.id, tracking_data: cleanTracking })
        }),
        new Promise(function(_, reject) { setTimeout(function() { reject("timeout"); }, 2000); })
      ]);
    } catch(e) { /* timeout or error — proceed anyway */ }
    /* --- HYBRID: pass ALL tracking attributes directly in URL (like HeroCart) --- */
    var sep = checkoutUrl.includes("?") ? "&" : "?";
    for (var [ak, av] of Object.entries(cleanTracking)) {
      checkoutUrl += sep + "attributes[" + encodeURIComponent(ak) + "]=" + encodeURIComponent(av);
      sep = "&";
    }
    checkoutUrl += sep + "attributes[_octo_sid]=" + encodeURIComponent(sid);
    if (bestCoupon?.shopify_coupon) checkoutUrl += "&discount=" + encodeURIComponent(bestCoupon.shopify_coupon);
    if (mergedTracking.fbclid) checkoutUrl += "&fbclid=" + encodeURIComponent(mergedTracking.fbclid);
    if (mergedTracking.ttclid) checkoutUrl += "&ttclid=" + encodeURIComponent(mergedTracking.ttclid);
    return checkoutUrl;
  }

  window.cfToggleAddon = (type) => {
    _hadInteraction = true;
    if (type === 'sp') { _spActive = !_spActive; trackEvent('addon_toggled', 0, { addon: 'shipping_protection', active: _spActive }); }
    if (type === 'gw') { _gwActive = !_gwActive; trackEvent('addon_toggled', 0, { addon: 'gift_wrap', active: _gwActive }); }
    fetchShopifyCart().then(cart => { if (window._cfConfig) renderCart(cart, window._cfConfig); });
  };

  window.cfQty = async (key, qty) => {
    _hadInteraction = true;
    if (qty < 0) return;
    await (window._cfOrigFetch||fetch)('/cart/change.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:key,quantity:qty}) });
    const cart = await fetchShopifyCart();
    window._lastCart = cart;
    if (window._cfConfig) renderCart(cart, window._cfConfig);
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
    try {
      const res = await (window._cfOrigFetch||fetch)('/cart/add.js?_cf=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: vitrineVariantId, quantity: 1 }] })
      });
      if (!res.ok) { trackEvent('error_upsell_add', 0, { product_title: product.title, message: 'HTTP ' + res.status }); console.warn('[CartFlow] Failed:', await res.text()); _upsellPending = false; resetBtn(); return; }
    } catch(e) { trackEvent('error_upsell_add', 0, { product_title: product.title, message: e.message || 'add failed' }); console.warn('[CartFlow] Add error:', e); _upsellPending = false; resetBtn(); return; }
    const cart = await fetchShopifyCart();
    window._lastCart = cart;
    if (window._cfConfig) {
      filterUpsellsForCart(cart);
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
          filterUpsellsForCart(cart);
        } else if (openAfter) { _pendingOpen = true; }
      } catch(e) {
        if (openAfter && window._cfConfig) {
          try { openCart(); } catch(e2) {}
        }
      }
    }, 100);
  }

  function interceptCart() {
    if (window._cfFetchPatched) return;
    window._cfFetchPatched = true;

    if (!window._cfOrigFetch) window._cfOrigFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]||'');
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

      // If theme already added via fetch/XHR, don't duplicate
      if (window._cfAddInFlight) return;

      // Fallback: native form submit (no fetch), do manual POST
      const formData = new FormData(form);
      try {
        window._cfAddInFlight = true;
        await (window._cfOrigFetch || fetch)('/cart/add.js?_cf=1', {
          method: 'POST',
          body: formData
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
        trackEvent('checkout_clicked');
        try { sessionStorage.setItem('_octo_checkout_ts', String(Date.now())); } catch(e) {}
        try { sessionStorage.setItem('_octo_checkout_clicked', '1'); } catch(e) {}        try {
          const cart = _upsellPending ? await fetchShopifyCart() : (window._lastCart || await fetchShopifyCart());
          window._lastCart = cart;
          const url = await buildCheckoutUrl(cart.items, window._cfConfig);
          trackEvent('checkout', cart.total_price/100, { addon_total: window._cfAddonTotal || 0, upsell_total: window._cfUpsellTotal || 0 });
          flushTrackQueue();
          try { sessionStorage.removeItem('_octo_checkout_ts'); } catch(e) {}
          try { sessionStorage.removeItem('_octo_checkout_clicked'); } catch(e) {}
          await new Promise(r => setTimeout(r, 50));
          window.location.href = url || '/checkout';
       } catch(e) {
          trackEvent('error_checkout_redirect', 0, { message: e.message || 'redirect failed' });
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
  const cart = await fetchShopifyCart();
  window._lastCart = cart;
  if(window._cfConfig) {
    filterUpsellsForCart(cart);
    renderCart(cart, window._cfConfig);
    openCart();
  }
}
    }, { passive: false, capture: true });
  }

  try {
    const initialCart = await fetchShopifyCart();
    const initialSkus = (initialCart.items||[]).map(i => i.sku).filter(Boolean).join(',');
    const config = await getConfig();
    getVitrineSkuMap();
    if (!config) { console.warn('[CartFlow] Config not found'); return; }
    window._cfConfig = config;
    _allUpsells = config.upsells || [];
    filterUpsellsForCart(initialCart);
    _storeCurrency = config.visual?.store_currency || 'USD';

    if (config.visual?.currency_conversion_enabled === true) {
      _visitorCurrency = detectVisitorCurrency();
    }

    _fontScale = SCALE_MAP[config.visual?.font_scale] || 1.15;
    injectStyles(config.visual||{});
    injectHTML(config.visual||{});
    interceptCart();
    if (config.visual?.announcement_timer) startTimer(config.visual.announcement_timer);
    window._lastCart = initialCart;
    renderCart(initialCart, config);
    onCartReady();
    trackEvent('cart_impression', initialCart.total_price ? initialCart.total_price/100 : 0, {
      items: (initialCart.items||[]).map(i => ({ title: i.title, variant: i.variant_title||'', qty: i.quantity, price: (i.price||0)/100 })),
      item_count: initialCart.item_count || 0,
      total: initialCart.total_price ? initialCart.total_price/100 : 0,
      addon_total: window._cfAddonTotal || 0,
      upsell_total: window._cfUpsellTotal || 0
    });
    console.log('[CartFlow] ✓ Loaded v12.2 (early-fetch-save + deferred-cache-cleanup + dynamic-fx)');
  } catch(err) { console.error('[CartFlow] Init error:', err); }

})();
