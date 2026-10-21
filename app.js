(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const intro = document.getElementById('intro');

  // ---------- Audio setup ----------
  let audioCtx = null;
  let analyser = null;
  let freq = null;   // Uint8Array, frequency magnitudes 0-255
  let wave = null;   // Uint8Array, time-domain samples 0-255
  let micSource = null;
  let micStream = null;

  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    freq = new Uint8Array(analyser.frequencyBinCount);
    wave = new Uint8Array(analyser.fftSize);
    // Narrow band-pass filters, each with its own small analyser, for finer features than the FFT bins give.
    bands.sub = makeBand(75, 1.5, 512);       // about 50-100 Hz
    bands.high = makeBand(9600, 1.5, 1024);   // about 6.4-12.8 kHz
    // An unsmoothed analyser for beat detection (the main one is smoothed, which blurs attacks).
    onset.an = audioCtx.createAnalyser();
    onset.an.fftSize = 1024;
    onset.an.smoothingTimeConstant = 0;
    onset.cur = new Uint8Array(onset.an.frequencyBinCount);
    onset.prev = new Uint8Array(onset.an.frequencyBinCount);
  }

  const onset = { an: null, cur: null, prev: null, hist: [], peak: 0, frames: 0 };

  const bands = {};
  function makeBand(centre, q, fftSize) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centre;
    filter.Q.value = q;
    const an = audioCtx.createAnalyser();
    an.fftSize = fftSize;
    an.smoothingTimeConstant = 0;
    filter.connect(an);
    return { filter, an, buf: new Float32Array(fftSize), peak: 0.02 };
  }

  const deviceSelect = document.getElementById('device');

  // Errors show on the stage rather than in a popup, so they are visible in OBS too.
  function notify(message) {
    intro.querySelector('p').textContent = message;
    intro.classList.add('error');
    intro.classList.remove('hidden');
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage may be blocked */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // Labels are blank until the user has granted permission once.
  async function refreshDevices(selectedId) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    const wanted = selectedId || deviceSelect.value || recall('deviceId') || '';
    const track = micStream && micStream.getAudioTracks()[0];
    const activeId = track && track.getSettings().deviceId;
    const named = inputs.filter(d => d.label || d.deviceId === activeId);
    deviceSelect.innerHTML = '';
    if (named.length === 0) {
      // No permission yet, so the browser hides device names.
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Press Listen to choose an input';
      deviceSelect.appendChild(opt);
      return;
    }
    named.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || (d.deviceId === activeId && track.label) || 'Unnamed input';
      deviceSelect.appendChild(opt);
    });
    if (named.some(d => d.deviceId === wanted)) deviceSelect.value = wanted;
  }

  async function startMic(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify('Audio input needs a secure page. Open this page via http://localhost, ' +
             'https://, or file:// (plain http:// to a network address is blocked by the browser).');
      return;
    }
    ensureAudio();
    if (micStream) stopMic();
    // Voice-call processing squashes and distorts music, so switch it all off.
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      notify('Audio input unavailable: ' + err.message);
      return;
    }
    micSource = audioCtx.createMediaStreamSource(micStream);
    // The analyser is never connected to the speakers, so there is no feedback.
    micSource.connect(analyser);
    micSource.connect(onset.an);
    micSource.connect(bands.sub.filter);
    micSource.connect(bands.high.filter);
    document.getElementById('mic').classList.add('active');
    document.getElementById('mic').textContent = 'Stop';
    intro.classList.add('hidden');
    intro.classList.remove('error');

    const activeId = micStream.getAudioTracks()[0].getSettings().deviceId;
    await refreshDevices(activeId);
    if (deviceSelect.value) store('deviceId', deviceSelect.value);
  }

  function stopMic() {
    if (!micStream) return;
    micStream.getTracks().forEach(t => t.stop());
    micSource.disconnect();
    micStream = micSource = null;
    document.getElementById('mic').classList.remove('active');
    document.getElementById('mic').textContent = 'Listen';
  }

  document.getElementById('mic').addEventListener('click', () =>
    (micStream ? stopMic() : startMic(deviceSelect.value || recall('deviceId'))));
  deviceSelect.addEventListener('change', () => {
    store('deviceId', deviceSelect.value);
    if (micStream) startMic(deviceSelect.value);
  });
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    refreshDevices().catch(() => {});
    navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
  }

  // Sensitivity and noise gate are applied in software, after the analyser.
  const sensInput = document.getElementById('sens');
  const gateInput = document.getElementById('gate');
  const saved = { sens: recall('sens'), gate: recall('gate') };
  if (saved.sens !== null) sensInput.value = saved.sens;
  if (saved.gate !== null) gateInput.value = saved.gate;
  sensInput.addEventListener('input', () => store('sens', sensInput.value));
  gateInput.addEventListener('input', () => store('gate', gateInput.value));

  // ---------- Analysis ----------
  const state = {
    bass: 0, mid: 0, treble: 0, level: 0,
    beat: 0,          // 1 on a beat, decays to 0
    onset: false,     // true for exactly one frame when a beat is detected
    hue: 200,
    bassAvg: 0,
    lastBeat: 0,
    // Finer features (see analyse / trackTempo), all 0-1:
    subBass: 0,       // kick-drum / bass-line energy, 50-100 Hz
    high: 0,          // cymbals and hi-hats, 6.4-12.8 kHz
    snap: 0,          // how sharply the loudness just rose (percussive attacks)
    clarity: 0.5,     // how regular the detected beats are (1 = steady pulse, 0 = no clear pulse)
    intensity: 0,     // recent loudness relative to this source's own peak (so quiet sources still reach 1)
    punch: 0,         // bass right now relative to this source's bass peak
    relLevel: 0,      // loudness right now relative to this source's peak (unsmoothed intensity)
    locked: false,    // true while the beat clock is following detected beats (false in silence or with no beat)
    onsetCount: 0,    // beats detected so far
    // Beat clock (see trackTempo): a steady tempo locked to the detected beats.
    period: 500,      // ms per beat
    bpm: 120,
    beatTime: 0,      // timestamp of a beat on the clock
    phase: 0,         // 0-1 position within the current beat
    tick: false,      // true for one frame at the start of each beat
    beatCount: 0,     // beats since the page loaded (or since the music last restarted)
  };
  MRD.state = state;  // exposed for debugging in the browser console

  function bandEnergy(loHz, hiHz) {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const lo = Math.max(0, Math.floor(loHz / binHz));
    const hi = Math.min(freq.length - 1, Math.ceil(hiHz / binHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freq[i];
    return sum / ((hi - lo + 1) * 255);
  }

  const snapState = { rms: 0, last: 0, peak: 2 };
  const loud = { peak: 0, avg: 0, bassPeak: 0 };

  function analyse(now) {
    state.onset = false;
    if (!analyser) {
      state.bass = state.mid = state.treble = state.level = 0;
      state.subBass = state.high = state.snap = state.punch = state.relLevel = 0;
      state.intensity *= 0.98;
      state.beat *= 0.9;
      return;
    }
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);

    // Sensitivity: 0-100 slider mapped to 0.25x-4x. Gate: drop everything below a floor.
    const gain = Math.pow(4, (Number(sensInput.value) - 50) / 50);
    const floor = Number(gateInput.value) / 100 * 255;
    for (let i = 0; i < freq.length; i++) {
      const v = freq[i] * gain;
      freq[i] = v <= floor ? 0 : Math.min(255, (v - floor) / (255 - floor) * 255);
    }
    let peak = 0;
    for (let i = 0; i < wave.length; i++) {
      wave[i] = Math.max(0, Math.min(255, 128 + (wave[i] - 128) * gain));
      peak = Math.max(peak, Math.abs(wave[i] - 128));
    }
    if (peak < floor * 0.5) wave.fill(128);

    state.bass = bandEnergy(20, 150);
    state.mid = bandEnergy(150, 2000);
    state.treble = bandEnergy(2000, 10000);
    state.level = (state.bass + state.mid + state.treble) / 3;

    // Band levels: RMS of each filtered band, scaled by the sensitivity and gate, then
    // normalised to a slowly-decaying peak so quiet bands still swing. Quick attack, short decay.
    const gateAmp = Number(gateInput.value) / 100 * 0.3;
    const bandLevel = b => {
      b.an.getFloatTimeDomainData(b.buf);
      let sum = 0;
      for (let i = 0; i < b.buf.length; i++) sum += b.buf[i] * b.buf[i];
      const rms = Math.max(0, Math.sqrt(sum / b.buf.length) * gain - gateAmp);
      b.peak = Math.max(rms, b.peak * 0.9995, 0.02);
      return Math.min(1, rms / b.peak);
    };
    state.subBass = Math.max(bandLevel(bands.sub), state.subBass * 0.85);
    state.high = Math.max(bandLevel(bands.high), state.high * 0.85);

    // Percussive snap: slope of the overall loudness envelope, normalised to its recent peak.
    let sq = 0;
    for (let i = 0; i < wave.length; i++) sq += ((wave[i] - 128) / 128) ** 2;
    const rmsNow = Math.sqrt(sq / wave.length);
    const dtSec = Math.max(0.001, (now - snapState.last) / 1000);
    const slope = Math.max(0, (rmsNow - snapState.rms) / dtSec);
    snapState.rms = rmsNow;
    snapState.last = now;
    snapState.peak = Math.max(slope, snapState.peak * 0.999, 2);
    state.snap = Math.max(Math.min(1, slope / snapState.peak), state.snap * 0.88);

    // Loudness relative to this source's own recent peak, so a quiet loopback behaves like a loud one.
    loud.peak = Math.max(state.level, loud.peak * 0.9997);   // forgets over about 40 s
    loud.avg += (state.level - loud.avg) * 0.015;             // about a second of smoothing
    loud.bassPeak = Math.max(state.bass, loud.bassPeak * 0.9997);
    state.intensity = Math.min(1, loud.avg / Math.max(0.08, loud.peak * 0.9));
    state.punch = Math.min(1, state.bass / Math.max(0.15, loud.bassPeak));
    state.relLevel = Math.min(1, state.level / Math.max(0.08, loud.peak * 0.9));

    // Beat detection: bass jumps above its recent running average and above a floor that is
    // relative to the bass this source actually produces (about 0.35 for a loud source, lower for a quiet one).
    state.bassAvg += (state.bass - state.bassAvg) * 0.05;
    const bassHit = state.bass > state.bassAvg * 1.3 && state.bass > Math.max(0.12, 0.45 * loud.bassPeak);

    // Spectral flux: how much the spectrum (in decibels, so independent of loudness) just rose, with
    // the low end weighted double. A beat is a flux spike well above its recent level. Unlike the
    // bass rule above, this still works when the bass is already high or saturated.
    onset.an.getByteFrequencyData(onset.cur);
    let flux = 0;
    for (let i = 1; i < 116; i++) { // up to about 5 kHz
      const d = onset.cur[i] - onset.prev[i];
      if (d > 0) flux += i < 6 ? d * 2 : d;
    }
    onset.prev.set(onset.cur);
    // The first frames compare against nothing, so they are ignored; then about a second of history is
    // needed before judging. A beat must be a clear multiple of the typical flux, so hiss never qualifies.
    onset.frames++;
    let fluxHit = false;
    if (onset.frames > 2) {
      onset.hist.push(flux);
      if (onset.hist.length > 60) onset.hist.shift();
      const fMean = onset.hist.reduce((a, b) => a + b, 0) / onset.hist.length;
      const fSd = Math.sqrt(onset.hist.reduce((a, b) => a + (b - fMean) ** 2, 0) / onset.hist.length);
      onset.peak = Math.max(flux, onset.peak * 0.999);
      fluxHit = onset.hist.length >= 30 && flux > Math.max(40, fMean + 1.5 * fSd, 2.2 * fMean, 0.3 * onset.peak);
    }

    // (Nothing counts in the first second after the audio starts: the averages haven't settled yet.)
    if ((bassHit || fluxHit) && onset.frames > 60 && now - state.lastBeat > 220) {
      state.beat = 1;
      state.onset = true;
      state.onsetCount++;
      state.lastBeat = now;
    }
    state.beat *= 0.92;
    state.hue = (state.hue + 0.2 + state.bass * 2) % 360;
  }

  // ---------- Tempo ----------
  // Estimates BPM from the gaps between detected beats and runs a steady beat clock
  // that visuals can dance to. It keeps ticking through breaks, and re-syncs after
  // a few seconds of silence (a new track).
  const tempo = { intervals: [], gaps: [], prevOnset: 0, lastIndex: null };

  function trackTempo(now) {
    if (state.onset) {
      if (!tempo.prevOnset || now - tempo.prevOnset > 3000) {
        state.beatTime = now;
        tempo.intervals = [];
        tempo.gaps = [];
      } else {
        let gap = now - tempo.prevOnset;
        if (gap > 150) { // pulse clarity: how even the raw gaps between beats are
          tempo.gaps.push(gap);
          if (tempo.gaps.length > 8) tempo.gaps.shift();
          if (tempo.gaps.length >= 4) {
            const mean = tempo.gaps.reduce((a, b) => a + b, 0) / tempo.gaps.length;
            const sd = Math.sqrt(tempo.gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / tempo.gaps.length);
            state.clarity += (1 - Math.min(1, sd / mean) - state.clarity) * 0.3;
          }
        }
        if (gap > 200) {
          while (gap < 333) gap *= 2;      // fold into 60-180 BPM
          while (gap >= 1000) gap /= 2;
          tempo.intervals.push(gap);
          if (tempo.intervals.length > 12) tempo.intervals.shift();
          const sorted = [...tempo.intervals].sort((a, b) => a - b);
          state.period += (sorted[Math.floor(sorted.length / 2)] - state.period) * 0.25;
          state.bpm = 60000 / state.period;
        }
        // Nudge the clock towards hits that land near a beat; ignore off-beat ones.
        const pos = (now - state.beatTime) / state.period;
        const err = pos - Math.round(pos);
        if (Math.abs(err) < 0.25) state.beatTime += err * state.period * 0.4;
      }
      tempo.prevOnset = now;
    }
    state.locked = tempo.prevOnset > 0 && now - tempo.prevOnset < 2500;   // following beats, not free-running
    if (!state.locked) state.clarity *= 0.99;                               // no beats: the pulse fades
    const beats = (now - state.beatTime) / state.period;
    const index = Math.floor(beats);
    state.phase = beats - index;
    state.tick = tempo.lastIndex !== null && index > tempo.lastIndex;
    if (state.tick) state.beatCount++;
    tempo.lastIndex = index;
  }

  // ---------- Display settings (URL parameters override saved choices) ----------
  // ?clean            hide all controls (for OBS)
  // ?bg=black|green|transparent
  // ?visual=<name>
  // ?device=<part of an input's name>   (picked automatically in clean mode)
  const params = new URLSearchParams(location.search);
  const clean = params.has('clean');
  const BACKGROUNDS = {
    black: { rgb: '0,0,0' },
    green: { rgb: '0,255,0' },
    transparent: null,
  };
  const bgSelect = document.getElementById('bg');
  let bg = [params.get('bg'), recall('bg'), 'black']
    .find(v => v && Object.hasOwn(BACKGROUNDS, v));

  if (clean) document.documentElement.classList.add('clean');

  function setBackground(name) {
    bg = name;
    bgSelect.value = name;
    document.documentElement.dataset.bg = name;
    store('bg', name);
    clearStage();
  }
  bgSelect.addEventListener('change', () => setBackground(bgSelect.value));

  // ---------- Rendering ----------
  let W = 0, H = 0, dpr = 1;

  function clearStage() {
    ctx.globalCompositeOperation = 'source-over';
    if (BACKGROUNDS[bg] === null) {
      ctx.clearRect(0, 0, W, H);
    } else {
      ctx.fillStyle = `rgb(${BACKGROUNDS[bg].rgb})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearStage();
  }
  window.addEventListener('resize', resize);
  resize();

  // Log-spaced value for bar i of n, 30 Hz to 16 kHz.
  function barValue(i, n) {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const f0 = 30 * Math.pow(16000 / 30, i / n);
    const f1 = 30 * Math.pow(16000 / 30, (i + 1) / n);
    const lo = Math.floor(f0 / binHz);
    const hi = Math.max(lo, Math.floor(f1 / binHz));
    let max = 0;
    for (let b = lo; b <= hi && b < freq.length; b++) if (freq[b] > max) max = freq[b];
    return max / 255;
  }

  // Fades the previous frame towards the background, leaving motion trails.
  function fade(alpha) {
    if (BACKGROUNDS[bg] === null) {
      // Transparent: erase a little of what is already drawn.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${BACKGROUNDS[bg].rgb},${alpha})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  const spec = (i, n) => (freq ? barValue(i, n) : 0);

  // Everything a visual may use (documented in registry.js). Values that change
  // over time are refreshed every frame before draw() is called.
  const api = { ctx, state, fade, clearStage, spec, W: 0, H: 0, freq: null, wave: null, bgRgb: null };

  // Visuals live in visuals/*.js and register themselves with MRD.register()
  // (see registry.js), in the order their <script> tags appear in index.html.
  const VISUALS = MRD.visuals;
  const visualSelect = document.getElementById('visual');
  let current = 0;

  VISUALS.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = v.name;
    visualSelect.appendChild(opt);
  });

  function findVisual(key) {
    if (!key) return -1;
    return VISUALS.findIndex(v => v.name.toLowerCase() === key.toLowerCase());
  }

  function setVisual(i) {
    current = (i + VISUALS.length) % VISUALS.length;
    visualSelect.value = current;
    store('visual', VISUALS[current].name);
    clearStage();
  }
  visualSelect.addEventListener('change', () => setVisual(Number(visualSelect.value)));
  document.getElementById('prev').addEventListener('click', () => setVisual(current - 1));
  document.getElementById('next').addEventListener('click', () => setVisual(current + 1));

  function frame(now) {
    analyse(now);
    trackTempo(now);
    api.W = W;
    api.H = H;
    api.freq = freq;
    api.wave = wave;
    api.bgRgb = BACKGROUNDS[bg] ? BACKGROUNDS[bg].rgb : null;
    VISUALS[current].draw(api);
    requestAnimationFrame(frame);
  }

  setBackground(bg);
  setVisual(Math.max(0, [findVisual(params.get('visual')), findVisual(recall('visual'))]
    .find(i => i >= 0) ?? 0));
  requestAnimationFrame(frame);

  // ---------- UI: fullscreen, keys, idle-hide ----------
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  document.getElementById('full').addEventListener('click', toggleFullscreen);

  // Build a link for an OBS Browser Source that reproduces the current look.
  document.getElementById('obslink').addEventListener('click', async e => {
    const q = new URLSearchParams({ clean: '', visual: VISUALS[current].name.toLowerCase(), bg });
    const opt = deviceSelect.selectedOptions[0];
    if (micStream && opt && opt.value) q.set('device', opt.textContent);
    const url = location.origin + location.pathname + '?' + q.toString().replace('clean=', 'clean');
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy OBS link'; }, 1500);
    } catch (err) {
      prompt('Copy this link into an OBS Browser Source:', url);
    }
  });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') setVisual(current + 1);
    else if (e.key === 'ArrowLeft') setVisual(current - 1);
    else if (e.key === 'b' || e.key === 'B') {
      const names = Object.keys(BACKGROUNDS);
      setBackground(names[(names.indexOf(bg) + 1) % names.length]);
    }
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!intro.classList.contains('hidden')) return;
      document.body.classList.add('idle');
    }, 3000);
  }
  window.addEventListener('mousemove', wake);
  window.addEventListener('keydown', wake);
  wake();

  // In clean mode there is nobody to press Listen, so start straight away,
  // then switch to the input named in ?device= once the browser reveals names.
  async function autostart() {
    await startMic(recall('deviceId'));
    const wanted = (params.get('device') || '').toLowerCase();
    if (!wanted || !micStream) return;
    const match = [...deviceSelect.options].find(o => o.textContent.toLowerCase().includes(wanted));
    if (match && match.value !== deviceSelect.value) await startMic(match.value);
  }
  if (clean) autostart().catch(err => notify(err.message));
})();
