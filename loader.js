(async () => {

  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';

  if (!TOKEN) { console.warn('[CartFlow] Missing data-token'); return; }

  /* ── State ── */
  let _cfConfig = null;
  let _cartReady = false;
  let _pendingOpen = false;
  let _spAdded = false;
  let _gwAdded = false;

  /* ── Helpers ── */
  const fmt = (v, currency = 'USD') => {
    const n = typeof v === 'string' ? parseFloat(v) : (v || 0);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
  };
  const fmtDecimal = (v, currency = 'USD') => {
    const n = typeof v === 'number' ? v : parseFloat(v || '0');
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  };

  /* ── Fetch config (with SKUs for upsells) ── */
  async function getConfig(skus = '') {
    const sep = '?';
    let u = `${API_URL}?token=${TOKEN}`;
    if (skus) u += `&skus=${encodeURIComponent(skus)}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Config ${r.status}`);
    return r.json();
  }

  /* ── Fetch Shopify cart ── */
  async function fetchShopifyCart() {
    const r = await fetch('/cart.js', { credentials: 'same-origin' });
    return r.json();
  }

  /* ── Track ── */
  function trackEvent(type, meta = {}) {
    const storeId = _cfConfig?.store?.id;
    if (!storeId) return;
    fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, event_type: type, metadata: meta }),
    }).catch(() => {});
  }

  /* ── Timer ── */
  let _timerInterval = null;
  function startTimer(isoEnd) {
    if (_timerInterval) clearInterval(_timerInterval);
    const end = new Date(isoEnd).getTime();
    function tick() {
      const diff = Math.max(0, end - Date.now());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const v = _cfConfig?.visual || {};
      const labels = (v.announcement_timer_labels || 'DAYS,HRS,MIN,SEC').split(',');
      const style = v.announcement_timer_style || 'inline';
      const el = document.getElementById('cf-timer');
      if (!el) return;
      if (style === 'blocks') {
        const bg = v.announcement_timer_block_bg || '#000';
        const tc = v.announcement_timer_text_color || '#fff';
        el.innerHTML = [[d, labels[0]], [h, labels[1]], [m, labels[2]], [s, labels[3]]]
          .map(([val, lbl]) => `<span style="display:inline-flex;flex-direction:column;align-items:center;margin:0 3px;background:${bg};color:${tc};border-radius:4px;padding:4px 7px;min-width:36px;font-size:13px;font-weight:700;line-height:1.2"><span>${String(val).padStart(2,'0')}</span><span style="font-size:8px;font-weight:400;opacity:.75;margin-top:1px">${lbl}</span></span>`).join('');
      } else {
        el.textContent = `${String(d).padStart(2,'0')}:${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }
      if (diff <= 0) clearInterval(_timerInterval);
    }
    tick();
    _timerInterval = setInterval(tick, 1000);
  }

  /* ── Build checkout URL (uses sku_map from config, filtered by active store) ── */
  async function buildCheckoutUrl(cartItems, config) {
    const domain = config.routing?.active_store?.domain;
    if (!domain) return null;
    const skuMap = config.routing?.sku_map || {};
    if (Object.keys(skuMap).length === 0) return null;

    const lines = [];
    for (const item of cartItems) {
      const vid = skuMap[item.sku];
      if (vid) {
        lines.push(`${vid}:${item.quantity}`);
      } else {
        console.warn(`[CartFlow] No SKU map for: ${item.sku}`);
      }
    }

    // Add-ons
    const v = config.visual || {};
    if (_spAdded && v.sp_sku) {
      const spVid = skuMap[v.sp_sku];
      if (spVid) lines.push(`${spVid}:1`);
    }
    if (_gwAdded && v.gw_sku) {
      const gwVid = skuMap[v.gw_sku];
      if (gwVid) lines.push(`${gwVid}:1`);
    }

    if (lines.length === 0) return null;

    let url = `https://${domain}/cart/${lines.join(',')}`;

    // Coupon from rewards
    const rewards = config.rewards || [];
    const cart = await fetchShopifyCart();
    const cartTotal = cart.total_price / 100;
    const calcMode = v.rewards_calculation || 'cart_total';
    const calcValue = calcMode === 'item_count' ? cart.item_count : cartTotal;

    const unlockedRewards = rewards.filter(r => calcValue >= Number(r.minimum_value || 0));
    const lastUnlocked = unlockedRewards[unlockedRewards.length - 1];
    if (lastUnlocked?.shopify_coupon) {
      url += `?discount=${encodeURIComponent(lastUnlocked.shopify_coupon)}`;
    }

    return url;
  }

  /* ── Inject styles ── */
  function injectStyles(v) {
    let existing = document.getElementById('cf-injected-styles');
    if (existing) existing.remove();

    const btnColor = v.button_color || '#000';
    const btnHover = v.button_hover_color || '';
    const hoverBg = btnHover && btnHover !== btnColor ? btnHover : '';

    const style = document.createElement('style');
    style.id = 'cf-injected-styles';
    style.textContent = `
      #cf-drawer, #cf-drawer * { box-sizing: border-box !important; }
      #cf-checkout {
        all: unset !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        width: 100% !important;
        height: 46px !important;
        border: none !important;
        outline: none !important;
        cursor: pointer !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        border-radius: ${v.button_radius ?? 0}px !important;
        background-color: ${btnColor} !important;
        color: ${v.button_text_color || '#fff'} !important;
        transition: background-color 0.15s ease, opacity 0.15s ease !important;
        appearance: none !important;
        -webkit-appearance: none !important;
        background-image: none !important;
      }
      #cf-checkout:hover {
        background-color: ${hoverBg || btnColor} !important;
        ${hoverBg ? '' : 'opacity: 0.92 !important;'}
        color: ${v.button_text_color || '#fff'} !important;
      }
      #cf-checkout:focus, #cf-checkout:active {
        background-color: ${hoverBg || btnColor} !important;
        color: ${v.button_text_color || '#fff'} !important;
        outline: none !important;
      }
      /* Quantity stepper isolation */
      .cf-qty-btn {
        all: unset !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        max-width: 28px !important;
        min-height: 28px !important;
        max-height: 28px !important;
        border: none !important;
        background: transparent !important;
        cursor: pointer !important;
        font-size: 16px !important;
        font-weight: 400 !important;
        line-height: 1 !important;
        padding: 0 !important;
        margin: 0 !important;
        color: ${v.text_color || '#000'} !important;
        flex-shrink: 0 !important;
        flex-grow: 0 !important;
      }
      .cf-qty-btn:hover { opacity: 0.7 !important; }
      .cf-qty-val {
        all: unset !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 24px !important;
        min-width: 24px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        text-align: center !important;
        color: ${v.text_color || '#000'} !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      /* Upsell add button */
      .cf-upsell-add {
        all: unset !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        padding: 6px 14px !important;
        border-radius: ${v.button_radius ?? 0}px !important;
        background-color: ${btnColor} !important;
        color: ${v.button_text_color || '#fff'} !important;
        border: none !important;
        white-space: nowrap !important;
        transition: opacity 0.15s ease !important;
      }
      .cf-upsell-add:hover { opacity: 0.85 !important; }
    `;
    document.head.appendChild(style);
  }

  /* ── Render cart ── */
  function renderCart(cart, config) {
    const v = config.visual || {};
    const rewards = config.rewards || [];
    const items = cart.items || [];
    const currency = cart.currency || 'USD';

    injectStyles(v);

    const calcMode = v.rewards_calculation || 'cart_total';
    const cartTotalCents = cart.total_price || 0;
    const cartTotal = cartTotalCents / 100;
    const calcValue = calcMode === 'item_count' ? cart.item_count : cartTotal;

    /* ── Rewards bar ── */
    let rewardsHtml = '';
    if (v.rewards_enabled && rewards.length > 0) {
      const showOnEmpty = v.rewards_show_on_empty !== false;
      if (items.length > 0 || showOnEmpty) {
        const sorted = [...rewards].sort((a, b) => a.tier_order - b.tier_order);
        const allUnlocked = sorted.every(r => calcValue >= Number(r.minimum_value || 0));
        const nextTier = sorted.find(r => calcValue < Number(r.minimum_value || 0));

        let statusText = '';
        if (allUnlocked) {
          statusText = v.rewards_complete_text || '🎉 All rewards unlocked!';
        } else if (nextTier) {
          const rawBefore = nextTier.title_before || '';
          if (rawBefore) {
            const remaining = Number(nextTier.minimum_value || 0) - calcValue;
            const formatted = calcMode === 'item_count'
              ? String(Math.ceil(remaining))
              : fmtDecimal(remaining, currency);
            statusText = rawBefore.replace('{{remaining}}', `<b>${formatted}</b>`);
          } else {
            const remaining = Number(nextTier.minimum_value || 0) - calcValue;
            const formatted = calcMode === 'item_count'
              ? String(Math.ceil(remaining))
              : fmtDecimal(remaining, currency);
            statusText = `Add <b>${formatted}</b> more to unlock <b>${nextTier.reward_description || 'reward'}</b>`;
          }
        }

        // Progress bar
        const maxVal = sorted[sorted.length - 1]?.minimum_value || 1;
        const pct = Math.min(100, (calcValue / Number(maxVal)) * 100);
        const barBg = v.rewards_bar_bg_color || '#efefef';
        const barFg = v.rewards_bar_fg_color || '#303030';
        const barH = v.rewards_bar_height || 8;
        const fontSize = v.rewards_font_size || 13;

        // Icons
        const completeColor = v.rewards_complete_icon_color || '#fff';
        const incompleteColor = v.rewards_incomplete_icon_color || '#4D4949';
        const iconsHtml = sorted.map((r, i) => {
          const unlocked = calcValue >= Number(r.minimum_value || 0);
          const leftPct = Math.min(100, (Number(r.minimum_value || 0) / Number(maxVal)) * 100);
          return `<div style="position:absolute;left:${leftPct}%;top:50%;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;background:${unlocked ? barFg : barBg};border:2px solid ${unlocked ? barFg : '#ccc'};z-index:2;transition:all .3s ease">
            <span style="color:${unlocked ? completeColor : incompleteColor};font-size:12px">${r.icon || '🎁'}</span>
          </div>`;
        }).join('');

        rewardsHtml = `<div style="padding:12px 16px">
          <div style="text-align:center;margin-bottom:10px;font-size:${fontSize}px;color:${v.text_color||'#000'};line-height:1.4">${statusText}</div>
          <div style="position:relative;height:${barH}px;margin:14px 0 6px">
            <div style="position:absolute;inset:0;background:${barBg};border-radius:${barH}px"></div>
            <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${barFg};border-radius:${barH}px;transition:width .4s ease"></div>
            ${iconsHtml}
          </div>
        </div>`;
      }
    }

    /* ── Announcement bar ── */
    let announcementHtml = '';
    if (v.announcement_enabled && v.announcement_text) {
      const pos = v.announcement_position || 'before';
      const align = v.announcement_alignment || 'center';
      const bgC = v.announcement_bg_color || '#f2f2f2';
      const txC = v.announcement_text_color || '#333';
      const bdC = v.announcement_border_color || '#efefef';
      const fs = v.announcement_font_size || 14;
      const hMap = { compact: '36px', normal: '44px', relaxed: '52px' };
      const h = hMap[v.announcement_height] || '44px';

      let timerHtml = '';
      if (v.announcement_timer) {
        timerHtml = `<span id="cf-timer" style="margin-left:6px;font-weight:700"></span>`;
      }

      announcementHtml = `<div id="cf-announcement-${pos}" style="display:flex;align-items:center;justify-content:${align};min-height:${h};padding:0 16px;background:${bgC};color:${txC};font-size:${fs}px;border-bottom:1px solid ${bdC}">
        <span>${v.announcement_text}</span>${timerHtml}
      </div>`;
    }

    /* ── Header ── */
    const hdrBg = v.header_bg_color || '#fff';
    const hdrAlign = v.header_alignment || 'side';
    const hdrJustify = hdrAlign === 'center' ? 'center' : 'space-between';
    const hdrBorder = v.header_border || 'thin';
    const hdrBorderColor = v.header_border_color || '#e5e7eb';
    const hdrBorderWidth = hdrBorder === 'none' ? '0' : hdrBorder === 'thick' ? '2px' : '1px';
    const hdrH = { slim: '52px', default: '60px', tall: '72px' }[v.header_height] || '60px';
    const hdrFontSize = v.header_font_size || 18;
    const hdrFontWeight = { normal: '400', medium: '500', semibold: '600', bold: '700' }[v.header_font_weight] || '600';
    const hdrTextColor = v.header_text_color_override || v.text_color || '#000';

    let titleHtml = '';
    const titleType = v.header_title_type || 'inherit';
    if (titleType === 'logo' && v.header_logo_url) {
      const logoSize = v.header_logo_size || 100;
      titleHtml = `<img src="${v.header_logo_url}" style="height:${logoSize}px;object-fit:contain" alt="Logo"/>`;
    } else {
      const raw = v.header_title_text || 'Cart • {{cart_quantity}}';
      const titleText = raw.replace('{{cart_quantity}}', String(cart.item_count || 0));
      const tag = v.header_heading_level || 'h3';
      titleHtml = `<${tag} style="margin:0;font-size:${hdrFontSize}px;font-weight:${hdrFontWeight};color:${hdrTextColor}">${titleText}</${tag}>`;
    }

    // Close button
    const closeSide = v.close_button_position || 'right';
    const iconSizeMap = { small: '18', medium: '22', large: '26' };
    const iconSz = iconSizeMap[v.close_icon_size] || '18';
    const iconColor = v.close_icon_color || '#000';
    const iconHoverColor = v.close_icon_hover_color || '#666';
    const closeBg = v.close_bg_color || 'transparent';
    const closeHoverBg = v.close_bg_hover_color || '#f3f4f6';
    const strokeW = v.close_icon_thickness === 'bold' ? '2.5' : v.close_icon_thickness === 'light' ? '1.5' : '2';

    const closeBtnHtml = `<button onclick="document.getElementById('cf-drawer').style.transform='translateX(100%)';document.getElementById('cf-overlay').style.opacity='0';setTimeout(()=>{document.getElementById('cf-overlay').style.display='none'},300)" style="all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:${closeBg};transition:background .15s" onmouseenter="this.style.background='${closeHoverBg}';this.querySelector('svg').style.stroke='${iconHoverColor}'" onmouseleave="this.style.background='${closeBg}';this.querySelector('svg').style.stroke='${iconColor}'">
      <svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="${strokeW}" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;

    const headerHtml = `<div style="display:flex;align-items:center;justify-content:${hdrJustify};padding:0 16px;min-height:${hdrH};background:${hdrBg};border-bottom:${hdrBorderWidth} solid ${hdrBorderColor}">
      ${closeSide === 'left' ? closeBtnHtml : ''}
      <div style="flex:1;display:flex;justify-content:${hdrAlign === 'center' ? 'center' : 'flex-start'}">${titleHtml}</div>
      ${closeSide === 'right' ? closeBtnHtml : ''}
    </div>`;

    /* ── Items ── */
    let itemsHtml = '';
    if (items.length === 0) {
      itemsHtml = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:${v.text_color||'#000'};opacity:.6">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <p style="margin-top:16px;font-size:15px">Your cart is empty</p>
        ${v.show_continue_shopping ? '<button onclick="document.getElementById(\'cf-drawer\').style.transform=\'translateX(100%)\';document.getElementById(\'cf-overlay\').style.opacity=\'0\';setTimeout(()=>{document.getElementById(\'cf-overlay\').style.display=\'none\'},300)" style="all:unset;cursor:pointer;margin-top:12px;font-size:13px;text-decoration:underline">Continue shopping</button>' : ''}
      </div>`;
    } else {
      itemsHtml = items.map(item => {
        const productTitle = item.product_title || item.title;
        let variantLabel = '';
        if (item.options_with_values && item.options_with_values.length > 0) {
          variantLabel = item.options_with_values
            .filter(o => o.value && o.value !== 'Default Title')
            .map(o => `${o.name}: ${o.value}`)
            .join(' / ');
        } else if (item.variant_title && item.variant_title !== 'Default Title') {
          variantLabel = item.variant_title;
        }
        const linePrice = item.final_line_price || item.line_price || 0;
        const origLinePrice = item.original_line_price || linePrice;
        const hasDiscount = origLinePrice > linePrice;
        const imgSrc = item.featured_image?.url || item.image || '';

        return `<div style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.06)">
          <div style="width:72px;height:72px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#f5f5f5">
            ${imgSrc ? `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;display:block" alt="${productTitle}"/>` : ''}
          </div>
          <div style="flex:1;display:flex;flex-direction:column;min-width:0">
            <p style="margin:0;font-size:13px;font-weight:500;color:${v.text_color||'#000'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${productTitle}</p>
            ${variantLabel ? `<p style="margin:2px 0 0;font-size:11px;color:${v.text_color||'#000'};opacity:.6">${variantLabel}</p>` : ''}
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px">
              <div style="display:inline-flex;align-items:center;border:1px solid rgba(0,0,0,.12);border-radius:6px;height:30px;overflow:hidden">
                <button class="cf-qty-btn" onclick="cfUpdateQty('${item.key}',${item.quantity - 1})">−</button>
                <span class="cf-qty-val">${item.quantity}</span>
                <button class="cf-qty-btn" onclick="cfUpdateQty('${item.key}',${item.quantity + 1})">+</button>
              </div>
              <div style="text-align:right">
                ${hasDiscount && v.show_strikethrough ? `<span style="font-size:11px;text-decoration:line-through;color:${v.text_color||'#000'};opacity:.5;margin-right:4px">${fmt(origLinePrice, currency)}</span>` : ''}
                <span style="font-size:13px;font-weight:600;color:${hasDiscount ? (v.savings_color||'#22c55e') : (v.text_color||'#000')}">${fmt(linePrice, currency)}</span>
              </div>
            </div>
          </div>
          <button onclick="cfRemoveItem('${item.key}')" style="all:unset;cursor:pointer;align-self:flex-start;padding:4px;opacity:.4;transition:opacity .15s" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.4'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
      }).join('');
    }

    /* ── Upsells ── */
    let upsellsHtml = '';
    const upsells = config.upsells || [];
    if (v.upsells_enabled && upsells.length > 0) {
      const uTitle = v.upsells_title || 'RECOMMENDED FOR YOU';
      const uTitleColor = v.upsells_title_color || '#000';
      const uTitleFs = v.upsells_title_font_size || 14;
      const btnText = v.upsells_button_text || '+Add';
      const direction = v.upsells_direction || 'block';
      const isHorizontal = direction === 'inline';

      const upsellItems = upsells.map(up => {
        const hasCompare = up.compare_price && up.compare_price > up.price;
        return `<div style="display:flex;${isHorizontal ? 'flex-direction:column;min-width:140px;max-width:160px' : 'flex-direction:row;align-items:center'};gap:10px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <div style="width:${isHorizontal ? '100%' : '56px'};height:${isHorizontal ? '120px' : '56px'};border-radius:8px;overflow:hidden;flex-shrink:0;background:#f5f5f5">
            ${up.image_url ? `<img src="${up.image_url}" style="width:100%;height:100%;object-fit:cover;display:block"/>` : ''}
          </div>
          <div style="flex:1;min-width:0">
            <p style="margin:0;font-size:12px;font-weight:500;color:${v.text_color||'#000'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${up.title}</p>
            <div style="margin-top:4px;font-size:12px">
              ${hasCompare && v.upsells_show_strikethrough ? `<span style="text-decoration:line-through;opacity:.5;margin-right:4px">${fmtDecimal(up.compare_price, currency)}</span>` : ''}
              <span style="font-weight:600;color:${v.text_color||'#000'}">${fmtDecimal(up.price, currency)}</span>
            </div>
          </div>
          <button class="cf-upsell-add" onclick="cfAddUpsell('${up.variant_id || up.sku}')">${btnText}</button>
        </div>`;
      }).join('');

      upsellsHtml = `<div style="padding:12px 16px;border-top:1px solid rgba(0,0,0,.08)">
        <p style="margin:0 0 8px;font-size:${uTitleFs}px;font-weight:600;color:${uTitleColor};letter-spacing:.03em">${uTitle}</p>
        <div style="${isHorizontal ? 'display:flex;overflow-x:auto;gap:12px;padding-bottom:4px' : ''}">${upsellItems}</div>
      </div>`;
    }

    /* ── Add-ons (Shipping Protection & Gift Wrap) ── */
    let addonsHtml = '';
    const spEnabled = v.shipping_protection_enabled;
    const gwEnabled = v.gift_wrap_enabled;

    if ((spEnabled || gwEnabled) && items.length > 0) {
      let spBlock = '';
      if (spEnabled) {
        const spTitle = v.sp_title || 'Shipping Protection';
        const spDesc = v.sp_description || 'Coverage against loss, damage, or theft.';
        const spIcon = v.sp_icon || '';
        const spPrice = v.sp_price ?? 4.99;
        spBlock = `<div onclick="cfToggleSP()" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid ${_spAdded ? (v.accent_color||'#000') : 'rgba(0,0,0,.1)'};border-radius:8px;margin-bottom:8px;transition:border-color .15s;background:${_spAdded ? 'rgba(0,0,0,.02)' : 'transparent'}">
          ${spIcon ? `<img src="${spIcon}" style="width:36px;height:36px;object-fit:contain;border-radius:6px"/>` : ''}
          <div style="flex:1;min-width:0">
            <p style="margin:0;font-size:13px;font-weight:500;color:${v.text_color||'#000'}">${spTitle}</p>
            <p style="margin:2px 0 0;font-size:11px;color:${v.text_color||'#000'};opacity:.6">${spDesc}</p>
          </div>
          <span style="font-size:13px;font-weight:600;color:${v.text_color||'#000'};white-space:nowrap">${fmtDecimal(spPrice, currency)}</span>
        </div>`;
      }

      let gwBlock = '';
      if (gwEnabled) {
        const gwTitle = v.gw_title || 'Gift Wrapping';
        const gwDesc = v.gw_description || 'Perfect for gifting to someone you care about.';
        const gwIcon = v.gw_icon || '';
        const gwPrice = v.gift_wrap_price ?? 2.99;
        gwBlock = `<div onclick="cfToggleGW()" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid ${_gwAdded ? (v.accent_color||'#000') : 'rgba(0,0,0,.1)'};border-radius:8px;transition:border-color .15s;background:${_gwAdded ? 'rgba(0,0,0,.02)' : 'transparent'}">
          ${gwIcon ? `<img src="${gwIcon}" style="width:36px;height:36px;object-fit:contain;border-radius:6px"/>` : ''}
          <div style="flex:1;min-width:0">
            <p style="margin:0;font-size:13px;font-weight:500;color:${v.text_color||'#000'}">${gwTitle}</p>
            <p style="margin:2px 0 0;font-size:11px;color:${v.text_color||'#000'};opacity:.6">${gwDesc}</p>
          </div>
          <span style="font-size:13px;font-weight:600;color:${v.text_color||'#000'};white-space:nowrap">${fmtDecimal(gwPrice, currency)}</span>
        </div>`;
      }

      addonsHtml = `<div style="padding:12px 16px;border-top:1px solid rgba(0,0,0,.08);margin-top:auto">${spBlock}${gwBlock}</div>`;
    }

    /* ── Trust badges ── */
    let badgesHtml = '';
    if (v.trust_badges_enabled) {
      const tbPos = v.trust_badges_position || 'bottom';
      const imgSize = v.trust_badges_image_size || 100;
      if (v.trust_badges_image_url) {
        badgesHtml = `<div id="cf-badges-${tbPos}" style="padding:8px 16px;text-align:center">
          <img src="${v.trust_badges_image_url}" style="max-width:${imgSize}%;height:auto;object-fit:contain" alt="Trust badges"/>
        </div>`;
      } else if (v.trust_badges_preset) {
        const PRESET_IMAGES = {
          payment_icons: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/payment-icons.png',
          returns_warranty: 'https://pdeontahcfqcvlxjtnka.supabase.co/storage/v1/object/public/trust-badges/free-return-guarantee.png',
        };
        const presetUrl = PRESET_IMAGES[v.trust_badges_preset];
        if (presetUrl) {
          badgesHtml = `<div id="cf-badges-${tbPos}" style="padding:8px 16px;text-align:center">
            <img src="${presetUrl}" style="max-width:${imgSize}%;height:auto;object-fit:contain" alt="Trust badges"/>
          </div>`;
        }
      }
    }

    /* ── Footer (subtotal + checkout) ── */
    let footerHtml = '';
    if (items.length > 0) {
      const subtotalColor = v.subtotal_text_color || '#000';
      const subtotalLine = v.show_subtotal_line ? `<div style="display:flex;justify-content:space-between;padding:12px 16px 0;font-size:14px">
        <span style="color:${subtotalColor}">Subtotal</span>
        <span style="font-weight:600;color:${subtotalColor}">${fmt(cartTotalCents, currency)}</span>
      </div>` : '';

      // Compute total with add-ons
      let displayTotal = cartTotalCents;
      if (_spAdded) displayTotal += (v.sp_price ?? 4.99) * 100;
      if (_gwAdded) displayTotal += (v.gift_wrap_price ?? 2.99) * 100;

      footerHtml = `<div style="border-top:1px solid rgba(0,0,0,.08);padding:0 16px 16px">
        ${subtotalLine}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 12px">
          <span style="font-size:16px;font-weight:600;color:${v.text_color||'#000'}">Total</span>
          <span style="font-size:16px;font-weight:700;color:${v.text_color||'#000'}">${fmt(displayTotal, currency)}</span>
        </div>
        <button id="cf-checkout" onclick="cfCheckout()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Secure Checkout
        </button>
        ${v.show_continue_shopping ? '<div style="text-align:center;padding-top:8px"><button onclick="document.getElementById(\'cf-drawer\').style.transform=\'translateX(100%)\';document.getElementById(\'cf-overlay\').style.opacity=\'0\';setTimeout(()=>{document.getElementById(\'cf-overlay\').style.display=\'none\'},300)" style="all:unset;cursor:pointer;font-size:12px;text-decoration:underline;opacity:.6">Continue shopping</button></div>' : ''}
      </div>`;
    }

    /* ── Upsell position ── */
    const upsellPos = v.upsells_position || 'bottom';
    const badgesPos = v.trust_badges_position || 'bottom';

    /* ── Assemble ── */
    const annBefore = v.announcement_position === 'before' ? announcementHtml : '';
    const annAfter = v.announcement_position !== 'before' ? announcementHtml : '';

    // Desktop width
    const dwMap = { narrow: '360px', default: '420px', wide: '480px' };
    const desktopW = dwMap[v.cart_width_desktop] || '420px';

    const drawer = document.getElementById('cf-drawer') || document.createElement('div');
    drawer.id = 'cf-drawer';
    drawer.style.cssText = `position:fixed;top:0;right:0;width:100%;max-width:${desktopW};height:100%;background:${v.bg_color||'#fff'};z-index:999999;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);box-shadow:-4px 0 24px rgba(0,0,0,.12);${v.inherit_fonts ? '' : 'font-family:system-ui,-apple-system,sans-serif;'}color:${v.text_color||'#000'}`;

    drawer.innerHTML = `
      ${annBefore}
      ${headerHtml}
      ${annAfter}
      ${rewardsHtml}
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column">
        ${itemsHtml}
        ${upsellPos === 'bottom' && badgesPos !== 'bottom' ? badgesHtml : ''}
        ${upsellsHtml}
        ${addonsHtml}
      </div>
      ${badgesPos === 'bottom' ? badgesHtml : ''}
      ${footerHtml}
    `;

    if (!drawer.parentNode) document.body.appendChild(drawer);

    // Overlay
    let overlay = document.getElementById('cf-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cf-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:999998;display:none;opacity:0;transition:opacity .3s';
      overlay.onclick = () => {
        drawer.style.transform = 'translateX(100%)';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
      };
      document.body.appendChild(overlay);
    }

    // Timer
    if (v.announcement_timer) startTimer(v.announcement_timer);
  }

  /* ── Open / close cart ── */
  function openCart() {
    const d = document.getElementById('cf-drawer');
    const o = document.getElementById('cf-overlay');
    if (d && o) {
      o.style.display = 'block';
      requestAnimationFrame(() => {
        o.style.opacity = '1';
        d.style.transform = 'translateX(0)';
      });
    }
  }

  /* ── Global actions ── */
  window.cfUpdateQty = async (key, qty) => {
    if (qty < 1) { window.cfRemoveItem(key); return; }
    await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: qty }),
    });
    const cart = await fetchShopifyCart();
    if (_cfConfig) renderCart(cart, _cfConfig);
  };

  window.cfRemoveItem = async (key) => {
    await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: 0 }),
    });
    const cart = await fetchShopifyCart();
    if (_cfConfig) {
      await refreshUpsells(cart);
      renderCart(cart, _cfConfig);
    }
  };

  window.cfAddUpsell = async (variantId) => {
    await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
    });
    const cart = await fetchShopifyCart();
    if (_cfConfig) {
      await refreshUpsells(cart);
      renderCart(cart, _cfConfig);
    }
    trackEvent('upsell_added', { variant_id: variantId });
  };

  window.cfToggleSP = () => {
    _spAdded = !_spAdded;
    fetchShopifyCart().then(cart => { if (_cfConfig) renderCart(cart, _cfConfig); });
  };

  window.cfToggleGW = () => {
    _gwAdded = !_gwAdded;
    fetchShopifyCart().then(cart => { if (_cfConfig) renderCart(cart, _cfConfig); });
  };

  window.cfCheckout = async () => {
    const cart = await fetchShopifyCart();
    if (!_cfConfig) return;
    const url = await buildCheckoutUrl(cart.items || [], _cfConfig);
    if (url) {
      trackEvent('checkout_redirect', { url });
      window.location.href = url;
    } else {
      window.location.href = '/checkout';
    }
  };

  /* ── Refresh upsells after cart changes ── */
  async function refreshUpsells(cart) {
    const skus = (cart.items || []).map(i => i.sku).filter(Boolean).join(',');
    try {
      const freshConfig = await getConfig(skus);
      _cfConfig.upsells = freshConfig.upsells || [];
    } catch (e) {
      console.warn('[CartFlow] Failed to refresh upsells', e);
    }
  }

  /* ── Intercept fetch for cart changes ── */
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const result = await _origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/cart/add.js') || url.includes('/cart/change.js')) {
        const cart = await fetchShopifyCart();
        if (_cfConfig) {
          await refreshUpsells(cart);
          renderCart(cart, _cfConfig);
          if (url.includes('/cart/add.js')) openCart();
        } else if (url.includes('/cart/add.js')) {
          _pendingOpen = true;
        }
      }
    } catch(e) { console.warn('[CartFlow] Fetch intercept error', e); }
    return result;
  };

  /* ── Cart icon click interceptor ── */
  function onCartReady() {
    const selectors = [
      'a[href="/cart"]',
      '[data-cart-trigger]',
      '.cart-icon-bubble',
      '.site-header__cart',
      '.js-drawer-open-right',
      'button[aria-label="Cart"]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cart = await fetchShopifyCart();
          if (_cfConfig) {
            await refreshUpsells(cart);
            renderCart(cart, _cfConfig);
          }
          openCart();
        }, true);
      });
    }
  }

  /* ── Init ── */
  try {
    const initialCart = await fetchShopifyCart();
    const skus = (initialCart.items || []).map(i => i.sku).filter(Boolean).join(',');
    const config = await getConfig(skus);
    _cfConfig = config;
    window._cfConfig = config;

    renderCart(initialCart, config);
    _cartReady = true;

    if (_pendingOpen) { _pendingOpen = false; openCart(); }

    onCartReady();
    trackEvent('cart_impression');
    console.log('[CartFlow] ✓ Loaded v6');
    console.log('[CartFlow] Store:', config.routing?.active_store?.name || 'none');
    console.log('[CartFlow] Upsells:', (config.upsells || []).length);
    console.log('[CartFlow] SKU map entries:', Object.keys(config.routing?.sku_map || {}).length);
  } catch(err) { console.error('[CartFlow] Init error:', err); }

})();
