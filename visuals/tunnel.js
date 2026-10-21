// Hexagonal tunnel rushing towards you. Near rings follow the bass, far rings the treble.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const tunnel = { z: 0, rot: 0 };
  function draw(api) {
    const { ctx, W, H, state, fade, spec } = api;
    fade(0.3);
    const cx = W / 2, cy = H / 2, maxR = Math.hypot(W, H) / 2;
    tunnel.z = (tunnel.z + 0.004 + state.level * 0.03 + state.beat * 0.02) % 1;
    tunnel.rot += 0.003 + state.mid * 0.03;
    const rings = 20, sides = 6;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < rings; k++) {
      const t = (k / rings + tunnel.z) % 1; // 0 = far away, 1 = at the viewer
      const bulge = 1 + spec(Math.floor((1 - t) * 40), 40) * 0.4;
      const r = maxR * Math.pow(t, 2.2) * bulge;
      ctx.lineWidth = 1 + t * 7;
      ctx.strokeStyle = `hsl(${(state.hue + t * 220) % 360} 100% ${45 + state.beat * 25}% / ${0.15 + t * 0.85})`;
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const a = tunnel.rot * (k % 2 ? 1 : -1) + k * 0.12 + (s / sides) * TAU;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Tunnel', draw });
})();
