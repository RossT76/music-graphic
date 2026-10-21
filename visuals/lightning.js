// Forking lightning from the centre on every beat; treble adds small sparks.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const bolts = [];
  function jag(x0, y0, x1, y1, disp, depth, out) { // midpoint displacement
    if (depth === 0) { out.push(x1, y1); return; }
    const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * disp;
    const my = (y0 + y1) / 2 + (Math.random() - 0.5) * disp;
    jag(x0, y0, mx, my, disp / 2, depth - 1, out);
    jag(mx, my, x1, y1, disp / 2, depth - 1, out);
  }
  function makeBolt(x0, y0, angle, len, hue) {
    const main = [x0, y0];
    jag(x0, y0, x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len, len * 0.35, 6, main);
    const lines = [main];
    for (let b = 0; b < 4; b++) {
      const i = (2 + Math.floor(Math.random() * (main.length / 2 - 4))) * 2;
      const ba = angle + (Math.random() - 0.5) * 1.4;
      const bl = len * (0.15 + Math.random() * 0.25);
      const branch = [main[i], main[i + 1]];
      jag(main[i], main[i + 1], main[i] + Math.cos(ba) * bl, main[i + 1] + Math.sin(ba) * bl, bl * 0.35, 4, branch);
      lines.push(branch);
    }
    bolts.push({ lines, life: 1, hue });
  }
  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    fade(0.25);
    const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
    if (state.onset) {
      const n = 2 + Math.floor(state.bass * 4);
      for (let k = 0; k < n; k++) makeBolt(cx, cy, Math.random() * TAU, R * (0.5 + Math.random() * 0.5), state.hue + k * 30);
    } else if (Math.random() < state.treble * 0.5) {
      makeBolt(cx, cy, Math.random() * TAU, R * 0.25 * (0.5 + Math.random()), state.hue + 180);
    }
    while (bolts.length > 24) bolts.shift();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let b = bolts.length - 1; b >= 0; b--) {
      const bolt = bolts[b];
      bolt.life -= 0.07;
      if (bolt.life <= 0) { bolts.splice(b, 1); continue; }
      ctx.beginPath();
      bolt.lines.forEach(pts => {
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      });
      ctx.strokeStyle = `hsl(${bolt.hue % 360} 100% 70% / ${bolt.life})`;
      ctx.lineWidth = 3 * bolt.life + 1;
      ctx.shadowBlur = 18;
      ctx.shadowColor = `hsl(${bolt.hue % 360} 100% 60%)`;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255,255,255,${bolt.life})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    const r = Math.min(W, H) * (0.03 + state.bass * 0.05);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    g.addColorStop(0, `hsla(${state.hue} 100% 80% / 0.9)`);
    g.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.5, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Lightning', draw });
})();
