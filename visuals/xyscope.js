// XY oscilloscope: the waveform plotted against a delayed copy of itself.
(() => {
  'use strict';

  function draw(api) {
    const { ctx, W, H, state, fade, wave } = api;
    fade(0.12);
    if (!wave) return;
    const delay = 12 + Math.floor((Math.sin(performance.now() / 4000) * 0.5 + 0.5) * 60);
    const S = Math.min(W, H) * 0.7;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `hsl(${state.hue} 100% 60% / 0.9)`;
    ctx.shadowBlur = 12;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.beginPath();
    for (let i = 0; i < wave.length - delay; i += 2) {
      const a = (wave[i] - 128) / 128, b = (wave[i + delay] - 128) / 128;
      const x = W / 2 + (a - b) * 0.7071 * S, y = H / 2 + (a + b) * 0.7071 * S;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'XY Scope', draw });
})();
