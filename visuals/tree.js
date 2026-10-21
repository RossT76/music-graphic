// Recursive tree: mids spread the branches, bass lengthens the trunk, treble lights the leaves.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    fade(0.3);
    const t = performance.now() / 1000;
    const spread = 0.3 + state.mid * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const grow = (x, y, len, ang, depth) => {
      const a = ang + Math.sin(t * 1.3 + depth * 0.7) * 0.06 * (1 + state.level * 3);
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      ctx.strokeStyle = `hsl(${(state.hue + depth * 22) % 360} 90% ${40 + (10 - depth) * 3}% / 0.85)`;
      ctx.lineWidth = Math.max(1, depth * 0.9);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (depth <= 1) {
        ctx.fillStyle = `hsl(${(state.hue + 120) % 360} 100% 65% / ${0.4 + state.treble})`;
        ctx.beginPath();
        ctx.arc(x2, y2, 2 + state.treble * 8 + state.beat * 4, 0, TAU);
        ctx.fill();
        return;
      }
      grow(x2, y2, len * 0.74, a - spread, depth - 1);
      grow(x2, y2, len * 0.74, a + spread, depth - 1);
    };
    grow(W / 2, H * 0.98, H * (0.2 + state.bass * 0.05), -Math.PI / 2, 10);
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Tree', draw });
})();
