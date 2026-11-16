// Layered wobbling blob: each layer is the spectrum from a moment earlier, so it ripples outward
// (inward when reversed).
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const LAYER_LAG = 0.1;   // seconds between layers at 1x
  const amoeba = { hist: [], rot: 0, dt: 1 / 60 };
  function draw(api) {
    const { ctx, W, H, state, fade, spec, flow, dt, speed, dir } = api;
    fade(0.3);
    const N = 72;
    const prof = new Float32Array(N);
    for (let k = 0; k < N; k++) prof[k] = spec(k < N / 2 ? k : N - 1 - k, N / 2);
    amoeba.hist.unshift(prof);
    if (amoeba.hist.length > 300) amoeba.hist.pop();   // enough for the slowest speed on a fast display
    amoeba.rot += (0.003 + state.mid * 0.01) * flow;
    amoeba.dt += (dt - amoeba.dt) * 0.05;   // smoothed, so the layer spacing doesn't jitter
    const lagFrames = LAYER_LAG / (speed * amoeba.dt);   // slower speed: layers reach further back in time
    const m = Math.min(W, H);
    const base = m * (0.14 + state.bass * 0.05), amp = m * 0.3;
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 5; l >= 0; l--) {
      // Reversed, the oldest spectrum sits on the inside, so the ripples run inward.
      const age = Math.round((dir < 0 ? 5 - l : l) * lagFrames);
      const p = amoeba.hist[Math.min(age, amoeba.hist.length - 1)];
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

  MRD.register({ name: 'Amoeba', draw, motion: true, reverseLabel: 'Ripples run inward' });
})();
