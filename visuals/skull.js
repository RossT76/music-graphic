// Holographic skull: a 3D wireframe skull floating over a projector base. It sweeps left and right
// and drops its jaw on every beat.
//
// How it works:
//  - The skull is a 3D solid with real human proportions (see Geometry): cranium, brow ridge, deep eye sockets,
//    nose opening, cheekbones and arches, the upper jaw with its teeth, and a separate lower jaw. It is drawn as
//    scan-slice contours through that solid, found once at load, plus the rims of the sockets, the sutures, the
//    lower border of the jaw, and every tooth (incisors, canines, premolars and molars, sized as in a real mouth).
//  - Each frame it is rotated (a yaw sweep, plus a little pitch), put through a simple perspective, and
//    drawn as additive glowing lines. Lines at the back are dimmer than lines at the front, so it reads as a
//    translucent solid.
//  - The jaw hinges on the real joint, just in front of the ears. Each beat (a detected hit, or the beat clock
//    while it is locked) snaps it open, then it closes again, and the teeth clack shut before the next beat.
//    The jaw is a spring, so it has a little overshoot; harder hits open it wider. The head tips back a touch
//    as the mouth opens, and the eyes flare.
//  - Hologram effects: a scan band sweeping up the skull, scanlines, flicker, glitch slices on sharp attacks,
//    a projector base with a light cone, and rising motes.
//  - Speed and Reverse change the sweep. The jaw always follows the music, not the Speed slider.
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = x => x * x * (3 - 2 * x);
  const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

  // ----- Tunables -----
  const SWEEP = 1.15;        // how far it turns each way, in radians (about 66 degrees)
  const SWEEP_RATE = 0.7;    // sweep speed, radians of the sweep cycle per second (a full left-right-left takes 9 s)
  const JAW_MAX = 0.46;      // widest the jaw opens, in radians (about 26 degrees)
  const CAMERA = 7;          // camera distance, in skull units (about 70 cm: close enough for depth, far enough not to distort)
  const HUE = 187;           // the hologram's colour (cyan); it drifts a little with the music's hue
  // Build stamp, drawn small in the bottom-left corner of both skull visuals so you can tell which version a display
  // is running. Bump it with every change to either skull; set SHOW_VERSION to false to hide it when testing is done.
  const VERSION = 'v10';
  const SHOW_VERSION = true;

  // ----- Geometry -----
  // The skull is modelled as a solid in centimetres, from average adult measurements (x right, y up, z towards
  // the viewer, origin at the middle of the eye sockets): a signed-distance function, negative inside, built
  // from smooth blends of simple shapes, with the eye sockets and nose carved out. The lower jaw is a second
  // solid. The glowing lines are slices through these solids, found once at load by marching rays in to the
  // surface, so the contours dip into the sockets and follow the cheekbones. U converts cm to drawing units.
  const U = 0.1;
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);
  function ellipsoid(x, y, z, c, r) {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = Math.hypot(px, py, pz), k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
    return k0 * (k0 - 1) / (k1 || 1e-9);
  }
  // A smooth bump of height A (cm) and width sigma around c, to subtract from a distance (raising the surface there).
  const swell = (x, y, z, c, sigma, A) => A * Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) / (sigma * sigma));
  function capsules(x, y, z, pts, r) {             // a tube through a chain of points
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
      const ax = x - a[0], ay = y - a[1], az = z - a[2];
      const h = clamp((ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz), 0, 1);
      d = Math.min(d, Math.hypot(ax - bx * h, ay - by * h, az - bz * h));
    }
    return d - r;
  }
  function polygon(px, py, P) {                    // signed distance to a closed 2D polygon
    let d = Infinity, inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j][0], ay = P[j][1], ex = P[i][0] - ax, ey = P[i][1] - ay, wx = px - ax, wy = py - ay;
      const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
      d = Math.min(d, (wx - ex * h) ** 2 + (wy - ey * h) ** 2);
      if ((ay > py) !== (P[i][1] > py) && px < ex * (py - ay) / ey + ax) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(d);
  }
  // A curve in the xz-plane (a half-arch from the midline back), with closest-point lookup.
  function curve(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function closest(C, px, pz) {                    // [distance, position along the curve 0-1]
    let best = Infinity, bt = 0;
    for (let i = 1; i < C.pts.length; i++) {
      const ax = C.pts[i - 1][0], az = C.pts[i - 1][1], ex = C.pts[i][0] - ax, ez = C.pts[i][1] - az, wx = px - ax, wz = pz - az;
      const h = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1), d = (wx - ex * h) ** 2 + (wz - ez * h) ** 2;
      if (d < best) { best = d; bt = (C.cum[i - 1] + h * (C.cum[i] - C.cum[i - 1])) / C.len; }
    }
    return [Math.sqrt(best), bt];
  }
  // A dental arch: U-shaped (a superellipse), half-width W, depth D, back end at z = zb. Half: midline to back.
  function arch(W, D, zb, half, N = 60) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const psi = half ? (i / N) * Math.PI / 2 : mix(-Math.PI / 2, Math.PI / 2, i / N);
      pts.push([W * sgnpow(Math.sin(psi), 2 / 2.3), zb + D * Math.pow(Math.abs(Math.cos(psi)), 2 / 2.3)]);
    }
    return pts;
  }

  // Teeth: [kind, width, height, thickness] in cm, from the middle front tooth back to the last molar.
  const UPPER = [['inc', 0.85, 1.05, 0.6], ['inc', 0.66, 0.92, 0.55], ['can', 0.76, 1.05, 0.75], ['pm', 0.7, 0.82, 0.85],
    ['pm', 0.67, 0.76, 0.85], ['mol', 1.0, 0.72, 1.05], ['mol', 0.9, 0.68, 1.0], ['mol', 0.85, 0.62, 0.95]];
  const LOWER = [['inc', 0.54, 0.9, 0.55], ['inc', 0.6, 0.95, 0.55], ['can', 0.7, 1.05, 0.7], ['pm', 0.7, 0.85, 0.8],
    ['pm', 0.72, 0.8, 0.85], ['mol', 1.1, 0.75, 1.0], ['mol', 1.05, 0.72, 1.0], ['mol', 1.0, 0.68, 0.95]];
  const jawTop = t => -7.25 + 0.35 * t;          // the lower gum line, t = 0 at the front to 1 at the back
  // Places a row of teeth along an arch: each gets its centre on the arch (the outer face), the direction along the
  // arch (tx, tz), outward (nx, nz), its gum height g, and dir (-1: hangs down from the upper jaw, 1: stands up).
  function layoutTeeth(archPts, list, gum, dir) {
    const C = curve(archPts), order = list.slice().reverse().concat(list);
    const fit = C.len / order.reduce((a, t) => a + t[1], 0);
    const out = [];
    let s0 = 0;
    for (const [kind, w0, h, thick] of order) {
      const w = w0 * fit, s = s0 + w / 2;
      let i = 1; while (i < C.pts.length - 1 && C.cum[i] < s) i++;
      const f = (s - C.cum[i - 1]) / (C.cum[i] - C.cum[i - 1]), a = C.pts[i - 1], b = C.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, back = Math.abs(s - C.len / 2) / (C.len / 2);
      out.push({ kind, w, h, thick, x: mix(a[0], b[0], f), z: mix(a[1], b[1], f), tx, tz, nx: -tz, nz: tx, g: gum(back), dir });
      s0 += w;
    }
    return out;
  }
  const TEETH_UP = layoutTeeth(arch(2.9, 4.95, 3.55, false), UPPER, t => -5.3 - 0.1 * t, -1);
  const TEETH_LO = layoutTeeth(arch(2.7, 4.45, 3.5, false), LOWER, jawTop, 1);
  // One crown as a solid: a rounded box in the tooth's own frame, reaching a little into the gum, with a shape by kind
  // (canines come to a point, incisors narrow at the neck). Neighbours leave a small gap between them.
  function tooth(T, x, y, z) {
    const dx = x - T.x, dz = z - T.z;
    if (dx * dx + dz * dz > 1.6) return 1;
    const s = dx * T.tx + dz * T.tz, n = dx * T.nx + dz * T.nz + T.thick / 2 - 0.02, hv = (y - T.g) * T.dir;
    const f = clamp(hv / T.h, 0, 1);
    let a = T.w * 0.44 * (0.82 + 0.18 * ss(0, 0.4, f));
    if (T.kind === 'can') a *= 1 - 0.5 * ss(0.5, 1, f);
    else if (T.kind === 'pm') a *= 1 - 0.18 * ss(0.7, 1, f);
    let b = T.thick / 2;
    if (T.kind === 'inc' || T.kind === 'can') b *= 1 - 0.55 * ss(0.35, 1, f);            // front teeth thin to a cutting edge
    const hh = (T.h + 0.35) / 2;
    let hl = hv - (T.h - 0.35) / 2;
    if (T.kind === 'mol' || T.kind === 'pm') {                                              // back teeth: cusps at the corners, a dip between
      const cusp = 0.5 * (Math.cos(2 * Math.PI * s / (T.w * 0.88)) + Math.cos(2 * Math.PI * n / T.thick));
      hl += 0.07 * T.h * cusp * ss(0.55, 1, f);
    }
    const r = Math.pow(Math.pow(Math.abs(s / a), 2.8) + Math.pow(Math.abs(n / b), 2.8) + Math.pow(Math.abs(hl / hh), 2.8), 1 / 2.8);
    return (r - 1) * Math.min(a, b, hh) * 0.9;
  }
  const teethSolid = list => (x, y, z) => { let d = 1; for (const T of list) d = Math.min(d, tooth(T, x, y, z)); return d; };
  const upperTeeth = teethSolid(TEETH_UP), lowerTeeth = teethSolid(TEETH_LO);

  // Eye sockets: rounded-square tunnels, turned outward, the outer corner drooping (roll), narrowing towards the
  // back. x is |x| (right side).
  const ORB = { cx: 2.95, cy: -0.15, z: 6.6, a: 1.9, b: 1.7, p: 2.6, yaw: 0.24, roll: 0.17, depth: 4.0 };
  const orbC = Math.cos(ORB.yaw), orbS = Math.sin(ORB.yaw), rollC = Math.cos(ORB.roll), rollS = Math.sin(ORB.roll);
  function orbit(ax, y, z) {
    const dx = ax - ORB.cx, dz = z - ORB.z, u = dx * orbC - dz * orbS, w = dx * orbS + dz * orbC, v = y - ORB.cy;
    const ul = u * rollC - v * rollS, vl = u * rollS + v * rollC;
    const s = w > -0.6 ? 1 : Math.max(0.5, 1 + (w + 0.6) / 4.2);   // the back stays wide: a rounded wall, not a pinhole
    const r = Math.pow(Math.pow(Math.abs(ul / (ORB.a * s)), ORB.p) + Math.pow(Math.abs(vl / (ORB.b * s)), ORB.p), 1 / ORB.p);
    return smax((r - 1) * ORB.b * s, -ORB.depth - w, 0.6);
  }
  // A point on a socket's wall from its own outline coordinates (ul across, vl up) and depth w.
  function orbitPoint(ul, vl, w) {
    const u = ul * rollC + vl * rollS, v = -ul * rollS + vl * rollC;
    return [ORB.cx + u * orbC + w * orbS, ORB.cy + v, ORB.z - u * orbS + w * orbC];
  }
  // The nose opening: narrow under the nasal bones, flaring to a pear shape, with the nasal spine pointing up into
  // its lower edge. Right half, top to bottom.
  const NOSE_HALF = [[0, -0.4], [0.35, -0.75], [0.75, -1.5], [1.1, -2.4], [1.2, -3.0], [1.0, -3.45], [0.5, -3.6], [0, -3.3]];
  const NOSE = NOSE_HALF.concat(NOSE_HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y]));

  const UPPER_ALV = curve(arch(2.4, 4.45, 3.55, true, 24));
  const SUPERCILIARY = [[0.55, 1.55, 8.45], [1.7, 2.05, 8.05], [2.9, 2.05, 7.4]];             // the brow arches, dipping at the glabella
  const SUPRAORBITAL = [[1.3, 1.45, 8.0], [2.6, 1.75, 7.5], [3.8, 1.8, 6.7], [4.95, 1.3, 5.3]]; // the upper rim of the socket
  const LAT_RIM = [[4.95, 1.3, 5.3], [5.0, -0.9, 5.0]];
  const ARCH_Z = [[5.0, -1.45, 4.0], [6.15, -1.6, 1.8], [5.85, -1.6, -1.2]];
  const NASAL = [[0.15, 1.4, 8.2], [0.17, -0.35, 8.75]];                                        // one of the pair of nasal bones (mirrored): a narrow tent
  const BUTTRESS = [[4.3, -2.0, 4.8], [3.5, -3.3, 4.9], [3.0, -4.4, 4.9]];                    // strut from the cheekbone down to the first molar
  const EAR = [[6.6, -1.35, -1.75], [5.2, -1.35, -1.75]];                                    // the ear canal opening
  const SPINE = [[0, -3.42, 8.4], [0, -3.5, 8.95]];
  const PHILTRUM = [[0, -3.75, 8.7], [0, -4.8, 8.7]];
  // Ridges over the tooth roots (juga), above the upper teeth and below the lower front teeth.
  const ROOT = { inc: 1.2, can: 1.7, pm: 1.2, mol: 0.8 };
  const JUGA_UP = TEETH_UP.map(T => ({ a: [T.x - T.nx * 0.18, T.g + 0.05, T.z - T.nz * 0.18], b: [T.x - T.nx * 0.26, T.g - ROOT[T.kind], T.z - T.nz * 0.26], r: Math.min(0.26, T.w * 0.32) }));
  // (lower juga left out: on this smooth jaw they read as stripes)
  const JUGA_LO = TEETH_LO.filter(T => T.kind !== 'mol').map(T => ({ a: [T.x - T.nx * 0.3, T.g - 0.05, T.z - T.nz * 0.3], b: [T.x - T.nx * 0.4, T.g - ROOT[T.kind] * 0.8, T.z - T.nz * 0.4], r: Math.min(0.24, T.w * 0.3) }));
  const juga = (list, x, y, z) => { let d = Infinity; for (const J of list) d = Math.min(d, capsules(x, y, z, [J.a, J.b], J.r)); return d; };

  // The skull without its holes (used to find the rims), then with them.
  function skullOuter(x, y, z) {
    const ax = Math.abs(x);
    // Cranium: an egg, narrower at the forehead, cut flat underneath at the base, with a hollow at each temple
    // (its upper edge is the temporal line).
    let d = ellipsoid(ax, y, z, [0, 3.5, -0.8], [7.0 * (1 - 0.12 * ss(-2, 8, z)), mix(9.0, 7.0, ss(1.5, 5.5, y)), 8.8]);
    d = smax(d, -2.1 + 0.35 * Math.max(0, -2 - z) - y, 0.8);                           // the base rises towards the back
    // Gentle swellings of a few millimetres: the parietal eminences (the widest point of the head), the frontal
    // eminences on the forehead, and the occipital bump at the back of the head.
    d -= swell(ax, y, z, [5.6, 6.0, -2.8], 2.6, 0.3) + swell(ax, y, z, [2.3, 5.2, 7.2], 1.8, 0.22) + swell(ax, y, z, [0, 1.8, -9.5], 0.9, 0.25);
    d = smax(d, -ellipsoid(ax, y, z, [7.45, 1.0, 1.3], [1.25, 2.8, 3.6]), 1.0);              // temporal fossa (shallow)
    d = smin(d, capsules(ax, y, z, SUPERCILIARY, 0.5), 0.7);                               // brow arches
    d = smin(d, capsules(ax, y, z, SUPRAORBITAL, 0.45), 0.6);
    d = smin(d, capsules(ax, y, z, LAT_RIM, 0.42), 0.5);                                   // outer rim of the eye socket
    // Face: a rounded block, wide at the cheeks and narrowing to the upper jaw.
    // (an ellipse in cross-section, so its sides round off instead of standing as flat panels; it slopes in at the back)
    const hw = mix(3.5, 5.1, ss(-3.6, 0, y)), fz = z - 5.0 + 0.25 * (y + 1), fd = fz > 0 ? 3.4 : 2.4;
    const r = Math.hypot(ax / hw, fz / fd);
    d = smin(d, smax((r - 1) * Math.min(hw, fd), Math.abs(y + 1.0) - 2.6, 1.2), 0.9);
    d = smin(d, ellipsoid(ax, y, z, [4.6, -1.5, 4.9], [0.85, 1.15, 1.35]), 0.9);          // cheekbone: a plate, not a ball
    d = smax(d, -ellipsoid(ax, y, z, [2.2, -2.4, 8.25], [0.95, 0.85, 0.6]), 0.5);          // canine fossa under the eye
    // Zygomatic arch: a flat bar, taller than it is thick (two tubes stacked).
    d = smin(d, Math.min(capsules(ax, y - 0.2, z, ARCH_Z, 0.32), capsules(ax, y + 0.2, z, ARCH_Z, 0.32)), 0.9);
    d = smin(d, ellipsoid(ax, y, z, [5.0, -2.5, -2.6], [0.7, 1.0, 0.85]), 0.9);             // mastoid process: a short cone behind the ear
    d = smax(d, -capsules(ax, y, z, EAR, 0.42), 0.15);                                    // the ear canal
    d = smin(d, capsules(ax, y, z, NASAL, 0.26), 0.4);                                    // nasal bones (a pair, meeting in the middle)
    d = smin(d, capsules(ax, y, z, SPINE, 0.2), 0.3);                                    // nasal spine
    if (y < -1.5) {
      // The bone holding the upper teeth: a plate following the dental arch, with the root ridges and the groove
      // under the nose.
      const [da] = closest(UPPER_ALV, ax, z);
      // (its lower edge curves up behind the last molar, as the jaw does, instead of ending square)
      const back = ss(3.5, 2.7, z);                                                       // 0 along the teeth, 1 behind the last molar
      d = smin(d, smax(da - 0.55 * (1 - 0.4 * back), Math.max(-5.3 + 1.2 * back - y, y + 2.6), 0.5), 0.8);
      d = smin(d, capsules(ax, y, z, BUTTRESS, 0.45), 0.7);
      if (y < -3.2 && z > 2.5) d = smin(d, juga(JUGA_UP, x, y, z), 0.15);
      if (y < -3.5 && ax < 0.6) d = smax(d, -capsules(ax, y, z, PHILTRUM, 0.25), 0.2);
    }
    return d;
  }
  // Inside the nose: the septum down the middle and two curled turbinates on each side.
  function noseInside(x, y, z) {
    const ax = Math.abs(x);
    const septum = Math.max(ax - 0.09, Math.abs(y + 1.9) - 1.4, Math.abs(z - 5.3) - 2.3);
    const lower = ellipsoid(ax, y, z, [0.9, -2.6, 5.4], [0.3, 0.4, 1.8]);
    const middle = ellipsoid(ax, y, z, [0.75, -1.55, 5.1], [0.24, 0.3, 1.5]);
    return Math.min(septum, lower, middle);
  }
  function skull(x, y, z) {
    const hole = Math.min(orbit(Math.abs(x), y, z), Math.max(polygon(x, y, NOSE), 3.0 - z));
    const d = smax(skullOuter(x, y, z), -hole, 0.25);
    return y < -0.2 && y > -3.7 && Math.abs(x) < 1.4 ? Math.min(d, noseInside(x, y, z)) : d;
  }

  // The lower jaw, closed, in the same frame: a U-shaped plate (the body), the chin, and on each side the
  // upright branch (ramus) ending in the coronoid process (front) and the condyle (the hinge, at the back).
  const JAW_LINE = curve([[0, 7.3], [1.2, 7.0], [2.2, 6.25], [2.85, 5.2], [3.25, 3.9], [3.6, 2.4], [4.1, 1.4], [4.45, 0.9]]);
  const jawBottom = t => -11.0 + 1.2 * ss(0, 0.45, t) + 1.2 * Math.pow(t, 1.5);   // rises quickly either side of the chin
  const RAMUS = [[0.0, -8.1], [-0.4, -6.0], [-0.75, -3.0], [-0.5, -2.1], [0.2, -2.5], [1.0, -3.4], [1.7, -2.9], [2.2, -2.3],
    [2.55, -3.0], [2.85, -5.0], [3.2, -7.0], [3.4, -8.3], [2.2, -8.75], [1.0, -8.75], [0.35, -8.55]];   // (z, y): back edge leaning back, rounded angle
  const CONDYLE = [4.75, -1.85, -0.5];
  const RAMUS_BACK = [[4.75, -2.5, -0.55], [4.72, -5.5, -0.45], [4.68, -7.7, -0.05], [4.5, -8.45, 0.8]];
  const OBLIQUE = [[3.95, -8.6, 4.6], [4.45, -7.6, 3.4], [4.95, -6.3, 2.6], [4.75, -3.6, 2.3]];   // ridge from the body up the ramus
  const SULCUS = [[-1.3, -8.6, 7.95], [1.3, -8.6, 7.95]];                                    // the hollow under the lower teeth
  function mandible(x, y, z) {
    const ax = Math.abs(x);
    const [dc, t] = closest(JAW_LINE, ax / (1 + 0.035 * Math.max(0, -7.25 - y)), z);     // the body flares outward towards its base
    const th = t < 0.6 ? mix(0.55, 0.7, t / 0.6) : mix(0.7, 0.2, (t - 0.6) / 0.4);    // thins out into the ramus
    const crest = 0.8 + 0.2 * ss(jawTop(t) + 0.1, jawTop(t) - 1.4, y);                   // the bone narrows to a ridge under the teeth
    const yb = jawBottom(t), yt = jawTop(t), half = (yt - yb) / 2, v = (y - (yt + yb) / 2) / half;
    const bulge = 0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - v * v));                            // its outer face bulges, rather than being flat
    let d = smax(dc - th * crest * bulge, smax(yb - y, y - yt, 0.3), 0.55);                 // (rounded lower border)
    d = smin(d, ellipsoid(ax, y, z, [0, -10.0, 7.5], [1.3, 0.8, 0.65]), 0.6);                // chin
    d = smin(d, ellipsoid(ax, y, z, [1.1, -10.5, 7.3], [0.45, 0.35, 0.4]), 0.4);            // mental tubercles
    d = smax(d, -capsules(x, y, z, SULCUS, 0.25), 0.5);
    const xr = 4.7 - 0.3 * ss(0.5, 2.2, z) * ss(-5, -2.5, y);
    // The ramus: a thin plate, with a thick rounded back edge running from the condyle down to the angle.
    d = smin(d, smax(polygon(z, y, RAMUS), Math.abs(ax - xr) - 0.22, 0.2), 0.5);
    d = smin(d, capsules(ax, y, z, RAMUS_BACK, 0.36), 0.5);
    d = smin(d, ellipsoid(ax, y, z, CONDYLE, [1.0, 0.45, 0.5]), 0.3);
    d = smin(d, capsules(ax, y, z, OBLIQUE, 0.18), 0.3);
    return d;
  }

  // First surface point met marching in along a ray from distance R towards the origin o, or null.
  function hit(F, ox, oy, oz, dx, dy, dz, R) {
    let s = R, prev = R;
    while (s > 0) {
      if (F(ox + dx * s, oy + dy * s, oz + dz * s) < 0) {
        let lo = s, hi = prev;
        for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (F(ox + dx * m, oy + dy * m, oz + dz * m) < 0) lo = m; else hi = m; }
        return [ox + dx * hi, oy + dy * hi, oz + dz * hi];
      }
      prev = s;
      s -= clamp(F(ox + dx * s, oy + dy * s, oz + dz * s) * 0.6, 0.04, 0.45);
    }
    return null;
  }

  // Polylines: flat xyz arrays in drawing units. style 0 = body (cyan), 1 = accent (brighter). w scales their
  // brightness. jaw lines belong to the lower jaw and swing with it.
  const LINES = [];
  const NODES = [];                       // glowing dots along the contours
  // Adds a list of cm points as lines, breaking it at nulls and at jumps (where a slice leaves the surface).
  function addPath(pts, style, w, jaw, maxJump = 1.6) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) { const q = simplify(run, 0.04); LINES.push({ p: Float32Array.from(q.flat().map(v => v * U)), n: q.length, style, w, jaw }); }
      run = [];
    };
    for (const q of pts) {
      if (!q) { flush(); continue; }
      const last = run[run.length - 1];
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > maxJump) flush();
      run.push(q);
    }
    flush();
  }
  // Drops points that lie within tol (cm) of the line through their neighbours (Ramer-Douglas-Peucker), so smooth
  // stretches cost a few segments instead of dozens. Nothing visible changes.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop(), a = pts[i0], b = pts[i1];
      const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], ee = ex * ex + ey * ey + ez * ez || 1e-12;
      let worst = -1, wd = tol * tol;
      for (let i = i0 + 1; i < i1; i++) {
        const p = pts[i], h = clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey + (p[2] - a[2]) * ez) / ee, 0, 1);
        const d = (p[0] - a[0] - ex * h) ** 2 + (p[1] - a[1] - ey * h) ** 2 + (p[2] - a[2] - ez * h) ** 2;
        if (d > wd) { wd = d; worst = i; }
      }
      if (worst > 0) { keep[worst] = 1; stack.push([i0, worst], [worst, i1]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // A horizontal slice at height y, by rays out from (0, y, z0) between angles a0 and a1 (0 = straight ahead).
  function hSlice(F, y, z0, a0, a1, N, R) {
    const pts = [];
    for (let i = 0; i <= N; i++) { const a = mix(a0, a1, i / N); pts.push(hit(F, 0, y, z0, Math.sin(a), 0, Math.cos(a), R)); }
    return pts;
  }
  // A vertical front-to-back slice at x, by rays out from (x, y0, z0).
  function vSlice(F, x, y0, z0, N, R) {
    const pts = [];
    for (let i = 0; i <= N; i++) { const a = mix(-Math.PI, Math.PI, i / N); pts.push(hit(F, x, y0, z0, 0, Math.cos(a), Math.sin(a), R)); }
    return pts;
  }

  (function buildSkull() {
    // Horizontal scan slices. Below the base of the skull only the face is there, so those slices only look forward.
    let k = 0;
    for (let y = -5.1; y < 10.4; y += 0.4, k++) {
      const low = y < -2.2;
      const pts = low ? hSlice(skull, y, 5.2, -1.95, 1.95, 90, 14) : hSlice(skull, y, -0.5, -Math.PI, Math.PI, 150, 14);
      addPath(pts, 0, 0.75, false);
      if (k % 3 === 1) pts.forEach((q, i) => { if (q && i % 6 === 0) NODES.push(q.map(v => v * U)); });
    }
    // Vertical front-to-back slices.
    for (let x = -6; x <= 6.01; x += 1) addPath(vSlice(skull, x, 2.0, -0.3, 150, 14), 0, 0.55, false);

    // Rims of the eye sockets: walk round each socket's outline and find where its tunnel meets the face.
    for (const side of [-1, 1]) {
      const rim = [];
      for (let j = 0; j <= 56; j++) {
        const phi = (j / 56) * TAU, u = ORB.a * sgnpow(Math.cos(phi), 2 / ORB.p), v = ORB.b * sgnpow(Math.sin(phi), 2 / ORB.p);
        let found = null;
        for (let w = 6; w > -2; w -= 0.05) { const q = orbitPoint(u, v, w); if (skullOuter(q[0], q[1], q[2]) < 0) { found = q; break; } }
        rim.push(found && [side * found[0], found[1], found[2]]);
      }
      addPath(rim, 1, 1.15, false, 2.5);
    }
    // Rim of the nose opening.
    {
      const rim = [];
      for (let i = 0; i <= NOSE.length; i++) {
        const a = NOSE[i % NOSE.length], b = NOSE[(i + 1) % NOSE.length];
        for (let f = 0; f < (i < NOSE.length ? 1 : 0.01); f += 0.25) {
          const x = mix(a[0], b[0], f), y = mix(a[1], b[1], f);
          let found = null;
          for (let z = 12; z > 4; z -= 0.05) if (skullOuter(x, y, z) < 0) { found = [x, y, z]; break; }
          rim.push(found);
        }
      }
      addPath(rim, 1, 1.15, false);
    }
    // Sutures: the coronal one over the top from side to side, and the sagittal one from there to the back.
    {
      const cor = [], tilt = 0.26;
      for (let i = 0; i <= 80; i++) {
        const b = mix(-1.25, 1.25, i / 80), q = hit(skull, 0, 3.5, 2.0, Math.sin(b), Math.cos(b) * Math.cos(tilt), -Math.cos(b) * Math.sin(tilt), 14);
        cor.push(q && [q[0], q[1], q[2] + (i % 2 ? 0.13 : -0.13)]);
      }
      addPath(cor, 1, 0.6, false);
      const sag = [];
      for (let i = 0; i <= 60; i++) {
        const g = mix(-0.12, 1.05, i / 60), q = hit(skull, 0, 3.5, -0.8, 0, Math.cos(g), -Math.sin(g), 14);
        sag.push(q && [i % 2 ? 0.12 : -0.12, q[1], q[2]]);
      }
      addPath(sag, 1, 0.6, false);
    }

    // The lower jaw: horizontal and vertical slices, and its lower border (from one condyle round the chin to the other).
    for (let y = -10.9; y < -1.5; y += 0.4) addPath(hSlice(mandible, y, 1.5, -Math.PI, Math.PI, 110, 10), 0, 0.75, true);
    for (let x = -3.5; x <= 3.51; x += 1) addPath(vSlice(mandible, x, -8.0, 2.5, 110, 10), 0, 0.55, true);
    {
      const back = [];
      for (let y = -2.4; y > -8.3; y -= 0.25) {
        let found = null;
        for (let z = -4; z < 3; z += 0.04) if (mandible(4.7, y, z) < 0) { found = [4.7, y, z]; break; }
        back.push(found);
      }
      const bottom = [];
      for (let i = 40; i >= 0; i--) {
        const t = i / 40, c = JAW_LINE.cum.findIndex(s => s >= t * JAW_LINE.len), p = JAW_LINE.pts[Math.max(0, c)];
        let found = null;
        for (let y = -13; y < -6; y += 0.03) if (mandible(p[0], y, p[1]) < 0) { found = [p[0], y, p[1]]; break; }
        bottom.push(found);
      }
      const half = back.concat(bottom);
      addPath(half.concat(half.slice(0, -1).reverse().map(q => q && [-q[0], q[1], q[2]])), 1, 0.9, true, 2.5);
    }

    // Teeth: each crown's outline as seen from outside, and the biting surface of the back teeth.
    const TIPS = {      // the biting edge, as [across (-0.5 to 0.5 of the width), height (fraction)]
      inc: [[-0.44, 0.96], [-0.2, 1], [0.2, 1], [0.44, 0.96]],
      can: [[-0.4, 0.86], [-0.12, 0.97], [0, 1], [0.12, 0.97], [0.4, 0.86]],
      pm: [[-0.42, 0.92], [-0.12, 0.99], [0, 1], [0.12, 0.99], [0.42, 0.92]],
      mol: [[-0.44, 0.95], [-0.26, 1], [-0.08, 0.93], [0.08, 0.93], [0.26, 1], [0.44, 0.95]],
    };
    for (const [row, jaw] of [[TEETH_UP, false], [TEETH_LO, true]]) {
      for (const T of row) {
        const P = (a, f, out = 0) => {
          const s = a * T.w, bulge = 0.06 * (1 - 4 * a * a) * Math.sin(Math.PI * Math.min(1, f));
          return [T.x + T.tx * s + T.nx * (bulge + out), T.g + T.dir * f * T.h, T.z + T.tz * s + T.nz * (bulge + out)];
        };
        addPath([P(-0.36, 0), P(-0.5, 0.55), ...TIPS[T.kind].map(([a, f]) => P(a, f)), P(0.5, 0.55), P(0.36, 0), P(0, -0.04), P(-0.36, 0)], 1, 1.05, jaw);
        if (T.kind !== 'inc') addPath([P(-0.42, 0.95), P(0.42, 0.95), P(0.36, 0.95, -T.thick), P(-0.36, 0.95, -T.thick), P(-0.42, 0.95)], 1, 0.5, jaw);
      }
    }
  })();

  const HINGE = [0, CONDYLE[1] * U, CONDYLE[2] * U];   // the jaw joint (an axis along x through the condyles)
  const Y_OFF = 0.025;                                  // lifts the skull so its height is centred on the stage
  const EYE_CENTRES = [[-2.9 * U, -0.2 * U, 3.6 * U], [2.9 * U, -0.2 * U, 3.6 * U]];
  const MAXPTS = LINES.reduce((m, L) => Math.max(m, L.n), 0);

  // ----- State -----
  const sk = {
    clock: 0,                // real seconds (hologram effects; not scaled by Speed)
    jaw: 0, jawV: 0,         // current jaw angle (radians) and its speed
    hitAt: -9, hitStrength: 0, lastHit: -9,
    clack: 0,                // flash when the teeth close
    glitch: 0, glitchY: 0, glitchH: 0, glitchDx: 0,
    yaw: 0, pitch: 0, flare: 0,
    wasLocked: false,
  };

  // Per-frame scratch space, so drawing allocates nothing but the paths.
  const px = new Float32Array(MAXPTS), py = new Float32Array(MAXPTS), pz = new Float32Array(MAXPTS);
  const NB = 8;

  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function updateJaw(api, dt) {
    const { state } = api;
    // A hit: a detected beat, or the beat clock ticking while it is locked to the music. Hits closer
    // together than 0.12 s count as one.
    const clockHit = state.locked && state.tick && state.clarity > 0.35;
    if ((state.onset || clockHit) && sk.clock - sk.lastHit > 0.12) {
      sk.lastHit = sk.hitAt = sk.clock;
      sk.hitStrength = 0.5 + 0.5 * Math.max(state.punch, state.snap, state.relLevel * 0.7);
      sk.flare = 1;
    }
    const period = (state.period || 500) / 1000;
    const fall = clamp(period * 0.6, 0.18, 0.5);         // how long it takes to shut again
    const x = clamp((sk.clock - sk.hitAt - 0.02) / fall, 0, 1);
    const env = 1 - x * x;                               // slow to start closing, then slams shut
    const active = state.level > 0.02 || state.locked;
    const rest = active ? 0 : 0.035 + 0.02 * Math.sin(sk.clock * 1.3);   // hangs slightly slack in silence
    const target = rest + (JAW_MAX * 0.95 * sk.hitStrength) * env;
    // A spring on the angle, stepped finely so a slow frame can't blow it up.
    const steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps, K = 2600, C = 2 * 0.7 * Math.sqrt(K);
    for (let i = 0; i < steps; i++) {
      sk.jawV += (K * (target - sk.jaw) - C * sk.jawV) * h;
      sk.jaw += sk.jawV * h;
      if (sk.jaw < 0) {                                   // the teeth meet
        if (sk.jawV < -0.9) sk.clack = Math.min(1, -sk.jawV / 3);
        sk.jaw = 0; sk.jawV *= -0.25;
      }
      if (sk.jaw > JAW_MAX) { sk.jaw = JAW_MAX; sk.jawV = 0; }
    }
    sk.clack *= Math.pow(0.0005, dt);
    sk.flare *= Math.pow(0.02, dt);
  }

  // Advances the shared motion one frame: the clock, the jaw, the sweep, and the tilt. Both skull visuals call it.
  function step(api) {
    const dt = clamp(api.dt || 1 / 60, 0.001, 0.05);
    sk.clock += dt;
    updateJaw(api, dt);
    // Sweep left and right on the flow clock (so Speed and Reverse apply), and tip back as the mouth opens.
    sk.yaw = SWEEP * Math.sin((api.time || 0) * SWEEP_RATE);
    sk.pitch = 0.05 + 0.04 * Math.sin((api.time || 0) * 0.43) - 0.3 * sk.jaw;
    return dt;
  }
  function drawVersion(ctx, W, H, name) {
    if (!SHOW_VERSION) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${Math.max(11, Math.round(Math.min(W, H) / 60))}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(190, 215, 235, 0.75)';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${name} ${VERSION}`, 12, H - 10);
    ctx.restore();
  }
  // Where the skull sits on the stage: scale (pixels per drawing unit) and centre, with a gentle float.
  const layout = (W, H) => {
    const sc = Math.min(H * 0.3, W * 0.27);
    return { sc, cx: W / 2, cy: H * 0.46 + Math.sin(sk.clock * 1.1) * sc * 0.015 };
  };

  function draw(api) {
    const { ctx, W, H, state, fade } = api;
    const dt = step(api);
    const clock = sk.clock;

    // Glitch: on sharp attacks, now and then, a band of the picture slips sideways for a moment.
    if (state.onset && Math.random() < 0.12 + 0.35 * state.snap) sk.glitch = 0.1 + Math.random() * 0.12;
    if (sk.glitch > 0) sk.glitch -= dt;

    fade(0.32);

    const { sc, cx, cy } = layout(W, H);
    const floorY = cy + sc * 1.62, topY = cy - sc * 1.15;
    const hue = HUE + 22 * Math.sin((state.hue || 0) * Math.PI / 180);
    const glob = 0.78 + 0.22 * Math.max(state.beat, state.level);
    let flick = 0.93 + 0.05 * Math.sin(clock * 41) * Math.sin(clock * 13.7) + (hash(Math.floor(clock * 24)) < 0.04 ? -0.25 : 0);
    flick = clamp(flick, 0.5, 1);
    if (sk.glitch > 0 && !sk.glitchH) {
      sk.glitchH = sc * (0.05 + Math.random() * 0.18); sk.glitchY = mix(topY, floorY - sc * 0.5, Math.random());
      sk.glitchDx = (Math.random() < 0.5 ? -1 : 1) * sc * (0.03 + Math.random() * 0.1);
    }
    if (sk.glitch <= 0) sk.glitchH = 0;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    // --- Projector base and light cone ---
    const R0 = sc * (0.8 + 0.05 * state.bass), RT = sc * 1.45;
    const cone = ctx.createLinearGradient(0, floorY, 0, topY);
    cone.addColorStop(0, `hsla(${hue} 100% 60% / ${0.09 + 0.09 * state.bass})`);
    cone.addColorStop(0.6, `hsla(${hue} 100% 60% / 0.03)`);
    cone.addColorStop(1, `hsla(${hue} 100% 60% / 0)`);
    const coneShape = new Path2D();
    coneShape.moveTo(cx - R0, floorY); coneShape.lineTo(cx - RT, topY); coneShape.lineTo(cx + RT, topY); coneShape.lineTo(cx + R0, floorY);
    coneShape.ellipse(cx, floorY, R0, R0 * 0.2, 0, 0, Math.PI);
    ctx.fillStyle = cone;
    ctx.fill(coneShape);
    const disc = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, R0);
    disc.addColorStop(0, `hsla(${hue} 100% 60% / ${0.14 + 0.14 * state.bass})`);
    disc.addColorStop(1, `hsla(${hue} 100% 50% / 0)`);
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.ellipse(cx, floorY, R0, R0 * 0.2, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1, sc / 300);
    for (let i = 0; i < 3; i++) {
      const R = R0 * (1 + i * 0.22) * (1 + (i === 0 ? 0.03 * state.beat : 0));
      ctx.strokeStyle = `hsla(${hue} 100% ${70 - i * 6}% / ${(0.7 - i * 0.18) * flick})`;
      ctx.setLineDash(i === 1 ? [sc * 0.07, sc * 0.05] : []);
      ctx.lineDashOffset = -clock * sc * 0.2 * (i % 2 ? -1 : 1);
      ctx.beginPath(); ctx.ellipse(cx, floorY, R, R * 0.2, 0, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);

    // --- The skull ---
    const cyaw = Math.cos(sk.yaw), syaw = Math.sin(sk.yaw), cpit = Math.cos(sk.pitch), spit = Math.sin(sk.pitch);
    const cj = Math.cos(sk.jaw), sj = Math.sin(sk.jaw);
    const glide = 0.035 * sk.jaw / JAW_MAX;
    const scanY = mix(topY + sc * 0.1, floorY - sc * 0.4, (clock * 0.28) % 1);
    const scanW = sc * 0.1;
    const gy0 = sk.glitchY, gy1 = sk.glitchY + sk.glitchH;
    const accent = 0.9 + 0.45 * sk.flare + 0.3 * sk.clack;

    // Rotate and project one point.
    let rx = 0, ry = 0, rz = 0;
    const place = (x, y, z, jaw) => {
      if (jaw) {                                              // swing the lower jaw about its hinge
        const yy = y - HINGE[1], zz = z - HINGE[2];
        y = HINGE[1] + yy * cj - zz * sj; z = HINGE[2] + yy * sj + zz * cj + glide;   // it also slides forward a little
      }
      y += Y_OFF;
      const x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw;
      const y2 = y * cpit - z1 * spit, z2 = y * spit + z1 * cpit;
      const k = CAMERA / (CAMERA - z2);
      rx = cx + x1 * k * sc; ry = cy - y2 * k * sc; rz = z2;
      if (gy1 > gy0 && ry > gy0 && ry < gy1) rx += sk.glitchDx;
    };

    const paths = [[], []];
    for (let s = 0; s < 2; s++) for (let b = 0; b < NB; b++) paths[s].push(null);
    const shade = z => 0.25 + 0.75 * Math.pow(clamp((z + 1.2) / 2.4, 0, 1), 1.3);
    for (const L of LINES) {
      const n = L.n, p = L.p;
      for (let i = 0; i < n; i++) { place(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], L.jaw); px[i] = rx; py[i] = ry; pz[i] = rz; }
      for (let i = 0; i < n - 1; i++) {
        const my = (py[i] + py[i + 1]) / 2, dz = (pz[i] + pz[i + 1]) / 2, d = (my - scanY) / scanW;
        let b = (shade(dz) * 0.85 + 0.9 * Math.exp(-d * d)) * L.w * glob * flick;
        if (L.style) b *= accent;
        const bi = clamp(Math.floor(b * NB), 0, NB - 1);
        const path = paths[L.style][bi] || (paths[L.style][bi] = new Path2D());
        path.moveTo(px[i], py[i]); path.lineTo(px[i + 1], py[i + 1]);
      }
    }
    const lw = Math.max(1, sc / 330);
    for (let s = 0; s < 2; s++) {
      for (let b = 0; b < NB; b++) {
        const path = paths[s][b];
        if (!path) continue;
        const a = (b + 0.5) / NB, light = s ? 86 : 64;
        if (s || b >= NB / 2) {                               // glow only where it shows: accents and the brighter lines
          ctx.strokeStyle = `hsla(${hue + s * 8} 100% 50% / ${a * 0.22})`;
          ctx.lineWidth = lw * 4.5;
          ctx.stroke(path);
        }
        ctx.strokeStyle = `hsla(${hue + s * 8} 100% ${light}% / ${Math.min(1, a * 1.15)})`;
        ctx.lineWidth = lw * (s ? 1.5 : 1.1);
        ctx.stroke(path);
      }
    }
    // Glowing nodes where the contours cross, bright at the front and faint at the back.
    {
      const front = new Path2D(), back = new Path2D(), d = Math.max(1.5, sc / 190);
      for (const q of NODES) {
        place(q[0], q[1], q[2], false);
        (rz > 0 ? front : back).rect(rx - d / 2, ry - d / 2, d, d);
      }
      ctx.fillStyle = `hsla(${hue} 100% 80% / ${0.8 * flick})`; ctx.fill(front);
      ctx.fillStyle = `hsla(${hue} 100% 60% / 0.25)`; ctx.fill(back);
    }

    // Eyes: a glow deep in each socket that flares on the beat.
    for (const [x, y, z] of EYE_CENTRES) {
      place(x, y, z, false);
      const r = sc * (0.1 + 0.07 * sk.flare + 0.03 * state.mid), a = 0.35 + 0.65 * Math.max(sk.flare, state.mid * 0.8);
      const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
      g.addColorStop(0, `hsla(${hue + 10} 100% 90% / ${a})`);
      g.addColorStop(0.35, `hsla(${hue} 100% 60% / ${a * 0.5})`);
      g.addColorStop(1, `hsla(${hue} 100% 50% / 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(rx - r, ry - r, r * 2, r * 2);
    }

    // Motes rising through the beam.
    {
      const motes = new Path2D(), d = Math.max(1.5, sc / 170);
      for (let i = 0; i < 46; i++) {
        const ph = (hash(i) + clock * (0.03 + 0.05 * hash(i + 50))) % 1;
        const x = cx + (hash(i + 100) * 2 - 1) * mix(R0, RT, ph) * 0.95, y = floorY - ph * (floorY - topY);
        const s = d * (0.6 + hash(i + 150)), fadeIn = Math.sin(ph * Math.PI);
        if (fadeIn > 0.25 + 0.5 * hash(i + 200)) motes.rect(x, y, s, s);
      }
      ctx.fillStyle = `hsla(${hue} 100% 80% / 0.6)`; ctx.fill(motes);
    }

    // Scanlines over the whole projection, and the bright band travelling up it.
    {
      ctx.save();
      ctx.clip(coneShape);                                  // keep the overlay inside the beam
      const lines = new Path2D(), step = Math.max(3, sc / 80), left = cx - RT, width = RT * 2;
      for (let y = topY; y < floorY; y += step) lines.rect(left, y, width, Math.max(1, step * 0.3));
      ctx.fillStyle = `hsla(${hue} 100% 70% / 0.035)`; ctx.fill(lines);
      const band = ctx.createLinearGradient(0, scanY - scanW, 0, scanY + scanW);
      band.addColorStop(0, `hsla(${hue} 100% 70% / 0)`);
      band.addColorStop(0.5, `hsla(${hue} 100% 80% / 0.10)`);
      band.addColorStop(1, `hsla(${hue} 100% 70% / 0)`);
      ctx.fillStyle = band;
      ctx.fillRect(left, scanY - scanW, width, scanW * 2);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    drawVersion(ctx, W, H, 'Skull');
  }

  MRD.skull = sk;
  // The model and motion, shared with the X-ray Skull (visuals/xray.js). Solids are in cm; drawing units are U cm.
  MRD.skullModel = {
    skull, mandible, upperTeeth, lowerTeeth, sk, step, layout, drawVersion, VERSION,
    U, CAMERA, JAW_MAX, CONDYLE, Y_OFF, glide: () => 0.035 * sk.jaw / JAW_MAX,
  };
  MRD.register({
    name: 'Skull', draw, motion: true,
    reverseLabel: 'Skull sweeps the other way',
    debug: () => [
      ['Jaw', `${(sk.jaw * 180 / Math.PI).toFixed(0)}° (${sk.hitStrength.toFixed(2)} hit)`, sk.jaw / JAW_MAX],
      ['Sweep', `${(sk.yaw * 180 / Math.PI).toFixed(0)}°`, (sk.yaw / SWEEP + 1) / 2],
    ],
  });
})();
