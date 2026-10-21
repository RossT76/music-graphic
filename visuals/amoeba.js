// Layered wobbling blob: each layer is the spectrum from a few frames earlier, so it ripples outward.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const amoeba = { hist: [], rot: 0 };
  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.3);
    const N = 72;
    const prof = new Float32Array(N);
    for (let k = 0; k < N; k++) prof[k] = spec(k < N / 2 ? k : N - 1 - k, N / 2);
    amoeba.hist.unshift(prof);
    if (amoeba.hist.length > 40) amoeba.hist.pop();
    amoeba.rot += 0.003 + state.mid * 0.01;
    const m = Math.min(W, H);
    const base = m * (0.14 + state.bass * 0.05), amp = m * 0.3;
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 5; l >= 0; l--) {
      const p = amoeba.hist[Math.min(l * 6, amoeba.hist.length - 1)];
      const pts = [];
      for (let k = 0; k < N; k++) {
        const a = amoeba.rot * (l % 2 ? -1 : 1) + (k / N) * TAU;
        const r = base * (1 + l * 0.18) + Math.pow(p[k], 1.3) * amp * (1 - l * 0.1);
        pts.push([W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r]);
      }
      const start = mid(pts[N - 1], pts[0]);
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      for (let k = 0; k < N; k++) {
        const e = mid(pts[k], pts[(k + 1) % N]);
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], e[0], e[1]);
      }
      ctx.closePath();
      ctx.fillStyle = `hsl(${(state.hue + l * 28) % 360} 95% 50% / 0.04)`;
      ctx.fill();
      ctx.strokeStyle = `hsl(${(state.hue + l * 28) % 360} 100% 65% / 0.8)`;
      ctx.lineWidth = 1.5 + state.beat * 3;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Amoeba', draw });
})();
