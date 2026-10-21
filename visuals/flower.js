// Sunflower seed pattern (golden angle). Centre dots follow the bass, outer dots the treble.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const flower = { rot: 0 };
  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.2);
    const R = Math.min(W, H) * 0.47, n = 520;
    flower.rot += 0.002 + state.mid * 0.02;
    const ga = (137.508 + Math.sin(performance.now() / 6000) * 0.25) * Math.PI / 180;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const r = R * Math.sqrt(f) * (1 + state.bass * 0.15);
      const a = i * ga + flower.rot;
      const v = spec(Math.floor(f * 48), 48);
      ctx.fillStyle = `hsl(${(state.hue + f * 240) % 360} 100% ${40 + v * 35}% / ${0.35 + v * 0.65})`;
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, 1 + v * 9 * (0.5 + f) + state.beat * 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Flower', draw });
})();
