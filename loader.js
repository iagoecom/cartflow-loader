(async () => {

  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';
  const SKU_CACHE_KEY = 'cartflow_sku_cache';
  const SKU_TTL = 30 * 60 * 1000;

  if (!TOKEN) { console.warn('[CartFlow] data-token not found'); return; }

  let _cartReady = false;
  let _pendingOpen = false;

  function onCartReady() {
    _cartReady = true;
    if (_pendingOpen) {
      _pendingOpen = false;
      fetchShopifyCart().then(cart => {
        if (window._cfConfig) { renderCart(cart, window._cfConfig); openCart(); }
      });
    }
  }

  // ── Helpers ──
  function formatPrice(cents) {
    const amount = cents / 100;
    const currency = window.Shopify?.currency?.active || 'USD';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount); }
    catch (e) { return `${currency} ${amount.toFixed(2)}`; }
  }

  function stripHtml(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || d.innerText || '';
  }

  function contrastText(hex) {
    if (!hex || hex.length < 7) return '#000000';
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 > 0.5 ? '#000000' : '#FFFFFF';
  }

  // ── SVG Icons ──
  const SVG_ICONS = {
    truck: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
    gift: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    shield: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    minus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    close: (sw) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  };

  const PRESETS = {
    returns_warranty: 'Free returns + 30-day warranty',
    secure_delivery: 'Secure payment + Guaranteed delivery',
    protected_support: 'Protected purchase + 24/7 support',
  };

  // ── Config ──
  async function getConfig() {
    try { const r = await fetch(`${API_URL}?token=${TOKEN}`); if (!r.ok) return null; return await r.json(); }
    catch(e) { return null; }
  }

  function trackEvent(type, amount=0, metadata={}) {
    fetch(TRACK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token:TOKEN, event_type:type, amount, metadata }) }).catch(()=>{});
  }

  async function fetchShopifyCart() { return (await fetch('/cart.js')).json(); }

  // ── SKU Map ──
  async function getSkuMap(domain) {
    const ck = `${SKU_CACHE_KEY}_${domain}`;
    try { const c = localStorage.getItem(ck); if (c) { const {data,expiresAt}=JSON.parse(c); if (Date.now()<expiresAt) return data; } } catch(e){}
    const m = {};
    let url = `https://${domain}/products.json?limit=250`;
    try {
      while (url) {
        const r = await fetch(url); if (!r.ok) break; const d = await r.json();
        for (const p of d.products) for (const v of p.variants) if (v.sku) m[v.sku] = v.id;
        const lh = r.headers.get('Link');
        if (lh?.includes('rel="next"')) { const mt = lh.match(/<([^>]+)>;\s*rel="next"/); url = mt ? mt[1] : null; } else url = null;
      }
    } catch(e) { console.warn('[CartFlow] SKU map error:', e); }
    try { localStorage.setItem(ck, JSON.stringify({ data:m, expiresAt:Date.now()+SKU_TTL })); } catch(e){}
    return m;
  }

  // ── Drawer Width ──
  function getDrawerWidth(v) {
    const dw = v.cart_width_desktop || 'default';
    return dw === 'narrow' ? '360px' : dw === 'wide' ? '500px' : '420px';
  }

  // ── Timer ──
  let _timerInterval = null;
  let _timerSeconds = 0;

  function startTimer(raw) {
    if (_timerInterval) clearInterval(_timerInterval);
    const parts = (raw || '').split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      _timerSeconds = parts[0] * 60 + parts[1];
    } else { _timerSeconds = 0; return; }
    _timerInterval = setInterval(() => {
      if (_timerSeconds > 0) {
        _timerSeconds--;
        const el = document.getElementById('cf-timer-value');
        if (el) el.textContent = formatTimer(_timerSeconds);
      } else clearInterval(_timerInterval);
    }, 1000);
  }

  function formatTimer(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

  // ── Styles ──
  function injectStyles(v) {
    const dw = getDrawerWidth(v);
    const mw = v.cart_width_mobile === 'default' ? '90vw' : '100vw';
    const borderMap = { none:'0px', thin:'1px', normal:'2px', thick:'3px' };
    const bdr = borderMap[v.header_border_thickness] || '1px';
    const headingMap = { h2:{fs:22,fw:700}, h3:{fs:18,fw:600}, h4:{fs:16,fw:600} };
    const hd = headingMap[v.header_heading_level] || headingMap.h3;
    const closeMap = { small:'16px', medium:'20px', large:'24px' };
    const closeSz = closeMap[v.close_icon_size] || '16px';

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

      /* Header */
      #cf-header {
        padding:${v.header_height==='tall'?'20px':'12px'} 16px;
        border-bottom:${v.header_border_thickness!=='none' ? bdr+' solid '+(v.header_border_color||'#e5e7eb') : 'none'};
        background:${v.header_bg_color||'#FFFFFF'};
        display:flex;align-items:center;flex-shrink:0;
        ${v.close_button_position==='left' ? 'flex-direction:row-reverse;' : ''}
      }
      #cf-header-content { flex:1;display:flex;align-items:center;
        ${v.header_alignment==='center'?'justify-content:center;':v.header_alignment==='right'?'justify-content:flex-end;':'justify-content:flex-start;'}
      }
      #cf-title-el { font-size:${hd.fs}px;font-weight:${hd.fw};margin:0;
        ${v.header_text_color_override ? 'color:'+v.header_text_color_override+';' : ''}
      }
      #cf-header-logo { height:${v.header_logo_size||32}px;object-fit:contain; }
      #cf-close {
        background:${v.close_bg_color||'transparent'};border:none;cursor:pointer;
        padding:4px;line-height:0;border-radius:4px;flex-shrink:0;
        width:${parseInt(closeSz)+8}px;height:${parseInt(closeSz)+8}px;
        display:flex;align-items:center;justify-content:center;
        color:${v.close_icon_color||'#000'};transition:all 0.15s;
      }
      #cf-close:hover {
        background:${v.close_bg_hover_color||'#f3f4f6'};
        color:${v.close_icon_hover_color||'#666'};
      }
      #cf-close svg { width:${closeSz};height:${closeSz}; }

      /* Announcement */
      .cf-ann {
        padding:${v.announcement_height==='compact'?'6px':v.announcement_height==='tall'?'16px':'10px'} 16px;
        background:${v.announcement_bg_color||'#f2f2f2'};
        border-bottom:1px solid ${v.announcement_border_color||'#efefef'};
        color:${v.announcement_text_color||'#333'};
        font-size:${v.announcement_font_size||14}px;
        text-align:${v.announcement_alignment||'center'};
        flex-shrink:0;
      }

      /* Rewards */
      #cf-rewards { padding:16px 24px;border-bottom:1px solid ${v.accent_color||'#f6f6f7'};flex-shrink:0;overflow:hidden; }
      .cf-rw-status { text-align:center;margin-bottom:12px;font-size:${v.rewards_font_size||14}px;line-height:1.5; }
      .cf-rw-bar { display:flex;align-items:center;gap:0; }
      .cf-rw-seg { flex:1;border-radius:9999px;overflow:hidden;height:${v.rewards_bar_height||8}px;background:${v.rewards_bar_bg_color||'#efefef'}; }
      .cf-rw-seg-fill { height:100%;border-radius:9999px;background:${v.rewards_bar_fg_color||'#303030'};transition:width 0.4s; }
      .cf-rw-circle {
        flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;
        margin:0 4px;transition:all 0.3s;
      }
      .cf-rw-circle.reached { width:32px;height:32px;background:${v.rewards_bar_fg_color||'#303030'};color:${v.rewards_complete_icon_color||'#fff'}; }
      .cf-rw-circle.pending { width:24px;height:24px;background:${v.rewards_bar_bg_color||'#efefef'};color:${v.rewards_incomplete_icon_color||'#4D4949'}; }
      .cf-rw-dot { width:8px;height:8px;border-radius:50%;background:${v.rewards_incomplete_icon_color||'#4D4949'};opacity:0.4; }
      .cf-rw-labels { display:flex;align-items:flex-start;gap:0;margin-top:2px; }
      .cf-rw-label { flex-shrink:0;margin:0 4px;text-align:center;white-space:nowrap;font-size:8px;opacity:0.5;line-height:1.2; }

      /* Scrollable body */
      #cf-body { flex:1;overflow-y:auto; }

      /* Items */
      .cf-item { display:flex;gap:12px;padding:16px;border-bottom:1px solid ${v.accent_color||'#f6f6f7'}; }
      .cf-img { width:70px;height:70px;border-radius:8px;object-fit:cover;background:${v.accent_color||'#f5f5f5'};flex-shrink:0; }
      .cf-info { flex:1;min-width:0; }
      .cf-item-top { display:flex;align-items:flex-start;justify-content:space-between;gap:8px; }
      .cf-name { font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .cf-variant { font-size:10px;opacity:0.5;margin-top:1px; }
      .cf-trash { background:none;border:none;cursor:pointer;padding:4px;opacity:0.4;transition:opacity 0.15s;color:inherit; }
      .cf-trash:hover { opacity:0.8; }
      .cf-trash svg { width:16px;height:16px; }
      .cf-price-row { display:flex;align-items:center;gap:6px;margin-top:6px; }
      .cf-compare { font-size:14px;text-decoration:line-through;opacity:0.4; }
      .cf-price { font-size:14px;font-weight:600; }
      .cf-save { font-size:11px;font-weight:500;color:${v.savings_color||'#22c55e'}; }
      .cf-qty-wrap { display:inline-flex;align-items:center;border:1px solid ${v.accent_color||'#e5e7eb'};border-radius:6px;margin-top:8px; }
      .cf-qty-btn { width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:inherit; }
      .cf-qty-n { font-size:13px;width:32px;text-align:center;border-left:1px solid ${v.accent_color||'#e5e7eb'};border-right:1px solid ${v.accent_color||'#e5e7eb'}; }

      /* Empty */
      .cf-empty { text-align:center;padding:48px 16px;color:#999; }
      .cf-empty-icon { font-size:40px;margin-bottom:12px; }

      /* Upsells */
      #cf-upsells-top, #cf-upsells-bottom { padding:12px 16px;border-bottom:1px solid ${v.accent_color||'#f6f6f7'}; }
      .cf-up-title { font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:center;margin-bottom:12px;opacity:0.6; }
      .cf-up-list.inline { display:flex;gap:8px;overflow-x:auto; }
      .cf-up-list.stack { display:flex;flex-direction:column;gap:12px; }
      .cf-up-card { display:flex;align-items:flex-start;gap:12px;border:1px solid ${v.accent_color||'#e5e7eb'};border-radius:8px;padding:12px; }
      .cf-up-img { width:80px;height:80px;border-radius:8px;object-fit:cover;background:${v.accent_color||'#f5f5f5'};flex-shrink:0; }
      .cf-up-info { flex:1;min-width:0; }
      .cf-up-name { font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .cf-up-prices { display:flex;align-items:center;gap:6px;margin-top:4px; }
      .cf-up-compare { font-size:12px;text-decoration:line-through;opacity:0.5; }
      .cf-up-price { font-size:12px;font-weight:600; }
      .cf-up-actions { display:flex;align-items:center;gap:8px;margin-top:8px; }
      .cf-up-select { font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid ${v.accent_color||'#e5e7eb'};background:${v.bg_color||'#fff'};color:${v.text_color||'#000'};flex:1;min-width:0; }
      .cf-up-btn {
        padding:4px 12px;font-size:11px;font-weight:600;border:none;cursor:pointer;flex-shrink:0;
        background:${v.button_color||'#000'};color:${v.button_text_color||'#fff'};
        border-radius:${v.button_radius||0}px;
      }

      /* Shipping protection */
      .cf-addon { display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${v.accent_color||'#f6f6f7'}; }
      .cf-addon-left { display:flex;align-items:center;gap:8px; }
      .cf-addon-icon { color:#16a34a; }
      .cf-addon-title { font-size:10px;font-weight:500; }
      .cf-addon-desc { font-size:9px;opacity:0.5; }
      .cf-addon-right { display:flex;align-items:center;gap:8px; }
      .cf-addon-price { font-size:10px;font-weight:500; }
      .cf-toggle { width:32px;height:16px;border-radius:9999px;background:#16a34a;position:relative;cursor:pointer;border:none; }
      .cf-toggle-dot { position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:${v.bg_color||'#fff'}; }

      /* Footer */
      #cf-footer { flex-shrink:0;border-top:1px solid ${v.accent_color||'#e5e7eb'}; }
      .cf-footer-inner { padding:12px 16px; }
      .cf-savings-row { display:flex;justify-content:space-between;font-size:12px;font-weight:500;color:${v.savings_color||'#22c55e'};margin-bottom:8px; }
      .cf-subtotal-row { display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px; }
      #cf-checkout {
        width:100%;padding:10px;border:none;cursor:pointer;
        font-size:12px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;
        background:${v.button_color||'#000'};color:${v.button_text_color||'#fff'};
        border-radius:${v.button_radius||0}px;transition:background 0.15s;
      }
      #cf-checkout:disabled { opacity:0.6;cursor:not-allowed; }
      .cf-continue { width:100%;padding:8px;background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline;opacity:0.5;color:${v.text_color||'#000'};transition:opacity 0.15s; }
      .cf-continue:hover { opacity:0.8; }
      .cf-express { display:flex;justify-content:center;gap:8px;padding-top:4px; }
      .cf-express-item { font-size:9px;padding:4px 12px;border-radius:4px;border:1px solid ${v.accent_color||'#e5e7eb'};opacity:0.4; }

      /* Trust badges */
      .cf-badges { padding:12px 16px;border-top:1px solid ${v.accent_color||'#e5e7eb'}; }
      .cf-badges img { max-width:100%;height:auto;max-height:64px;object-fit:contain;display:block;margin:0 auto; }
      .cf-badges-text { display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;font-size:9px;opacity:0.5; }

      /* Hide native Shopify cart */
      cart-drawer,cart-notification,.cart-drawer,.cart-notification,#cart-drawer,#CartDrawer,
      #cart-notification,[id*="cart-drawer"],[class*="cart-drawer"],drawer-component[id*="cart"],
      .shopify-section-cart-drawer { display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important; }

      @media (max-width:480px) {
        #cf-drawer { width:${mw};right:-${mw}; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build HTML ──
  function injectHTML(v) {
    const overlay = document.createElement('div');
    overlay.id = 'cf-overlay';

    const closeSw = v.close_icon_thickness === 'bold' ? 3 : 2;

    overlay.innerHTML = `
      <div id="cf-drawer">
        <div id="cf-header">
          <div id="cf-header-content">
            ${v.header_title_type === 'logo' && v.header_logo_url
              ? `<img id="cf-header-logo" src="${v.header_logo_url}" alt="Logo">`
              : `<${v.header_heading_level||'h3'} id="cf-title-el">Cart &bull; 0</${v.header_heading_level||'h3'}>`
            }
          </div>
          <button id="cf-close">${SVG_ICONS.close(closeSw)}</button>
        </div>
        <div id="cf-body">
          <div id="cf-ann-before"></div>
          <div id="cf-rewards"></div>
          <div id="cf-upsells-top"></div>
          <div id="cf-items"></div>
          <div id="cf-ann-after"></div>
          <div id="cf-upsells-bottom"></div>
          <div id="cf-addon-section"></div>
        </div>
        <div id="cf-footer">
          <div id="cf-badges-top"></div>
          <div class="cf-footer-inner">
            <div id="cf-savings-row" class="cf-savings-row" style="display:none">
              <span>Savings:</span>
              <span id="cf-savings-val"></span>
            </div>
            <div id="cf-subtotal-row" class="cf-subtotal-row" style="display:none">
              <span>Subtotal:</span>
              <span id="cf-subtotal"></span>
            </div>
            <button id="cf-checkout">SECURE CHECKOUT</button>
            <div id="cf-continue-wrap"></div>
            <div id="cf-express-wrap"></div>
          </div>
          <div id="cf-badges-bottom"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // ── Open / Close ──
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

  // ── Render ──
  function renderCart(cart, config) {
    const v = config.visual || {};
    const items = cart.items || [];
    const count = items.reduce((a,i) => a + i.quantity, 0);

    // Title
    const titleEl = document.getElementById('cf-title-el');
    if (titleEl) {
      titleEl.textContent = (v.header_title_text || 'Cart • {{cart_quantity}}').replace('{{cart_quantity}}', count);
    }

    // Announcement
    const annBefore = document.getElementById('cf-ann-before');
    const annAfter = document.getElementById('cf-ann-after');
    if (annBefore) annBefore.innerHTML = '';
    if (annAfter) annAfter.innerHTML = '';
    if (v.announcement_enabled && v.announcement_text) {
      const timerHtml = _timerSeconds > 0 ? `<span id="cf-timer-value" style="font-weight:600">${formatTimer(_timerSeconds)}</span>` : '';
      const annHtml = `<div class="cf-ann">${(v.announcement_text||'').replace('{{timer}}', timerHtml)}</div>`;
      const target = v.announcement_position === 'after' ? annAfter : annBefore;
      if (target) target.innerHTML = annHtml;
    }

    // Rewards
    const rwEl = document.getElementById('cf-rewards');
    if (rwEl) {
      rwEl.innerHTML = '';
      const tiers = config.rewards || [];
      const showOnEmpty = v.rewards_show_on_empty !== false;
      if (v.rewards_enabled && tiers.length > 0 && (count > 0 || showOnEmpty)) {
        const isQty = (v.rewards_calculation || 'cart_total') === 'quantity';
        const totalQty = count;
        const totalValue = cart.total_price / 100;
        const simValue = isQty ? totalQty : totalValue;
        const sorted = [...tiers].sort((a,b) => a.minimum_value - b.minimum_value);
        const maxVal = Math.max(...sorted.map(t => t.minimum_value), 1);
        const cidx = sorted.findIndex(t => simValue < t.minimum_value);
        const nextT = cidx >= 0 ? sorted[cidx] : null;
        const rem = nextT ? (isQty ? `${nextT.minimum_value - simValue}` : `$${(nextT.minimum_value - simValue).toFixed(0)}`) : null;

        const rawText = nextT
          ? (nextT.title_before || `Add {remaining} more to unlock ${nextT.reward_description||'the next reward'}`)
              .replace('{remaining}', String(rem)).replace('{{count}}', String(totalQty))
          : (v.rewards_complete_text || 'All rewards unlocked! 🎉').replace('{{count}}', String(totalQty));
        const statusText = stripHtml(rawText);

        let barHtml = '<div class="cf-rw-bar">';
        let labelsHtml = '<div class="cf-rw-labels">';
        sorted.forEach((tier, idx) => {
          const segStart = idx === 0 ? 0 : sorted[idx-1].minimum_value;
          const segEnd = tier.minimum_value;
          const segRange = segEnd - segStart;
          const lp = segRange > 0 ? Math.min(Math.max((simValue-segStart)/segRange,0),1)*100 : (simValue>=segEnd?100:0);
          const reached = simValue >= tier.minimum_value;
          const iconKey = tier.icon || 'gift';
          const iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.gift;

          barHtml += `<div class="cf-rw-seg"><div class="cf-rw-seg-fill" style="width:${lp}%"></div></div>`;
          barHtml += `<div class="cf-rw-circle ${reached?'reached':'pending'}">`;
          barHtml += reached ? iconSvg : '<div class="cf-rw-dot"></div>';
          barHtml += '</div>';

          labelsHtml += '<div style="flex:1"></div>';
          labelsHtml += `<div class="cf-rw-label">${tier.reward_description || tier.reward_type || ''}</div>`;
        });
        barHtml += '</div>';
        labelsHtml += '</div>';

        rwEl.innerHTML = `<div class="cf-rw-status">${statusText}</div>${barHtml}${labelsHtml}`;
      }
    }

    // Items
    const itemsEl = document.getElementById('cf-items');
    if (itemsEl) {
      if (items.length === 0) {
        itemsEl.innerHTML = '<div class="cf-empty"><div class="cf-empty-icon">🛒</div><div>Your cart is empty</div></div>';
      } else {
        itemsEl.innerHTML = items.map(item => {
          const price = formatPrice(item.price);
          const hasDis = item.original_price && item.original_price > item.price;
          const orig = hasDis ? formatPrice(item.original_price) : '';
          const saving = hasDis ? formatPrice((item.original_price - item.price) * item.quantity) : '';
          const variantLabel = item.variant_title && item.variant_title !== 'Default Title' ? item.variant_title : '';
          return `
            <div class="cf-item">
              <img class="cf-img" src="${item.image||''}" alt="${item.title}">
              <div class="cf-info">
                <div class="cf-item-top">
                  <div style="min-width:0">
                    <div class="cf-name">${item.title}</div>
                    ${variantLabel ? `<div class="cf-variant">${variantLabel}</div>` : ''}
                  </div>
                  <button class="cf-trash" onclick="cfQty('${item.key}',0)">${SVG_ICONS.trash}</button>
                </div>
                <div class="cf-price-row">
                  ${hasDis && v.show_strikethrough ? `<span class="cf-compare">${orig}</span>` : ''}
                  <span class="cf-price">${price}</span>
                  ${saving && v.show_strikethrough ? `<span class="cf-save">(Save ${saving})</span>` : ''}
                </div>
                <div class="cf-qty-wrap">
                  <button class="cf-qty-btn" onclick="cfQty('${item.key}',${item.quantity-1})">${SVG_ICONS.minus}</button>
                  <span class="cf-qty-n">${item.quantity}</span>
                  <button class="cf-qty-btn" onclick="cfQty('${item.key}',${item.quantity+1})">${SVG_ICONS.plus}</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Upsells
    const upsells = config.upsells || [];
    const topEl = document.getElementById('cf-upsells-top');
    const btmEl = document.getElementById('cf-upsells-bottom');
    if (topEl) topEl.innerHTML = '';
    if (btmEl) btmEl.innerHTML = '';
    if (v.upsells_enabled && upsells.length > 0) {
      const dirClass = (v.upsells_direction||'stack') === 'inline' ? 'inline' : 'stack';
      const html = `
        <div class="cf-up-title">${v.upsells_title||'RECOMMENDED FOR YOU'}</div>
        <div class="cf-up-list ${dirClass}">
          ${upsells.map(p => {
            const hasCompare = v.upsells_show_strikethrough && p.compare_price && p.compare_price > (p.price||0);
            return `
              <div class="cf-up-card">
                ${p.image_url ? `<img class="cf-up-img" src="${p.image_url}" alt="${p.title}">` : `<div class="cf-up-img"></div>`}
                <div class="cf-up-info">
                  <div class="cf-up-name">${p.title}</div>
                  <div class="cf-up-prices">
                    ${hasCompare ? `<span class="cf-up-compare">${formatPrice(p.compare_price*100)}</span>` : ''}
                    <span class="cf-up-price">${formatPrice((p.price||0)*100)}</span>
                  </div>
                  <div class="cf-up-actions">
                    <select class="cf-up-select"><option>Default</option></select>
                    <button class="cf-up-btn" onclick="cfAddUpsell('${p.shopify_variant_id||''}','${(p.title||'').replace(/'/g,"\\'")}',${p.price||0})">${v.upsells_button_text||'+ Add'}</button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      const target = (v.upsells_position||'bottom') === 'top' ? topEl : btmEl;
      if (target) target.innerHTML = html;
    }

    // Shipping protection add-on
    const addonEl = document.getElementById('cf-addon-section');
    if (addonEl) {
      addonEl.innerHTML = '';
      if (v.shipping_protection_enabled) {
        addonEl.innerHTML = `
          <div class="cf-addon">
            <div class="cf-addon-left">
              <div class="cf-addon-icon">${SVG_ICONS.shield}</div>
              <div>
                <div class="cf-addon-title">Shipping Protection</div>
                <div class="cf-addon-desc">Protect your order against loss</div>
              </div>
            </div>
            <div class="cf-addon-right">
              <span class="cf-addon-price">$4.90</span>
              <button class="cf-toggle"><div class="cf-toggle-dot"></div></button>
            </div>
          </div>
        `;
      }
    }

    // Subtotal & Savings
    const totalOrig = items.reduce((a,i) => a + (i.original_price||i.price)*i.quantity, 0);
    const totalSaved = totalOrig - cart.total_price;

    const savRow = document.getElementById('cf-savings-row');
    const savVal = document.getElementById('cf-savings-val');
    if (v.show_strikethrough && totalSaved > 0) {
      if (savRow) savRow.style.display = 'flex';
      if (savVal) savVal.textContent = `-${formatPrice(totalSaved)}`;
    } else {
      if (savRow) savRow.style.display = 'none';
    }

    const subRow = document.getElementById('cf-subtotal-row');
    const subEl = document.getElementById('cf-subtotal');
    if (v.show_subtotal_line !== false) {
      if (subRow) { subRow.style.display = 'flex'; subRow.style.color = v.subtotal_text_color || v.text_color || '#000'; }
      if (subEl) subEl.textContent = formatPrice(cart.total_price);
    } else {
      if (subRow) subRow.style.display = 'none';
    }

    // Trust badges
    const badgesTopEl = document.getElementById('cf-badges-top');
    const badgesBtmEl = document.getElementById('cf-badges-bottom');
    if (badgesTopEl) badgesTopEl.innerHTML = '';
    if (badgesBtmEl) badgesBtmEl.innerHTML = '';
    if (v.trust_badges_enabled) {
      let badgeHtml = '';
      if (v.trust_badges_image_url) {
        badgeHtml = `<div class="cf-badges"><img src="${v.trust_badges_image_url}" alt="Trust badges"></div>`;
      } else if (v.trust_badges_preset && PRESETS[v.trust_badges_preset]) {
        badgeHtml = `<div class="cf-badges"><div class="cf-badges-text">${SVG_ICONS.shield} ${PRESETS[v.trust_badges_preset]}</div></div>`;
      }
      if (badgeHtml) {
        const tgt = (v.trust_badges_position||'bottom') === 'top' ? badgesTopEl : badgesBtmEl;
        if (tgt) tgt.innerHTML = badgeHtml;
      }
    }

    // Continue shopping
    const contWrap = document.getElementById('cf-continue-wrap');
    if (contWrap) {
      contWrap.innerHTML = v.show_continue_shopping
        ? '<button class="cf-continue" onclick="closeCart()">Or continue shopping</button>'
        : '';
    }

    // Express payments
    const expWrap = document.getElementById('cf-express-wrap');
    if (expWrap) {
      expWrap.innerHTML = v.express_payments_enabled
        ? '<div class="cf-express">' + ['Apple Pay','G Pay','PayPal'].map(m => `<div class="cf-express-item">${m}</div>`).join('') + '</div>'
        : '';
    }

    // Checkout button hover
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn && v.button_hover_color) {
      ckBtn.onmouseenter = () => { ckBtn.style.backgroundColor = v.button_hover_color; };
      ckBtn.onmouseleave = () => { ckBtn.style.backgroundColor = v.button_color || '#000'; };
    }
  }

  // ── Checkout ──
  async function buildCheckoutUrl(cartItems, config) {
    const domain = config.routing?.active_store?.domain;
    if (!domain) return null;
    const skuMap = await getSkuMap(domain);
    if (!skuMap || Object.keys(skuMap).length === 0) return null;
    const lines = cartItems.map(i => { const vid = skuMap[i.sku]; return vid ? `${vid}:${i.quantity}` : null; }).filter(Boolean);
    if (lines.length === 0) return null;
    return `https://${domain}/cart/${lines.join(',')}`;
  }

  // ── Global Functions ──
  window.cfQty = async (key, qty) => {
    if (qty < 0) return;
    await fetch('/cart/change.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:key,quantity:qty}) });
    const cart = await fetchShopifyCart();
    if (window._cfConfig) renderCart(cart, window._cfConfig);
  };

  window.cfAddUpsell = async (variantId, title, price) => {
    if (!variantId) return;
    await fetch('/cart/add.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:variantId,quantity:1}) });
    const cart = await fetchShopifyCart();
    if (window._cfConfig) { renderCart(cart, window._cfConfig); trackEvent('upsell_added', price, {title,variantId}); }
  };

  window.closeCart = closeCart;

  // ── Intercept ──
  function interceptCart() {
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]||'');
      const result = await origFetch.apply(window, args);
      if (url.includes('/cart/add') && !url.includes('track-event')) {
        try {
          const data = await result.clone().json();
          if (data?.id || data?.items) {
            const cart = await fetchShopifyCart();
            if (_cartReady && window._cfConfig) { renderCart(cart, window._cfConfig); openCart(); }
            else _pendingOpen = true;
          }
        } catch(e){}
      }
      return result;
    };

    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const isCart = form.action?.includes('/cart/add') || form.querySelector('[name="add"]');
      if (!isCart) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const btn = form.querySelector('[type="submit"],[name="add"]');
      if (btn) { btn.disabled=true; btn.dataset.orig=btn.textContent; btn.textContent='Adding...'; }
      try {
        const fd = new FormData(form);
        const res = await fetch('/cart/add.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:fd.get('id'),quantity:parseInt(fd.get('quantity')||'1')}) });
        if (res.ok) { const cart=await fetchShopifyCart(); if(_cartReady&&window._cfConfig){renderCart(cart,window._cfConfig);openCart();}else _pendingOpen=true; }
      } catch(e){ console.warn('[CartFlow] Add error:',e); }
      finally { if(btn){btn.disabled=false;btn.textContent=btn.dataset.orig||'Add to cart';} }
    }, true);

    document.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id==='cf-close'||t.closest('#cf-close')||t.id==='cf-overlay') { closeCart(); return; }
      if (t.id==='cf-checkout') {
        e.preventDefault(); if(t.disabled)return; t.disabled=true; t.textContent='Redirecting...';
        try { const cart=await fetchShopifyCart(); const url=await buildCheckoutUrl(cart.items,window._cfConfig); trackEvent('checkout',cart.total_price/100); window.location.href=url||'/checkout'; }
        catch(e){ t.disabled=false; t.textContent='SECURE CHECKOUT'; }
        return;
      }
      const triggers=['[href="/cart"]','.cart-icon-bubble','[data-cart-toggle]','.header__icon--cart','[aria-label="Cart"]','[aria-label="Open cart"]','.cart-count-bubble','#cart-icon-bubble'];
      if (triggers.some(sel => t.matches?.(sel)||t.closest?.(sel))) {
        e.preventDefault(); e.stopPropagation();
        const cart=await fetchShopifyCart(); if(window._cfConfig) renderCart(cart,window._cfConfig); openCart();
      }
    }, true);
  }

  // ── Init ──
  try {
    const config = await getConfig();
    if (!config) { console.warn('[CartFlow] Config not found'); return; }
    window._cfConfig = config;
    injectStyles(config.visual||{});
    injectHTML(config.visual||{});
    interceptCart();

    if (config.visual?.announcement_timer) startTimer(config.visual.announcement_timer);

    onCartReady();

    const domain = config.routing?.active_store?.domain;
    if (domain) getSkuMap(domain).then(m => console.log(`[CartFlow] SKU map: ${Object.keys(m).length}`));

    trackEvent('cart_impression');
    console.log('[CartFlow] ✓ Loaded');
    console.log('[CartFlow] Store:', config.routing?.active_store?.name||'none');
  } catch(err) { console.error('[CartFlow] Init error:', err); }

})();
