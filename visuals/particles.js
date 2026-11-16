// Starfield streaking outward from the centre; a burst on every beat. Reversed, it streams inward.
(() => {
  'use strict';

  const particles = [];
  const MAX_PARTICLES = 900;
  let spawnDebt = 0;

  // Normally particles are born at the centre; reversed, they are born out on the screen and fall in.
  function spawn(count, burst, inward, reach) {
    for (let k = 0; k < count && particles.length < MAX_PARTICLES; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = inward ? reach * (0.5 + Math.random() * 0.5) : 0;
      let [min, spread] = burst ? [4, 8] : [1, 3];
      if (inward) [min, spread] = burst ? [2, 4] : [0.6, 2];   // they speed up as they fall in
      const speed = min + Math.random() * spread;
      particles.push({
        x: Math.cos(a) * r, y: Math.sin(a) * r,
        a,
        speed,
        life: 1,
        decay: (0.004 + Math.random() * 0.008) * (inward ? 0.5 : 1),   // inward trips are longer
        hueOff: Math.random() * 60,
      });
    }
  }

  function draw(api) {
    const { ctx, W, H, state, fade, flow, dir } = api;
    fade(0.12);
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) / 800;
    const inward = dir < 0;
    const reach = Math.hypot(W, H) / 2, core = Math.min(W, H) * 0.03;
    const steps = Math.abs(flow);   // frames' worth of time passing, whichever way it runs

    spawnDebt += (2 + state.level * 14) * steps;
    const n = Math.floor(spawnDebt);
    spawnDebt -= n;
    spawn(n, false, inward, reach);
    if (state.onset) spawn(120, true, inward, reach);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const boost = 1 + state.mid * 3 + state.beat * 2;
      const c = Math.cos(p.a), s = Math.sin(p.a);
      const px = p.x, py = p.y;
      // flow is negative when reversed, which walks the particle back along its ray. Particles already
      // on screen when the direction flips just turn round.
      p.x += c * p.speed * boost * scale * flow;
      p.y += s * p.speed * boost * scale * flow;
      p.speed *= Math.pow(1.012, steps);
      p.life -= p.decay * steps;
      const along = p.x * c + p.y * s;   // distance from the centre, signed so that crossing it counts
      const gone = p.life <= 0 || (inward
        ? along < core
        : Math.abs(p.x) > W || Math.abs(p.y) > H);
      if (gone) {
        particles.splice(i, 1);
        continue;
      }
      // Inward streaks brighten as they close on the core.
      const alpha = p.life * (inward ? 0.55 + 0.45 * Math.max(0, 1 - along / reach) : 1);
      ctx.strokeStyle = `hsl(${(state.hue + p.hueOff) % 360} 100% 60% / ${alpha})`;
      ctx.lineWidth = (0.8 + (1 - p.life) * 2.5 + state.treble * 3) * Math.max(0.6, scale);
      ctx.beginPath();
      ctx.moveTo(cx + px, cy + py);
      ctx.lineTo(cx + p.x, cy + p.y);
      ctx.stroke();
    }

    // Core orb
    const r = Math.min(W, H) * (0.05 + state.bass * 0.08 + state.beat * 0.03);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    g.addColorStop(0, `hsla(${state.hue} 100% 75% / 0.9)`);
    g.addColorStop(0.4, `hsla(${state.hue} 100% 55% / 0.35)`);
    g.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Particles', draw, motion: true, reverseLabel: 'Streams inward to the centre' });
})();
