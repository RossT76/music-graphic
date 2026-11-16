// Spaceship flight through a narrow, deep synthwave canyon: skims a flat canyon floor,
// banks around left/right turns and irregular rock spires, hops over jagged boulder fields and low rock bridges,
// and flies under towering natural rock arches while canyon walls vary from shallow passes to abyssal gorges.
(() => {
  'use strict';

  const SLICE_RATE = 1000 / 68;   // slices per second at 1x
  const N = 64;                   // points across each cross-section
  const ROWS = 42;                // visible slices from horizon to near plane
  const EVENT_SPACING = 19;       // base window size for procedural canyon features

  // Random seed per page load so every run has a fresh obstacle layout while staying consistent in reverse
  const RUN_SEED = (Math.random() * 0x7fffffff) | 0;

  const valley = {
    pos: 0,                       // continuous ship station along the valley
    slices: new Map(),            // integer station id -> Float32Array(N) recorded spectrum
    bank: 0,                      // smoothed roll angle (radians)
    pitch: 0,                     // smoothed pitch offset
    lastState: { turn: 'straight', feature: 'deep gorge', depthMul: 2.1 },
  };

  // Fast 32-bit avalanche integer hash -> uniform float in [0, 1)
  function hash01(n, salt = 0) {
    let h = (n * 0x9e3779b1) ^ (salt * 0x85ebca6b) ^ RUN_SEED;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Deterministic multi-frequency cliff noise at station s, point i
  function cliffNoise(s, i) {
    const a = Math.sin(s * 0.37 + i * 0.53) * 0.5 + 0.5;
    const b = Math.cos(s * 0.19 - i * 0.89 + 1.3) * 0.5 + 0.5;
    const c = Math.sin(s * 0.71 + i * 1.37 - 0.8) * 0.5 + 0.5;
    return a * 0.45 + b * 0.35 + c * 0.20;
  }

  // 3D winding centerline of the valley at world station s (left and right turns)
  function pathX(s) {
    return Math.sin(s * 0.050) * 1.15
         + Math.sin(s * 0.022 + 1.7) * 0.75
         + Math.cos(s * 0.086 - 0.6) * 0.24;
  }

  // Mostly flat valley bottom with only a gentle, subtle undulation
  function canyonY(s) {
    return Math.sin(s * 0.045 + 0.4) * 0.16
         + Math.cos(s * 0.021 - 1.2) * 0.10;
  }

  // Variable canyon wall depth multiplier along station s:
  // >= 2.0x for most of the valley, dipping to ~1.15x in shallow passes and surging to ~3.15x in abyssal gorges.
  function canyonDepth(s) {
    const w1 = Math.sin(s * 0.027 + 0.7);
    const w2 = Math.cos(s * 0.012 - 1.9);
    const w3 = Math.sin(s * 0.063 + 2.4);
    const wave = w1 * 0.50 + w2 * 0.35 + w3 * 0.15; // [-1, 1]
    if (wave < -0.25) {
      const t = (wave + 0.25) / 0.75; // 0 down to -1 in shallow stretches
      return 2.0 + t * 0.85;          // dips smoothly down to 1.15x
    }
    return 2.0 + Math.pow((wave + 0.25) / 1.25, 1.25) * 1.15; // 2.0x up to 3.15x
  }

  // Raw random roll for slot idx (before checking neighbor arch constraints)
  function rawRoll(idx) {
    return hash01(idx, 1);
  }

  // Uncorrelated procedural feature for slot idx (may return null for open canyon stretches)
  function featureInfo(idx) {
    const rType = rawRoll(idx);
    // ~20% of slots are open canyon with no obstacle, breaking up any regular cadence
    if (rType < 0.20) return null;

    // Wide station jitter (-4..+4) so time between obstacles varies from 11 to 27+ slices
    const jitter = Math.round((hash01(idx, 2) - 0.5) * 8);
    const station = idx * EVENT_SPACING + jitter;

    let type;
    const prevWasArch = rawRoll(idx - 1) >= 0.76;
    if (rType < 0.50) {
      type = 'spire';
    } else if (rType < 0.76 || prevWasArch) {
      type = hash01(idx, 3) < 0.55 ? 'mound' : 'spire';
    } else if (rType < 0.88) {
      type = 'arch';
    } else {
      type = 'bridge';
    }

    const vary = hash01(idx, 4);                          // 0..1 height/size variation
    const widthVar = hash01(idx, 5);                      // 0..1 independent width variation
    const skew = (hash01(idx, 6) - 0.5) * 0.32;           // natural left-to-right asymmetry / lean
    const dodgeDir = hash01(idx, 7) < 0.5 ? 1 : -1;       // independent random left/right dodge
    const shapeSeed = hash01(idx, 8) * Math.PI * 2;       // random phase for multi-peak crags
    const subPeaks = 2 + Math.floor(hash01(idx, 9) * 3);  // 2..4 craggy sub-ridges on the obstacle
    const twin = hash01(idx, 10) < 0.42;                  // some spires/mounds have a secondary rock outcrop

    // Vary longitudinal thickness (1 to 3 slices half-length -> 3 to 7 slices total)
    const halfLen = type === 'spire'
      ? (hash01(idx, 11) < 0.35 ? 1 : 2)
      : (hash01(idx, 11) < 0.65 ? 2 : 3);

    return {
      idx, station, type, vary, widthVar, skew, dodgeDir,
      shapeSeed, subPeaks, twin, halfLen,
    };
  }

  // Check if integer station id falls within a feature's multi-slice footprint
  function featureAtStation(id) {
    const approxIdx = Math.round(id / EVENT_SPACING);
    for (let di = -1; di <= 1; di++) {
      const info = featureInfo(approxIdx + di);
      if (!info) continue;
      const along = id - info.station;
      if (Math.abs(along) <= info.halfLen) {
        const env = Math.cos((along / (info.halfLen + 0.75)) * (Math.PI * 0.5));
        return { ...info, along, env };
      }
    }
    return null;
  }

  // Ship altitude above the mostly-flat canyon floor: skims low by default, hops over mounds & low bridges
  function shipAltitude(s) {
    let alt = 0.28; // low-altitude canyon skimming baseline
    const approxIdx = Math.round(s / EVENT_SPACING);
    for (let di = -1; di <= 1; di++) {
      const info = featureInfo(approxIdx + di);
      if (!info) continue;
      const span = 6.5 + info.halfLen * 0.8;
      const dist = (s - info.station) / span;
      if (Math.abs(dist) < 2.4) {
        const bell = Math.exp(-dist * dist * 1.25);
        if (info.type === 'mound') {
          alt += bell * (0.34 + info.vary * 0.16);
        } else if (info.type === 'bridge') {
          alt += bell * (0.50 + info.vary * 0.16);
        } else if (info.type === 'arch') {
          alt -= bell * (0.04 + (1 - info.vary) * 0.04);
        }
      }
    }
    return alt;
  }

  // Ship lateral offset (in normalized canyon width units c) to weave around rock spires
  function shipLateral(s) {
    let lat = 0;
    const approxIdx = Math.round(s / EVENT_SPACING);
    for (let di = -1; di <= 1; di++) {
      const info = featureInfo(approxIdx + di);
      if (!info || info.type !== 'spire') continue;
      const dist = (s - info.station) / 6.8;
      if (Math.abs(dist) < 2.4) {
        const bell = Math.exp(-dist * dist * 1.2);
        lat += bell * info.dodgeDir * (0.15 + info.widthVar * 0.05);
      }
    }
    return lat;
  }

  function sampleSlice(id, spec) {
    const row = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.abs((i - (N - 1) / 2) / ((N - 1) / 2));
      const band = Math.min(47, Math.floor((1 - c * 0.75) * 36 + (i % 5) * 2));
      row[i] = spec(band, 48);
    }
    valley.slices.set(id, row);
    if (valley.slices.size > ROWS * 3) {
      for (const k of valley.slices.keys()) {
        if (Math.abs(k - id) > ROWS * 2) valley.slices.delete(k);
      }
    }
    return row;
  }

  function getSlice(id, spec) {
    return valley.slices.get(id) || sampleSlice(id, spec);
  }

  // Narrow, ultra-deep gorge profile with variable wall depth (depthMul) and procedural floor obstacles
  function terrainProfile(c, specVal, crag, bass, mid, feat, depthMul) {
    let effC = c;
    // Carve a wider side-channel on the dodge side of a spire so the ship can bank cleanly past it
    if (feat && feat.type === 'spire' && c * feat.dodgeDir > 0) {
      effC = c - feat.dodgeDir * (0.07 + feat.widthVar * 0.03) * feat.env;
    }
    const absC = Math.abs(effC);
    const innerWall = Math.min(1, Math.max(0, (absC - 0.10) / 0.36));
    const upperWall = Math.max(0, (absC - 0.46) / 0.54);
    const strataFreq = 4 + Math.floor(depthMul * 1.5);
    const terrace = Math.pow(innerWall, 1.12) * 0.85
                  + Math.pow(upperWall, 0.88) * 0.38
                  + 0.055 * Math.sin(innerWall * Math.PI * strataFreq);
    const rimFade = Math.sin(Math.min(1, (1 - Math.abs(c)) * 5.5) * (Math.PI / 2));
    const floorRipple = (1 - innerWall) * (0.016 * Math.cos(c * Math.PI * 10) + Math.pow(specVal, 1.4) * 0.05 * (0.5 + mid));
    // Scale canyon walls by depthMul (~2.0x-3.15x normally, ~1.15x-1.8x in shallow passes)
    const wallHeight = depthMul * terrace * (0.70 + crag * 0.28 + Math.pow(specVal, 1.25) * 0.50 + bass * 0.20);
    let h = (wallHeight + floorRipple) * (0.42 + 0.58 * rimFade);

    // Sculpt irregular ground obstacles directly into the natural terrain contour
    if (feat) {
      const specBoost = Math.pow(specVal, 1.3) * 0.18 + bass * 0.10;
      if (feat.type === 'spire') {
        // Primary rock spire / hoodoo jutting up on the side opposite the ship's dodge channel
        const spireCenter = -feat.dodgeDir * (0.03 + feat.vary * 0.06) + feat.along * feat.skew * 0.08;
        const spireW = (0.075 + feat.widthVar * 0.055) * (0.70 + 0.30 * feat.env);
        const uSpire = (c - spireCenter) / spireW;
        if (Math.abs(uSpire) < 1) {
          const lean = 1 + feat.skew * 1.4 * uSpire;
          const spireShape = Math.pow(Math.max(0, 1 - uSpire * uSpire), 1.05 + feat.widthVar * 0.5) * lean;
          const jagged = 0.72 + 0.38 * crag + 0.18 * Math.cos(uSpire * Math.PI * feat.subPeaks + feat.shapeSeed);
          const spireH = (0.58 + feat.vary * 0.42 + specBoost) * feat.env * spireShape * jagged;
          h = Math.max(h, floorRipple + spireH);
        }
        // Optional secondary rock outcrop / shoulder boulder beside the main spire
        if (feat.twin) {
          const subCenter = spireCenter - feat.dodgeDir * spireW * 0.85;
          const uSub = (c - subCenter) / (spireW * 0.75);
          if (Math.abs(uSub) < 1) {
            const subH = (0.32 + feat.vary * 0.22) * feat.env * Math.pow(1 - uSub * uSub, 1.2) * (0.7 + 0.4 * crag);
            h = Math.max(h, floorRipple + subH);
          }
        }
      } else if (feat.type === 'mound') {
        // Irregular boulder field / tilted rock shelf across the canyon floor (ship hops over it)
        const moundCenter = feat.skew * 0.35 + feat.along * 0.02;
        const moundW = 0.20 + feat.widthVar * 0.10;
        const uMound = (c - moundCenter) / moundW;
        if (Math.abs(uMound) < 1) {
          const dome = Math.pow(1 - uMound * uMound, 0.75);
          const boulders = 0.68 + 0.42 * crag
                         + 0.22 * Math.sin(uMound * Math.PI * feat.subPeaks + feat.shapeSeed)
                         + feat.skew * 0.8 * uMound;
          const moundH = (0.22 + feat.vary * 0.15 + specBoost * 0.8) * feat.env * dome * Math.max(0.3, boulders);
          h = Math.max(h, floorRipple + moundH);
        }
      }
    }

    return h;
  }

  function draw(api) {
    const { ctx, W, H, state, spec, clearStage, bgRgb, dt, flow } = api;

    const step = (flow / 60) * SLICE_RATE;
    valley.pos += step;

    const baseId = Math.floor(valley.pos);
    const frac = valley.pos - baseId;

    const enteringId = step >= 0 ? baseId + ROWS : baseId + 1;
    sampleSlice(enteringId, spec);

    // Ship 3D kinematics: gentle canyon floor + active obstacle dodging (lateral weave & vertical hop)
    const s0 = valley.pos;
    const x0 = pathX(s0);
    const lat0 = shipLateral(s0);
    const floorY0 = canyonY(s0);
    const alt0 = shipAltitude(s0);
    const shipY0 = floorY0 + alt0;

    const canyonTurn = (pathX(s0 + 6) - x0) / 6;
    const dodgeTurn = (shipLateral(s0 + 4) - lat0) / 4;
    const turnAhead = canyonTurn + dodgeTurn * 1.35;

    const shipY4 = canyonY(s0 + 4) + shipAltitude(s0 + 4);
    const slopeAhead = (shipY4 - shipY0) / 4;

    const targetBank = Math.max(-0.36, Math.min(0.36, -turnAhead * 1.25));
    const targetPitch = Math.max(-0.28, Math.min(0.28, slopeAhead * 0.90));
    const smooth = 1 - Math.exp(-dt * 9);
    valley.bank += (targetBank - valley.bank) * smooth;
    valley.pitch += (targetPitch - valley.pitch) * smooth;

    const curDepth = canyonDepth(s0 + 6);
    valley.lastState.depthMul = curDepth;
    valley.lastState.turn = valley.bank > 0.05 ? 'left' : valley.bank < -0.05 ? 'right' : 'straight';
    const nearFeat = featureAtStation(baseId + 2) || featureAtStation(baseId + 4) || featureAtStation(baseId + 6);
    const depthLabel = curDepth > 2.55 ? 'abyssal gorge' : curDepth < 1.65 ? 'shallow pass' : 'deep canyon';
    valley.lastState.feature = nearFeat
      ? (nearFeat.type === 'spire' ? `around spire (${nearFeat.dodgeDir > 0 ? 'R' : 'L'})`
        : nearFeat.type === 'mound' ? 'over boulder ridge'
        : nearFeat.type === 'bridge' ? 'over rock bridge'
        : 'under rock arch')
      : depthLabel;

    clearStage();
    const solid = bgRgb !== null;

    const horizonBase = H * (0.38 - valley.pitch * 0.28);
    const bottomBase = H * 1.04;
    const sunX = W * (0.5 - turnAhead * 0.38);
    const sunY = horizonBase - H * 0.04;

    ctx.save();
    ctx.translate(W / 2, H * 0.48);
    ctx.rotate(valley.bank);
    ctx.translate(-W / 2, -H * 0.48);

    // Bass-pulsing synthwave sun above the canyon horizon
    const sunR = H * (0.22 + state.bass * 0.14);
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sun.addColorStop(0, `hsla(${(state.hue + 310) % 360} 100% 62% / 0.65)`);
    sun.addColorStop(0.55, `hsla(${(state.hue + 280) % 360} 95% 50% / 0.25)`);
    sun.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(-W * 0.3, -H * 0.3, W * 1.6, H * 1.6);

    // Precompute screen geometry for all slices from far (k = ROWS) to near (k = 1)
    const slicesGeo = new Array(ROWS);
    for (let k = ROWS; k >= 1; k--) {
      const id = baseId + k;
      const d = k - frac;
      const z = d / ROWS;                        // 0 = at viewer, 1 = far horizon
      const depth = Math.pow(1 - z, 1.82);       // 0 = horizon, 1 = near plane

      const s = s0 + d;
      const depthMul = canyonDepth(id);
      const relX = (pathX(s) - x0) - canyonTurn * d * 0.38;
      const relFloorY = (canyonY(s) - floorY0) - slopeAhead * d * 0.25;

      const perspCurve = z * (0.35 + 0.65 * depth);
      const halfW = W * (0.13 + 0.68 * depth);
      const amp = H * 0.72 * (0.16 + 0.90 * depth);

      // Lateral dodge shifts the near canyon center opposite the ship's dodge direction so the ship flies through the gap
      const dodgeShift = -lat0 * halfW * (0.20 + 0.80 * depth);
      const cx = W * 0.5 + relX * W * 0.34 * perspCurve - canyonTurn * W * 0.18 * z + dodgeShift;
      const hillLift = relFloorY * H * 0.22 * Math.sin(z * Math.PI * 0.92);
      const altDrop = (alt0 - 0.28) * H * (0.12 + 0.58 * depth);
      const yFloor = horizonBase + (bottomBase - horizonBase) * depth - hillLift + altDrop;

      const row = getSlice(id, spec);
      const xs = new Float32Array(N);
      const baseYs = new Float32Array(N);

      const feat = featureAtStation(id);
      const isArch = feat && (feat.type === 'arch' || feat.type === 'bridge');
      let topYs = baseYs;
      let caveYs = null;
      let iLeft = 0, iRight = N - 1, iOuterL = 0, iOuterR = N - 1;

      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const c = (u - 0.5) * 2;
        const crag = cliffNoise(id, i);
        const h = terrainProfile(c, row[i], crag, state.bass, state.mid, feat, depthMul);
        xs[i] = cx + c * halfW;
        baseYs[i] = yFloor - h * amp;
      }

      if (isArch) {
        topYs = new Float32Array(N);
        caveYs = new Float32Array(N);
        const flyOver = feat.type === 'bridge';
        const { vary, widthVar, skew, shapeSeed, env } = feat;

        // Low bridges anchor into the lower inner gorge; high arches span higher across the deep canyon walls
        const outerSpan = flyOver ? (0.30 + widthVar * 0.08) : (0.52 + widthVar * 0.12);
        const innerSpan = (flyOver ? (0.18 + widthVar * 0.05) : (0.30 + widthVar * 0.08)) * (0.76 + 0.24 * env);

        const archScale = flyOver ? 1.0 : Math.min(1.65, 0.70 + 0.35 * depthMul);
        const cavePeak = flyOver
          ? (0.22 + vary * 0.12) * (0.80 + 0.20 * env)
          : (0.98 + vary * 0.32) * archScale * (0.85 + 0.15 * env);
        const spineBase = flyOver
          ? cavePeak + (0.12 + widthVar * 0.06) * (0.75 + 0.25 * env)
          : cavePeak + (0.20 + widthVar * 0.10) * archScale * (0.75 + 0.25 * env);

        iOuterL = Math.max(0, Math.floor((0.5 - outerSpan * 0.5) * (N - 1)));
        iOuterR = Math.min(N - 1, Math.ceil((0.5 + outerSpan * 0.5) * (N - 1)));
        iLeft = Math.max(0, Math.floor((0.5 - innerSpan * 0.5) * (N - 1)));
        iRight = Math.min(N - 1, Math.ceil((0.5 + innerSpan * 0.5) * (N - 1)));

        const yShoulderL = baseYs[iOuterL];
        const yShoulderR = baseYs[iOuterR];
        const yWallL = baseYs[iLeft];
        const yWallR = baseYs[iRight];

        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const c = (u - 0.5) * 2;
          const absC = Math.abs(c);
          const crag = cliffNoise(id, i);
          const crag2 = cliffNoise(id + 17, N - 1 - i);
          const specMod = Math.pow(row[i], 1.25) * 0.24 + state.bass * 0.10;

          if (absC < outerSpan) {
            const tSpan = (c + outerSpan) / (2 * outerSpan);
            const shoulderChordY = yShoulderL + tSpan * (yShoulderR - yShoulderL);
            const blend = 0.5 + 0.5 * Math.cos((c / outerSpan) * Math.PI);
            const saddle = -0.05 * Math.cos((c / outerSpan) * Math.PI + shapeSeed * 0.3) + skew * (c / outerSpan);
            const rockSpineH = spineBase + saddle + (crag - 0.45) * 0.24 + specMod;
            const rockY = yFloor - rockSpineH * amp;
            const bridgeY = shoulderChordY * (1 - blend) + rockY * blend;
            topYs[i] = Math.min(baseYs[i], bridgeY);
          } else {
            topYs[i] = baseYs[i];
          }

          if (absC < innerSpan) {
            const tInner = (c + innerSpan) / (2 * innerSpan);
            const wallChordY = yWallL + tInner * (yWallR - yWallL);
            const uIn = (c - skew * 0.18) / innerSpan;
            const dome = Math.pow(Math.max(0, 1 - uIn * uIn), 0.68 + widthVar * 0.16);
            const caveRough = (crag2 - 0.5) * 0.14 + Math.pow(row[i], 1.3) * 0.08;
            const apexY = yFloor - (cavePeak + caveRough) * amp;
            const rawCaveY = wallChordY * (1 - dome) + apexY * dome;
            const minThickness = amp * (0.08 + 0.06 * crag);
            caveYs[i] = Math.min(baseYs[i], Math.max(topYs[i] + minThickness, rawCaveY));
          } else {
            caveYs[i] = baseYs[i];
          }
        }
      }

      // Guide line indices shift around rock spires along the ship's dodge channel
      const latAtSlice = shipLateral(s);
      const iCenter = Math.min(N - 3, Math.max(2, Math.round((0.5 + latAtSlice * 0.45) * (N - 1))));

      slicesGeo[k - 1] = {
        id, k, z, depth, cx, yFloor, halfW, amp, xs, baseYs, topYs, caveYs,
        feat, isArch, iLeft, iRight, iOuterL, iOuterR, iCenter,
      };
    }

    // Draw back-to-front (far horizon k = ROWS down to near k = 1)
    for (let k = ROWS; k >= 1; k--) {
      const g = slicesGeo[k - 1];
      const { id, depth, yFloor, xs, baseYs, topYs, caveYs, feat, isArch, iLeft, iRight, iOuterL, iOuterR, iCenter } = g;
      const hue = (state.hue + id * 5) % 360;
      const alpha = 0.22 + depth * 0.78;

      // 1. If this slice is part of a natural rock arch, occlude behind the overhanging stone mass
      if (isArch) {
        if (k < ROWS && slicesGeo[k].isArch && slicesGeo[k].feat.idx === feat.idx && solid) {
          const far = slicesGeo[k];
          const mid = N >> 1;

          if (topYs[mid] > far.topYs[mid]) {
            ctx.beginPath();
            for (let i = iOuterL; i <= iOuterR; i++) {
              if (i === iOuterL) ctx.moveTo(xs[i], topYs[i]);
              else ctx.lineTo(xs[i], topYs[i]);
            }
            for (let i = far.iOuterR; i >= far.iOuterL; i--) {
              ctx.lineTo(far.xs[i], far.topYs[i]);
            }
            ctx.closePath();
            ctx.fillStyle = `rgb(${bgRgb})`;
            ctx.fill();
          }

          if (caveYs[mid] < far.caveYs[mid]) {
            ctx.beginPath();
            for (let i = iLeft; i <= iRight; i++) {
              if (i === iLeft) ctx.moveTo(xs[i], caveYs[i]);
              else ctx.lineTo(xs[i], caveYs[i]);
            }
            for (let i = far.iRight; i >= far.iLeft; i--) {
              ctx.lineTo(far.xs[i], far.caveYs[i]);
            }
            ctx.closePath();
            ctx.fillStyle = `rgb(${bgRgb})`;
            ctx.fill();

            const farHue = (state.hue + far.id * 5) % 360;
            const farAlpha = 0.22 + far.depth * 0.78;
            ctx.beginPath();
            for (let i = far.iLeft; i <= far.iRight; i++) {
              if (i === far.iLeft) ctx.moveTo(far.xs[i], far.caveYs[i]);
              else ctx.lineTo(far.xs[i], far.caveYs[i]);
            }
            ctx.strokeStyle = `hsl(${farHue} 95% ${46 + state.beat * 12}% / ${farAlpha * 0.9})`;
            ctx.lineWidth = 1 + far.depth * 2.0;
            ctx.stroke();
          }
        }

        if (solid) {
          ctx.beginPath();
          ctx.moveTo(xs[0], topYs[0]);
          for (let i = 1; i < N; i++) ctx.lineTo(xs[i], topYs[i]);
          for (let i = N - 1; i >= 0; i--) ctx.lineTo(xs[i], caveYs[i]);
          ctx.closePath();
          ctx.fillStyle = `rgb(${bgRgb})`;
          ctx.fill();
        }
      }

      // 2. Fill below the canyon floor, obstacles & outer walls (baseYs) to occlude farther terrain
      if (solid) {
        ctx.beginPath();
        ctx.moveTo(xs[0], yFloor + H * 0.7);
        for (let i = 0; i < N; i++) {
          ctx.lineTo(xs[i], baseYs[i]);
        }
        ctx.lineTo(xs[N - 1], yFloor + H * 0.7);
        ctx.closePath();
        ctx.fillStyle = `rgb(${bgRgb})`;
        ctx.fill();
      }

      // Longitudinal canyon floor guide lines that weave around spires and over boulder ridges
      if (k < ROWS) {
        const far = slicesGeo[k];
        const offsets = [-2, 0, 2];
        ctx.beginPath();
        for (let gi = 0; gi < offsets.length; gi++) {
          const idxNear = iCenter + offsets[gi];
          const idxFar = far.iCenter + offsets[gi];
          ctx.moveTo(far.xs[idxFar], far.baseYs[idxFar]);
          ctx.lineTo(xs[idxNear], baseYs[idxNear]);
        }
        ctx.strokeStyle = `hsla(${(hue + 180) % 360} 100% 65% / ${alpha * 0.45})`;
        ctx.lineWidth = 0.8 + depth * 1.2;
        ctx.stroke();
      }

      // 3. When an arch is present, stroke the canyon floor & underside cavern roof inside the opening
      if (isArch) {
        ctx.beginPath();
        for (let i = iLeft; i <= iRight; i++) {
          if (i === iLeft) ctx.moveTo(xs[i], baseYs[i]);
          else ctx.lineTo(xs[i], baseYs[i]);
        }
        ctx.strokeStyle = `hsl(${hue} 100% ${52 + state.beat * 12}% / ${alpha * 0.85})`;
        ctx.lineWidth = 0.9 + depth * 1.8;
        ctx.stroke();

        ctx.beginPath();
        for (let i = iLeft; i <= iRight; i++) {
          if (i === iLeft) ctx.moveTo(xs[i], caveYs[i]);
          else ctx.lineTo(xs[i], caveYs[i]);
        }
        ctx.strokeStyle = `hsl(${hue} 95% ${46 + state.beat * 12}% / ${alpha * 0.9})`;
        ctx.lineWidth = 1 + depth * 2.0;
        ctx.stroke();
      }

      // 4. Stroke the main continuous cross-section ridge line (canyon walls, spires, mounds & rock arch spine)
      ctx.beginPath();
      ctx.moveTo(xs[0], topYs[0]);
      for (let i = 1; i < N; i++) {
        ctx.lineTo(xs[i], topYs[i]);
      }
      ctx.strokeStyle = `hsl(${hue} 100% ${56 + state.beat * 14}% / ${alpha})`;
      ctx.lineWidth = 1 + depth * 2.2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function debug() {
    return [
      ['Turn', valley.lastState.turn],
      ['Bank', `${(valley.bank * 180 / Math.PI).toFixed(1)}°`, Math.min(1, Math.abs(valley.bank) / 0.36)],
      ['Depth', `${valley.lastState.depthMul.toFixed(2)}×`, Math.min(1, (valley.lastState.depthMul - 1) / 2.2)],
      ['Flight', valley.lastState.feature],
    ];
  }

  MRD.register({
    name: 'Valley',
    draw,
    motion: true,
    reverseLabel: 'Fly backwards through the valley',
    debug,
  });
})();
