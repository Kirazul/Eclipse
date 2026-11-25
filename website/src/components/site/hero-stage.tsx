"use client";

import { useEffect, useRef } from "react";
import { TALL_MEDIA, TALL_SIZES, WIDE_SIZES, tallArt, wideArt } from "@/lib/hero-art";


// site/assets/js/main.js, the hero's half: the art fades in once decoded, ash
// circles the eclipse under the veil, embers and glints rise above it, and every
// few seconds the world charges and strikes. It runs while the hero is on screen
// and not at all with reduced motion, and the effect's cleanup takes it all down
// again, since unlike the static page this one can be navigated away from.

type Paint = (c: CanvasRenderingContext2D, size: number) => void;

function makeSprite(size: number, paint: Paint) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!, size);
  return c;
}

function radial(c: CanvasRenderingContext2D, size: number, stops: [number, string][]) {
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, colour]) => g.addColorStop(offset, colour));
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function startFx(bg: HTMLElement, canvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement, plate: HTMLElement) {
  const ctx = canvas.getContext("2d")!;
  const fx = fxCanvas.getContext("2d")!;

  // Ash: a soft oval, drawn stretched along its path so it reads as a streak.
  const shardSprite = makeSprite(32, (c, S) => radial(c, S, [
    [0, "rgba(22,9,5,1)"], [0.55, "rgba(30,12,6,0.75)"], [1, "rgba(30,12,6,0)"]]));
  const moteSprite = makeSprite(32, (c, S) => radial(c, S, [
    [0, "rgba(255,196,120,0.9)"], [0.35, "rgba(255,140,60,0.4)"], [1, "rgba(255,120,40,0)"]]));
  const emberSprite = makeSprite(48, (c, S) => radial(c, S, [
    [0, "rgba(255,246,214,1)"], [0.14, "rgba(255,200,98,0.95)"], [0.4, "rgba(255,122,34,0.35)"], [1, "rgba(255,90,20,0)"]]));
  // A four-point star: a round core and two long, thin streaks.
  const glintSprite = makeSprite(96, (c, S) => {
    radial(c, S, [[0, "rgba(255,250,232,1)"], [0.08, "rgba(255,226,160,0.8)"], [0.22, "rgba(255,170,80,0.12)"], [0.5, "rgba(255,170,80,0)"]]);
    for (const [sx, sy] of [[1, 0.045], [0.045, 1]]) {
      c.save();
      c.translate(S / 2, S / 2);
      c.scale(sx, sy);
      c.translate(-S / 2, -S / 2);
      radial(c, S, [[0, "rgba(255,248,225,0.95)"], [0.35, "rgba(255,214,140,0.35)"], [1, "rgba(255,190,110,0)"]]);
      c.restore();
    }
  });

  // `boost` eases up while the world charges and peaks on the strike.
  let boost = 1;
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, reach = 1, nextGlint = 0, last = 0, visible = true, raf = 0;
  type Ash = ReturnType<typeof spawnAsh>;
  type Ember = ReturnType<typeof spawnEmber>;
  const ash: Ash[] = [];
  const embers: Ember[] = [];
  let glints: { x: number; y: number; size: number; born: number; life: number; rot: number }[] = [];

  // Ash lives in polar coordinates around the eclipse (cx, cy). New pieces start
  // part way out and fade in; they leave past `reach`.
  function spawnAsh(anywhere: boolean) {
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
  }

  // Embers rise from the lower hero and burn out on the way up, at `top`.
  function spawnEmber(anywhere: boolean) {
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
  }

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    fxCanvas.width = W;
    fxCanvas.height = H;
    const area = canvas.clientWidth * canvas.clientHeight;
    // The vortex centre is the halo in the art: 50.5% across, 14% down the plate.
    const box = canvas.getBoundingClientRect();
    const pr = plate.getBoundingClientRect();
    cx = (pr.left - box.left + pr.width * 0.505) * dpr;
    cy = (pr.top - box.top + pr.height * 0.14) * dpr;
    reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 20 * dpr;
    const want = Math.min(140, Math.round(area / 8000));
    while (ash.length < want) ash.push(spawnAsh(true));
    ash.length = want;
    const wantEmbers = Math.min(42, Math.round(area / 30000));
    while (embers.length < wantEmbers) embers.push(spawnEmber(true));
    embers.length = wantEmbers;
  };

  const drawAsh = (t: number, dt: number) => {
    ctx.clearRect(0, 0, W, H);
    const s = t / 1000;
    for (const p of ash) {
      // Closer in turns faster, and everything drifts outwards.
      const k = Math.pow((0.25 * reach) / Math.max(p.d, 0.25 * reach), 0.6);
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

  const drawFx = (t: number, dt: number, wind: number) => {
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

  const frame = (t: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    const wind = (8 + 10 * Math.sin(t / 9000)) * dpr;
    const want = bg.classList.contains("is-strike") ? 3.2 : bg.classList.contains("is-charging") ? 2.4 : 1;
    boost += (want - boost) * Math.min(1, dt * (want > boost ? 1.2 : 0.8));
    drawAsh(t, dt);
    drawFx(t, dt, wind);
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (!raf && visible && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  resize();
  const sizes = new ResizeObserver(resize);
  sizes.observe(canvas);
  const seen = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    start();
  });
  seen.observe(canvas);
  document.addEventListener("visibilitychange", start);
  start();

  return () => {
    cancelAnimationFrame(raf);
    sizes.disconnect();
    seen.disconnect();
    document.removeEventListener("visibilitychange", start);
  };
}

// Every 6 to 11 seconds, while the hero is in view, the world charges, then
// strikes. The two beats are CSS (.is-charging, .is-strike); this only times them.
function startLightning(bg: HTMLElement) {
  let timer: ReturnType<typeof setTimeout>;
  const cycle = () => {
    if (!document.hidden && bg.getBoundingClientRect().bottom > 0) bg.classList.add("is-charging");
    else timer = setTimeout(cycle, 3000);
  };
  const onEnd = (e: AnimationEvent) => {
    if (e.animationName === "charge") bg.classList.replace("is-charging", "is-strike");
    else if (e.animationName === "strike") {
      bg.classList.remove("is-strike");
      timer = setTimeout(cycle, 6000 + Math.random() * 5000);
    }
  };
  bg.addEventListener("animationend", onEnd);
  timer = setTimeout(cycle, 3000);
  return () => {
    clearTimeout(timer);
    bg.removeEventListener("animationend", onEnd);
  };
}

export function HeroStage() {
  const bg = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const ash = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stopFx = startFx(bg.current!, ash.current!, fx.current!, plate.current!);
    const stopLightning = startLightning(bg.current!);
    return () => {
      stopFx();
      stopLightning();
    };
  }, []);

  return (
    <div ref={bg} className="hero__bg" aria-hidden="true">
      <div ref={plate} className="hero__plate">
        <picture>
          <source media={TALL_MEDIA} type="image/avif" sizes={TALL_SIZES} srcSet={tallArt("avif")} />
          <source media={TALL_MEDIA} type="image/webp" sizes={TALL_SIZES} srcSet={tallArt("webp")} />
          <source type="image/avif" sizes={WIDE_SIZES} srcSet={wideArt("avif")} />
          <source type="image/webp" sizes={WIDE_SIZES} srcSet={wideArt("webp")} />
          <img className="hero__art" src="/assets/img/bg-wide-1920.webp" width={1920} height={1080} alt="" fetchPriority="high" decoding="async" />
        </picture>
        <div className="hero__rays" />
        <div className="hero__glow" />
      </div>
      <canvas ref={ash} className="hero__ash" />
      <canvas ref={fx} className="hero__fx" />
    </div>
  );
}
