// Mirrored, log-spaced spectrum bars.
(() => {
  'use strict';

  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.25);
    const n = Math.max(24, Math.floor(W / 18));
    const bw = W / n;
    const mid = H / 2;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = spec(i, n);
      const h = Math.pow(v, 1.5) * H * 0.42 + 2;
      const hue = (state.hue + (i / n) * 120) % 360;
      ctx.fillStyle = `hsl(${hue} 90% ${40 + v * 25}%)`;
      ctx.fillRect(i * bw + 1, mid - h, bw - 2, h * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Bars', draw });
})();
