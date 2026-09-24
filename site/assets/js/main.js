/* ==========================================================================
   Eclipse - site script
   ==========================================================================
   No framework, no dependency. Without JavaScript the page is complete and
   still; with reduced motion nothing moves.
   ========================================================================== */
(() => {
  "use strict";

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  /* ------------------------------------------------------------------------
     Hero art: fade in over the blurred placeholder once decoded.
     ------------------------------------------------------------------------ */
  const art = $(".hero__art");
  if (art) {
    const show = () => art.classList.add("is-loaded");
    if (art.complete && art.naturalWidth) show();
    else {
      art.addEventListener("load", () => (art.decode ? art.decode().then(show, show) : show()), { once: true });
      art.addEventListener("error", show, { once: true });
    }
  }

  /* ------------------------------------------------------------------------
     Snow over the hero art. One pre-rendered soft sprite, three depths,
     density by area. It only runs while the hero is on screen.
     ------------------------------------------------------------------------ */
  const canvas = $(".hero__snow");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    const sprite = document.createElement("canvas");
    const S = 48;
    sprite.width = sprite.height = S;
    const sctx = sprite.getContext("2d");
    const g = sctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(240,248,255,0.6)");
    g.addColorStop(1, "rgba(240,248,255,0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, S, S);

    let W = 0, H = 0, dpr = 1, flakes = [], last = 0, visible = true, raf = 0;

    const spawn = (anywhere) => {
      const z = Math.random();
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : -12 * dpr,
        z,
        r: (0.6 + 2.2 * z * z) * dpr,
        vy: (12 + 44 * z) * dpr,
        sway: (4 + 16 * z) * dpr,
        phase: Math.random() * Math.PI * 2,
        freq: 0.2 + Math.random() * 0.5,
        a: 0.15 + 0.45 * z,
      };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      const want = Math.min(150, Math.round((canvas.clientWidth * canvas.clientHeight) / 7000));
      while (flakes.length < want) flakes.push(spawn(true));
      flakes.length = want;
    };

    const frame = (t) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000);
      last = t;
      const wind = (8 + 10 * Math.sin(t / 9000)) * dpr;
      ctx.clearRect(0, 0, W, H);
      for (const f of flakes) {
        f.y += f.vy * dt;
        f.x += wind * (0.4 + f.z) * dt;
        const x = f.x + Math.sin((t / 1000) * f.freq + f.phase) * f.sway;
        if (f.y - f.r > H || x - f.r > W + 30 * dpr) Object.assign(f, spawn(false), { x: Math.random() * W - 30 * dpr });
        ctx.globalAlpha = f.a;
        ctx.drawImage(sprite, x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };

    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else addEventListener("resize", resize, { passive: true });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
    }
    document.addEventListener("visibilitychange", start);
    start();
  }

  /* ------------------------------------------------------------------------
     Header: a hairline once the page moves; the current section is marked.
     ------------------------------------------------------------------------ */
  const bar = $("[data-bar]");
  const onScroll = () => bar && bar.classList.toggle("is-solid", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const navLinks = $$(".bar__nav a");
  if ("IntersectionObserver" in window && navLinks.length) {
    const byId = new Map(navLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        navLinks.forEach((a) => a.classList.toggle("is-active", a === byId.get(e.target.id)));
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ------------------------------------------------------------------------
     Showcase. Set data-youtube-id on [data-player] to the video's 11
     character id; the poster becomes its thumbnail, and the YouTube frame is
     only created on click.
     ------------------------------------------------------------------------ */
  const player = $("[data-player]");
  if (player) {
    const id = (player.dataset.youtubeId || "").trim();
    if (/^[\w-]{11}$/.test(id)) {
      const poster = $(".player__poster", player);
      const play = $(".player__play", player);
      const thumb = new Image();
      thumb.className = "player__thumb";
      thumb.alt = "";
      thumb.decoding = "async";
      thumb.src = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      thumb.onerror = () => { thumb.onerror = null; thumb.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; };
      poster.replaceChildren(thumb);
      play.hidden = false;
      play.addEventListener("click", () => {
        const f = document.createElement("iframe");
        f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
        f.title = "Eclipse showcase";
        f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        f.allowFullscreen = true;
        player.replaceChildren(f);
      }, { once: true });
    }
  }

  /* ------------------------------------------------------------------------
     Wallets: one list, drawn as cards on the page and as tabs in the dialog.
     ------------------------------------------------------------------------ */
  let wallets = [];
  try { wallets = JSON.parse($("#wallets").textContent); } catch (_) { wallets = []; }

  const toast = $("[data-toast]");
  let toastTimer = 0;
  const say = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), 1800);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  };

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const icon = (id, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

  const copyButton = (w, label) => {
    const b = el("button", "copy", `${icon("i-copy")}<span>${label}</span>`);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (!(await copyText(w.address))) { say("Select the address to copy it"); return; }
      b.classList.add("is-done");
      b.innerHTML = `${icon("i-check")}<span>Copied</span>`;
      say(`${w.ticker} address copied`);
      setTimeout(() => {
        b.classList.remove("is-done");
        b.innerHTML = `${icon("i-copy")}<span>${label}</span>`;
      }, 1800);
    });
    return b;
  };

  // Addresses are one long word; offer a single break at the midpoint so a
  // wrapped address reads as two even lines rather than a stub.
  const splitAddr = (a) => { const m = Math.ceil(a.length / 2); return `${a.slice(0, m)}<wbr>${a.slice(m)}`; };

  const qrImage = (w) => {
    const img = new Image();
    img.src = `assets/img/qr-${w.id}.svg`;
    img.alt = `QR code for the ${w.coin} address`;
    img.decoding = "async";
    return img;
  };

  $$("[data-wallets]").forEach((host) => {
    if (!wallets.length) return;

    if (!("compact" in host.dataset)) {
      for (const w of wallets) {
        const card = el("article", "wcard");
        const qr = el("div", "wcard__qr");
        const img = qrImage(w);
        img.loading = "lazy";
        qr.appendChild(img);
        card.append(
          el("div", "wcard__head",
            `<svg class="wcard__coin" aria-hidden="true"><use href="#c-${w.id}"/></svg>` +
            `<span class="wcard__name"><strong>${w.coin}</strong><span>${w.ticker} &middot; ${w.network}</span></span>`),
          qr,
          el("code", "wcard__addr", splitAddr(w.address)),
          copyButton(w, "Copy address"));
        host.appendChild(card);
      }
      return;
    }

    host.appendChild(el("p", "modal__crypto-title", "Or send crypto"));
    const tabs = el("div", "wtabs");
    tabs.setAttribute("role", "tablist");
    const panel = el("div", "wpanel");
    panel.setAttribute("role", "tabpanel");
    const select = (i) => {
      const w = wallets[i];
      $$(".wtab", tabs).forEach((t, j) => {
        t.setAttribute("aria-selected", String(i === j));
        t.tabIndex = i === j ? 0 : -1;
      });
      const qr = el("div", "wallet__qr");
      qr.appendChild(qrImage(w));
      const side = el("div", "wpanel__side");
      side.append(
        el("p", "wpanel__net", `<strong>${w.coin}</strong> on ${w.network}`),
        el("code", "wallet__addr", splitAddr(w.address)),
        copyButton(w, "Copy address"));
      panel.replaceChildren(qr, side);
    };
    wallets.forEach((w, i) => {
      const t = el("button", "wtab", `${icon("c-" + w.id)}<span>${w.ticker}</span>`);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.addEventListener("click", () => select(i));
      t.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const n = (i + d + wallets.length) % wallets.length;
        select(n);
        tabs.children[n].focus();
      });
      tabs.appendChild(t);
    });
    host.append(tabs, panel);
    select(0);
  });

  /* ------------------------------------------------------------------------
     Support dialog: opens on every visit, a moment after the page settles.
     Closes on the close button, Escape, the backdrop or Continue, each with
     the same short exit.
     ------------------------------------------------------------------------ */
  const modal = $("#support-modal");
  if (modal && typeof modal.showModal === "function") {
    const open = () => {
      if (modal.open) return;
      modal.classList.remove("is-closing");
      modal.showModal();
      // Focus the dialog itself, not its first link: nothing is pre-selected,
      // and Tab still walks into the links from here.
      modal.focus({ preventScroll: true });
    };
    const close = () => {
      if (!modal.open || modal.classList.contains("is-closing")) return;
      if (reduceMotion) { modal.close(); return; }
      modal.classList.add("is-closing");
      modal.addEventListener("animationend", () => {
        modal.classList.remove("is-closing");
        modal.close();
      }, { once: true });
    };
    modal.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    $$("form[method=dialog]", modal).forEach((f) =>
      f.addEventListener("submit", (e) => { e.preventDefault(); close(); }));
    modal.addEventListener("click", (e) => {
      if (e.target !== modal) return;
      const r = modal.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    $$("[data-open-support]").forEach((b) => b.addEventListener("click", open));

    // data-no-popup on <html> suppresses the automatic open (used for previews).
    if (!document.documentElement.hasAttribute("data-no-popup")) {
      const openSoon = () => setTimeout(open, 1400);
      if (document.readyState === "complete") openSoon();
      else addEventListener("load", openSoon, { once: true });
    }
  }
})();
