// Spectrum ring with a bass-pulsing glow in the middle.
(() => {
  'use strict';

  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.18);
    const cx = W / 2, cy = H / 2;
    const base = Math.min(W, H) * (0.16 + state.beat * 0.04);
    const n = 180;
    ctx.lineWidth = Math.max(2, Math.min(W, H) / 220);
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const rot = performance.now() / 8000;
    for (let i = 0; i < n; i++) {
      // Mirror the spectrum around the circle so it is symmetrical.
      const half = i < n / 2 ? i : n - 1 - i;
      const v = spec(half, n / 2);
      const a = (i / n) * Math.PI * 2 + rot;
      const len = Math.pow(v, 1.4) * Math.min(W, H) * 0.3 + 3;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.strokeStyle = `hsl(${(state.hue + half * 2) % 360} 95% ${45 + v * 25}%)`;
      ctx.beginPath();
      ctx.moveTo(cx + c * base, cy + s * base);
      ctx.lineTo(cx + c * (base + len), cy + s * (base + len));
      ctx.stroke();
    }
    // Inner glow pulses with the bass
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base);
    g.addColorStop(0, `hsla(${state.hue} 100% 60% / ${0.15 + state.bass * 0.5})`);
    g.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Radial', draw });
})();
