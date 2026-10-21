// Lava-lamp blobs. Drawn small, then blurred and contrast-boosted so they merge like liquid.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const goo = document.createElement('canvas');
  const gooCtx = goo.getContext('2d');
  function draw(api) {
    const { ctx, W, H, state, spec, clearStage } = api;
    const w = Math.ceil(W / 2), h = Math.ceil(H / 2);
    if (goo.width !== w || goo.height !== h) { goo.width = w; goo.height = h; }
    const t = performance.now() / 1000;
    gooCtx.fillStyle = '#000';
    gooCtx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = w / 2 + Math.sin(t * (0.4 + i * 0.13) + i) * w * 0.32;
      const y = h / 2 + Math.cos(t * (0.3 + i * 0.11) + i * 2) * h * 0.32;
      const r = Math.min(w, h) * (0.06 + spec(i * 3, 30) * 0.16 + state.beat * 0.03);
      gooCtx.fillStyle = `hsl(${(state.hue + i * 40) % 360} 100% 55%)`;
      gooCtx.beginPath();
      gooCtx.arc(x, y, r, 0, TAU);
      gooCtx.fill();
    }
    clearStage();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `blur(${Math.max(10, W / 32)}px) contrast(26)`;
    ctx.drawImage(goo, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Goo', draw });
})();
