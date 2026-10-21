// Oscilloscope waveform with a chromatic fringe.
(() => {
  'use strict';

  function draw(api) {
    const { ctx, W, H, state, fade, wave } = api;
    fade(0.2);
    const mid = H / 2;
    const amp = H * (0.18 + state.level * 0.5);
    ctx.globalCompositeOperation = 'lighter';
    // Three offset traces give a chromatic fringe
    for (let layer = 0; layer < 3; layer++) {
      ctx.strokeStyle = `hsl(${(state.hue + layer * 50) % 360} 100% 60% / ${0.9 - layer * 0.25})`;
      ctx.lineWidth = 3 - layer * 0.8;
      ctx.shadowBlur = 18;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      const step = wave ? Math.max(1, Math.floor(wave.length / (W / 2))) : 1;
      const count = wave ? Math.floor(wave.length / step) : 2;
      for (let i = 0; i < count; i++) {
        const v = wave ? (wave[i * step] - 128) / 128 : 0;
        const x = (i / (count - 1)) * W;
        const y = mid + v * amp + (layer - 1) * 6 * (1 + state.treble * 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Scope', draw });
})();
