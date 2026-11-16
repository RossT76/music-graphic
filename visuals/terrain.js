// Synthwave landscape: the spectrum is laid down as a row of hills that recedes towards the horizon,
// under a bass-pulsing sun. Reversed, new rows appear on the horizon and roll towards you.
(() => {
  'use strict';

  const ROW_RATE = 1000 / 70;   // new rows per second at 1x
  const terrain = { rows: [], acc: 0 };   // acc: how far (0-1) the rows are towards the next one
  function draw(api) {
    const { ctx, W, H, state, spec, clearStage, bgRgb, dt, speed, dir } = api;
    const N = 64, ROWS = 34;
    terrain.acc += dt * ROW_RATE * speed;
    while (terrain.acc >= 1) {
      terrain.acc -= 1;
      const row = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const fromCentre = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2); // bass in the middle
        row[i] = spec(Math.floor(fromCentre * 47), 48);
      }
      terrain.rows.unshift(row);
      if (terrain.rows.length > ROWS) terrain.rows.pop();
    }
    clearStage();
    const horizon = H * 0.38, bottom = H * 0.95;
    const solid = bgRgb !== null;
    const sun = ctx.createRadialGradient(W / 2, horizon, 0, W / 2, horizon, H * (0.2 + state.bass * 0.15));
    sun.addColorStop(0, `hsla(${(state.hue + 300) % 360} 100% 60% / 0.55)`);
    sun.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
    // Row k is k rows old, plus the fraction of the way to the next one, so the scroll is smooth at any
    // speed. Newest is nearest normally and farthest when reversed; draw far rows first either way.
    const back = dir < 0, count = terrain.rows.length;
    for (let j = 0; j < count; j++) {
      const k = back ? j : count - 1 - j;
      const age = (k + terrain.acc) / ROWS;
      const depth = Math.pow(back ? age : 1 - age, 1.8);
      const y = horizon + (bottom - horizon) * depth;
      const halfW = W * (0.18 + 0.52 * depth);
      const amp = H * 0.28 * (0.25 + depth);
      const row = terrain.rows[k];
      ctx.beginPath();
      ctx.moveTo(W / 2 - halfW, y);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        ctx.lineTo(W / 2 - halfW + u * halfW * 2, y - Math.pow(row[i], 1.3) * amp * Math.sin(u * Math.PI));
      }
      ctx.lineTo(W / 2 + halfW, y);
      if (solid) { // hide the rows behind this one
        ctx.fillStyle = `rgb(${bgRgb})`;
        ctx.fill();
      }
      ctx.strokeStyle = `hsl(${(state.hue + k * 6) % 360} 100% 60% / ${0.25 + depth * 0.75})`;
      ctx.lineWidth = 1 + depth * 2;
      ctx.stroke();
    }
  }

  MRD.register({ name: 'Terrain', draw, motion: true, reverseLabel: 'Hills roll towards you' });
})();
