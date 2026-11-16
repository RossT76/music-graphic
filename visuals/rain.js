// Falling glyphs (rising when reversed). Each column's speed and brightness follow its own slice of the spectrum.
(() => {
  'use strict';

  const rain = { cols: 0, y: [], chars: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789' };
  function draw(api) {
    const { ctx, W, H, state, fade, spec, flow } = api;
    const size = Math.max(12, Math.round(W / 90));
    const cols = Math.floor(W / size);
    if (rain.cols !== cols) {
      rain.cols = cols;
      rain.y = Array.from({ length: cols }, () => Math.random() * H / size);
    }
    fade(0.09);
    ctx.font = `${size}px monospace`;
    ctx.textBaseline = 'top';
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < cols; c++) {
      const v = spec(Math.floor((c / cols) * 48), 48);
      rain.y[c] += (0.25 + v * 1.6 + state.beat * 0.8) * flow;
      // Once a column has left the screen it restarts at the other edge, with the same 4%-per-frame chance.
      const restart = Math.random() > Math.pow(0.96, Math.abs(flow));
      if (flow > 0 && rain.y[c] * size > H && restart) rain.y[c] = 0;
      else if (flow < 0 && rain.y[c] < 0 && restart) rain.y[c] = H / size;
      ctx.fillStyle = `hsl(${(state.hue * 0.5 + 100) % 360} 100% ${50 + v * 45}%)`;
      ctx.fillText(rain.chars[Math.floor(Math.random() * rain.chars.length)],
        c * size, Math.floor(rain.y[c]) * size);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  MRD.register({ name: 'Rain', draw, motion: true, reverseLabel: 'Rain rises instead of falls' });
})();
