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
     Life over the hero art, from one frame loop. Under the veil, ash: dark
     shards and a few warm motes caught in the vortex the art paints around
     the eclipse, circling it and slowly flung outwards. Above the veil,
     embers that rise and flicker out, and the odd glint that flares on the
     art. It only runs while the hero is on screen.
     ------------------------------------------------------------------------ */
  const canvas = $(".hero__ash");
  const fxCanvas = $(".hero__fx");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    const fx = fxCanvas ? fxCanvas.getContext("2d") : null;

    const makeSprite = (S, paint) => {
      const c = document.createElement("canvas");
      c.width = c.height = S;
      paint(c.getContext("2d"), S);
      return c;
    };
    const radial = (c, S, stops) => {
      const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      stops.forEach(([o, col]) => g.addColorStop(o, col));
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
    };
    // Ash: a soft oval, drawn stretched along its path so it reads as a
    // streak of debris like the ones in the painting.
    const shardSprite = makeSprite(32, (c, S) => radial(c, S, [
      [0, "rgba(22,9,5,1)"], [0.55, "rgba(30,12,6,0.75)"], [1, "rgba(30,12,6,0)"]]));
    const moteSprite = makeSprite(32, (c, S) => radial(c, S, [
      [0, "rgba(255,196,120,0.9)"], [0.35, "rgba(255,140,60,0.4)"], [1, "rgba(255,120,40,0)"]]));
    const emberSprite = makeSprite(48, (c, S) => radial(c, S, [
      [0, "rgba(255,246,214,1)"], [0.14, "rgba(255,200,98,0.95)"], [0.4, "rgba(255,122,34,0.35)"], [1, "rgba(255,90,20,0)"]]));
    // A four-point star: a round core and two long, thin streaks.
    const glintSprite = makeSprite(96, (c, S) => {
      radial(c, S, [[0, "rgba(255,250,232,1)"], [0.08, "rgba(255,226,160,0.8)"], [0.22, "rgba(255,170,80,0.12)"], [0.5, "rgba(255,170,80,0)"]]);
      for (const flat of [[1, 0.045], [0.045, 1]]) {
        c.save();
        c.translate(S / 2, S / 2);
        c.scale(flat[0], flat[1]);
        c.translate(-S / 2, -S / 2);
        radial(c, S, [[0, "rgba(255,248,225,0.95)"], [0.35, "rgba(255,214,140,0.35)"], [1, "rgba(255,190,110,0)"]]);
        c.restore();
      }
    });

    // `boost` eases up while the world charges and peaks on the strike;
    // the ash spins and the embers climb faster with it.
    const bg = canvas.parentElement;
    let boost = 1;
    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, reach = 1, ash = [], embers = [], glints = [], nextGlint = 0, last = 0, visible = true, raf = 0;
    const rand = (a, b) => a + Math.random() * (b - a);

    // Ash lives in polar coordinates around the eclipse (cx, cy). New pieces
    // start part way out and fade in; they leave past `reach`.
    const spawnAsh = (anywhere) => {
      const z = Math.random();
      const dark = Math.random() < 0.72;
      return {
        a0: Math.random() * Math.PI * 2,
        d: (anywhere ? rand(0.12, 1) : rand(0.12, 0.45)) * reach,
        z,
        dark,
        r: (dark ? 1.2 + 3.2 * z * z : 0.8 + 1.6 * z) * dpr,
        out: (8 + 26 * z) * dpr,
        spin: (0.05 + 0.09 * z) * (0.8 + Math.random() * 0.4),
        jitter: rand(-0.5, 0.5),
        wob: rand(0, Math.PI * 2),
        a: dark ? 0.35 + 0.5 * z : 0.25 + 0.4 * z,
        age: anywhere ? 9 : 0,
      };
    };

    // Embers rise from the lower part of the hero and burn out somewhere on
    // the way up; `top` is the height where each one is gone.
    const spawnEmber = (anywhere) => {
      const z = Math.random();
      return {
        x: Math.random() * W,
        y: anywhere ? rand(0.3, 1) * H : H + 8 * dpr,
        z,
        r: (1.4 + 3.4 * z * z) * dpr,
        vy: (16 + 38 * z) * dpr,
        sway: (6 + 18 * z) * dpr,
        phase: Math.random() * Math.PI * 2,
        freq: 0.25 + Math.random() * 0.6,
        flick: rand(3, 9),
        top: rand(0.05, 0.55) * H,
        a: 0.35 + 0.55 * z,
      };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (fxCanvas) { fxCanvas.width = W; fxCanvas.height = H; }
      const area = canvas.clientWidth * canvas.clientHeight;
      // The vortex centre is the halo in the art: 50.5% across, 14% down
      // the plate, wherever the plate currently sits.
      const plate = $(".hero__plate"), box = canvas.getBoundingClientRect();
      const pr = plate ? plate.getBoundingClientRect() : box;
      cx = (pr.left - box.left + pr.width * 0.505) * dpr;
      cy = (pr.top - box.top + pr.height * 0.14) * dpr;
      reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 20 * dpr;
      const want = Math.min(140, Math.round(area / 8000));
      while (ash.length < want) ash.push(spawnAsh(true));
      ash.length = want;
      const wantEmbers = fx ? Math.min(42, Math.round(area / 30000)) : 0;
      while (embers.length < wantEmbers) embers.push(spawnEmber(true));
      embers.length = wantEmbers;
    };

    const drawAsh = (t, dt) => {
      ctx.clearRect(0, 0, W, H);
      const s = t / 1000;
      for (const p of ash) {
        // Closer in turns faster, and everything drifts outwards.
        const k = Math.pow(0.25 * reach / Math.max(p.d, 0.25 * reach), 0.6);
        p.a0 += p.spin * k * boost * dt;
        p.d += p.out * (0.5 + p.d / reach) * boost * dt;
        p.age += dt;
        if (p.d > reach) { Object.assign(p, spawnAsh(false)); continue; }
        const d = p.d + Math.sin(s * 0.7 + p.wob) * 6 * dpr;
        const x = cx + Math.cos(p.a0) * d;
        const y = cy + Math.sin(p.a0) * d * 0.82;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        ctx.globalAlpha = p.a * Math.min(1, p.age / 1.5);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.a0 + Math.PI / 2 + p.jitter);
        const len = p.r * (p.dark ? 3.2 : 2.2) * (1 + 0.6 * p.z);
        ctx.drawImage(p.dark ? shardSprite : moteSprite, -len, -p.r, len * 2, p.r * 2);
        ctx.restore();
      }
    };

    const drawFx = (t, dt, wind) => {
      fx.clearRect(0, 0, W, H);
      fx.globalCompositeOperation = "lighter";
      const s = t / 1000;

      for (const e of embers) {
        e.y -= e.vy * boost * dt;
        e.x += wind * 0.5 * (0.4 + e.z) * dt;
        const x = e.x + Math.sin(s * e.freq + e.phase) * e.sway;
        // Fade in off the bottom edge, burn out towards `top`.
        const life = Math.min(1, (H - e.y) / (0.12 * H) + 0.2, (e.y - e.top) / (0.18 * H));
        if (life <= 0 || x - e.r > W + 30 * dpr) { Object.assign(e, spawnEmber(false)); continue; }
        const flicker = 0.7 + 0.3 * Math.sin(s * e.flick + e.phase * 3);
        fx.globalAlpha = Math.max(0, e.a * life * flicker);
        const r = e.r * (0.85 + 0.15 * flicker);
        fx.drawImage(emberSprite, x - r * 2, e.y - r * 2, r * 4, r * 4);
      }

      // Glints: a few at a time, on the upper art where the light is.
      if (t >= nextGlint || (boost > 2 && t >= nextGlint - 1500)) {
        if (glints.length < 4) {
          glints.push({ x: rand(0.18, 0.82) * W, y: rand(0.06, 0.62) * H, size: rand(14, 34) * dpr, born: t, life: rand(1100, 2100), rot: rand(-0.3, 0.3) });
        }
        nextGlint = t + rand(700, 2600);
      }
      glints = glints.filter((g) => t - g.born < g.life);
      for (const g of glints) {
        const p = (t - g.born) / g.life;
        const k = Math.sin(p * Math.PI);
        const size = g.size * (0.35 + 0.65 * k);
        fx.globalAlpha = k * k * 0.85;
        fx.save();
        fx.translate(g.x, g.y);
        fx.rotate(g.rot + p * 0.5);
        fx.drawImage(glintSprite, -size, -size, size * 2, size * 2);
        fx.restore();
      }
      fx.globalCompositeOperation = "source-over";
    };

    const frame = (t) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000);
      last = t;
      const wind = (8 + 10 * Math.sin(t / 9000)) * dpr;
      const want = bg.classList.contains("is-strike") ? 3.2 : bg.classList.contains("is-charging") ? 2.4 : 1;
      boost += (want - boost) * Math.min(1, dt * (want > boost ? 1.2 : 0.8));
      drawAsh(t, dt);
      if (fx) drawFx(t, dt, wind);
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
     Lightning: every 6 to 11 seconds, while the hero is in view, the world
     charges up, then strikes - it jolts, blurs and flares, and settles
     (see .is-charging and .is-strike in the CSS).
     ------------------------------------------------------------------------ */
  const heroBg = $(".hero__bg");
  if (heroBg && !reduceMotion) {
    const cycle = () => {
      if (!document.hidden && heroBg.getBoundingClientRect().bottom > 0) heroBg.classList.add("is-charging");
      else setTimeout(cycle, 3000);
    };
    heroBg.addEventListener("animationend", (e) => {
      if (e.animationName === "charge") heroBg.classList.replace("is-charging", "is-strike");
      else if (e.animationName === "strike") {
        heroBg.classList.remove("is-strike");
        setTimeout(cycle, 6000 + Math.random() * 5000);
      }
    });
    setTimeout(cycle, 3000);
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
    img.loading = "lazy";
    return img;
  };

  // The tabbed picker: one wallet at a time. The dialog always uses it; the
  // page uses it on phones, where four QR cards would be a long scroll.
  const renderTabs = (host, title) => {
    host.appendChild(el("p", "wpick__title", title));
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
  };

  $$("[data-wallets]").forEach((host) => {
    if (!wallets.length) return;

    if ("compact" in host.dataset) { renderTabs(host, "Or send crypto"); return; }

    const cards = el("div", "wallets__cards");
    for (const w of wallets) {
      const card = el("article", "wcard");
      const qr = el("div", "wcard__qr");
      qr.appendChild(qrImage(w));
      card.append(
        el("div", "wcard__head",
          `<svg class="wcard__coin" aria-hidden="true"><use href="#c-${w.id}"/></svg>` +
          `<span class="wcard__name"><strong>${w.coin}</strong><span>${w.ticker} &middot; ${w.network}</span></span>`),
        qr,
        el("code", "wcard__addr", splitAddr(w.address)),
        copyButton(w, "Copy address"));
      cards.appendChild(card);
    }
    const pick = el("div", "wallets__pick panel");
    renderTabs(pick, "Send crypto");
    host.append(cards, pick);
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
