// Hypnotic spiral arms that spin faster with the music and lurch on every beat.
(() => {
  'use strict';
  const TAU = Math.PI * 2;

  const hypno = { rot: 0, vel: 0 };
  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    fade(0.3);
    hypno.vel = hypno.vel * 0.95 + state.level * 0.004;
    if (state.onset) hypno.vel += 0.06;
    hypno.rot += 0.004 + hypno.vel;
    const R = Math.hypot(W, H) / 2, arms = 4;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = R * 0.035 * (0.4 + state.bass * 1.6);
    for (let arm = 0; arm < arms; arm++) {
      ctx.strokeStyle = `hsl(${(state.hue + arm * 90) % 360} 100% 55% / 0.8)`;
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const f = i / 240;
        const a = hypno.rot + (arm / arms) * TAU + f * TAU * 3;
        const x = W / 2 + Math.cos(a) * R * f, y = H / 2 + Math.sin(a) * R * f;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Hypno', draw });
})();
