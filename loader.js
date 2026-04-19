/**
 * OctoRoute Loader — Tracking Module v12
 *
 * MUDANÇAS vs v11:
 * 1. AWAIT REAL no store-checkout-attributes antes do redirect
 *    (3 tentativas, backoff 300ms → 700ms → 1500ms)
 * 2. cart/update.js em paralelo, mas com retry próprio
 * 3. FALLBACK ADBLOCKER: se POST falhar nas 3 tentativas, anexa tracking
 *    como query string no permalink de checkout (sobrevive a bloqueio
 *    cross-domain do POST, mas não do loader inteiro)
 * 4. Whitelist expandida: msclkid, li_fat_id, twclid, sccid, epik
 * 5. Captura _fbp/_fbc/ttp dos cookies (com retry de 200ms se ainda
 *    não hidrataram quando o loader inicia)
 *
 * INSTALAÇÃO: substituir o bloco de tracking no loader.js da Vercel
 * por este código. Mantém a mesma assinatura pública:
 *   - window.__octoTracking.captureFromUrl()
 *   - window.__octoTracking.persistAndRedirect(checkoutUrl)
 */

(function () {
  "use strict";

  const SUPABASE_URL = "https://pdeontahcfqcvlxjtnka.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkZW9udGFoY2ZxY3ZseGp0bmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNzUwMjAsImV4cCI6MjA5MDY1MTAyMH0.BgeZpXWMMyfiodsBpRfbMt_eekdOckKPyXCT1FLSGTU";

  // Whitelist sincronizada com store-checkout-attributes/index.ts
  const ALLOWED_PARAMS = [
    // UTMs
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
    // Click IDs principais
    "fbclid", "ttclid", "gclid", "wbraid", "gbraid", "tikclid", "irclickid",
    // Click IDs adicionais (v12)
    "msclkid", "li_fat_id", "twclid", "sccid", "epik",
  ];

  const COOKIE_KEYS = ["_fbp", "_fbc", "ttp"];

  // ---------- Helpers ----------

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\\/+^]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function getOrCreateSid() {
    const KEY = "_octo_sid";
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = "ocs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  }

  function captureTracking() {
    const out = { source: "octoroute" };
    const url = new URL(window.location.href);

    // 1. URL params (whitelist)
    for (const k of ALLOWED_PARAMS) {
      const v = url.searchParams.get(k);
      if (v && v.length > 0 && v.length <= 512) out[k] = v;
    }

    // 2. Persistir em sessionStorage para sobreviver navegação interna
    try {
      const stored = JSON.parse(sessionStorage.getItem("_octo_tracking") || "{}");
      // Merge: URL atual sobrescreve, mas mantém o que já tinha
      for (const [k, v] of Object.entries(stored)) {
        if (!out[k] && v) out[k] = v;
      }
      sessionStorage.setItem("_octo_tracking", JSON.stringify(out));
    } catch (e) { /* ignore */ }

    // 3. Cookies (Facebook Pixel, TikTok)
    for (const ck of COOKIE_KEYS) {
      const v = readCookie(ck);
      if (v) out[ck] = v;
    }

    return out;
  }

  // Espera até cookies do FB Pixel hidratarem (até 800ms)
  async function waitForCookies(maxMs = 800) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (readCookie("_fbp") || readCookie("_fbc")) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- POST com retry exponencial ----------

  async function postWithRetry(url, body, maxAttempts = 3) {
    const backoffs = [0, 300, 700, 1500];
    let lastErr = null;

    for (let i = 0; i < maxAttempts; i++) {
      if (backoffs[i] > 0) await sleep(backoffs[i]);

      try {
        // Timeout individual de 4s por tentativa
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          keepalive: true,
        });
        clearTimeout(tid);

        if (res.ok) return { ok: true, attempt: i + 1 };
        lastErr = "http_" + res.status;
      } catch (e) {
        lastErr = e?.name === "AbortError" ? "timeout" : (e?.message || "fetch_error");
      }
    }

    return { ok: false, error: lastErr, attempts: maxAttempts };
  }

  // ---------- Persist tracking no Supabase (com await real) ----------

  async function persistTracking(sid, storeId, tracking) {
    const url = SUPABASE_URL + "/functions/v1/store-checkout-attributes";
    const result = await postWithRetry(url, {
      session_id: sid,
      store_id: storeId,
      tracking_data: tracking,
    }, 3);

    if (result.ok) {
      console.log("[octo-tracking] ✅ persisted on attempt " + result.attempt);
    } else {
      console.warn("[octo-tracking] ❌ persist failed after 3 attempts: " + result.error);
    }
    return result.ok;
  }

  // ---------- Cart update (injeta SID na white via /cart/update.js) ----------

  async function updateCartAttributes(sid) {
    const backoffs = [0, 400, 1000];
    for (let i = 0; i < backoffs.length; i++) {
      if (backoffs[i] > 0) await sleep(backoffs[i]);
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3000);

        const res = await fetch("/cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ attributes: { _octo_sid: sid } }),
          signal: ctrl.signal,
          keepalive: true,
        });
        clearTimeout(tid);
        if (res.ok) {
          if (i > 0) console.log("[octo-tracking] cart attr injected on retry " + (i + 1));
          return true;
        }
      } catch (e) { /* try again */ }
    }
    console.warn("[octo-tracking] ❌ cart/update.js failed after 3 attempts");
    return false;
  }

  // ---------- Fallback: anexa tracking como query string no permalink ----------

  function appendTrackingToUrl(checkoutUrl, tracking) {
    try {
      const u = new URL(checkoutUrl, window.location.origin);
      // attributes[key] é o formato que o checkout do Shopify aceita via URL
      for (const [k, v] of Object.entries(tracking)) {
        if (k === "source" || !v) continue;
        // Use attributes[] para garantir que o Shopify capture como note_attribute
        u.searchParams.set("attributes[" + k + "]", String(v));
      }
      // Inclui também o SID como atributo (redundância)
      return u.toString();
    } catch (e) {
      return checkoutUrl;
    }
  }

  // ---------- API pública ----------

  window.__octoTracking = window.__octoTracking || {};

  /**
   * Capturar tracking imediatamente ao carregar a página.
   * Salva em sessionStorage para sobreviver navegação SPA.
   */
  window.__octoTracking.captureFromUrl = function () {
    const tracking = captureTracking();
    return tracking;
  };

  /**
   * Persiste tracking + injeta SID no carrinho + redireciona pro checkout.
   * AWAIT REAL: aguarda persist confirmar 2xx (até ~3s total) antes do redirect.
   * Se POST falhar, fallback: anexa tracking como query string no checkoutUrl.
   *
   * @param {string} checkoutUrl - URL de redirect (permalink Shopify ou /checkout)
   * @param {string} storeId - UUID da store
   * @returns {Promise<void>} resolve quando o redirect acontecer
   */
  window.__octoTracking.persistAndRedirect = async function (checkoutUrl, storeId) {
    const sid = getOrCreateSid();

    // Espera cookies do FB hidratarem (max 800ms — só na primeira chamada)
    await waitForCookies(800);

    // Re-captura agora que cookies podem ter chegado
    const tracking = captureTracking();

    console.log("[octo-tracking] persistAndRedirect", {
      sid: sid.substring(0, 20) + "...",
      tracking_keys: Object.keys(tracking).filter((k) => k !== "source"),
    });

    // Dispara em PARALELO os 2 POSTs, mas AWAIT em ambos
    const [persistOk, cartOk] = await Promise.all([
      persistTracking(sid, storeId, tracking),
      updateCartAttributes(sid),
    ]);

    let finalUrl = checkoutUrl;

    // FALLBACK: se persist falhou, anexa tracking como query string no URL
    // (sobrevive a adblocker que bloqueia POST cross-domain mas não bloqueia o redirect)
    if (!persistOk) {
      finalUrl = appendTrackingToUrl(checkoutUrl, tracking);
      console.warn("[octo-tracking] using URL fallback (persist failed)");
    }

    // Sempre injeta o SID no URL como redundância
    try {
      const u = new URL(finalUrl, window.location.origin);
      u.searchParams.set("attributes[_octo_sid]", sid);
      finalUrl = u.toString();
    } catch (e) { /* ignore */ }

    console.log("[octo-tracking] redirecting", {
      persistOk,
      cartOk,
      url_has_fallback: finalUrl !== checkoutUrl,
    });

    window.location.href = finalUrl;
  };

  // Captura inicial automática
  try {
    captureTracking();
  } catch (e) {
    console.error("[octo-tracking] init capture error:", e);
  }
})();
