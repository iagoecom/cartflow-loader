(async () => {

  const SCRIPT_TAG = document.currentScript;
  const TOKEN = SCRIPT_TAG?.getAttribute('data-token');
  const API_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/config';
  const TRACK_URL = 'https://pdeontahcfqcvlxjtnka.supabase.co/functions/v1/track-event';
  const CACHE_KEY = 'cartflow_config';
  const SKU_CACHE_KEY = 'cartflow_sku_cache';
  const CONFIG_TTL = 5 * 60 * 1000;
const SKU_TTL = 30 * 60 * 1000;

  if (!TOKEN) {
    console.warn('[CartFlow] data-token not found');
    return;
  }

  function formatPrice(cents) {
    const amount = cents / 100;
    const currency = window.Shopify?.currency?.active || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      }).format(amount);
    } catch (e) {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  async function getConfig() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, expiresAt } = JSON.parse(cached);
        if (Date.now() < expiresAt) return data;
      }
    } catch (e) {}

    const res = await fetch(`${API_URL}?token=${TOKEN}`);
    if (!res.ok) return null;

    const data = await res.json();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        expiresAt: Date.now() + CONFIG_TTL
      }));
    } catch (e) {}

    return data;
  }

  async function trackEvent(eventType, amount = 0, metadata = {}) {
    try {
      await fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          event_type: eventType,
          amount,
          metadata
        })
      });
    } catch (e) {}
  }

  async function fetchShopifyCart() {
    const res = await fetch('/cart.js');
    return await res.json();
  }

  // ============================================
  // SKU → VARIANT_ID (com cache 30min por loja)
  // ============================================
  async function getSkuMap(domain) {
    const cacheKey = `${SKU_CACHE_KEY}_${domain}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data, expiresAt } = JSON.parse(cached);
        if (Date.now() < expiresAt) return data;
      }
    } catch (e) {}

    // Buscar todos os produtos da loja white
    const skuMap = {};
    let url = `https://${domain}/products.json?limit=250`;

    try {
      while (url) {
        const res = await fetch(url);
        if (!res.ok) break;
        const data = await res.json();

        for (const product of data.products) {
          for (const variant of product.variants) {
            if (variant.sku) {
              skuMap[variant.sku] = variant.id;
            }
          }
        }

        // Paginação
        const linkHeader = res.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = match ? match[1] : null;
        } else {
          url = null;
        }
      }
    } catch (e) {
      console.warn('[CartFlow] Erro ao buscar SKU map:', e);
    }

    // Salvar cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        data: skuMap,
        expiresAt: Date.now() + SKU_TTL
      }));
    } catch (e) {}

    console.log(`[CartFlow] SKU map carregado: ${Object.keys(skuMap).length} variantes`);
    return skuMap;
  }

  // ============================================
  // STYLES
  // ============================================
  function injectStyles(v) {
    const style = document.createElement('style');
    style.id = 'cartflow-styles';
    style.textContent = `
      #cf-overlay {
        display:none;position:fixed;inset:0;
        background:rgba(0,0,0,0.5);z-index:999998;
      }
      #cf-overlay.open { display:block; }

      #cf-drawer {
        position:fixed;top:0;right:-440px;
        width:420px;max-width:100vw;height:100%;
        background:${v.bg_color || '#FFFFFF'};
        color:${v.text_color || '#000000'};
        z-index:999999;transition:right 0.3s ease;
        display:flex;flex-direction:column;
        box-shadow:-4px 0 24px rgba(0,0,0,0.12);
        font-family:${v.inherit_fonts ? 'inherit' : 'system-ui,sans-serif'};
      }
      #cf-drawer.open { right:0; }

      #cf-header {
        padding:${v.header_height === 'tall' ? '20px' : '14px'} 16px;
        border-bottom:${v.header_border === 'thin' ? '1px solid #e5e7eb' : 'none'};
        background:${v.header_bg_color || '#FFFFFF'};
        display:flex;align-items:center;
        justify-content:space-between;flex-shrink:0;
      }
      #cf-title { font-size:16px;font-weight:600; }
      #cf-close {
        background:none;border:none;font-size:20px;
        cursor:pointer;color:${v.text_color || '#000'};
        padding:4px;line-height:1;
      }

      #cf-announcement {
        padding:${v.announcement_height === 'slim' ? '6px' : v.announcement_height === 'thick' ? '14px' : '10px'} 16px;
        background:${v.announcement_bg_color || '#f2f2f2'};
        border-bottom:1px solid ${v.announcement_border_color || '#efefef'};
        font-size:13px;text-align:center;
        display:none;flex-shrink:0;
      }
      #cf-announcement.show { display:block; }

      #cf-rewards {
        padding:10px 16px;
        border-bottom:1px solid #e5e7eb;
        flex-shrink:0;display:none;
      }
      #cf-rewards.show { display:block; }
      .cf-rw-text { font-size:12px;text-align:center;margin-bottom:6px; }
      .cf-rw-bg {
        height:5px;border-radius:3px;
        background:${v.rewards_bar_bg_color || '#efefef'};
        margin-bottom:5px;
      }
      .cf-rw-fill {
        height:5px;border-radius:3px;
        background:${v.rewards_bar_fg_color || '#000'};
        transition:width 0.4s ease;
      }
      .cf-rw-tiers {
        display:flex;justify-content:space-between;
        font-size:10px;color:#999;
      }

      #cf-items { flex:1;overflow-y:auto;padding:12px 16px; }
      .cf-empty { text-align:center;padding:48px 16px;color:#999; }
      .cf-empty-icon { font-size:40px;margin-bottom:12px; }

      .cf-item {
        display:flex;gap:12px;padding-bottom:12px;
        margin-bottom:12px;border-bottom:1px solid #f0f0f0;
      }
      .cf-item:last-child { border:none; }
      .cf-img {
        width:64px;height:64px;border-radius:8px;
        object-fit:cover;background:#f5f5f5;flex-shrink:0;
      }
      .cf-info { flex:1; }
      .cf-name { font-size:13px;font-weight:500;margin-bottom:2px; }
      .cf-variant { font-size:11px;color:#999;margin-bottom:4px; }
      .cf-price { font-size:13px;font-weight:600; }
      .cf-compare {
        font-size:11px;color:#999;
        text-decoration:line-through;margin-right:4px;
      }
      .cf-save { font-size:11px;color:${v.savings_color || '#22c55e'}; }
      .cf-qty { display:flex;align-items:center;gap:8px;margin-top:6px; }
      .cf-qty-btn {
        width:24px;height:24px;border:1px solid #e5e7eb;
        border-radius:4px;background:none;cursor:pointer;
        font-size:15px;display:flex;align-items:center;
        justify-content:center;
      }
      .cf-qty-n { font-size:13px;min-width:20px;text-align:center; }

      #cf-upsells {
        padding:10px 16px;border-top:1px solid #f0f0f0;
        flex-shrink:0;display:none;
      }
      #cf-upsells.show { display:block; }
      .cf-up-title {
        font-size:11px;font-weight:600;letter-spacing:.06em;
        text-align:center;margin-bottom:10px;
      }
      .cf-up-item {
        display:flex;align-items:center;gap:10px;
        padding:8px;border:1px solid #e5e7eb;
        border-radius:8px;margin-bottom:6px;
      }
      .cf-up-img {
        width:40px;height:40px;border-radius:6px;
        object-fit:cover;background:#f5f5f5;flex-shrink:0;
      }
      .cf-up-name { font-size:12px;font-weight:500;flex:1; }
      .cf-up-price { font-size:11px;color:#666;margin-top:2px; }
      .cf-up-btn {
        padding:5px 12px;
        background:${v.button_color || '#000000'};
        color:${v.button_text_color || '#FFFFFF'};
        border:none;border-radius:${v.button_radius || 0}px;
        font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;
      }

      #cf-footer {
        padding:14px 16px;
        border-top:1px solid #e5e7eb;flex-shrink:0;
      }
      .cf-row {
        display:flex;justify-content:space-between;
        font-size:13px;margin-bottom:4px;color:#666;
      }
      .cf-savings-row {
        display:flex;justify-content:space-between;
        font-size:12px;margin-bottom:8px;
        color:${v.savings_color || '#22c55e'};
      }
      #cf-checkout {
        width:100%;padding:14px;
        background:${v.button_color || '#000000'};
        color:${v.button_text_color || '#FFFFFF'};
        border:none;border-radius:${v.button_radius || 0}px;
        font-size:14px;font-weight:700;cursor:pointer;
        letter-spacing:.04em;margin-top:4px;
      }
      #cf-checkout:hover { opacity:.88; }

      #cf-badges { margin-top:10px;text-align:center;display:none; }
      #cf-badges.show { display:block; }
      #cf-badges img { max-width:100%;height:auto; }

      /* Hide native Shopify cart drawer */
      cart-drawer,cart-notification,.cart-drawer,
      .cart-notification,#cart-drawer,#CartDrawer,
      #cart-notification,[id*="cart-drawer"],
      [class*="cart-drawer"],drawer-component[id*="cart"],
      .shopify-section-cart-drawer {
        display:none !important;
        visibility:hidden !important;
        opacity:0 !important;
        pointer-events:none !important;
      }

      @media (max-width: 480px) {
        #cf-drawer { width:100vw; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectHTML(v) {
    const overlay = document.createElement('div');
    overlay.id = 'cf-overlay';
    overlay.innerHTML = `
      <div id="cf-drawer">
        <div id="cf-header">
          <span id="cf-title">Cart • 0</span>
          <button id="cf-close" aria-label="Close cart">✕</button>
        </div>
        <div id="cf-announcement"></div>
        <div id="cf-rewards">
          <div class="cf-rw-text"></div>
          <div class="cf-rw-bg">
            <div class="cf-rw-fill" style="width:0%"></div>
          </div>
          <div class="cf-rw-tiers"></div>
        </div>
        <div id="cf-items"></div>
        <div id="cf-upsells"></div>
        <div id="cf-footer">
          <div class="cf-row">
            <span>Subtotal</span>
            <span id="cf-subtotal">${formatPrice(0)}</span>
          </div>
          <div class="cf-savings-row" id="cf-savings" style="display:none">
            <span>Total savings</span>
            <span id="cf-savings-val"></span>
          </div>
          <button id="cf-checkout">SECURE CHECKOUT</button>
          <div id="cf-badges"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
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

  function renderCart(cart, config) {
    const v = config.visual || {};
    const items = cart.items || [];
    const count = items.reduce((a, i) => a + i.quantity, 0);

    const titleEl = document.getElementById('cf-title');
    if (titleEl) {
      titleEl.textContent = (v.header_title_text || 'Cart • {{cart_quantity}}')
        .replace('{{cart_quantity}}', count);
    }

    const annEl = document.getElementById('cf-announcement');
    if (annEl && v.announcement_enabled && v.announcement_text) {
      annEl.innerHTML = v.announcement_text;
      annEl.classList.add('show');
    }

    const itemsEl = document.getElementById('cf-items');
    if (itemsEl) {
      if (items.length === 0) {
        itemsEl.innerHTML = `
          <div class="cf-empty">
            <div class="cf-empty-icon">🛒</div>
            <div>Your cart is empty</div>
          </div>`;
      } else {
        itemsEl.innerHTML = items.map(item => {
          const price = formatPrice(item.price);
          const hasDiscount = item.original_price && item.original_price > item.price;
          const orig = hasDiscount ? formatPrice(item.original_price) : null;
          const saving = hasDiscount
            ? formatPrice((item.original_price - item.price) * item.quantity)
            : null;

          return `
            <div class="cf-item">
              <img class="cf-img"
                src="${item.image || ''}"
                alt="${item.title}"
                onerror="this.style.background='#f5f5f5'"
              />
              <div class="cf-info">
                <div class="cf-name">${item.title}</div>
                <div class="cf-variant">
                  ${item.variant_title && item.variant_title !== 'Default Title' ? item.variant_title : ''}
                </div>
                <div>
                  ${orig && v.show_strikethrough ? `<span class="cf-compare">${orig}</span>` : ''}
                  <span class="cf-price">${price}</span>
                  ${saving && v.show_strikethrough ? `<span class="cf-save"> Save ${saving}</span>` : ''}
                </div>
                <div class="cf-qty">
                  <button class="cf-qty-btn"
                    onclick="cfQty('${item.key}',${item.quantity - 1})">−</button>
                  <span class="cf-qty-n">${item.quantity}</span>
                  <button class="cf-qty-btn"
                    onclick="cfQty('${item.key}',${item.quantity + 1})">+</button>
                </div>
              </div>
            </div>`;
        }).join('');
      }
    }

    const rewards = config.rewards || [];
    if (rewards.length > 0 && v.rewards_enabled) {
      const rwEl = document.getElementById('cf-rewards');
      if (rwEl) {
        rwEl.classList.add('show');
        const calc = v.rewards_calculation || 'cart_total';
        const value = calc === 'cart_total'
          ? cart.total_price / 100
          : items.reduce((a, i) => a + i.quantity, 0);
        const last = rewards[rewards.length - 1];
        const next = rewards.find(t => t.minimum_value > value);
        const pct = Math.min((value / last.minimum_value) * 100, 100);

        const textEl = rwEl.querySelector('.cf-rw-text');
        const fillEl = rwEl.querySelector('.cf-rw-fill');
        const tiersEl = rwEl.querySelector('.cf-rw-tiers');

        if (textEl) {
          if (next) {
            const rem = (next.minimum_value - value).toFixed(0);
            textEl.textContent = (next.title_before || '').replace('{remaining}', rem);
          } else {
            textEl.textContent = v.rewards_complete_text || 'All benefits unlocked! 🎉';
          }
        }
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (tiersEl) {
          tiersEl.innerHTML = rewards.map(t =>
            `<span>${t.icon || ''} ${t.reward_description}</span>`
          ).join('');
        }
      }
    }

    const upsells = config.upsells || [];
    if (upsells.length > 0 && v.upsells_enabled) {
      const upEl = document.getElementById('cf-upsells');
      if (upEl) {
        upEl.classList.add('show');
        upEl.innerHTML = `
          <div class="cf-up-title">
            ${v.upsells_title || 'RECOMMENDED FOR YOU'}
          </div>
          ${upsells.map(p => `
            <div class="cf-up-item">
              <img class="cf-up-img"
                src="${p.image_url || ''}"
                alt="${p.title}"
                onerror="this.style.display='none'"
              />
              <div>
                <div class="cf-up-name">${p.title}</div>
                <div class="cf-up-price">${formatPrice(p.price * 100)}</div>
              </div>
              <button class="cf-up-btn"
                onclick="cfAddUpsell('${p.shopify_variant_id}','${p.title}',${p.price})">
                ${v.upsells_button_text || '+Add'}
              </button>
            </div>
          `).join('')}
        `;
      }
    }

    const subEl = document.getElementById('cf-subtotal');
    if (subEl) subEl.textContent = formatPrice(cart.total_price);

    const totalOrig = items.reduce((a, i) =>
      a + (i.original_price || i.price) * i.quantity, 0);
    const totalSaved = totalOrig - cart.total_price;
    if (totalSaved > 0) {
      const savRow = document.getElementById('cf-savings');
      const savVal = document.getElementById('cf-savings-val');
      if (savRow) savRow.style.display = 'flex';
      if (savVal) savVal.textContent = `−${formatPrice(totalSaved)}`;
    }

    if (v.trust_badges_enabled && v.trust_badges_image_url) {
      const bdEl = document.getElementById('cf-badges');
      if (bdEl) {
        bdEl.innerHTML = `<img src="${v.trust_badges_image_url}" alt="Trust badges"/>`;
        bdEl.classList.add('show');
      }
    }
  }

  // ============================================
  // ROUTED CHECKOUT — busca variant_id pelo SKU
  // ============================================
  async function buildCheckoutUrl(cartItems, config) {
    const domain = config.routing?.active_store?.domain;
    if (!domain) return null;

    // Buscar SKU map da loja white (com cache)
    const skuMap = await getSkuMap(domain);
    if (!skuMap || Object.keys(skuMap).length === 0) {
      console.warn('[CartFlow] SKU map vazio para:', domain);
      return null;
    }

    const lineItems = cartItems
      .map(item => {
        const sku = item.sku;
        if (!sku) return null;
        const variantId = skuMap[sku];
        if (!variantId) {
          console.warn(`[CartFlow] SKU não encontrado: ${sku}`);
          return null;
        }
        return `${variantId}:${item.quantity}`;
      })
      .filter(Boolean);

    if (lineItems.length === 0) return null;
    return `https://${domain}/cart/${lineItems.join(',')}`;
  }

  window.cfQty = async (key, qty) => {
    if (qty < 0) return;
    await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: qty })
    });
    const cart = await fetchShopifyCart();
    if (window._cfConfig) renderCart(cart, window._cfConfig);
  };

  window.cfAddUpsell = async (variantId, title, price) => {
    await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: 1 })
    });
    const cart = await fetchShopifyCart();
    if (window._cfConfig) {
      renderCart(cart, window._cfConfig);
      trackEvent('upsell_added', price, { title, variantId });
    }
  };

  function interceptCart() {
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0] || '');
      const result = await origFetch.apply(window, args);
      if (url.includes('/cart/add') && !url.includes('track-event')) {
        try {
          const cart = await fetchShopifyCart();
          if (window._cfConfig) {
            renderCart(cart, window._cfConfig);
            openCart();
          }
        } catch (e) {}
      }
      return result;
    };

    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const isCart =
        form.action?.includes('/cart/add') ||
        form.querySelector('[name="add"]');
      if (!isCart) return;
      e.preventDefault();
      const fd = new FormData(form);
      await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fd.get('id'),
          quantity: parseInt(fd.get('quantity') || '1')
        })
      });
    }, true);

    document.addEventListener('click', async (e) => {
      const t = e.target;

      if (t.id === 'cf-close' || t.id === 'cf-overlay') {
        closeCart();
        return;
      }

      if (t.id === 'cf-checkout') {
        e.preventDefault();
        const cart = await fetchShopifyCart();
        const url = await buildCheckoutUrl(cart.items, window._cfConfig);
        trackEvent('checkout', cart.total_price / 100);
        window.location.href = url || '/checkout';
        return;
      }

      const triggers = [
        '[href="/cart"]',
        '.cart-icon-bubble',
        '[data-cart-toggle]',
        '.header__icon--cart',
        '[aria-label="Cart"]',
        '[aria-label="Open cart"]',
        '.cart-count-bubble',
        '#cart-icon-bubble',
      ];
      const isCartIcon = triggers.some(sel =>
        t.matches?.(sel) || t.closest?.(sel)
      );
      if (isCartIcon) {
        e.preventDefault();
        e.stopPropagation();
        const cart = await fetchShopifyCart();
        if (window._cfConfig) renderCart(cart, window._cfConfig);
        openCart();
      }
    }, true);
  }

  try {
    const config = await getConfig();
    if (!config) {
      console.warn('[CartFlow] Config not found for token:', TOKEN);
      return;
    }

    window._cfConfig = config;

    // Pré-carregar SKU map em background
    const domain = config.routing?.active_store?.domain;
    if (domain) {
      getSkuMap(domain).then(map => {
        console.log(`[CartFlow] SKU map pré-carregado: ${Object.keys(map).length} variantes`);
      });
    }

    injectStyles(config.visual || {});
    injectHTML(config.visual || {});
    interceptCart();
    trackEvent('cart_impression');

    console.log('[CartFlow] ✓ Loaded successfully');
    console.log('[CartFlow] Active store:', config.routing?.active_store?.name || 'none');
  } catch (err) {
    console.error('[CartFlow] Init error:', err);
  }

})();
