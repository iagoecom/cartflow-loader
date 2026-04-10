(async () => {

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
 let _addedUpsellSkus = new Set();
 let _refreshTimer = null;
 const SCALE_MAP = { small: 1, medium: 1.15, large: 1.3 };
 let _fontScale = 1.15;
 const fs = (base) => Math.round(base * _fontScale);

 function onCartReady() {
 _cartReady = true;
 if (_pendingOpen) {
 _pendingOpen = false;
 fetchShopifyCart(true).then(async cart => {
 if (window._cfConfig) {
 await fetchUpsells(cart);
 window._lastCart = cart;
 renderCart(cart, window._cfConfig);
 openCart();
 }
 });
 }
 }

 function formatPriceDollars(val) { return '$' + Number(val).toFixed(2); }

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
 truck: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="11" x="1" y="3" rx="2"/><path d="M17 8h4l2 4v5h-2"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="19.5" cy="18.5" r="2.5"/></svg>',
 tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/></svg>',
 gift: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
 star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
 shield: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
 trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
 minus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
 plus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
 lock: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
 close: (sw) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
 check: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
 spin: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:cf-spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
 };

 const PRESETS = {
 returns_warranty: 'Free returns + 30-day warranty',
 secure_delivery: 'Secure payment + Guaranteed delivery',
 protected_support: 'Protected purchase + 24/7 support',
 };

async function getConfig(skus) {
 const cacheKey = `cf_config_${TOKEN}`;
 try {
 const cached = sessionStorage.getItem(cacheKey);
 if (cached) {
 const parsed = JSON.parse(cached);
 _spActive = parsed.visual?.sp_pre_checked || false;
 _gwActive = parsed.visual?.gw_pre_checked || false;
 fetch(`${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`)
 .then(r => r.ok ? r.json() : null)
 .then(fresh => { if (fresh) { sessionStorage.setItem(cacheKey, JSON.stringify(fresh)); window._cfConfig = fresh; _spActive = fresh.visual?.sp_pre_checked || false; _gwActive = fresh.visual?.gw_pre_checked || false; } }).catch(()=>{});
 return parsed;
 }
 const r = await fetch(`${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`);
 if (!r.ok) return null;
 const data = await r.json();
 sessionStorage.setItem(cacheKey, JSON.stringify(data));
 _spActive = data.visual?.sp_pre_checked || false;
 _gwActive = data.visual?.gw_pre_checked || false;
 return data;
 } catch(e) { return null; }
 }

 async function getVitrineSkuMap() {
 if (_vitrineSkuMap) return _vitrineSkuMap;
 try {
 _vitrineSkuMap = {};
 let page = 1;
 while (true) {
 const res = await (window._cfOrigFetch || fetch)(`/products.json?limit=250&page=${page}`);
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
 if (!skus) { if (window._cfConfig) window._cfConfig.upsells = []; _lastSkus = ''; return; }
 if (skus === _lastSkus) return;
 _lastSkus = skus;
 try {
 const r = await window._cfOrigFetch(`${API_URL}?token=${TOKEN}&skus=${skus}`);
 if (r.ok) { const data = await r.json(); if (window._cfConfig) window._cfConfig.upsells = data.upsells || []; }
 } catch(e) {}
 }

 function trackEvent(type, amount=0, metadata={}) {
 (window._cfOrigFetch || fetch)(TRACK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token:TOKEN, event_type:type, amount, metadata }) }).catch(()=>{});
 }

 // ===== CHANGE 1: fetchShopifyCart with retry when expecting items =====
 async function fetchShopifyCart(expectItems = false, attempt = 0) {
 const cart = await (await (window._cfOrigFetch || fetch)('/cart.js')).json();
 if (expectItems && cart.item_count === 0 && attempt < 4) {
 const delays = [200, 400, 800, 1500];
 await new Promise(r => setTimeout(r, delays[attempt]));
 return fetchShopifyCart(true, attempt + 1);
 }
 return cart;
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
<div style="display:flex;align-items:center;gap:4px;">
<div style="display:flex;flex-direction:column;align-items:center;">
<span style="background:${blockBg};color:${textColor};padding:4px 8px;border-radius:4px;font-weight:700;font-size:${fs(14)}px;min-width:32px;text-align:center;">${String(seg.value).padStart(2,'0')}</span>
<span style="font-size:${fs(8)}px;color:${annTextColor};margin-top:2px;text-transform:uppercase;">${seg.label}</span>
</div>
 ${i < segments.length-1 ? `<span style="font-weight:700;font-size:${fs(16)}px;color:${annTextColor};margin-bottom:12px;">:</span>` : ''}
</div>
 `).join('');
 }

 // ===== CHANGE 2: Universal CSS with wildcard selectors =====
 function injectStyles(v) {
 const dw = getDrawerWidth(v);
 const mw = v.cart_width_mobile === 'default' ? '90vw' : '100vw';
 const footerBg = v.accent_color || '#f6f6f7';
 const style = document.createElement('style');
 style.id = 'cartflow-styles';
 style.textContent = `
 #cf-overlay { display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999998; }
 #cf-overlay.open { display:block; }
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
 /* === UNIVERSAL CART DRAWER SUPPRESSION === */
 /* Exact custom elements */
 cart-drawer, cart-notification, cart-notification-drawer, side-cart, ajax-cart, slide-cart,
 /* Wildcard ID matches (case-insensitive) */
 [id*="cart-drawer" i], [id*="CartDrawer" i], [id*="cart-notification" i],
 [id*="mini-cart" i], [id*="minicart" i], [id*="side-cart" i], [id*="slide-cart" i],
 [id*="ajax-cart" i], [id*="ajaxcart" i],
 /* Wildcard class matches (case-insensitive) */
 [class*="cart-drawer" i], [class*="cart-notification" i], [class*="mini-cart" i],
 [class*="minicart" i], [class*="side-cart" i], [class*="slide-cart" i],
 [class*="cart-flyout" i], [class*="ajax-cart" i], [class*="ajaxcart" i],
 [class*="cart-sidebar" i],
 /* Data attribute matches */
 [data-section-type*="cart-drawer"], [data-section-type*="cart-notification"],
 [data-section-type*="mini-cart"], [data-cart-drawer], [data-mini-cart],
 /* Legacy/specific selectors as fallback */
 .shopify-section-cart-drawer, .drawer--cart, .header-cart-flyout,
 #CartSpecialDrawer, #mini-cart-wrapper
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
 @keyframes cf-spin { to { transform: rotate(360deg); } }
 @media (max-width:480px) { #cf-drawer { width:${mw};right:-${mw}; } }
 `;
 document.head.appendChild(style);
 }

 // ===== CHANGE 3: MutationObserver for dynamically injected drawers =====
 function observeNativeDrawers() {
 const CART_PATTERNS = /cart[-_]?drawer|cart[-_]?notification|mini[-_]?cart|minicart|side[-_]?cart|slide[-_]?cart|ajax[-_]?cart|ajaxcart|cart[-_]?flyout|cart[-_]?sidebar/i;

 function hideIfCartDrawer(el) {
   if (!el || !el.tagName || el.id === 'cf-drawer' || el.id === 'cf-overlay') return;
   const tag = el.tagName.toLowerCase();
   const id = el.id || '';
   const cls = el.className || '';
   const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
   const sectionType = el.getAttribute?.('data-section-type') || '';
   if (CART_PATTERNS.test(tag) || CART_PATTERNS.test(id) || CART_PATTERNS.test(clsStr) || CART_PATTERNS.test(sectionType)) {
     el.style.setProperty('display', 'none', 'important');
     el.style.setProperty('visibility', 'hidden', 'important');
     el.style.setProperty('pointer-events', 'none', 'important');
   }
 }

 // Hide any already-existing native drawers
 document.querySelectorAll('*').forEach(el => {
   if (el.closest('#cf-overlay') || el.closest('#cf-drawer')) return;
   hideIfCartDrawer(el);
 });

 // Watch for new elements added dynamically
 const observer = new MutationObserver((mutations) => {
   for (const mutation of mutations) {
     for (const node of mutation.addedNodes) {
       if (node.nodeType !== 1) continue;
       hideIfCartDrawer(node);
       // Also check children (for section wrappers)
       if (node.querySelectorAll) {
         node.querySelectorAll('*').forEach(child => {
           if (!child.closest('#cf-overlay') && !child.closest('#cf-drawer')) hideIfCartDrawer(child);
         });
       }
     }
   }
 });
 observer.observe(document.body, { childList: true, subtree: true });
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
 ? `<img src="${v.header_logo_url}" alt="Logo" style="height:${v.header_logo_size||40}px;object-fit:contain;" />`
 : `<${v.header_heading_level||'h3'} id="cf-title-el" style="font-size:${hd.fs}px;font-weight:${hd.fw};margin:0;${v.header_text_color_override?'color:'+v.header_text_color_override+';':''}">Cart &bull; 0</${v.header_heading_level||'h3'}>`;
 overlay.innerHTML = `
<div id="cf-drawer">
<div style="display:flex;align-items:center;${isCloseLeft?'flex-direction:row-reverse;':''}justify-content:space-between;padding:${headerPy} 16px;background:${v.header_bg_color||'transparent'};border-bottom:${v.header_border==='none'?'none':`${bdr} solid ${v.header_border_color||'#e5e7eb'}`};">
<div style="flex:1;display:flex;justify-content:${headerJustify};">${headerTitleHtml}</div>
<button id="cf-close" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;background:${v.close_bg_color||'transparent'};color:${v.close_icon_color||'#000'};cursor:pointer;border-radius:6px;padding:0;transition:background 0.15s ease,color 0.15s ease;flex-shrink:0;">
<span style="width:${closeSz};height:${closeSz};display:flex;">${SVG_ICONS.close(closeSw)}</span>
</button>
</div>
<div id="cf-body">
<div id="cf-ann-before"></div>
<div id="cf-rewards"></div>
<div id="cf-ann-after"></div>
<div id="cf-upsells-top"></div>
<div id="cf-items"><div class="cf-empty"><div class="cf-empty-icon">🛒</div><div>Your cart is empty</div></div></div>
<div id="cf-upsells-bottom"></div>
<div id="cf-addon-section"></div>
<div id="cf-badges-top"></div>
</div>
<div id="cf-footer" style="padding:16px;">
<div id="cf-badges-bottom" style="margin-bottom:8px;"></div>
<div id="cf-discounts-row" style="display:none;justify-content:space-between;margin-bottom:6px;font-size:${fs(13)}px;"></div>
<div id="cf-subtotal-row" style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:12px;font-size:${fs(14)}px;">
<span>Subtotal:</span><span id="cf-subtotal">$0.00</span>
</div>
<button id="cf-checkout">${SVG_ICONS.lock} Secure Checkout</button>
<div id="cf-continue-wrap" style="text-align:center;margin-top:8px;"></div>
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

 function openCart() {
 document.getElementById('cf-overlay')?.classList.add('open');
 document.getElementById('cf-drawer')?.classList.add('open');
 document.body.style.overflow = 'hidden';
 }
 function closeCart() {
 document.getElementById('cf-overlay')?.classList.remove('open');
 document.getElementById('cf-drawer')?.classList.remove('open');
 document.body.style.overflow = '';
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
 const options = values.map(val => `<option value="${val}" ${val===defaultVal?'selected':''}>${val}</option>`).join('');
 selectsHtml += `<select data-cf-option="${name}" onchange="cfUpdateUpsellVariant(this)" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:${fs(11)}px;margin-top:4px;background:#fff;">${options}</select>`;
 idx++;
 }
 return `<div data-cf-selected-sku="${defaultSku}" style="margin-top:4px;">${selectsHtml}</div>`;
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
 const inlineTimerHtml = _timerSeconds>0 && !isBlocks ? `<span id="cf-timer-value" style="font-weight:700;">${formatTimer(_timerSeconds)}</span>` : '';
 const annText = (v.announcement_text||'').replace('{{timer}}', inlineTimerHtml);
 const blocksHtml = _timerSeconds>0 && isBlocks ? `<div id="cf-timer-blocks" style="display:flex;gap:6px;justify-content:center;margin-top:6px;">
</div>` : '';
 const annHtml = `<div style="background:${v.announcement_bg_color||'#FEF9C3'};padding:${annHeightPy} 16px;text-align:${annAlign};font-size:${v.announcement_font_size||fs(13)}px;color:${v.announcement_text_color||'#333'};border-bottom:1px solid ${v.announcement_border_color||'rgba(0,0,0,0.06)'};">
<div>${annText}</div>
${blocksHtml}
</div>`;
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
 if (rwEl) {
 rwEl.innerHTML = '';
 if (v.rewards_enabled && tiers.length > 0 && (count > 0 || showOnEmpty)) {
 const isQty = (v.rewards_calculation||'cart_total') === 'quantity';
 const totalQty = count;
 const totalValue = cart.total_price / 100;
 const simValue = Number(isQty ? totalQty : totalValue)||0;
 const sorted = [...tiers].sort((a,b) => (Number(a.minimum_value)||0) - (Number(b.minimum_value)||0));
 const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
 const rawSubtotal = rawSubtotalCents / 100;
 const cheapestPrice = items.length > 0 ? Math.min(...items.map(i => i.price)) / 100 : 0;
 const unlockedTiers = sorted.filter(t => simValue >= (parseFloat(t.minimum_value)||0));
 const byType = new Map();
 for (const tier of unlockedTiers) {
 const amount = getRewardDiscountAmount(tier, rawSubtotal, cheapestPrice);
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
 const rem = nextT ? (isQty ? `${(parseFloat(nextT.minimum_value)||0) - simValue}` : `$${((parseFloat(nextT.minimum_value)||0) - simValue).toFixed(0)}`) : null;
 let rawText = '';
 if (!nextT) {
 rawText = (v.rewards_complete_text || 'All rewards unlocked! 🎉').replace('{{count}}', String(totalQty));
 } else if (nextT.title_before) {
 rawText = nextT.title_before.replace('{remaining}', String(rem)).replace('{{remaining}}', String(rem)).replace('{{count}}', String(rem)).replace('{count}', String(rem));
 } else {
 rawText = `Add ${rem} more to unlock ${nextT.reward_description||'the next reward'}`;
 }
 let barHtml = '<div style="position:relative;display:flex;align-items:center;height:12px;margin:0 14px;">';
 let labelsHtml = '<div style="display:flex;align-items:flex-start;margin:4px 14px 0;position:relative;height:20px;">';
 sorted.forEach((tier, idx) => {
 const segStart = idx===0 ? 0 : parseFloat(sorted[idx-1].minimum_value)||0;
 const segEnd = parseFloat(tier.minimum_value)||0;
 const segRange = segEnd - segStart;
 const lp = segRange>0 ? Math.min(Math.max((simValue-segStart)/segRange,0),1)*100 : (simValue>=segEnd?100:0);
 const reached = simValue >= (parseFloat(tier.minimum_value)||0);
 const iconSvg = SVG_ICONS[tier.icon||'gift'] || SVG_ICONS.gift;
 const circleSize = reached ? 28 : 20;
 barHtml += `<div style="flex:1;height:${v.rewards_bar_height||8}px;background:${v.rewards_bar_bg_color||'#e5e7eb'};border-radius:99px;overflow:hidden;${idx>0?'margin-left:-2px;':''}">
<div style="width:${lp}%;height:100%;background:linear-gradient(90deg,${v.rewards_bar_fg_color||'#22c55e'},${v.rewards_bar_fg_color||'#22c55e'});border-radius:99px;transition:width 0.4s ease;"></div>
</div>`;
 barHtml += `<div style="width:${circleSize}px;height:${circleSize}px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:-2px;font-size:14px;border:2px solid ${reached?(v.rewards_complete_icon_color||v.rewards_bar_fg_color||'#22c55e'):(v.rewards_incomplete_icon_color||'#d1d5db')};background:${reached?(v.rewards_complete_icon_color||v.rewards_bar_fg_color||'#22c55e'):'#fff'};color:${reached?'#fff':(v.rewards_incomplete_icon_color||'#d1d5db')};transition:all 0.3s ease;">`;
 barHtml += reached ? iconSvg : `<span style="font-size:10px;">${iconSvg}</span>`;
 barHtml += '</div>';
 labelsHtml += `<div style="flex:1;min-width:0;"></div>
<div style="width:${circleSize}px;flex-shrink:0;margin-left:-2px;display:flex;flex-direction:column;align-items:center;">
<span style="display:block;width:0;overflow:hidden;">&#8203;</span>
</div>`;
 labelsHtml += `<div style="position:absolute;left:0;right:0;display:flex;justify-content:space-around;pointer-events:none;">
</div>`;
 });
 barHtml += '</div>'; labelsHtml += '</div>';
 rwEl.innerHTML = `<div style="padding:12px 16px;">
<div style="font-size:${v.rewards_font_size||fs(13)}px;text-align:center;margin-bottom:8px;font-weight:500;">${rawText}</div>
${barHtml}${labelsHtml}
</div>`;
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
 itemsEl.innerHTML = '<div class="cf-empty"><div class="cf-empty-icon">🛒</div><div>Your cart is empty</div></div>';
 } else {
 const emptyEl = itemsEl.querySelector('.cf-empty');
 if (emptyEl) emptyEl.remove();
 const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
 const rawSubtotalDollars = rawSubtotalCents / 100;
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
 const itemShare = rawSubtotalDollars > 0 ? lineTotalDollars / rawSubtotalDollars : 0;
 const itemRewardDiscount = rewardDiscount * itemShare;
 const discountedTotal = Math.max(0, lineTotalDollars - itemRewardDiscount);
 const hasCompareDiscount = lineCompareDollars > lineTotalDollars;
 const hasRewardDiscount = itemRewardDiscount > 0;
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
 existing.style.borderBottom = borderBottom ? '1px solid rgba(0,0,0,0.08)' : 'none';
 } else {
 const div = document.createElement('div');
 div.innerHTML = `
<div data-cf-item-key="${item.key}" style="display:flex;gap:12px;padding:12px 16px;${borderBottom}">
<img src="${item.image||item.featured_image?.url||''}" alt="${productTitle}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;" />
<div style="flex:1;min-width:0;">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
<span style="font-weight:500;font-size:${fs(13)}px;word-break:break-word;">${productTitle}</span>
<button data-cf-del onclick="cfQty('${item.key}',0)" style="color:#999;flex-shrink:0;padding:2px;">${SVG_ICONS.trash}</button>
</div>
${variantLabel ? `<div style="font-size:${fs(11)}px;color:#888;margin-top:2px;">${variantLabel}</div>` : ''}
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
<div style="display:flex;flex-direction:column;gap:2px;">
<span data-cf-strike style="text-decoration:line-through;color:#999;font-size:${fs(12)}px;${v.show_strikethrough&&hasDis?'':`display:none;`}">${formatPriceDollars(lineCompareDollars)}</span><span data-cf-price style="font-weight:600;font-size:${fs(14)}px;">${formatPriceDollars(displayPrice)}</span><span data-cf-save style="font-size:${fs(10)}px;color:${v.savings_color||'#22c55e'};font-weight:600;${v.show_strikethrough&&totalSavingsItem>0.01?'':`display:none;`}">(Save ${formatPriceDollars(totalSavingsItem)})</span>
</div>
<div style="display:flex;align-items:center;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
<button data-cf-minus onclick="cfQty('${item.key}',${item.quantity-1})" style="width:28px;height:28px;color:#666;">${SVG_ICONS.minus}</button><span data-cf-qty style="width:28px;text-align:center;font-size:${fs(13)}px;font-weight:500;">${item.quantity}</span><button data-cf-plus onclick="cfQty('${item.key}',${item.quantity+1})" style="width:28px;height:28px;color:#666;">${SVG_ICONS.plus}</button>
</div>
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
 const cartSkus = new Set(items.map(i => i.sku).filter(Boolean));
 const visibleUpsells = upsells.filter(u => {
 const uSku = u.sku || u.variants?.[0]?.sku || '';
 return !uSku || !cartSkus.has(uSku);
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
 const upsellBg = accentColor;
 const upsellText = accentTextColor;
 const isStack = (v.upsells_direction||'stack') !== 'inline';
 const html = `
<div style="padding:12px 16px;">
<div style="font-size:${v.upsells_title_font_size||fs(13)}px;font-weight:600;margin-bottom:8px;color:${v.upsells_title_color||v.text_color||'#000'};text-transform:uppercase;letter-spacing:0.5px;">
${v.upsells_title||'RECOMMENDED FOR YOU'}
</div>
<div style="display:flex;${isStack?'flex-direction:column;':'overflow-x:auto;'}gap:8px;">
${visibleUpsells.map(p => {
const hasCompare = v.upsells_show_strikethrough && p.compare_price && p.compare_price > (p.price||0);
const variantHtml = buildUpsellVariantHtml(p, v);
const imgSrc = p.image_url || p.variants?.[0]?.image_url || '';
return `
<div data-cf-upsell-card="${p.id}" style="display:flex;gap:10px;padding:10px;background:${upsellBg};border-radius:8px;${isStack?'':`min-width:200px;flex-shrink:0;`}">
<div data-cf-product-id="${p.id}" style="display:flex;gap:10px;flex:1;align-items:center;">
${imgSrc ? `<div style="flex-shrink:0;">
<img id="cf-upsell-img-${p.id}" src="${imgSrc}" alt="${p.title}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;" />
</div>` : `<div style="width:60px;height:60px;background:#eee;border-radius:6px;flex-shrink:0;"></div>`}
<div style="flex:1;min-width:0;">
<div style="font-size:${fs(12)}px;font-weight:500;color:${upsellText};margin-bottom:4px;word-break:break-word;">
${p.title}
</div>
<div style="font-size:${fs(12)}px;">
${hasCompare ? `<span style="text-decoration:line-through;color:#999;margin-right:4px;">${formatPriceDollars(p.compare_price)}</span>` : ''}
<span style="font-weight:600;color:${upsellText};">${formatPriceDollars(p.price||0)}</span>
</div>
${variantHtml}
</div>
<button id="cf-upsell-btn-${p.id}" onclick="cfAddUpsell('${p.id}')" style="align-self:center;padding:6px 12px;background:${v.button_color||'#000'};color:${v.button_text_color||'#fff'};border:none;border-radius:${v.button_radius||4}px;font-size:${fs(11)}px;font-weight:600;cursor:pointer;white-space:nowrap;opacity:0.85;">${v.upsells_button_text||'+Add'}</button>
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
 addonHtml += `
<div onclick="cfToggleAddon('sp')" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.06);">
<div style="width:18px;height:18px;border:2px solid ${_spActive?v.button_color||'#000':'#ccc'};border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${_spActive?v.button_color||'#000':'transparent'};color:#fff;transition:all 0.15s ease;">${_spActive?SVG_ICONS.check:''}</div>
${v.sp_icon?`<img src="${v.sp_icon}" alt="SP" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" />`:''}
<div style="flex:1;min-width:0;">
<div style="font-size:${fs(13)}px;font-weight:500;">${spTitle}</div>
<div style="font-size:${fs(11)}px;color:#888;">${spDesc}</div>
</div>
<div style="font-size:${fs(13)}px;font-weight:600;flex-shrink:0;">${spPriceText}</div>
</div>`;
 }
 if (v.gift_wrap_enabled) {
 const gwTitle = v.gw_title||'Gift Wrapping';
 const gwDesc = v.gw_description||'Beautiful gift wrapping for your order.';
 const gwPrice = Number(v.gift_wrap_price||2.99);
 addonHtml += `
<div onclick="cfToggleAddon('gw')" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.06);">
<div style="width:18px;height:18px;border:2px solid ${_gwActive?v.button_color||'#000':'#ccc'};border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${_gwActive?v.button_color||'#000':'transparent'};color:#fff;transition:all 0.15s ease;">${_gwActive?SVG_ICONS.check:''}</div>
${v.gw_icon?`<img src="${v.gw_icon}" alt="GW" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" />`:''}
<div style="flex:1;min-width:0;">
<div style="font-size:${fs(13)}px;font-weight:500;">${gwTitle}</div>
<div style="font-size:${fs(11)}px;color:#888;">${gwDesc}</div>
</div>
<div style="font-size:${fs(13)}px;font-weight:600;flex-shrink:0;">${formatPriceDollars(gwPrice)}</div>
</div>`;
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
 badgeHtml = `<div style="text-align:center;padding:8px 16px;">
<img src="${badgeImgUrl}" alt="Trust Badge" style="max-width:${badgeSize}%;height:auto;" />
</div>`;
 } else if (PRESET_IMAGES[badgePreset]) {
 badgeHtml = `<div style="text-align:center;padding:8px 16px;">
<img src="${PRESET_IMAGES[badgePreset]}" alt="Trust Badge" style="max-width:${badgeSize}%;height:auto;" />
</div>`;
 } else if (PRESETS[badgePreset]) {
 badgeHtml = `<div style="text-align:center;padding:8px 16px;font-size:${fs(11)}px;color:#888;display:flex;align-items:center;justify-content:center;gap:4px;">
${SVG_ICONS.shield} ${PRESETS[badgePreset]}
</div>`;
 }
 if (badgeHtml) {
 const target = badgePos === 'above' ? badgesTop : badgesBot;
 if (target) target.innerHTML = badgeHtml;
 }
 }

 const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
 const rawSubtotalDollars = rawSubtotalCents / 100;
 let addonTotal = 0;
 if (_spActive && v.shipping_protection_enabled) {
 const spPrice = Number(v.sp_price||4.99);
 addonTotal += v.sp_price_type==='percentage' ? rawSubtotalDollars*spPrice/100 : spPrice;
 }
 if (_gwActive && v.gift_wrap_enabled) addonTotal += Number(v.gift_wrap_price||2.99);
 const finalSubtotal = Math.max(0, rawSubtotalDollars - rewardDiscount + addonTotal);
 const subtotalEl = document.getElementById('cf-subtotal');
 if (subtotalEl) subtotalEl.textContent = formatPriceDollars(finalSubtotal);

 const discRow = document.getElementById('cf-discounts-row');
 if (discRow) {
 if (activeRewardLabels.length > 0) {
 discRow.style.display = 'flex';
 const textColor = v.text_color || '#000';
 const savingsColor = v.savings_color || '#22c55e';
 const labelsHtml = activeRewardLabels.map(label =>
 `<span style="font-size:${fs(11)}px;color:${savingsColor};font-weight:500;">${label}</span>`
 ).join(' ');
 discRow.innerHTML = `
<div>
<div style="font-weight:500;">Discounts</div>
<div>${labelsHtml}</div>
</div>
<div style="color:${savingsColor};font-weight:600;">
 ${rewardDiscount > 0 ? `-${formatPriceDollars(rewardDiscount)}` : ''}
</div>`;
 } else {
 discRow.style.display = 'none';
 discRow.innerHTML = '';
 }
 }

 const subtotalRow = document.getElementById('cf-subtotal-row');
 if (subtotalRow) subtotalRow.style.display = v.show_subtotal_line===false ? 'none' : 'flex';

 const contWrap = document.getElementById('cf-continue-wrap');
 if (contWrap) contWrap.innerHTML = v.show_continue_shopping ? `<a href="javascript:void(0)" onclick="closeCart()" style="font-size:${fs(12)}px;color:#888;text-decoration:underline;">Continue Shopping</a>` : '';
 }

 async function buildCheckoutUrl(cartItems, config) {
 const routing = config?.routing || {};
 const skuMap = routing.sku_map || {};
 const activeDomain = routing.active_store?.domain;
 const v = config?.visual || {};
 if (!activeDomain) return '/checkout';
 const lineItems = [];
 for (const item of cartItems) {
 const mappedId = skuMap[item.sku];
 if (mappedId) lineItems.push(`${mappedId}:${item.quantity}`);
 }
 if (_spActive && v.sp_sku) { const m = skuMap[v.sp_sku]; if (m) lineItems.push(`${m}:1`); }
 if (_gwActive && v.gw_sku) { const m = skuMap[v.gw_sku]; if (m) lineItems.push(`${m}:1`); }
 if (lineItems.length === 0) return '/checkout';
 let checkoutUrl = `https://${activeDomain}/cart/${lineItems.join(',')}`;
 const tiers = config.rewards || [];
 const isQty = (v.rewards_calculation||'cart_total') === 'quantity';
 const simValue = isQty ? cartItems.reduce((a,i) => a+i.quantity, 0) : cartItems.reduce((a,i) => a+i.price*i.quantity, 0)/100;
 const unlockedTiers = tiers.filter(t => simValue >= (Number(t.minimum_value)||0));
 const bestCoupon = [...unlockedTiers].reverse().find(t => t.shopify_coupon);
 if (bestCoupon?.shopify_coupon) checkoutUrl += `?discount=${encodeURIComponent(bestCoupon.shopify_coupon)}`;
 return checkoutUrl;
 }

 window.cfToggleAddon = (type) => {
 if (type === 'sp') _spActive = !_spActive;
 if (type === 'gw') _gwActive = !_gwActive;
 fetchShopifyCart().then(cart => { if (window._cfConfig) renderCart(cart, window._cfConfig); });
 };

 window.cfQty = async (key, qty) => {
 if (qty < 0) return;
 await (window._cfOrigFetch||fetch)('/cart/change.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:key,quantity:qty}) });
 const cart = await fetchShopifyCart();
 window._lastCart = cart;
 if (window._cfConfig) renderCart(cart, window._cfConfig);
 };

 window.cfAddUpsell = async (productId) => {
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
 if (!res.ok) { console.warn('[CartFlow] Failed:', await res.text()); _upsellPending = false; resetBtn(); return; }
 } catch(e) { console.warn('[CartFlow] Add error:', e); _upsellPending = false; resetBtn(); return; }
 const cart = await fetchShopifyCart();
 window._lastCart = cart;
 if (window._cfConfig) {
 _lastSkus = '';
 await fetchUpsells(cart);
 renderCart(cart, window._cfConfig);
 trackEvent('upsell_added', product.price||0, { title: product.title, sku: selectedSku });
 }
 _upsellPending = false;
 resetBtn();
 };

 window.closeCart = closeCart;

 // Debounced cart refresh — groups rapid add/change calls (bundles, etc.)
 // ===== CHANGE 4: Pass expectItems flag through to fetchShopifyCart =====
 function debouncedCartRefresh(openAfter) {
 clearTimeout(_refreshTimer);
 _refreshTimer = setTimeout(async () => {
 try {
 // When openAfter=true, it means we just did an add-to-cart, so expect items
 let cart = await fetchShopifyCart(openAfter);
 window._lastCart = cart;
 if (_cartReady && window._cfConfig) {
 _lastSkus = '';
 await fetchUpsells(cart);
 renderCart(cart, window._cfConfig);
 if (openAfter) openCart();
 } else if (openAfter) { _pendingOpen = true; }
 } catch(e) {}
 }, 300);
 }

 function interceptCart() {
 // Guard: prevent double-patching if script loads twice
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
 debouncedCartRefresh(url.includes('/cart/add'));
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
 setTimeout(() => {
 debouncedCartRefresh(url.includes('/cart/add'));
 }, 50);
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
 const formData = new FormData(form);
 try {
 await (window._cfOrigFetch || fetch)('/cart/add.js?_cf=1', {
 method: 'POST',
 body: formData
 });
 debouncedCartRefresh(true);
 } catch(err) { console.warn('[CF] form submit error', err); }
 }, { capture: true });

 // ===== CHANGE 5: Universal click handler with broad cart detection =====
 document.addEventListener('click', async (e) => {
 const t = e.target;
 if (t.id==='cf-close'||t.closest('#cf-close')||t.id==='cf-overlay') { closeCart(); return; }
 if (t.id==='cf-checkout'||t.closest('#cf-checkout')) {
 e.preventDefault();
 const btn = document.getElementById('cf-checkout');
 if(!btn||btn.disabled) return;
 btn.disabled = true;
 const origHtml = btn.innerHTML;
 btn.innerHTML = `${SVG_ICONS.spin} SECURE CHECKOUT`;
 try {
 const cart = _upsellPending ? await fetchShopifyCart() : (window._lastCart || await fetchShopifyCart());
 window._lastCart = cart;
 const url = await buildCheckoutUrl(cart.items, window._cfConfig);
 trackEvent('checkout', cart.total_price/100);
 window.location.href = url || '/checkout';
 } catch(e) { btn.disabled=false; btn.innerHTML=origHtml; }
 finally { setTimeout(() => { btn.disabled=false; btn.innerHTML=origHtml; }, 3000); }
 return;
 }

 // Skip clicks inside our own drawer
 if (t.closest('#cf-drawer') || t.closest('#cf-overlay')) return;

 // === UNIVERSAL CART TRIGGER DETECTION ===
 // 1. Check if clicked element or ancestor is a link to /cart
 const cartLink = t.closest('a[href="/cart"], a[href*="/cart"]');
 if (cartLink) {
   const href = cartLink.getAttribute('href') || '';
   // Only intercept actual cart page links, not add-to-cart or checkout links
   if (href === '/cart' || href.endsWith('/cart') || href.match(/^\/cart\/?$/)) {
     e.preventDefault(); e.stopPropagation();
     if(window._cfConfig && window._lastCart) renderCart(window._lastCart, window._cfConfig);
     openCart();
     const cart = await fetchShopifyCart();
     window._lastCart = cart;
     if(window._cfConfig) renderCart(cart, window._cfConfig);
     return;
   }
 }

 // 2. Check explicit selectors (covers most themes)
 const triggers = [
 '.cart-icon-bubble', '[data-cart-toggle]',
 '.header__icon--cart', '[aria-label="Cart"]', '[aria-label="Open cart"]',
 '.cart-count-bubble', '#cart-icon-bubble',
 '.js-cart-toggle', '.cart-link', '.site-header__cart',
 '.Header__CartIcon', '[data-action="toggle-cart"]',
 '.cart-toggle', '#mini-cart', '.js-drawer-open-right',
 '.cart-page-link', '.header-cart-btn', '.icon-cart',
 'button[class*="cart"]',
 // Horizon / misc themes
 '[data-cart-count]', '.cart-count', '.header__cart',
 'cart-notification [data-cart-toggle]',
 '.cart-drawer__toggle', '.cart-icon',
 ];
 if (triggers.some(sel => { try { return t.matches?.(sel)||t.closest?.(sel); } catch(e) { return false; } })) {
 e.preventDefault(); e.stopPropagation();
 if(window._cfConfig && window._lastCart) renderCart(window._lastCart, window._cfConfig);
 openCart();
 const cart = await fetchShopifyCart();
 window._lastCart = cart;
 if(window._cfConfig) renderCart(cart, window._cfConfig);
 return;
 }

 // 3. Heuristic: element or ancestor has "cart" in class/id and looks like a button/icon
 const cartEl = t.closest('[class*="cart" i], [id*="cart" i]');
 if (cartEl && !cartEl.closest('form') && !cartEl.closest('[action*="/cart/add"]')) {
   const tag = cartEl.tagName.toLowerCase();
   const isInteractive = tag === 'button' || tag === 'a' || cartEl.getAttribute('role') === 'button' ||
                          cartEl.style.cursor === 'pointer' || cartEl.closest('button, a, [role="button"]');
   // Avoid matching product cards, cart page content, etc.
   const isSmall = cartEl.offsetWidth < 200 && cartEl.offsetHeight < 200;
   if (isInteractive && isSmall) {
     e.preventDefault(); e.stopPropagation();
     if(window._cfConfig && window._lastCart) renderCart(window._lastCart, window._cfConfig);
     openCart();
     const cart = await fetchShopifyCart();
     window._lastCart = cart;
     if(window._cfConfig) renderCart(cart, window._cfConfig);
     return;
   }
 }
 }, { passive: false, capture: true });
 }

 try {
 if (!window._cfOrigFetch) window._cfOrigFetch = window.fetch;
 const initialCart = await fetchShopifyCart();
 const initialSkus = (initialCart.items||[]).map(i => i.sku).filter(Boolean).join(',');
 _lastSkus = initialSkus;
 const config = await getConfig(initialSkus);
 getVitrineSkuMap();
 if (!config) { console.warn('[CartFlow] Config not found'); return; }
 window._cfConfig = config;
 _fontScale = SCALE_MAP[config.visual?.font_scale] || 1.15;
 injectStyles(config.visual||{});
 injectHTML(config.visual||{});
 // ===== CHANGE 6: Start MutationObserver for native drawer suppression =====
 observeNativeDrawers();
 interceptCart();
 if (config.visual?.announcement_timer) startTimer(config.visual.announcement_timer);
 window._lastCart = initialCart;
 renderCart(initialCart, config);
 onCartReady();
 trackEvent('cart_impression');
 console.log('[CartFlow] ✓ Loaded (v10-universal)');
 } catch(err) { console.error('[CartFlow] Init error:', err); }

})();
