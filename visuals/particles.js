// Starfield streaking outward from the centre; a burst on every beat.
(() => {
  'use strict';

  const particles = [];
  const MAX_PARTICLES = 900;

  function spawn(count, burst) {
    for (let k = 0; k < count && particles.length < MAX_PARTICLES; k++) {
      const a = Math.random() * Math.PI * 2;
      particles.push({
        x: 0, y: 0,
        a,
        speed: (burst ? 4 : 1) + Math.random() * (burst ? 8 : 3),
        life: 1,
        decay: 0.004 + Math.random() * 0.008,
        hueOff: Math.random() * 60,
      });
    }
  }

  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    fade(0.12);
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) / 800;
    spawn(Math.floor(2 + state.level * 14), false);
    if (state.onset) spawn(120, true);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const boost = 1 + state.mid * 3 + state.beat * 2;
      const dx = Math.cos(p.a) * p.speed * boost * scale;
      const dy = Math.sin(p.a) * p.speed * boost * scale;
      const px = p.x, py = p.y;
      p.x += dx; p.y += dy;
      p.speed *= 1.012;
      p.life -= p.decay;
      if (p.life <= 0 || Math.abs(p.x) > W || Math.abs(p.y) > H) {
        particles.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `hsl(${(state.hue + p.hueOff) % 360} 100% 60% / ${p.life})`;
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

  MRD.register({ name: 'Particles', draw });
})();
