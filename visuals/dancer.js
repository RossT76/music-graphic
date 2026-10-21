// Neon dancer: a front-view skeleton that dances in time with the music.
//
// How it works:
//  - The engine's beat clock gives a continuous beat position (beatCount + phase).
//  - The body is split into two layers, as in real dance (and in dance-generation research):
//      lower body (pelvis, legs, feet): bounce and steps, locked to the beat and the balance;
//      upper body (torso, arms, head): expressive gestures.
//    Each layer has its own moves, and the choreography (below) combines them, so lower x upper
//    pairings give lots of variety.
//  - A move is a function of the beat position: weight shifts and bounces are smooth
//    curves, but the arms and shoulders take discrete hits on the beat or the "and" and settle between them,
//    like a real dancer's accents. Amplitude follows how loud the music is. Moves are timed so
//    the body stops (a "kinematic beat") on the beat.
//  - The torso counter-leans and the shoulders counter-tilt against the hips automatically.
//  - Every joint chases its value through a stiff spring. Feet stay planted: knees are solved
//    with 3D two-bone IK (bending forward, which foreshortens the legs from the front).
//  - Audio features: sub-bass deepens the knee bounce, high frequencies flick the wrists and
//    head, sharp attacks stiffen the springs (crisper stops), and a steady pulse allows cadenced
//    footwork - when the pulse is unclear the feet settle and the arms "search".
//  - Real drum hits add a small accent; big bass hits launch a jump.
//  - It has a plan, like a human dancer. Moves are arranged in 8-beat phrases (see "Choreography"
//    below): a motif is stated, repeated, answered on the other side, varied, then returned to.
//    Transitions start two beats early so the new move arrives on the downbeat, and it reads the
//    track's arc: calm breakdowns, builds, and drops (which re-anchor the phrasing).
//  - With silence, or no beat to follow, it stops dancing and just breathes and sways. It only
//    dances while the engine's beat clock is locked to real beats.
//
// Add ?debug to see what the dancer hears (tempo, lock, clarity, loudness).
// Preview with ?move=<name>[,<name>] (e.g. ?move=kick%20step,swing), or MRD.dancer.pin('kick step', 'swing').
(() => {
  'use strict';

  const D2R = Math.PI / 180;
  const TAU = Math.PI * 2;

  // Body proportions, as fractions of the dancer's height.
  const P = { thigh: 0.25, shin: 0.25, torso: 0.28, shoulder: 0.1, neck: 0.04, head: 0.06, upper: 0.17, fore: 0.16, hand: 0.05, pelvis: 0.045 };

  // Channels. Lower body: hip sway/dip/tilt (tilt raises the right hip), feet (distance from
  // the centre line, lift), knee swivel (swiv: positive swings the knee outward, negative in across the other leg). Upper body: extra lean, head tilt, shoulder roll (positive raises the
  // left shoulder), shrug, head nod, chest (torso lengthens, as the chest opens), widen (shoulders look wider,
  // as the chest comes toward the viewer), arms [upper, fore] (0 = down, 90 = out sideways, 180 = up,
  // outward positive, negative crosses the body). Left/right are screen-left/screen-right.
  // Every lower-body move uses this stance width, so crossfading between moves never drags a planted foot.
  const STANCE = 0.095;
  const LOW_KEYS = ['sway', 'dip', 'hipTilt', 'fxL', 'fxR', 'liftL', 'liftR', 'swivL', 'swivR'];
  const UP_KEYS = ['lean', 'tilt', 'roll', 'shrug', 'nod', 'chest', 'widen', 'aL0', 'aL1', 'aR0', 'aR1'];
  const KEYS = LOW_KEYS.concat(UP_KEYS);
  const IS_LOW = new Set(LOW_KEYS);
  const FAST = new Set(['liftL', 'liftR', 'fxL', 'fxR']);   // light feet respond faster than the hips
  const FAST_FACTOR = 2;
  const ch = o => ({ sway: 0, dip: 0.02, hipTilt: 0, fxL: STANCE, fxR: STANCE, liftL: 0, liftR: 0, swivL: 0, swivR: 0,
    lean: 0, tilt: 0, roll: 0, shrug: 0, nod: 0, chest: 0, widen: 0, aL0: 15, aL1: 12, aR0: 15, aR1: 12, ...o });

  const sn = (b, n, o = 0) => Math.sin(TAU * (b / n + o));   // sine with a period of n beats
  const cs = (b, n, o = 0) => Math.cos(TAU * (b / n + o));
  const bump = b => 0.5 + 0.5 * Math.cos(TAU * b);            // 1 on the beat, 0 on the off-beat
  const ease = x => x * x * (3 - 2 * x);
  const frac = x => x - Math.floor(x);
  // A pop: a hit at `at` (in beats, so 0.5 is the "and"), then a settle. Real groove loads energy
  // unevenly - a quick attack and a slow recovery - and lives on the off-beats as much as the beats.
  const pop = (b, at = 0, k = 5) => Math.exp(-k * frac(b - at));
  // The same hit repeating every n beats (n = 2 alternates left and right on successive beats).
  const popEvery = (b, n, at = 0, k = 5) => Math.exp(-k * frac((b - at) / n) * n);
  // One leap (a jump or hop) per beat, as a sequence for the legs, with u = position in the beat:
  //   u 0     landing, deepest crouch (the knees have absorbed the impact - this is the stop on the beat)
  //   u 0.25  the legs have pushed straight and the feet leave the floor
  //   u 0.5   the apex, knees tucked (the hips are highest, the feet lifted: the legs are bent, not straight)
  //   u 0.75  touchdown with the legs straight again, then absorbing into the next crouch
  // Hips and feet do NOT simply rise together: the crouch and the push are what make it read as a jump.
  const leap = (u, A) => {
    const k = (a, b) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))));
    const crouch = 0.06 + 0.04 * A;
    let dip;
    if (u < 0.25) dip = mix(crouch, 0, k(0, 0.25));
    else if (u < 0.5) dip = mix(0, -0.02, k(0.25, 0.5));
    else if (u < 0.75) dip = mix(-0.02, 0, k(0.5, 0.75));
    else dip = mix(0, crouch, k(0.75, 1));
    const lift = u > 0.25 && u < 0.75 ? (0.05 + 0.04 * A) * Math.sin(Math.PI * (u - 0.25) / 0.5) : 0;
    return { dip, lift };
  };
  // Kinetic chain: the forearm follows the upper arm by this many beats (and the hand follows the forearm
  // through its own spring), so motion travels down the arm like a whip. A move can set `chain` to scale it.
  const CHAIN = 0.08;
  const mix = (a, b, t) => a + (b - a) * t;
  const pos = Math.max;

  // level: how energetic the music must be (0 calm, 1 medium, 2 high). snap: spring stiffness
  // multiplier. f(b, A): channels at beat position b with amplitude A (0.55-1); a layer only
  // reads its own channels, so a move can leave the other half at the defaults.

  // ----- Lower body: cadence and weight -----
  // The style: an untrained dancer in a nightclub - relaxed, small, loose in the knees, on the beat, with the
  // life in the off-beats. Disco in feel (four-on-the-floor, hip and shoulder), not 1970s routines.
  // `sync` marks moves whose accents sit on the "and", so they are graded on the 8th-note grid.
  const LOWER = [
    { name: 'bounce', family: 'ground', level: 0, snap: 1, f: (b, A) => ch({
      sway: 0.04 * A * cs(b, 2), dip: 0.025 + 0.04 * A * bump(b), hipTilt: 0.015 * A * cs(b, 2) }) },

    { name: 'rock', family: 'ground', level: 0, snap: 1, f: (b, A) => ch({
      sway: 0.08 * A * sn(b, 4), dip: 0.05 + 0.015 * A * cs(b, 4) + 0.045 * A * bump(b), hipTilt: 0.025 * A * sn(b, 4) }) },

    // Dropping into a relaxed pocket: knees soft, a small extra bounce on the "and".
    { name: 'down groove', family: 'ground', level: 0, sync: true, snap: 1, f: (b, A) => ch({
      sway: 0.03 * A * cs(b, 2), dip: 0.06 + 0.035 * A * bump(b) + 0.015 * A * pop(b, 0.5, 6), hipTilt: 0.02 * A * cs(b, 2),
      swivL: 0.35 * A * cs(b, 2), swivR: -0.35 * A * cs(b, 2) }) },

    // Weight arrives over one foot on the beat, then the other touches in. Small and relaxed.
    { name: 'step', family: 'weight', level: 1, pulse: true, snap: 1, f: (b, A) => {
      const w = cs(b, 2); // +1: weight on the right foot, left foot free
      const free = x => ease(Math.min(1, pos(0, (x - 0.85) / 0.15)));
      return ch({
        sway: STANCE * w, dip: 0.03 + 0.04 * A * bump(b), hipTilt: 0.02 * A * w,
        liftL: 0.09 * A * free(w), liftR: 0.09 * A * free(-w),
        fxL: STANCE - 0.04 * free(w), fxR: STANCE - 0.04 * free(-w) });
    } },

    // A step-touch that throws one kick every fourth beat. The weight stays fully over the support foot while
    // the other comes up (the window is a third of a beat either side of the beat); the kick swings out to the
    // side and peaks on the beat, the touches in between come in toward the other foot.
    { name: 'kick step', family: 'weight', level: 2, pulse: true, snap: 1.2, f: (b, A) => {
      const w = Math.max(-1, Math.min(1, 2 * cs(b, 2)));         // +1: weight on the right foot, left foot free
      const x = frac(b + 0.5) - 0.5;                              // time from the nearest beat, -0.5..0.5
      const u = (x + 1 / 3) / (2 / 3);                            // 0..1 across the free window
      const bell = Math.abs(w) >= 1 && u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
      const kicking = Math.round(b) % 4 === 3;
      const lift = (kicking ? 0.2 : 0.07) * A * bell;
      const out = kicking ? 0.12 * bell * bell : -0.04 * bell * bell;   // follows the lift, so no travel while on the floor
      return ch({
        sway: STANCE * w, dip: 0.03 + 0.04 * A * bump(b), hipTilt: 0.02 * A * w,
        liftL: w > 0 ? lift : 0, liftR: w < 0 ? lift : 0,
        fxL: STANCE + (w > 0 ? out : 0), fxR: STANCE + (w < 0 ? out : 0) });
    } },

    // Loose legs: the knees swing in and out against each other on the 8th notes while the feet stay down.
    { name: 'loose legs', family: 'ground', level: 1, sync: true, snap: 1.1, f: (b, A) => ch({
      sway: 0.03 * A * cs(b, 2), dip: 0.05 + 0.03 * A * bump(b), hipTilt: 0.01 * A * cs(b, 1),
      swivL: 0.6 * A * cs(b, 1), swivR: -0.6 * A * cs(b, 1) }) },

    // A house shuffle: weight alternates from foot to foot every 8th note, each foot just brushing off the floor.
    { name: 'shuffle', family: 'weight', level: 2, pulse: true, sync: true, snap: 1.2, f: (b, A) => {
      const w = cs(b, 1); // flips every half beat
      const free = x => ease(Math.min(1, pos(0, (x - 0.85) / 0.15)));
      return ch({
        sway: 1.2 * STANCE * w, dip: 0.04 + 0.025 * A * bump(b * 2), hipTilt: 0.015 * A * w,   // 1.2x: the hip spring loses ~20% at this speed
        liftL: 0.065 * A * free(w), liftR: 0.065 * A * free(-w),
        fxL: STANCE - 0.015 * free(w), fxR: STANCE - 0.015 * free(-w) });
    } },

    // A hop is on ONE foot: weight over the support foot (it stays on that side for four beats, then
    // the feet swap on a landing), the other knee lifted and tucked. The support leg crouches, pushes and
    // leaves the floor like a jump (see `leap`) once the weight is over it.
    { name: 'hop', family: 'weight', level: 2, pulse: true, snap: 1.4, f: (b, A) => {
      const w = Math.max(-1, Math.min(1, 3 * cs(b, 8)));     // +1: right foot is the support foot
      const side = Math.abs(w);
      const tuck = ease(Math.min(1, pos(0, (side - 0.85) / 0.15)));   // the free leg is up only once the weight is over
      const leapNow = leap(frac(b), A);
      const dip = tuck * leapNow.dip + (1 - tuck) * (0.03 + 0.03 * A * bump(b));
      const sup = leapNow.lift * tuck, free = (0.15 + leapNow.lift) * tuck;
      return ch({
        sway: STANCE * w, dip,
        liftL: w > 0 ? free : sup, liftR: w > 0 ? sup : free,
        fxL: w > 0 ? STANCE - 0.05 * tuck : STANCE, fxR: w > 0 ? STANCE : STANCE - 0.05 * tuck });
    } },

    // A jump is on TWO feet: crouch, push, both feet leave the floor together, tuck, land on the beat.
    { name: 'jump', family: 'air', level: 2, pulse: true, snap: 1.6, f: (b, A) => {
      const { dip, lift } = leap(frac(b), A);
      return ch({ dip, liftL: lift, liftR: lift });
    } },
  ];

  // Families: 'ground' moves keep both feet down, 'weight' moves shift onto one foot, and 'air' moves leave the
  // floor on both feet. There is no sensible halfway between one-footed and two-footed, so an 'air' move is
  // only entered from, or left for, a 'ground' move (the choreography bridges through one if it has to).
  const lowerCompatible = (a, b) => a === b || (a.family !== 'air' && b.family !== 'air') || a.family === 'ground' || b.family === 'ground';

  // ----- Upper body: gesture and expression -----
  // Arms hang bent at the elbow (a forearm angle well above the upper arm's), the way relaxed arms do; the
  // forearm lags the upper arm automatically (see CHAIN) and the hand whips after the forearm.
  // The head nods on the beat in nearly everything: it is what makes a body look like it is listening.
  const nod = (b, A) => ({ nod: -0.012 * A * bump(b), tilt: 5 * A * sn(b, 4) });

  // The arms do not wave continuously. They hang, take a hit on a beat (quarter) or on the "and" (eighth), and
  // settle: `popEvery` gives the hit-and-settle, and the gaps between hits are still.
  const UPPER = [
    // Loose arms: the left arm takes a small hit on the even beats, the right on the odd, and settles between.
    { name: 'swing', level: 0, snap: 1, f: (b, A) => {
      const L = popEvery(b, 2, 0, 5), R = popEvery(b, 2, 1, 5);
      return ch({ ...nod(b, A),
        aL0: 16 + 20 * A * L, aL1: 45 + 26 * A * L, aR0: 16 + 20 * A * R, aR1: 45 + 26 * A * R });
    } },

    // Shoulders hit alternately on the beat, with a pop on the "and"; the arms hang and follow a little.
    { name: 'shoulders', level: 0, sync: true, snap: 1, f: (b, A) => {
      const L = popEvery(b, 2, 0, 6), R = popEvery(b, 2, 1, 6);
      return ch({ ...nod(b, A),
        roll: 0.022 * A * (L - R), shrug: 0.02 * A * pop(b, 0.5, 6),
        aL0: 14 + 18 * A * L, aL1: 35 + 24 * A * L, aR0: 14 + 18 * A * R, aR1: 35 + 24 * A * R });
    } },

    // The chest pops on the backbeat (beats 2 and 4): a quick push, a slow settle.
    { name: 'chest pop', level: 1, sync: true, snap: 1.2, f: (b, A) => {
      const back = pop(b / 2, 0.5, 7);       // hits at b = 1, 3, 5...
      return ch({ ...nod(b, A), nod: -0.02 * A * back,
        chest: 0.045 * A * back, widen: 0.05 * A * back, shrug: 0.02 * A * back,
        aL0: 15 + 13 * A * back, aL1: 40 + 20 * A * back, aR0: 15 + 13 * A * back, aR1: 40 + 20 * A * back });
    } },

    // House "jack": a pulse that travels up the body on every beat - pelvis (the lower body's dip), then chest,
    // then head, each an eighth of a beat later. From the front the chest push is shown with depth cues: the
    // torso lengthens and the shoulders widen a little as the chest comes forward, and the collarbones rise
    // slowly through the beat and snap down on it. The arms get one hit per beat.
    { name: 'jack ripple', level: 1, snap: 1.1, f: (b, A) => ch({
      shrug: 0.03 * A * frac(b),
      chest: 0.04 * A * bump(b - 0.125), widen: 0.04 * A * bump(b - 0.125),
      nod: -0.022 * A * bump(b - 0.25), tilt: 4 * A * sn(b, 4),
      aL0: 22 + 15 * A * pop(b, 0, 6), aL1: 25 + 22 * A * pop(b, 0, 6),
      aR0: 22 + 15 * A * pop(b, 0, 6), aR1: 25 + 22 * A * pop(b, 0, 6) }) },

    // Arms held a little out from the body, hit on the "and" - the left on the "and" of 1, the right on the "and" of 2.
    { name: 'arm hits', level: 1, sync: true, snap: 1.1, f: (b, A) => {
      const L = popEvery(b, 2, 0.5, 6), R = popEvery(b, 2, 1.5, 6);
      return ch({ ...nod(b, A), roll: 0.012 * A * (L - R),
        aL0: 38 + 35 * A * L, aL1: 70 + 35 * A * L, aR0: 38 + 35 * A * R, aR1: 70 + 35 * A * R });
    } },

    // One hand up, over the head, bouncing on the beat while the other arm hangs: "this is my song".
    { name: 'one hand up', level: 2, snap: 1, f: (b, A) => ch({ ...nod(b, A),
      aR0: 150 + 15 * A * pop(b, 0, 5), aR1: 165 + 20 * A * pop(b, 0, 5),
      aL0: 16 + 18 * A * popEvery(b, 2, 0, 5), aL1: 50 + 22 * A * popEvery(b, 2, 0, 5) }) },

    // Both hands up, taking a small hit on each beat in turn (left on the even beats, right on the odd).
    { name: 'hands up', level: 2, snap: 1, f: (b, A) => {
      const L = popEvery(b, 2, 0, 5), R = popEvery(b, 2, 1, 5);
      return ch({ ...nod(b, A), lean: 3 * A * (L - R), tilt: 5 * A * (L - R),
        aL0: 155 + 26 * A * L, aL1: 165 + 26 * A * L, aR0: 155 + 26 * A * R, aR1: 165 + 26 * A * R });
    } },
  ];

  // Rest pose: breathing and a slow sway, driven by time rather than the beat.
  const IDLE = (t, amp) => ch({
    sway: 0.015 * amp * Math.sin(t * 1.1), dip: 0.02 + 0.006 * Math.sin(t * 1.7), tilt: 3 * amp * Math.sin(t * 0.8),
    aL0: 10 + 4 * amp * Math.sin(t * 1.3), aR0: 10 + 4 * amp * Math.sin(t * 1.3 + 1.5), aL1: 8, aR1: 8 });

  const mirrorCh = c => ({ ...c,
    sway: -c.sway, hipTilt: -c.hipTilt, lean: -c.lean, tilt: -c.tilt, roll: -c.roll,
    fxL: c.fxR, fxR: c.fxL, liftL: c.liftR, liftR: c.liftL, swivL: c.swivR, swivR: c.swivL,
    aL0: c.aR0, aL1: c.aR1, aR0: c.aL0, aR1: c.aL1 });

  const spring = {};            // key -> { x, v }
  const hand = { L: { x: 12, v: 0 }, R: { x: 12, v: 0 } };   // hands trail the forearm on a loose spring (the whip)
  let lastDt = 0.016;
  KEYS.forEach(k => { spring[k] = { x: ch({})[k], v: 0 }; });
  const makeLayer = (keys, items) => ({ keys, items, cur: { item: items[0], mirror: false }, prev: null, blend: 1 });
  const lower = makeLayer(LOW_KEYS, LOWER);
  const upper = makeLayer(UP_KEYS, UPPER);
  let pinned = false;
  let last = 0;
  let energy = 0;               // slow average of the music's loudness
  let accent = 0, accentSign = 1;
  let lastJump = 0;
  const jump = { y: 0, vy: 0, wind: 0, crouch: 0, absorb: 0 };   // wind: seconds of crouch left before take-off
  let clarity = 0.5;            // pulse clarity as the dancer last saw it
  let quiet = 0;                // seconds the signal has been near silent
  let rest = 1;                 // 0 = dancing, 1 = resting (eased)
  const debug = new URLSearchParams(location.search).has('debug');
  const pulseClarity = () => clarity;

  const setLayer = (L, item, mirror) => { L.prev = L.cur; L.cur = { item, mirror }; L.blend = 0; };

  // This layer's channels at beat position b, crossfading from the previous move.
  function layerChannels(L, b, A) {
    const get = (c, bb) => (c.mirror ? mirrorCh(c.item.f(bb, A)) : c.item.f(bb, A));
    // On the upper body the forearm follows the upper arm a fraction of a beat later (a move can scale this).
    const at = c => {
      const now = get(c, b);
      const lag = CHAIN * (c.item.chain === undefined ? 1 : c.item.chain);
      if (L.keys !== UP_KEYS || lag === 0) return now;
      const late = get(c, b - lag);
      return { ...now, aL1: late.aL1, aR1: late.aR1 };
    };
    const now = at(L.cur);
    if (!L.prev || L.blend >= 1) return now;
    const before = at(L.prev), k = ease(L.blend), out = {};
    // Foot lifts and the foot spread that goes with them blend differently: the outgoing move's lift fades
    // out early and the incoming move's arrives late, so the weight has shifted over before a foot comes up
    // and both feet are down in between. (The spread is measured from the shared stance.)
    const wOut = 1 - Math.cbrt(k), wIn = k * k * k;
    for (const key of L.keys) {
      if (key === 'liftL' || key === 'liftR') out[key] = before[key] * wOut + now[key] * wIn;
      else if (key === 'fxL' || key === 'fxR') out[key] = STANCE + (before[key] - STANCE) * wOut + (now[key] - STANCE) * wIn;
      else out[key] = mix(before[key], now[key], k);
    }
    return out;
  }

  // ----- Choreography: phrases, motifs and anticipation -----
  // A phrase is 8 beats. A section is 4 phrases built from two related motifs, e.g. A A' B A
  // (A, answered on the other side, a variation, back to A). The plan is made ahead of time, and
  // each change starts two beats before the phrase so it arrives on the downbeat.
  const PHRASE = 8;
  const MOODS = { calm: [0, 0], groove: [0, 1], build: [1, 2], peak: [1, 2] };   // allowed move levels
  const choreo = { offset: 0, plan: [], started: false, mood: 'groove', beatE: [], long: 0, sum: 0, frames: 0,
    lastDrop: -99, pendingJump: false };

  // Pick a move for this mood. Cadenced moves need a steady pulse; peaks and builds favour the top level.
  function pick(items, mood, avoid) {
    const [lo, hi] = MOODS[mood];
    const steady = pulseClarity() > 0.4;
    const ok = m => !avoid.includes(m) && (steady || !m.pulse);
    let opts = items.filter(m => ok(m) && m.level >= lo && m.level <= hi);
    if (!opts.length) opts = items.filter(ok);
    if (!opts.length) opts = items;
    const weights = opts.map(m => ((mood === 'peak' || mood === 'build') && m.level === hi ? 3 : 1));
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    return opts.find((m, i) => (r -= weights[i]) < 0) || opts[0];
  }

  function newSection(mood) {
    const first = { lower: pick(LOWER, mood, []), upper: pick(UPPER, mood, []), mirror: Math.random() < 0.5 };
    // The variation keeps one layer of the motif, so the phrases feel related.
    const keepLower = Math.random() < 0.5;
    const second = { mirror: Math.random() < 0.5, ...(keepLower
      ? { lower: first.lower, upper: pick(UPPER, mood, [first.upper]) }
      : { lower: pick(LOWER, mood, [first.lower].concat(LOWER.filter(m => !lowerCompatible(first.lower, m)))), upper: first.upper }) };
    const answer = p => ({ ...p, mirror: !p.mirror });   // the same motif, on the other side
    const A = first, B = second;
    const templates = [[A, answer(A), B, A], [A, B, A, answer(B)], [A, answer(A), A, B]];
    choreo.plan = templates[Math.floor(Math.random() * templates.length)].slice();
    choreo.mood = mood;
    note('section', { mood });
  }

  function note(kind, extra = {}) {
    const log = MRD.dancer.log;
    log.push({ beat: lastBeat, kind, mood: choreo.mood, ...extra });
    if (log.length > 400) log.shift();
  }

  function applyPhrase(planned, why) {
    let ph = planned;
    if (!lowerCompatible(lower.cur.item, ph.lower)) {   // settle onto both feet first, then go on to the planned phrase
      choreo.plan.unshift(planned);
      ph = { ...planned, lower: LOWER[0] };
      why = 'bridge';
    }
    if (lower.cur.item !== ph.lower || lower.cur.mirror !== ph.mirror) setLayer(lower, ph.lower, ph.mirror);
    if (upper.cur.item !== ph.upper || upper.cur.mirror !== ph.mirror) setLayer(upper, ph.upper, ph.mirror);
    note('phrase', { why, lower: ph.lower.name, upper: ph.upper.name, mirror: ph.mirror, inPhrase: phraseBeat(lastBeat) });
  }

  const phraseBeat = n => (((n - choreo.offset) % PHRASE) + PHRASE) % PHRASE;
  let lastBeat = 0;

  // Read the track's arc from the loudness of the last few beats, relative to the track's own average.
  function readArc(n) {
    const e = choreo.beatE;
    e.push(choreo.sum / Math.max(1, choreo.frames));
    if (e.length > 16) e.shift();
    choreo.sum = 0; choreo.frames = 0;
    const avg = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);
    const last = e[e.length - 1];
    choreo.long = choreo.long ? choreo.long + (last - choreo.long) / 48 : last;
    const M = Math.max(0.05, choreo.long);
    const recent = avg(e.slice(-4)), before = avg(e.slice(-8, -4)), lead = avg(e.slice(-5, -1));
    const dropped = e.length >= 6 && last > 1.6 * Math.max(0.05, lead) && last > M && state.punch > 0.5 && n - choreo.lastDrop > 8;
    if (dropped) choreo.lastDrop = n;
    // A drop means peak for a while; a clear rise (not yet loud) is a build; quiet, either relative to the
    // track's average or in absolute terms (relative to the source's peak), is calm.
    let mood = 'groove';
    if (n - choreo.lastDrop < 8) mood = 'peak';
    else if (e.length >= 8 && recent > before * 1.2 && recent < 0.9) mood = 'build';
    else if (recent < 0.6 * M || recent < 0.4) mood = 'calm';
    else if (recent > 1.15 * M) mood = 'peak';
    return { mood, dropped };
  }

  function choreograph(n) {
    lastBeat = n;
    const { mood, dropped } = readArc(n);
    if (dropped) {                       // the drop is a downbeat: restart the phrasing from here, and hit it
      choreo.offset = n % PHRASE;
      newSection('peak');
      applyPhrase(choreo.plan.shift(), 'drop');
      choreo.pendingJump = true;
      note('drop');
      return;
    }
    if (!choreo.started) {
      choreo.started = true;
      choreo.offset = n % PHRASE;
      newSection(mood);
      applyPhrase(choreo.plan.shift(), 'start');
      return;
    }
    if (phraseBeat(n) === PHRASE - 2) {  // lead-in: head for the next phrase now, so it lands on the downbeat
      const shifted = mood !== choreo.mood && (mood === 'calm' || choreo.mood === 'calm' || mood === 'peak' || mood === 'build');
      if (!choreo.plan.length || shifted) newSection(mood);
      applyPhrase(choreo.plan.shift(), 'lead-in');
    }
  }

  // Freeze the dancer on named moves (for preview and testing).
  function unpin() { pinned = false; choreo.started = false; choreo.plan = []; }

  function pin(...names) {
    pinned = true;
    for (const name of names) {
      const n = String(name).trim().toLowerCase();
      const lo = LOWER.find(m => m.name === n), up = UPPER.find(m => m.name === n);
      if (lo) setLayer(lower, lo, false);
      if (up) setLayer(upper, up, false);
    }
  }
  const wanted = new URLSearchParams(location.search).get('move');
  if (wanted) pin(...wanted.split(','));
  MRD.dancer = { lower: LOWER.map(m => m.name), upper: UPPER.map(m => m.name),
    pin, unpin, pose: null, leadScale: 1, label: '', log: [],
    levels: Object.fromEntries(LOWER.concat(UPPER).map(m => [m.name, m.level])),
    sync: LOWER.concat(UPPER).filter(m => m.sync).map(m => m.name),
    compatible: (a, b) => lowerCompatible(LOWER.find(m => m.name === a), LOWER.find(m => m.name === b)) };

  // Two-bone IK in 3D (z toward the viewer): the knee bends forward and a little outward,
  // then is flattened onto the screen. side = -1 for the left leg, +1 for the right.
  // `over` is how far the foot target was beyond the leg's reach (the foot gets pulled up).
  function knee(hx, hy, fx, fy, side, swivel = 0) {
    const dx = fx - hx, dy = fy - hy;
    const len = Math.hypot(dx, dy) || 1e-4;
    const d = Math.min(len, P.thigh + P.shin - 1e-4); // the foot can't be further than the leg is long
    const nx = dx / len, ny = dy / len;
    const along = (P.thigh * P.thigh - P.shin * P.shin + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, P.thigh * P.thigh - along * along));
    // Bend direction (side * out, 0, 1), with its component along the leg removed. `out` is how far the knee
    // swings outward (0.3 normally; the swivel moves it further out or in across the other leg).
    const out = side * (0.3 + 0.9 * swivel);
    const dot = out * nx;
    const px = out - dot * nx, py = -dot * ny, pz = 1;
    const pl = Math.hypot(px, py, pz);
    return { k: [hx + nx * along + (px / pl) * h, hy + ny * along + (py / pl) * h],
      foot: [hx + nx * d, hy + ny * d], over: len - d };
  }

  // Joint positions in units of the dancer's height; origin on the floor, y up.
  function skeleton(t, state) {
    const v = k => spring[k].x;
    const dipMod = (0.005 + 0.025 * state.subBass) * bump(state.phase) + 0.015 * accent; // extra dip on the beat and on hits
    // Real drum hits kick the arms a little, then they settle (nothing wiggles continuously).
    const swing = 6 * accent * accentSign;
    const flick = 4 * state.high * accent * accentSign;
    const hipX = v('sway');
    const tiltY = v('hipTilt');
    const feetY = [v('liftL') + jump.y * 1.5, v('liftR') + jump.y * 1.5];
    // Bend the knees as far as needed so neither foot is beyond the leg's reach.
    const reach = P.thigh + P.shin - 0.004;
    const ceiling = Math.min(
      feetY[0] + Math.sqrt(Math.max(0, reach * reach - Math.pow(hipX - P.pelvis + v('fxL'), 2))) + tiltY,
      feetY[1] + Math.sqrt(Math.max(0, reach * reach - Math.pow(hipX + P.pelvis - v('fxR'), 2))) - tiltY);
    const hipY = Math.min(Math.max(0.36, 0.5 - v('dip') - dipMod - 0.07 * jump.crouch) + jump.y, ceiling);   // 0.36: the deepest crouch
    const hipL = [hipX - P.pelvis, hipY - v('hipTilt')], hipR = [hipX + P.pelvis, hipY + v('hipTilt')];

    const footL = [-v('fxL'), feetY[0]];
    const footR = [v('fxR'), feetY[1]];
    const legL = knee(hipL[0], hipL[1], footL[0], footL[1], -1, v('swivL'));
    const legR = knee(hipR[0], hipR[1], footR[0], footR[1], 1, v('swivR'));

    // The torso counter-leans against the hip shift and the shoulders counter-tilt against the hips.
    const lean = (v('lean') - v('sway') * 60) * D2R;
    const roll = v('roll') + v('hipTilt');
    const pelvis = [hipX, hipY];
    const torso = P.torso * (1 + v('chest')), half = P.shoulder * (1 + v('widen'));   // 2.5D cues for the front view
    const chest = [pelvis[0] + Math.sin(lean) * torso, pelvis[1] + Math.cos(lean) * torso];
    const shL = [chest[0] - Math.cos(lean) * half, chest[1] + Math.sin(lean) * half + roll + v('shrug')];
    const shR = [chest[0] + Math.cos(lean) * half, chest[1] - Math.sin(lean) * half - roll + v('shrug')];
    const neck = [chest[0] + Math.sin(lean) * P.neck, chest[1] + Math.cos(lean) * P.neck + v('shrug')];
    const tilt = lean + (v('tilt') + state.high * 6 * Math.sin(t * 0.02) + 5 * accent * accentSign) * D2R;
    const head = [neck[0] + Math.sin(tilt) * P.head, neck[1] + Math.cos(tilt) * P.head + v('nod')];

    // The hand chases the forearm's angle on a loose, under-damped spring, so it lags and overshoots a little.
    const follow = (h, target) => {
      const w = 11, zeta = 0.3, n = 3, dt = lastDt / n;
      for (let i = 0; i < n; i++) { h.v += ((target - h.x) * w * w - 2 * zeta * w * h.v) * dt; h.x += h.v * dt; }
      return h.x;
    };
    const arm = (sh, side, a0, a1, h) => {
      const r0 = a0 * D2R, r1 = a1 * D2R, rh = follow(h, a1) * D2R;
      const elbow = [sh[0] + side * Math.sin(r0) * P.upper, sh[1] - Math.cos(r0) * P.upper];
      const wrist = [elbow[0] + side * Math.sin(r1) * P.fore, elbow[1] - Math.cos(r1) * P.fore];
      return { elbow, wrist, hand: [wrist[0] + side * Math.sin(rh) * P.hand, wrist[1] - Math.cos(rh) * P.hand] };
    };
    const armL = arm(shL, -1, v('aL0') + swing, v('aL1') + flick, hand.L);
    const armR = arm(shR, 1, v('aR0') - swing, v('aR1') - flick, hand.R);

    return { hipL, hipR, kneeL: legL.k, kneeR: legR.k, footL: legL.foot, footR: legR.foot,
      pelvis, chest, shL, shR, neck, head, armL, armR, over: [legL.over, legR.over] };
  }

  function render(ctx, J, px, py, u, hue, alpha) {
    const at = p => [px(p[0]), py(p[1])];
    const groups = [
      { hue: hue, segs: [[J.hipL, J.kneeL], [J.kneeL, J.footL], [J.hipR, J.kneeR], [J.kneeR, J.footR], [J.hipL, J.hipR]] },
      { hue: hue + 70, segs: [[J.pelvis, J.chest], [J.shL, J.shR], [J.chest, J.neck]] },
      { hue: hue + 140, segs: [[J.shL, J.armL.elbow], [J.armL.elbow, J.armL.wrist], [J.armL.wrist, J.armL.hand],
        [J.shR, J.armR.elbow], [J.armR.elbow, J.armR.wrist], [J.armR.wrist, J.armR.hand]] },
    ];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const g of groups) {
      ctx.beginPath();
      for (const [a, b] of g.segs) {
        const A = at(a), B = at(b);
        ctx.moveTo(A[0], A[1]);
        ctx.lineTo(B[0], B[1]);
      }
      ctx.strokeStyle = `hsl(${g.hue % 360} 100% 55% / ${0.22 * alpha})`;
      ctx.lineWidth = u * 0.05;
      ctx.stroke();
      ctx.strokeStyle = `hsl(${g.hue % 360} 100% 78% / ${alpha})`;
      ctx.lineWidth = u * 0.014;
      ctx.stroke();
    }
    // Head and hands
    const head = at(J.head);
    ctx.strokeStyle = `hsl(${(hue + 210) % 360} 100% 55% / ${0.22 * alpha})`;
    ctx.lineWidth = u * 0.05;
    ctx.beginPath();
    ctx.arc(head[0], head[1], u * P.head, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `hsl(${(hue + 210) % 360} 100% 80% / ${alpha})`;
    ctx.lineWidth = u * 0.014;
    ctx.stroke();
    ctx.fillStyle = `hsl(${(hue + 140) % 360} 100% 85% / ${alpha})`;
    for (const joint of [J.armL.hand, J.armR.hand, J.footL, J.footR]) {
      const pt = at(joint);
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], u * 0.017, 0, TAU);
      ctx.fill();
    }
  }

  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    lastDt = dt;
    energy = state.intensity;
    clarity = state.clarity;
    // Rest when the sound has gone quiet or the beat clock has nothing real to follow.
    quiet = state.level < 0.03 ? quiet + dt : 0;
    const resting = !state.locked || quiet > 0.6;
    rest += ((resting ? 1 : 0) - rest) * Math.min(1, dt / 0.7);
    choreo.sum += state.relLevel;
    choreo.frames++;
    if (resting) { choreo.started = false; choreo.plan = []; choreo.beatE = []; choreo.long = 0; }

    if (state.tick && !pinned && !resting) choreograph(state.beatCount);
    const fadeTime = dt / (2 * state.period / 1000);
    lower.blend = Math.min(1, lower.blend + fadeTime);
    upper.blend = Math.min(1, upper.blend + fadeTime);
    if (state.onset && !resting) { accent = Math.min(1.5, accent + 1); accentSign = -accentSign; }
    accent *= Math.exp(-dt * 7);

    // Each layer is timed a little ahead of the beat to cancel its springs' lag (2*zeta/omega
    // seconds), so the body's stops land on the beat instead of just after it.
    const A = 0.55 + 0.45 * Math.min(1, Math.max(0, (energy - 0.2) / 0.5));
    const w0 = Math.max(14, Math.min(30, 9000 / state.period));
    // Sharp attacks stiffen the upper body's springs a little (crisper stops).
    const springOf = L => {
      const snap = L.cur.item.snap * (L === upper ? 1 + 0.5 * state.snap : 1);
      return { w: w0 * snap, zeta: snap > 1.5 ? 0.95 : 0.85 };
    };
    const target = {};
    for (const [L, keys] of [[lower, LOW_KEYS], [upper, UP_KEYS]]) {
      const { w, zeta } = springOf(L);
      const leadFor = speed => (2 * zeta / (w * speed)) / (state.period / 1000) * MRD.dancer.leadScale;
      const base = state.beatCount + state.phase;
      const c = layerChannels(L, base + leadFor(1), A);
      const fast = L === lower ? layerChannels(L, base + leadFor(FAST_FACTOR), A) : c;
      for (const k of keys) target[k] = (FAST.has(k) ? fast : c)[k];
    }
    // With no clear pulse the arms "search": they roam wider instead of locking to the beat.
    const searching = Math.min(1, pos(0, (0.4 - pulseClarity()) / 0.3));
    if (searching > 0) {
      target.aL0 += 22 * searching * Math.sin(t / 700);
      target.aR0 += 22 * searching * Math.sin(t / 830 + 1);
      target.aL1 += 15 * searching * Math.sin(t / 560 + 2);
      target.aR1 += 15 * searching * Math.sin(t / 610 + 3);
    }

    // Ease into the rest pose when there is nothing to dance to.
    if (rest > 0.001) {
      const idle = IDLE(t / 1000, quiet > 0.6 ? 0.6 : 1);
      for (const k of KEYS) target[k] = mix(target[k], idle[k], ease(Math.min(1, rest)));
    }

    // Springs smooth the motion: stiffer for faster tempos and snappier moves (per layer).
    const sp = { low: springOf(lower), up: springOf(upper) };
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const k of KEYS) {
        const layer = IS_LOW.has(k) ? sp.low : sp.up;
        const w = layer.w * (FAST.has(k) ? FAST_FACTOR : 1), zeta = layer.zeta;
        const st = spring[k];
        st.v += ((target[k] - st.x) * w * w - 2 * zeta * w * st.v) * h;
        st.x += st.v * h;
      }
    }

    // Big bass hits launch a jump: crouch first, then push off and fly, then absorb the landing.
    const air = Math.max(0.3, 0.65 * state.period / 1000), peak = 0.11;
    const airborne = jump.y > 0 || jump.vy > 0;
    if (!airborne && jump.wind === 0 &&
        (choreo.pendingJump || (state.onset && state.punch > 0.85 && energy > 0.5 && !resting && t - lastJump > 2500))) {
      choreo.pendingJump = false;
      jump.wind = 0.14;
      lastJump = t;
    }
    if (jump.wind > 0) {
      jump.wind -= dt;
      if (jump.wind <= 0) { jump.wind = 0; jump.vy = (4 * peak) / air; }   // push off
    }
    if (airborne) {
      jump.vy -= (8 * peak / (air * air)) * dt;
      jump.y += jump.vy * dt;
      if (jump.y <= 0) {                                   // landing: the harder it lands, the deeper the knees absorb it
        jump.absorb = Math.min(1, -jump.vy / ((4 * peak) / air)) * 0.9;
        jump.y = 0; jump.vy = 0;
      }
    }
    jump.absorb = Math.max(0, jump.absorb - dt * 5);
    const crouchTarget = jump.wind > 0 ? 1 : jump.absorb;
    jump.crouch += (crouchTarget - jump.crouch) * Math.min(1, dt * 22);

    fade(0.26);
    const u = Math.min(H * 0.6, W * 0.9);
    const cx = W / 2, gy = H * 0.8;
    const hue = state.hue;
    ctx.globalCompositeOperation = 'lighter';

    // Spotlight cone and a floor ring that expands once per beat
    const beam = ctx.createLinearGradient(0, 0, 0, gy);
    beam.addColorStop(0, `hsla(${hue} 100% 60% / 0)`);
    beam.addColorStop(1, `hsla(${hue} 100% 60% / ${0.05 + state.beat * 0.12})`);
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.04, 0);
    ctx.lineTo(cx + u * 0.04, 0);
    ctx.lineTo(cx + u * 0.5, gy);
    ctx.lineTo(cx - u * 0.5, gy);
    ctx.fill();
    const floor = ctx.createRadialGradient(cx, gy, 0, cx, gy, u * 0.55);
    floor.addColorStop(0, `hsla(${hue} 100% 60% / ${0.2 + state.beat * 0.25})`);
    floor.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.save();
    ctx.translate(0, gy);
    ctx.scale(1, 0.18);
    ctx.translate(0, -gy);
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(cx, gy, u * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = `hsl(${(hue + 60) % 360} 100% 65% / ${(1 - state.phase) * 0.5 * (1 - rest)})`;
    ctx.lineWidth = u * 0.006;
    ctx.beginPath();
    ctx.ellipse(cx, gy, u * (0.1 + state.phase * 0.5), u * (0.1 + state.phase * 0.5) * 0.18, 0, 0, TAU);
    ctx.stroke();

    // The dancer, plus a faint reflection in the floor
    const J = skeleton(t, state);
    MRD.dancer.pose = J;
    render(ctx, J, x => cx + x * u, y => gy - y * u, u, hue, 1);
    render(ctx, J, x => cx + x * u, y => gy + y * u * 0.9, u, hue, 0.16);
    ctx.globalCompositeOperation = 'source-over';

    MRD.dancer.label = `${lower.cur.item.name} + ${upper.cur.item.name}`;
    if (debug) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.max(10, u * 0.03)}px system-ui, sans-serif`;
      ctx.fillStyle = `hsl(${hue} 80% 80% / 0.5)`;
      ctx.fillText((resting ? 'RESTING' : MRD.dancer.label).toUpperCase(), cx, gy + u * 0.16);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '13px monospace';
      [`beat lock   ${state.locked ? 'YES' : 'no'}   (beats detected: ${state.onsetCount})`,
        `tempo       ${state.bpm.toFixed(0)} BPM`,
        `clarity     ${state.clarity.toFixed(2)}   (cadenced moves need > 0.4)`,
        `loudness    ${state.level.toFixed(2)}   relative ${state.intensity.toFixed(2)}`,
        `bass        ${state.bass.toFixed(2)}   subBass ${state.subBass.toFixed(2)}   high ${state.high.toFixed(2)}`,
        `state       ${resting ? 'resting' : 'dancing'}   mood ${choreo.mood}   phrase beat ${phraseBeat(state.beatCount) + 1}/8`,
        `next phrase ${choreo.plan[0] ? choreo.plan[0].lower.name + ' + ' + choreo.plan[0].upper.name : '(planning)'}`]
        .forEach((line, i) => ctx.fillText(line, 12, 22 + i * 17));
    }
  }

  MRD.register({ name: 'Dancer', draw });
})();
