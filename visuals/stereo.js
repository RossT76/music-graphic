// Vintage hi-fi: three backlit VU meters (bass, mid, treble) with sprung needles.
(() => {
  'use strict';

  const SWEEP = 0.7; // half the needle's travel, in radians
  const A0 = -Math.PI / 2 - SWEEP, A1 = -Math.PI / 2 + SWEEP;
  const meters = [
    { label: 'BASS', key: 'bass', pos: 0, vel: 0, peak: 0.2 },
    { label: 'MID', key: 'mid', pos: 0, vel: 0, peak: 0.2 },
    { label: 'TREBLE', key: 'treble', pos: 0, vel: 0, peak: 0.2 },
  ];
  const MARKS = [['-20', 0], ['-10', 0.28], ['-7', 0.43], ['-5', 0.57], ['-3', 0.7], ['0', 0.8], ['+3', 1]];
  let last = 0;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCabinet(ctx, x, y, w, h, u) {
    const cab = u * 0.09;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = u * 0.15;
    ctx.shadowOffsetY = u * 0.04;
    const wood = ctx.createLinearGradient(0, y - cab, 0, y + h + cab);
    wood.addColorStop(0, '#7a4e2a');
    wood.addColorStop(1, '#3e2512');
    rr(ctx, x - cab, y - cab, w + 2 * cab, h + 2 * cab, u * 0.05);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.restore();

    ctx.save();
    rr(ctx, x - cab, y - cab, w + 2 * cab, h + 2 * cab, u * 0.05);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let i = 0; i < 50; i++) { // wood grain
      const gy = y - cab + (i / 50) * (h + 2 * cab);
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + 0.05 * Math.sin(i * 7.1)})`;
      ctx.beginPath();
      ctx.moveTo(x - cab, gy);
      ctx.bezierCurveTo(x + w * 0.3, gy + 5 * Math.sin(i), x + w * 0.7, gy - 5 * Math.cos(i), x + w + cab, gy);
      ctx.stroke();
    }
    ctx.restore();

    // Brushed charcoal faceplate
    const plate = ctx.createLinearGradient(0, y, 0, y + h);
    plate.addColorStop(0, '#2d2d31');
    plate.addColorStop(1, '#151517');
    rr(ctx, x, y, w, h, u * 0.03);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.save();
    rr(ctx, x, y, w, h, u * 0.03);
    ctx.clip();
    for (let yy = 0; yy < h; yy += 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + 0.025 * Math.abs(Math.sin(yy * 12.9898))})`;
      ctx.fillRect(x, y + yy, w, 1);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    rr(ctx, x, y, w, h, u * 0.03);
    ctx.stroke();

    const inset = u * 0.06;
    ctx.fillStyle = '#6d6d70'; // corner screws
    for (const [sx, sy] of [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]]) {
      ctx.beginPath();
      ctx.arc(sx, sy, u * 0.014, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMeter(ctx, m, x, y, w, h, t) {
    const bz = h * 0.07;
    const px = x + w / 2, py = y + h * 1.12; // pivot sits below the face, out of sight
    const ra = h * 0.9;

    const bezel = ctx.createLinearGradient(0, y - bz, 0, y + h + bz);
    bezel.addColorStop(0, '#8d8d90');
    bezel.addColorStop(0.5, '#3a3a3d');
    bezel.addColorStop(1, '#0d0d0e');
    rr(ctx, x - bz, y - bz, w + 2 * bz, h + 2 * bz, h * 0.1);
    ctx.fillStyle = bezel;
    ctx.fill();

    ctx.save();
    rr(ctx, x, y, w, h, h * 0.06);
    ctx.clip();

    // Backlit face: the lamp brightens slightly as the needle rises
    const lamp = 0.86 + 0.14 * Math.min(1, m.pos) + 0.01 * Math.sin(t / 90);
    const face = ctx.createRadialGradient(px, y + h * 0.5, h * 0.05, px, y + h * 0.5, w * 0.7);
    face.addColorStop(0, `hsl(47 92% ${80 * lamp}%)`);
    face.addColorStop(1, `hsl(32 85% ${46 * lamp}%)`);
    ctx.fillStyle = face;
    ctx.fillRect(x, y, w, h);

    // Scale: arc, red zone, ticks and numbers
    const ink = '#2a1a0c';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, h * 0.012);
    ctx.beginPath();
    ctx.arc(px, py, ra, A0, A1);
    ctx.stroke();
    ctx.strokeStyle = '#b3281c';
    ctx.lineWidth = Math.max(3, h * 0.035);
    ctx.beginPath();
    ctx.arc(px, py, ra, A0 + 0.8 * 2 * SWEEP, A1);
    ctx.stroke();

    for (let k = 0; k <= 25; k++) {
      const a = A0 + (k / 25) * 2 * SWEEP;
      ctx.strokeStyle = k / 25 >= 0.8 ? '#b3281c' : ink;
      ctx.lineWidth = Math.max(1, h * 0.008);
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * ra, py + Math.sin(a) * ra);
      ctx.lineTo(px + Math.cos(a) * ra * 1.05, py + Math.sin(a) * ra * 1.05);
      ctx.stroke();
    }
    ctx.font = `bold ${Math.max(8, h * 0.085)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [text, f] of MARKS) {
      const a = A0 + f * 2 * SWEEP;
      ctx.strokeStyle = f >= 0.8 ? '#b3281c' : ink;
      ctx.lineWidth = Math.max(1.5, h * 0.014);
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * ra, py + Math.sin(a) * ra);
      ctx.lineTo(px + Math.cos(a) * ra * 1.09, py + Math.sin(a) * ra * 1.09);
      ctx.stroke();
      ctx.fillStyle = f >= 0.8 ? '#b3281c' : ink;
      ctx.fillText(text, px + Math.cos(a) * ra * 0.86, py + Math.sin(a) * ra * 0.86);
    }
    ctx.fillStyle = ink;
    ctx.font = `bold ${Math.max(9, h * 0.1)}px Georgia, serif`;
    ctx.fillText(m.label.split('').join(' '), px, y + h * 0.7);
    ctx.font = `italic ${Math.max(8, h * 0.07)}px Georgia, serif`;
    ctx.fillText('VU', x + w * 0.12, y + h * 0.86);

    // Peak lamp
    const lit = Math.max(0, Math.min(1, (m.pos - 0.78) / 0.2));
    ctx.fillStyle = lit > 0 ? `rgb(255 ${70 + lit * 40} 50)` : '#5a1b14';
    ctx.shadowColor = '#ff3b2f';
    ctx.shadowBlur = lit * h * 0.15;
    ctx.beginPath();
    ctx.arc(x + w * 0.88, y + h * 0.16, h * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Needle, with a soft shadow on the face
    const ang = A0 + Math.max(-0.04, Math.min(1.06, m.pos)) * 2 * SWEEP;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.lineCap = 'round';
    for (const [ox, oy, colour, width] of [[h * 0.02, h * 0.03, 'rgba(0,0,0,0.28)', h * 0.016], [0, 0, '#16120e', Math.max(1.5, h * 0.011)]]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(px + ox, py + oy);
      ctx.lineTo(px + dx * h * 1.0 + ox, py + dy * h * 1.0 + oy);
      ctx.stroke();
    }

    // Glass glare and inner shadow
    const glare = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.9);
    glare.addColorStop(0, 'rgba(255,255,255,0.36)');
    glare.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = h * 0.06;
    rr(ctx, x, y, w, h, h * 0.06);
    ctx.stroke();
    ctx.restore();
  }

  function draw(api) {
    const { ctx, W, H, state, clearStage } = api;
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;

    // Each needle is a damped spring chasing its band's level (normalised to a slowly
    // decaying peak so the quiet treble band still swings), so it overshoots and settles.
    for (const m of meters) {
      const v = state[m.key];
      m.peak = Math.max(v, m.peak - dt * 0.08);
      const target = Math.min(1.08, (v / Math.max(0.2, m.peak)) * 0.9);
      m.vel += ((target - m.pos) * 220 - m.vel * 20) * dt;
      m.pos += m.vel * dt;
      if (m.pos < 0) { m.pos = 0; m.vel = Math.abs(m.vel) * 0.3; }
      if (m.pos > 1.06) { m.pos = 1.06; m.vel = -Math.abs(m.vel) * 0.3; }
    }

    clearStage();
    const mw = Math.min((W * 0.94) / 3.56, (H * 0.76) / 1.187);
    const mh = mw / 1.5, pad = mw * 0.16, gap = mw * 0.12;
    const strip = mw * 0.2;
    const pw = 3 * mw + 2 * gap + 2 * pad;
    const ph = pad + strip + mh + pad;
    const x0 = (W - pw) / 2, y0 = (H - ph) / 2 - H * 0.03;

    drawCabinet(ctx, x0, y0, pw, ph, mw);

    // Title strip: badge on the left, lamp that blinks on the beat on the right
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,214,170,0.9)';
    ctx.font = `italic ${strip * 0.42}px Georgia, serif`;
    ctx.fillText('S T E R E O   R E C E I V E R', x0 + pad, y0 + pad + strip * 0.36);
    ctx.save();
    ctx.fillStyle = `rgb(255 ${150 + state.beat * 70} ${40 + state.beat * 60})`;
    ctx.globalAlpha = 0.35 + 0.65 * state.beat;
    ctx.shadowColor = '#ffa42b';
    ctx.shadowBlur = strip * (0.2 + state.beat * 0.9);
    ctx.beginPath();
    ctx.arc(x0 + pw - pad - strip * 0.35, y0 + pad + strip * 0.36, strip * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const my = y0 + pad + strip;
    meters.forEach((m, i) => drawMeter(ctx, m, x0 + pad + i * (mw + gap), my, mw, mh, t));
  }

  MRD.register({ name: 'Stereo', draw });
})();
