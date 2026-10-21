// Ten mirrored wedges, each carrying two wriggling spectrum-shaped ribbons.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.14);
    const R = Math.min(W, H) * 0.5, seg = 10;
    const time = performance.now() / 1000;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(time * 0.15 + state.bass * 0.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let s = 0; s < seg; s++) {
      ctx.save();
      ctx.rotate((s / seg) * TAU);
      if (s % 2) ctx.scale(1, -1);
      for (let layer = 0; layer < 2; layer++) {
        ctx.strokeStyle = `hsl(${(state.hue + layer * 70 + s * 8) % 360} 100% 60% / 0.8)`;
        ctx.lineWidth = 2 + layer * 2 + state.beat * 4;
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) {
          const r = (i / 48) * R;
          const y = Math.sin(r * 0.025 + time * (2 + layer)) * R * 0.14 *
            (0.25 + spec(i, 48) * 1.5) * (layer ? -1 : 1);
          if (i === 0) ctx.moveTo(r, y); else ctx.lineTo(r, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  MRD.register({ name: 'Kaleidoscope', draw });
})();
