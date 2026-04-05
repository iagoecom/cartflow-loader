(async () => {

  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';

  if (!TOKEN) { console.warn('[CartFlow] data-token not found'); return; }

  let _cartReady = false;
  let _pendingOpen = false;
  let _spActive = false;
  let _gwActive = false;

  function onCartReady() {
    _cartReady = true;
    if (_pendingOpen) {
      _pendingOpen = false;
      fetchShopifyCart().then(async cart => {
        if (window._cfConfig) {
          await fetchUpsells(cart);
          renderCart(cart, window._cfConfig);
          openCart();
        }
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

  function formatPriceDollars(val) {
    return '$' + Number(val).toFixed(2);
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

  // ── SVG Icons ──
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
  };

  const PRESETS = {
    returns_warranty: 'Free returns + 30-day warranty',
    secure_delivery: 'Secure payment + Guaranteed delivery',
    protected_support: 'Protected purchase + 24/7 support',
  };

  // ── Config ──
  async function getConfig(skus) {
    try {
      const url = `${API_URL}?token=${TOKEN}${skus ? '&skus=' + skus : ''}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  }

  // ── Fetch upsells dynamically based on current cart SKUs ──
  async function fetchUpsells(cart) {
    const skus = (cart.items || []).map(i => i.sku).filter(Boolean).join(',');
    if (!skus) {
      if (window._cfConfig) window._cfConfig.upsells = [];
      return;
    }
    try {
      const r = await window._cfOrigFetch(`${API_URL}?token=${TOKEN}&skus=${skus}`);
      if (r.ok) {
        const data = await r.json();
        if (window._cfConfig) window._cfConfig.upsells = data.upsells || [];
      }
    } catch(e) {
      console.warn('[CartFlow] fetchUpsells error:', e);
    }
  }

  function trackEvent(type, amount=0, metadata={}) {
    (window._cfOrigFetch || fetch)(TRACK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token:TOKEN, event_type:type, amount, metadata }) }).catch(()=>{});
  }

  async function fetchShopifyCart() { return (await (window._cfOrigFetch || fetch)('/cart.js')).json(); }

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
    if (!parts.every(p => !isNaN(p)) || parts.length < 2) { _timerSeconds = 0; return; }

    if (parts.length === 4) _timerSeconds = parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
    else if (parts.length === 3) _timerSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) _timerSeconds = parts[0] * 60 + parts[1];
    else { _timerSeconds = 0; return; }

    _timerInterval = setInterval(() => {
      if (_timerSeconds > 0) {
        _timerSeconds--;
        updateTimerDisplay();
      } else clearInterval(_timerInterval);
    }, 1000);
  }

  function formatTimer(s) {
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
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

    const days = Math.floor(_timerSeconds / 86400);
    const hours = Math.floor((_timerSeconds % 86400) / 3600);
    const mins = Math.floor((_timerSeconds % 3600) / 60);
    const secs = _timerSeconds % 60;

    const segments = [];
    if (days > 0) segments.push({ value: days, label: labels[0] || 'DIAS' });
    segments.push({ value: hours, label: labels[1] || 'HORAS' });
    segments.push({ value: mins, label: labels[2] || 'MIN' });
    segments.push({ value: secs, label: labels[3] || 'SEG' });

    container.innerHTML = segments.map((seg, i) => {
      const separator = i < segments.length - 1
        ? `<span style="font-size:18px;font-weight:700;margin-top:-12px;color:${annTextColor}">:</span>`
        : '';
      return `
        <div style="display:flex;flex-direction:column;align-items:center">
          <div style="display:flex;align-items:center;justify-content:center;border-radius:6px;font-weight:700;width:36px;height:36px;font-size:16px;background:${blockBg};color:${textColor}">
            ${String(seg.value).padStart(2,'0')}
          </div>
          <span style="font-size:9px;margin-top:2px;opacity:0.7;color:${annTextColor}">${seg.label}</span>
        </div>
        ${separator}
      `;
    }).join('');
  }

  // ── Styles ──
  function injectStyles(v) {
    const dw = getDrawerWidth(v);
    const mw = v.cart_width_mobile === 'default' ? '90vw' : '100vw';
    const accentColor = v.accent_color || '#f6f6f7';
    const accentTextColor = contrastText(accentColor);

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

      /* Scrollable body */
      #cf-body { flex:1;overflow-y:auto;display:flex;flex-direction:column; }

      /* Empty */
      .cf-empty { text-align:center;padding:48px 16px;color:#999; }
      .cf-empty-icon { font-size:40px;margin-bottom:12px; }

      /* Hide native Shopify cart */
      cart-drawer,cart-notification,.cart-drawer,.cart-notification,#cart-drawer,#CartDrawer,
      #cart-notification,[id*="cart-drawer"],[class*="cart-drawer"],drawer-component[id*="cart"],
      .shopify-section-cart-drawer { display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important; }

      /* FIX #3: Reset all button styles to prevent Shopify theme inheritance */
      #cf-checkout {
        all: unset !important;
        box-sizing: border-box !important;
        width: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        border: none !important;
        cursor: pointer !important;
        text-transform: uppercase !important;
        height: 46px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        background: ${v.button_color||'#000'} !important;
        color: ${v.button_text_color||'#fff'} !important;
        border-radius: ${v.button_radius||0}px !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important;
        transition: background-color 0.15s ease, opacity 0.15s ease !important;
      }

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
          <div style="flex:1;display:flex;align-items:center;justify-content:${headerJustify}">
            ${headerTitleHtml}
          </div>
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

        <div id="cf-footer" style="flex-shrink:0;border-top:1px solid rgba(0,0,0,0.08);">
          <div id="cf-badges-top"></div>
          <div class="cf-footer-inner" style="padding:12px 16px;">
            <div id="cf-discounts-row" style="display:none;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:8px;"></div>
            <div id="cf-subtotal-row" style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:8px;">
              <span style="font-weight:500">Subtotal:</span>
              <span id="cf-subtotal" style="font-weight:700"></span>
            </div>
            <button id="cf-checkout">
              ${SVG_ICONS.lock}
              Secure Checkout
            </button>
            <div id="cf-continue-wrap"></div>
            <div id="cf-express-wrap"></div>
          </div>
          <div id="cf-badges-bottom"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close button hover
    const closeBtn = document.getElementById('cf-close');
    if (closeBtn) {
      closeBtn.onmouseenter = () => {
        closeBtn.style.background = v.close_bg_hover_color || '#f3f4f6';
        closeBtn.style.color = v.close_icon_hover_color || '#666';
      };
      closeBtn.onmouseleave = () => {
        closeBtn.style.background = v.close_bg_color || 'transparent';
        closeBtn.style.color = v.close_icon_color || '#000';
      };
    }

    // FIX #3: Checkout button hover — use !important to override theme styles
    const ckBtn = document.getElementById('cf-checkout');
    if (ckBtn) {
      ckBtn.onmouseenter = () => {
        if (v.button_hover_color) {
          ckBtn.style.setProperty('background', v.button_hover_color, 'important');
        } else {
          ckBtn.style.setProperty('background', v.button_color || '#000', 'important');
          ckBtn.style.setProperty('opacity', '0.9', 'important');
        }
      };
      ckBtn.onmouseleave = () => {
        ckBtn.style.setProperty('background', v.button_color || '#000', 'important');
        ckBtn.style.setProperty('opacity', '1', 'important');
      };
    }
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
    const accentColor = v.accent_color || '#f6f6f7';
    const accentTextColor = contrastText(accentColor);

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
      const annHeightPy = v.announcement_height === 'compact' ? '6px' : v.announcement_height === 'tall' ? '16px' : '10px';
      const annAlign = v.announcement_alignment || 'center';
      const isBlocks = v.announcement_timer_style === 'blocks';
      const inlineTimerHtml = _timerSeconds > 0 && !isBlocks ? `<span style="font-weight:600">${formatTimer(_timerSeconds)}</span>` : '';
      const annText = (v.announcement_text || '').replace('{{timer}}', inlineTimerHtml);
      const blocksHtml = _timerSeconds > 0 && isBlocks ? `<div id="cf-timer-blocks" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px;"></div>` : '';

      const annHtml = `
        <div style="padding:${annHeightPy} 16px;background:${v.announcement_bg_color||'#f2f2f2'};border-bottom:1px solid ${v.announcement_border_color||'#efefef'};color:${v.announcement_text_color||'#333'};font-size:${v.announcement_font_size||14}px;text-align:${annAlign};flex-shrink:0;">
          <div>${annText}</div>
          ${blocksHtml}
        </div>
      `;
      const target = v.announcement_position === 'after' ? annAfter : annBefore;
      if (target) {
        target.innerHTML = annHtml;
        if (_timerSeconds > 0 && isBlocks) {
          const blockEl = document.getElementById('cf-timer-blocks');
          if (blockEl) renderTimerBlocks(blockEl, v);
        }
      }
    }

    // ── Rewards ──
    const rwEl = document.getElementById('cf-rewards');
    const tiers = config.rewards || [];
    const showOnEmpty = v.rewards_show_on_empty !== false;
    let rewardDiscount = 0;
    let activeRewardLabels = [];

    if (rwEl) {
      rwEl.innerHTML = '';
      if (v.rewards_enabled && tiers.length > 0 && (count > 0 || showOnEmpty)) {
        const isQty = (v.rewards_calculation || 'cart_total') === 'quantity';
        const totalQty = count;
        const totalValue = cart.total_price / 100;
        const simValue = isQty ? totalQty : totalValue;
        const sorted = [...tiers].sort((a,b) => a.minimum_value - b.minimum_value);
        const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
        const rawSubtotal = rawSubtotalCents / 100;
        const cheapestPrice = items.length > 0 ? Math.min(...items.map(i => i.price)) / 100 : 0;

        // Calculate unlocked tiers and discounts
        const unlockedTiers = sorted.filter(t => simValue >= t.minimum_value);
        const byType = new Map();
        for (const tier of unlockedTiers) {
          const amount = getRewardDiscountAmount(tier, rawSubtotal, cheapestPrice);
          const label = tier.reward_description || tier.reward_type;
          const existing = byType.get(tier.reward_type);
          if (!existing || amount > existing.amount) byType.set(tier.reward_type, { amount, label });
        }
        byType.forEach(({ amount, label }) => { rewardDiscount += amount; activeRewardLabels.push(label); });

        const cidx = sorted.findIndex(t => simValue < t.minimum_value);
        const nextT = cidx >= 0 ? sorted[cidx] : null;
        const rem = nextT ? (isQty ? `${nextT.minimum_value - simValue}` : `$${(nextT.minimum_value - simValue).toFixed(0)}`) : null;
        const rawText = nextT
          ? (nextT.title_before || `Add {remaining} more to unlock ${nextT.reward_description||'the next reward'}`)
              .replace('{remaining}', String(rem)).replace('{{count}}', String(totalQty))
          : (v.rewards_complete_text || 'All rewards unlocked! 🎉').replace('{{count}}', String(totalQty));
        const statusText = rawText; // Preserve HTML formatting (bold, italic, etc.)

        let barHtml = '<div style="display:flex;align-items:center;gap:0">';
        let labelsHtml = '<div style="display:flex;align-items:flex-start;gap:0;margin-top:-2px">';
        sorted.forEach((tier, idx) => {
          const segStart = idx === 0 ? 0 : sorted[idx-1].minimum_value;
          const segEnd = tier.minimum_value;
          const segRange = segEnd - segStart;
          const lp = segRange > 0 ? Math.min(Math.max((simValue-segStart)/segRange,0),1)*100 : (simValue>=segEnd?100:0);
          const reached = simValue >= tier.minimum_value;
          const iconKey = tier.icon || 'gift';
          const iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.gift;

          barHtml += `<div style="flex:1;border-radius:9999px;overflow:hidden;height:${v.rewards_bar_height||8}px;background:${v.rewards_bar_bg_color||'#efefef'}">`;
          barHtml += `<div style="height:100%;border-radius:9999px;background:${v.rewards_bar_fg_color||'#303030'};transition:width 0.4s;width:${lp}%"></div></div>`;
          const circleSize = reached ? 28 : 20;
          barHtml += `<div style="flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 2px;transition:all 0.3s;width:${circleSize}px;height:${circleSize}px;background:${reached?v.rewards_bar_fg_color||'#303030':v.rewards_bar_bg_color||'#efefef'};color:${reached?v.rewards_complete_icon_color||'#fff':v.rewards_incomplete_icon_color||'#4D4949'}">`;
          barHtml += reached ? iconSvg : `<span style="display:block;width:8px;height:8px;border-radius:50%;background:${v.rewards_incomplete_icon_color||'#4D4949'};opacity:0.4"></span>`;
          barHtml += '</div>';

          labelsHtml += '<div style="flex:1"></div>';
          labelsHtml += `<div style="flex-shrink:0;margin:0 4px;text-align:center;white-space:nowrap"><span style="font-size:9px;opacity:0.7;line-height:1.2;font-weight:500">${tier.reward_description || tier.reward_type || ''}</span></div>`;
        });
        barHtml += '</div>';
        labelsHtml += '</div>';

        rwEl.innerHTML = `
          <div style="padding:10px 16px;border-bottom:1px solid rgba(0,0,0,0.08);overflow:hidden;">
            <div style="text-align:center;margin-bottom:6px;line-height:1.5;font-size:${v.rewards_font_size||14}px;min-height:40px;display:flex;align-items:center;justify-content:center">
              <span>${statusText}</span>
            </div>
            ${barHtml}${labelsHtml}
          </div>
        `;
      }
    }

    // ── Items ──
    const itemsEl = document.getElementById('cf-items');
    if (itemsEl) {
      if (items.length === 0) {
        itemsEl.innerHTML = '<div class="cf-empty"><div class="cf-empty-icon">🛒</div><p>Your cart is empty</p></div>';
      } else {
        const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
        const rawSubtotalDollars = rawSubtotalCents / 100;

        itemsEl.innerHTML = items.map((item, idx) => {
          const lineTotal = item.price * item.quantity;
          const lineTotalDollars = lineTotal / 100;
          const lineCompare = (item.original_price || item.price) * item.quantity;
          const lineCompareDollars = lineCompare / 100;
          const itemShare = rawSubtotalDollars > 0 ? lineTotalDollars / rawSubtotalDollars : 0;
          const itemRewardDiscount = rewardDiscount * itemShare;
          const discountedTotal = Math.max(0, lineTotalDollars - itemRewardDiscount);
          const totalSavingsItem = lineCompareDollars - discountedTotal;

          const hasDis = lineCompareDollars > discountedTotal;

          // FIX #1: Use product_title (without variant) instead of title
          const productTitle = item.product_title || item.title;

          // FIX #2: Build variant label with option names (Color: Black / Size: L)
          let variantLabel = '';
          if (item.options_with_values && item.options_with_values.length > 0) {
            const meaningful = item.options_with_values.filter(o => o.value !== 'Default Title');
            if (meaningful.length > 0) {
              variantLabel = meaningful.map(o => `${o.name}: ${o.value}`).join(' / ');
            }
          } else if (item.variant_title && item.variant_title !== 'Default Title') {
            variantLabel = item.variant_title;
          }

          const borderBottom = idx < items.length - 1 ? 'border-bottom:1px solid rgba(0,0,0,0.08);' : '';

          return `
  <div style="display:flex;gap:12px;padding:16px;${borderBottom}">
    <div style="flex-shrink:0;width:80px;height:80px;border-radius:8px;overflow:hidden;background:#f5f5f5">
      <img src="${item.image || item.featured_image?.url || '/placeholder.svg'}" alt="${productTitle}" style="width:100%;height:100%;object-fit:cover;display:block" />
    </div>
    <div style="flex:1;min-width:0">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <p style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin:0">${productTitle}</p>
        <button onclick="cfQty('${item.key}',0)" style="flex-shrink:0;padding:2px;opacity:0.4;background:none;border:none;cursor:pointer;color:inherit;transition:opacity 0.15s" onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='0.4'">
          ${SVG_ICONS.trash}
        </button>
      </div>

      ${variantLabel ? `<p style="font-size:12px;opacity:0.6;margin:4px 0 0 0">${variantLabel}</p>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px">

        <div style="display:flex;align-items:center;border:1px solid rgba(0,0,0,0.2);border-radius:6px;overflow:hidden;height:28px">
          <button onclick="cfQty('${item.key}',${item.quantity-1})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:inherit;padding:0">
            ${SVG_ICONS.minus}
          </button>
          <span style="font-size:13px;min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-left:1px solid rgba(0,0,0,0.2);border-right:1px solid rgba(0,0,0,0.2);padding:0 4px">
            ${item.quantity}
          </span>
          <button onclick="cfQty('${item.key}',${item.quantity+1})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:inherit;padding:0">
            ${SVG_ICONS.plus}
          </button>
        </div>

        <div style="display:flex;flex-direction:column;align-items:flex-end">
          ${v.show_strikethrough && hasDis ? `<span style="font-size:12px;opacity:0.5;text-decoration:line-through">${formatPriceDollars(lineCompareDollars)}</span>` : ''}
          <span style="font-size:16px;font-weight:700">${formatPriceDollars(discountedTotal)}</span>
          ${totalSavingsItem > 0 ? `<span style="font-size:13px;font-weight:600;color:${v.savings_color||'#22c55e'}">Save ${formatPriceDollars(totalSavingsItem)}</span>` : ''}
        </div>

      </div>
    </div>
  </div>
`;
        }).join('');
      }
    }

    // ── Upsells ──
    const upsells = config.upsells || [];
    const topEl = document.getElementById('cf-upsells-top');
    const btmEl = document.getElementById('cf-upsells-bottom');
    if (topEl) topEl.innerHTML = '';
    if (btmEl) btmEl.innerHTML = '';
    if (v.upsells_enabled && upsells.length > 0) {
      const titleFontSize = v.upsells_title_font_size || 14;
      const titleColor = v.upsells_title_color || undefined;
      const upsellBg = accentColor;
      const upsellText = accentTextColor;
      const isStack = (v.upsells_direction || 'stack') !== 'inline';

      const html = `
        <div style="padding:12px 16px 12px 16px;border-top:1px solid rgba(0,0,0,0.08);margin-top:16px">
          <p style="font-size:${titleFontSize}px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:center;opacity:0.6;margin:0 0 12px 0;${titleColor?'color:'+titleColor+';':''}">${v.upsells_title||'RECOMMENDED FOR YOU'}</p>
          <div style="display:flex;${isStack?'flex-direction:column;gap:12px':'gap:8px;overflow-x:auto'}">
            ${upsells.map(p => {
              const hasCompare = v.upsells_show_strikethrough && p.compare_price && p.compare_price > (p.price||0);
              return `
                <div style="display:flex;align-items:flex-start;gap:12px;border-radius:8px;background:${upsellBg};color:${upsellText};padding:12px">
                  ${p.image_url ? `<div style="width:80px;height:80px;border-radius:8px;overflow:hidden;flex-shrink:0"><img src="${p.image_url}" alt="${p.title}" style="width:100%;height:100%;object-fit:cover;display:block" /></div>` : `<div style="width:80px;height:80px;border-radius:8px;flex-shrink:0;background:rgba(255,255,255,0.2)"></div>`}
                  <div style="flex:1;min-width:0">
                    <p style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${p.title}</p>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                      ${hasCompare ? `<span style="font-size:12px;text-decoration:line-through;opacity:0.5">${formatPriceDollars(p.compare_price)}</span>` : ''}
                      <span style="font-size:12px;font-weight:600">${formatPriceDollars(p.price||0)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
                      <select style="font-size:11px;height:28px;padding:0 6px;border-radius:4px;border:1px solid rgba(0,0,0,0.25);background:${v.bg_color||'#fff'};color:${v.text_color||'#000'};flex:1;min-width:0"><option>Default</option></select>
                      <button onclick="cfAddUpsell('${p.sku||''}','${(p.title||'').replace(/'/g,"\\'")}',${p.price||0})" style="font-size:13px;height:32px;padding:0 32px;flex-shrink:0;font-weight:600;border:none;cursor:pointer;background:${v.button_color||'#000'};color:${v.button_text_color||'#fff'};border-radius:${v.button_radius||0}px;opacity:0.85">${v.upsells_button_text||'+Add'}</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      const target = (v.upsells_position||'bottom') === 'top' ? topEl : btmEl;
      if (target) target.innerHTML = html;
    }

    // ── Add-ons ──
    const addonEl = document.getElementById('cf-addon-section');
    if (addonEl) {
      addonEl.innerHTML = '';
      let addonHtml = '';
      if (v.shipping_protection_enabled) {
        const spIcon = v.sp_icon || '';
        const spTitle = v.sp_title || 'Shipping Protection';
        const spDesc = v.sp_description || 'Coverage against loss, damage, or theft.';
        const spPrice = Number(v.sp_price || 4.99);
        const spPriceText = v.sp_price_type === 'percentage' ? `${spPrice}%` : formatPriceDollars(spPrice);
        addonHtml += `
          <div style="padding:12px 16px 0 16px">
            <div id="cf-addon-sp" onclick="window.cfToggleAddon('sp')" style="border-radius:8px;padding:10px;cursor:pointer;user-select:none;transition:all 0.2s;border:1.5px solid ${_spActive?'#059669':'rgba(0,0,0,0.10)'};background:${_spActive?'rgba(5,150,105,0.04)':'transparent'}">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${_spActive?'background:#059669;border:none':'background:transparent;border:1.5px solid rgba(0,0,0,0.2)'}">
                    ${_spActive ? SVG_ICONS.check : ''}
                  </div>
                  ${spIcon ? `<img src="${spIcon}" alt="SP" style="width:28px;height:28px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'" />` : ''}
                  <div>
                    <p style="font-size:12px;font-weight:600;margin:0">${spTitle}</p>
                    <p style="font-size:12px;opacity:0.6;margin:0">${spDesc}</p>
                  </div>
                </div>
                <span style="font-size:14px;font-weight:600;flex-shrink:0;margin-left:8px">${spPriceText}</span>
              </div>
            </div>
          </div>
        `;
      }
      if (v.gift_wrap_enabled) {
        const gwIcon = v.gw_icon || '';
        const gwTitle = v.gw_title || 'Gift Wrapping';
        const gwDesc = v.gw_description || 'Beautiful gift wrapping for your order.';
        const gwPrice = Number(v.gift_wrap_price || 2.99);
        addonHtml += `
          <div style="padding:8px 16px 0 16px">
            <div id="cf-addon-gw" onclick="window.cfToggleAddon('gw')" style="border-radius:8px;padding:10px;cursor:pointer;user-select:none;transition:all 0.2s;border:1.5px solid ${_gwActive?'#059669':'rgba(0,0,0,0.10)'};background:${_gwActive?'rgba(5,150,105,0.04)':'transparent'}">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${_gwActive?'background:#059669;border:none':'background:transparent;border:1.5px solid rgba(0,0,0,0.2)'}">
                    ${_gwActive ? SVG_ICONS.check : ''}
                  </div>
                  ${gwIcon ? `<img src="${gwIcon}" alt="GW" style="width:28px;height:28px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'" />` : ''}
                  <div>
                    <p style="font-size:12px;font-weight:600;margin:0">${gwTitle}</p>
                    <p style="font-size:12px;opacity:0.6;margin:0">${gwDesc}</p>
                  </div>
                </div>
                <span style="font-size:14px;font-weight:600;flex-shrink:0;margin-left:8px">${formatPriceDollars(gwPrice)}</span>
              </div>
            </div>
          </div>
        `;
      }
      addonEl.innerHTML = addonHtml;
    }

    // ── Footer ──
    const footerEl = document.getElementById('cf-footer');
    if (footerEl) {
      footerEl.style.backgroundColor = accentColor;
      footerEl.style.color = accentTextColor;
    }

    // ── Discounts row ──
    const discRow = document.getElementById('cf-discounts-row');
    const rawSubtotalCents = items.reduce((a,i) => a + i.price * i.quantity, 0);
    const rawSubtotalDollars = rawSubtotalCents / 100;
    const productSavings = items.reduce((a,i) => a + Math.max((i.original_price||i.price) - i.price, 0) * i.quantity, 0) / 100;
    const totalSavings = productSavings + rewardDiscount;

    if (discRow) {
      if (v.show_strikethrough && totalSavings > 0) {
        let badgesHtml = activeRewardLabels.map(label =>
          `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;background:rgba(0,0,0,0.08);color:${v.text_color||'#000'}">${label}</span>`
        ).join('');
        discRow.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="color:${v.savings_color||'#22c55e'};font-weight:500">Discounts</span>
            ${badgesHtml}
          </div>
          <span style="color:${v.savings_color||'#22c55e'};font-weight:600;white-space:nowrap">- ${formatPriceDollars(totalSavings)}</span>
        `;
        discRow.style.display = 'flex';
      } else {
        discRow.style.display = 'none';
      }
    }

    // ── Subtotal ──
    const addonTotal = (_spActive ? Number(v.sp_price || 4.99) : 0) + (_gwActive ? Number(v.gift_wrap_price || 2.99) : 0);
    const subtotal = Math.max(0, rawSubtotalDollars - rewardDiscount) + addonTotal;

    const subRow = document.getElementById('cf-subtotal-row');
    const subEl = document.getElementById('cf-subtotal');
    if (v.show_subtotal_line !== false) {
      if (subRow) {
        subRow.style.display = 'flex';
        if (v.subtotal_text_color) subRow.style.color = v.subtotal_text_color;
      }
      if (subEl) subEl.textContent = formatPriceDollars(subtotal);
    } else {
      if (subRow) subRow.style.display = 'none';
    }

    // ── Trust badges ──
    const badgesTopEl = document.getElementById('cf-badges-top');
    const badgesBtmEl = document.getElementById('cf-badges-bottom');
    if (badgesTopEl) badgesTopEl.innerHTML = '';
    if (badgesBtmEl) badgesBtmEl.innerHTML = '';
    if (v.trust_badges_enabled) {
      const badgeSize = v.trust_badges_image_size ?? 100;
      let badgeHtml = '';
      const PRESET_IMAGES = {
        payment_icons: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/payment-icons-transparent.png',
        returns_warranty: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/free-return-guarantee-transparent.png',
      };
      if (v.trust_badges_image_url) {
        badgeHtml = `<div style="padding:6px 16px"><img src="${v.trust_badges_image_url}" alt="Badges" style="width:${badgeSize}%;max-width:100%;height:auto;object-fit:contain;display:block;margin:0 auto" /></div>`;
      } else if (PRESET_IMAGES[v.trust_badges_preset]) {
        badgeHtml = `<div style="padding:6px 16px"><img src="${PRESET_IMAGES[v.trust_badges_preset]}" alt="Badges" style="width:${badgeSize}%;max-width:100%;height:auto;object-fit:contain;display:block;margin:0 auto" /></div>`;
      } else if (v.trust_badges_preset) {
        const presetLabel = PRESETS[v.trust_badges_preset];
        if (presetLabel) {
          badgeHtml = `<div style="padding:6px 16px"><div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:4px 0;font-size:9px;opacity:0.5">${SVG_ICONS.shield} ${presetLabel}</div></div>`;
        }
      }
      if (badgeHtml) {
        const tgt = (v.trust_badges_position||'bottom') === 'top' ? badgesTopEl : badgesBtmEl;
        if (tgt) tgt.innerHTML = badgeHtml;
      }
    }

    // ── Continue shopping ──
    const contWrap = document.getElementById('cf-continue-wrap');
    if (contWrap) {
      contWrap.innerHTML = v.show_continue_shopping
        ? `<button onclick="closeCart()" style="width:100%;padding:8px;background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline;opacity:0.5;color:${v.text_color||'#000'};transition:opacity 0.15s" onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='0.5'">Or continue shopping</button>`
        : '';
    }

    // ── Express payments ──
    const expWrap = document.getElementById('cf-express-wrap');
    if (expWrap) {
      expWrap.innerHTML = v.express_payments_enabled
        ? `<div style="display:flex;justify-content:center;gap:8px;padding-top:4px">${['Apple Pay','G Pay','PayPal'].map(m => `<div style="font-size:9px;padding:4px 12px;border-radius:4px;border:1px solid rgba(0,0,0,0.12);opacity:0.4">${m}</div>`).join('')}</div>`
        : '';
    }
  }

  // ── Checkout ── FIX #4: Use config.routing.sku_map directly instead of products.json
  async function buildCheckoutUrl(cartItems, config) {
    const domain = config.routing?.active_store?.domain;
    if (!domain) return null;

    // FIX #4: Use the sku_map from config (populated from sku_maps table) instead of scraping products.json
    const skuMap = config.routing?.sku_map || {};
    if (Object.keys(skuMap).length === 0) {
      console.warn('[CartFlow] No SKU map available for routing');
      return null;
    }

    const lines = [];
    for (const i of cartItems) {
      const vid = skuMap[i.sku];
      if (vid) lines.push(`${vid}:${i.quantity}`);
      else console.warn(`[CartFlow] SKU not in map: ${i.sku}`);
    }

    // FIX #5: Add addon items using sku_map
    const v = config.visual || {};
    if (_spActive && v.sp_sku) {
      const vid = skuMap[v.sp_sku];
      if (vid) lines.push(`${vid}:1`);
      else console.warn(`[CartFlow] SP SKU not in map: ${v.sp_sku}`);
    }
    if (_gwActive && v.gw_sku) {
      const vid = skuMap[v.gw_sku];
      if (vid) lines.push(`${vid}:1`);
      else console.warn(`[CartFlow] GW SKU not in map: ${v.gw_sku}`);
    }

    if (lines.length === 0) return null;

    // Build URL with discount code if available
    let url = `https://${domain}/cart/${lines.join(',')}`;

    // Apply shopify coupon from unlocked reward tiers
    const rewards = config.rewards || [];
    const totalValue = cartItems.reduce((a,i) => a + i.price * i.quantity, 0) / 100;
    const unlockedTiers = rewards.filter(t => totalValue >= t.minimum_value);
    const coupon = unlockedTiers.map(t => t.shopify_coupon).filter(Boolean).pop();
    if (coupon) url += `?discount=${encodeURIComponent(coupon)}`;

    return url;
  }

  // ── Toggle Addon ──
  window.cfToggleAddon = (type) => {
    if (type === 'sp') _spActive = !_spActive;
    if (type === 'gw') _gwActive = !_gwActive;
    fetchShopifyCart().then(cart => {
      if (window._cfConfig) renderCart(cart, window._cfConfig);
    });
  };

  // ── Global Functions ──
  window.cfQty = async (key, qty) => {
    if (qty < 0) return;
    await (window._cfOrigFetch || fetch)('/cart/change.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:key,quantity:qty}) });
    const cart = await fetchShopifyCart();
    if (window._cfConfig) {
      await fetchUpsells(cart);
      renderCart(cart, window._cfConfig);
    }
  };

  window.cfAddUpsell = async (sku, title, price) => {
    if (!sku) return;
    try {
      const res = await (window._cfOrigFetch || fetch)('/cart/add.js', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items:[{id: sku, quantity:1}]}) });
      if (!res.ok) {
        console.warn('[CartFlow] Failed to add upsell:', sku);
        return;
      }
    } catch(e) { console.warn('[CartFlow] Upsell add error:', e); return; }
    const cart = await fetchShopifyCart();
    if (window._cfConfig) {
      await fetchUpsells(cart);
      renderCart(cart, window._cfConfig);
      trackEvent('upsell_added', price, {title, sku});
    }
  };

  window.closeCart = closeCart;

  // ── Intercept ──
  function interceptCart() {
    // Save original fetch before wrapping
    window._cfOrigFetch = window.fetch;

    window.fetch = async (...args) => {
      const url = String(args[0]||'');
      const result = await window._cfOrigFetch.apply(window, args);
      if ((url.includes('/cart/add') || url.includes('/cart/change')) && !url.includes('track-event') && !url.includes('config')) {
        try {
          const clone = await result.clone().json();
          if (clone?.id || clone?.items || clone?.item_count !== undefined) {
            const cart = await fetchShopifyCart();
            if (_cartReady && window._cfConfig) {
              await fetchUpsells(cart);
              renderCart(cart, window._cfConfig);
              if (url.includes('/cart/add')) openCart();
            } else if (url.includes('/cart/add')) {
              _pendingOpen = true;
            }
          }
        } catch(e){}
      }
      return result;
    };

    document.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id==='cf-close'||t.closest('#cf-close')||t.id==='cf-overlay') { closeCart(); return; }
      if (t.id==='cf-checkout'||t.closest('#cf-checkout')) {
        e.preventDefault();
        const btn = document.getElementById('cf-checkout');
        if(!btn||btn.disabled)return; btn.disabled=true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = 'Redirecting...';
        try { const cart=await fetchShopifyCart(); const url=await buildCheckoutUrl(cart.items,window._cfConfig); trackEvent('checkout',cart.total_price/100); window.location.href=url||'/checkout'; }
        catch(e){ btn.disabled=false; btn.innerHTML=origHtml; }
        return;
      }
      const triggers=['[href="/cart"]','.cart-icon-bubble','[data-cart-toggle]','.header__icon--cart','[aria-label="Cart"]','[aria-label="Open cart"]','.cart-count-bubble','#cart-icon-bubble'];
      if (triggers.some(sel => t.matches?.(sel)||t.closest?.(sel))) {
        e.preventDefault(); e.stopPropagation();
        const cart=await fetchShopifyCart();
        if(window._cfConfig) {
          await fetchUpsells(cart);
          renderCart(cart, window._cfConfig);
        }
        openCart();
      }
    }, true);
  }

  // ── Init ──
  try {
    // Fetch initial cart to get SKUs for upsells
    const initialCart = await fetchShopifyCart();
    const initialSkus = (initialCart.items || []).map(i => i.sku).filter(Boolean).join(',');

    const config = await getConfig(initialSkus);
    if (!config) { console.warn('[CartFlow] Config not found'); return; }
    window._cfConfig = config;
    injectStyles(config.visual||{});
    injectHTML(config.visual||{});
    interceptCart();

    if (config.visual?.announcement_timer) startTimer(config.visual.announcement_timer);

    // Render initial cart state
    renderCart(initialCart, config);

    onCartReady();

    trackEvent('cart_impression');
    console.log('[CartFlow] ✓ Loaded');
    console.log('[CartFlow] Store:', config.routing?.active_store?.name||'none');
    console.log('[CartFlow] SKU map entries:', Object.keys(config.routing?.sku_map || {}).length);
  } catch(err) { console.error('[CartFlow] Init error:', err); }

})();
