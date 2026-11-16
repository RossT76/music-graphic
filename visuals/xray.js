// X-ray skull: the same skull as the Skull visual (visuals/skull.js), drawn as a solid, sculpted surface in
// steel blue with an X-ray rim glow, solid enamel teeth, and fine sutures. It sweeps left and right and opens its
// jaw on the beat exactly like the wireframe one (they share the model and the motion).
//
// How it works:
//  - The first time it is shown, it turns the skull's solids (the skull, the lower jaw, and each row of teeth) into
//    triangle meshes with "surface nets": the solid is sampled on a fine grid near its surface, and one vertex is
//    placed in every grid cell the surface passes through. This takes a few seconds, so it is spread over frames
//    (with a progress ring) instead of freezing the page, and it happens once.
//  - For every vertex it also works out how sharply the surface curves there (crests such as the brow, the rims of
//    the sockets and the cheekbones are convex; creases concave) and how enclosed it is (ambient occlusion: deep
//    in the sockets and the nose, between the teeth). Those, with the surface's angle to the viewer, drive the
//    shading: a mid steel-blue that darkens in cavities and turns icy blue-white where the surface turns away
//    (the Fresnel rim) and along crests. The teeth are a brighter, glossier enamel.
//  - It is drawn with WebGL on a hidden canvas, which is then copied onto the stage, so the background setting
//    (black, green, transparent) still applies. Sutures are drawn in the shader as fine zigzag lines.
//  - On a beat the jaw snaps open (shared with Skull), the rim glow brightens, and a faint light pulses deep in
//    the sockets. A slow scan line drifts up the bone.
(() => {
  'use strict';
  const M = MRD.skullModel;
  if (!M) return;                                     // needs visuals/skull.js loaded first

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mix = (a, b, t) => a + (b - a) * t;

  // The pieces to mesh: solid, bounding box (cm), grid spacing (cm), material (0 bone, 1 enamel), part of the jaw.
  const PARTS = [
    { name: 'skull', F: M.skull, box: [[-7.9, -5.8, -10.7], [7.9, 11.1, 10.0]], h: 0.16, mat: 0, jaw: 0, weight: 0.58 },
    { name: 'upper teeth', F: M.upperTeeth, box: [[-3.4, -6.7, 2.4], [3.4, -4.7, 9.1]], h: 0.055, mat: 1, jaw: 0, weight: 0.08 },
    { name: 'jaw', F: M.mandible, box: [[-6.1, -11.5, -1.7], [6.1, -1.0, 8.7]], h: 0.14, mat: 0, jaw: 1, weight: 0.26 },
    { name: 'lower teeth', F: M.lowerTeeth, box: [[-3.2, -7.7, 2.4], [3.2, -5.8, 8.6]], h: 0.055, mat: 1, jaw: 1, weight: 0.08 },
  ];

  // ----- Meshing -----
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  // Builds one part's mesh. A generator: it yields its progress (0-1) every few hundred samples, so the caller can
  // stop when the frame's time is up and carry on next frame.
  function* meshPart(P) {
    const { F, h } = P, [x0, y0, z0] = P.box[0], [x1, y1, z1] = P.box[1];
    const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
    const idx = (i, j, k) => i + nx * (j + ny * k);
    const val = new Float32Array(nx * ny * nz).fill(NaN);
    let work = 0;
    const at = (i, j, k) => {
      const n = idx(i, j, k);
      if (val[n] !== val[n]) { val[n] = F(x0 + i * h, y0 + j * h, z0 + k * h); work++; }
      return val[n];
    };
    // 1. Sample the solid, but only near its surface: a coarse grid first, then the fine grid inside every coarse
    //    cell that the surface could pass through.
    const C = 4, band = C * h * 1.4;
    const cnx = Math.ceil((nx - 1) / C), cny = Math.ceil((ny - 1) / C), cnz = Math.ceil((nz - 1) / C);
    for (let ck = 0; ck < cnz; ck++) {
      for (let cj = 0; cj < cny; cj++) {
        for (let ci = 0; ci < cnx; ci++) {
          const i0 = ci * C, j0 = cj * C, k0 = ck * C, i1 = Math.min(i0 + C, nx - 1), j1 = Math.min(j0 + C, ny - 1), k1 = Math.min(k0 + C, nz - 1);
          let near = Infinity;
          for (const k of [k0, k1]) for (const j of [j0, j1]) for (const i of [i0, i1]) near = Math.min(near, Math.abs(at(i, j, k)));
          if (near > band) continue;
          for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) at(i, j, k);
          if (work > 400) { work = 0; yield 0.75 * (ck + cj / cny) / cnz; }
        }
      }
    }
    // 2. One vertex per cell the surface crosses, at the average of the crossings on its edges.
    const cnxm = nx - 1, cnym = ny - 1;
    const cells = new Int32Array(cnxm * cnym * (nz - 1)).fill(-1);
    const cid = (i, j, k) => i + cnxm * (j + cnym * k);
    const pos = [], v = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) {
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          let mask = 0, ok = true;
          for (let c = 0; c < 8; c++) {
            const q = val[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
            if (q !== q) { ok = false; break; }
            v[c] = q; if (q < 0) mask |= 1 << c;
          }
          if (!ok || mask === 0 || mask === 255) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [a, b] of EDGES) {
            if ((v[a] < 0) === (v[b] < 0)) continue;
            const t = v[a] / (v[a] - v[b]);
            sx += (a & 1) + ((b & 1) - (a & 1)) * t;
            sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
            sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
            n++;
          }
          cells[cid(i, j, k)] = pos.length / 3;
          pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
        }
      }
      if (k % 8 === 0) yield 0.75 + 0.05 * k / nz;
    }
    // 3. A quad (two triangles) across every grid edge the surface crosses, joining the four cells around it,
    //    wound so it faces out of the solid.
    const tris = [];
    const quad = (a, b, c, d, out) => {
      a = cells[a]; b = cells[b]; c = cells[c]; d = cells[d];
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (out) tris.push(a, b, c, a, c, d); else tris.push(a, c, b, a, d, c);
    };
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          if (cells[cid(i, j, k)] < 0) continue;
          const inside = val[idx(i, j, k)] < 0;
          if ((val[idx(i + 1, j, k)] < 0) !== inside) quad(cid(i, j, k), cid(i, j - 1, k), cid(i, j - 1, k - 1), cid(i, j, k - 1), inside);
          if ((val[idx(i, j + 1, k)] < 0) !== inside) quad(cid(i, j, k), cid(i, j, k - 1), cid(i - 1, j, k - 1), cid(i - 1, j, k), inside);
          if ((val[idx(i, j, k + 1)] < 0) !== inside) quad(cid(i, j, k), cid(i - 1, j, k), cid(i - 1, j - 1, k), cid(i, j - 1, k), inside);
        }
      }
    }
    yield 0.82;
    // 4. Smooth the vertices a little (the grid leaves faint terracing), then normals, curvature and occlusion.
    const nv = pos.length / 3, P3 = Float32Array.from(pos), nsum = new Float32Array(nv * 3), cnt = new Float32Array(nv);
    const neighbourSums = () => {
      nsum.fill(0); cnt.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = tris[t + e], b = tris[t + (e + 1) % 3];
          for (let c = 0; c < 3; c++) { nsum[a * 3 + c] += P3[b * 3 + c]; nsum[b * 3 + c] += P3[a * 3 + c]; }
          cnt[a]++; cnt[b]++;
        }
      }
    };
    neighbourSums();
    for (let i = 0; i < nv; i++) if (cnt[i]) for (let c = 0; c < 3; c++) P3[i * 3 + c] = mix(P3[i * 3 + c], nsum[i * 3 + c] / cnt[i], 0.5);
    const N3 = new Float32Array(nv * 3);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = P3[b] - P3[a], uy = P3[b + 1] - P3[a + 1], uz = P3[b + 2] - P3[a + 2];
      const vx = P3[c] - P3[a], vy = P3[c + 1] - P3[a + 1], vz = P3[c + 2] - P3[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N3[q] += fx; N3[q + 1] += fy; N3[q + 2] += fz; }
    }
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(N3[i * 3], N3[i * 3 + 1], N3[i * 3 + 2]) || 1;
      N3[i * 3] /= l; N3[i * 3 + 1] /= l; N3[i * 3 + 2] /= l;
    }
    // Curvature from how far each vertex sits from the average of its neighbours, along the normal (1 / radius,
    // positive on crests), averaged once with the neighbours so it is not noisy.
    neighbourSums();
    const kap = new Float32Array(nv), e2 = h * h * 1.2;
    for (let i = 0; i < nv; i++) {
      if (!cnt[i]) continue;
      const lx = nsum[i * 3] / cnt[i] - P3[i * 3], ly = nsum[i * 3 + 1] / cnt[i] - P3[i * 3 + 1], lz = nsum[i * 3 + 2] / cnt[i] - P3[i * 3 + 2];
      kap[i] = -2 * (lx * N3[i * 3] + ly * N3[i * 3 + 1] + lz * N3[i * 3 + 2]) / e2;
    }
    const kap2 = new Float32Array(nv), kc = new Float32Array(nv);
    for (let pass = 0; pass < 3; pass++) {                // averaged with the neighbours three times, so it is not blotchy
      kap2.fill(0); kc.fill(0);
      for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; kap2[a] += kap[b]; kc[a]++; kap2[b] += kap[a]; kc[b]++; }
      for (let i = 0; i < nv; i++) if (kc[i]) kap[i] = (kap[i] + kap2[i] / kc[i]) / 2;
    }
    yield 0.86;
    // Ambient occlusion: step out from the surface, straight out and in four directions tilted 50 degrees from it,
    // and see how much of the solid is still close by. Deep in the sockets and the nose the walls are close on
    // every side, so those go dark; open surfaces stay lit. (The teeth only need the short, straight-out test.)
    const attr = new Float32Array(nv * 2), DIST = P.mat ? [0.12, 0.3, 0.6] : [0.5, 1.2, 2.2];
    for (let i = 0; i < nv; i++) {
      const px = P3[i * 3], py = P3[i * 3 + 1], pz = P3[i * 3 + 2], qx = N3[i * 3], qy = N3[i * 3 + 1], qz = N3[i * 3 + 2];
      // two tangents
      let tx = Math.abs(qx) < 0.9 ? 1 : 0, ty = 1 - tx, tz = 0;
      const dt = tx * qx + ty * qy; tx -= dt * qx; ty -= dt * qy; tz -= dt * qz;
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      const bx = qy * tz - qz * ty, by = qz * tx - qx * tz, bz = qx * ty - qy * tx;
      const dirs = P.mat ? [[qx, qy, qz]] : [[qx, qy, qz]].concat([[tx, ty, tz], [-tx, -ty, -tz], [bx, by, bz], [-bx, -by, -bz]]
        .map(([ax, ay, az]) => [qx * 0.64 + ax * 0.77, qy * 0.64 + ay * 0.77, qz * 0.64 + az * 0.77]));
      let occ = 0;
      // (a tilted step is only expected to rise d * cos(50 degrees) off a flat surface, so it is judged against that)
      dirs.forEach(([dx, dy, dz], j) => { const c = j ? 0.64 : 1; for (const d of DIST) occ += clamp((d * c - F(px + dx * d, py + dy * d, pz + dz * d)) / (d * c), 0, 1); });
      attr[i * 2] = kap[i];
      attr[i * 2 + 1] = clamp(1 - 1.3 * occ / (dirs.length * DIST.length), 0, 1);
      if (i % 200 === 0) yield 0.86 + 0.14 * i / nv;
    }
    const vbo = new Float32Array(nv * 8);
    for (let i = 0; i < nv; i++) {
      vbo.set([P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2], N3[i * 3], N3[i * 3 + 1], N3[i * 3 + 2], attr[i * 2], attr[i * 2 + 1]], i * 8);
    }
    P.mesh = { vbo, ibo: Uint32Array.from(tris), count: tris.length };
  }
  function* buildAll() {
    let done = 0;
    for (const P of PARTS) {
      for (const f of meshPart(P)) yield done + P.weight * f;
      done += P.weight;
    }
  }

  // ----- WebGL -----
  const VERT = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aAttr;
uniform mat3 uRot; uniform mat3 uJaw; uniform vec3 uHinge; uniform float uGlide, uIsJaw, uYOff, uCam;
uniform vec2 uScale, uCenter;
varying vec3 vN, vV, vObj; varying vec2 vAttr;
void main() {
  vec3 p = aPos, n = aNrm;
  if (uIsJaw > 0.5) { p = uJaw * (p - uHinge) + uHinge + vec3(0.0, 0.0, uGlide); n = uJaw * n; }
  p.y += uYOff;
  vec3 v = uRot * p;
  vN = uRot * n; vV = vec3(0.0, 0.0, uCam) - v; vObj = aPos; vAttr = aAttr;
  float w = (uCam - v.z) / uCam;
  gl_Position = vec4(v.x * uScale.x + uCenter.x * w, v.y * uScale.y + uCenter.y * w, -v.z / 16.0 * w, w);
}`;
  const FRAG = `
precision highp float;
varying vec3 vN, vV, vObj; varying vec2 vAttr;
uniform float uMat, uGlow, uEye, uScan, uClack;
float zig(float t, float f) { return 0.05 * sin(t * f) + 0.025 * sin(t * f * 2.7 + 1.3); }
float line(float d, float w) { return 1.0 - smoothstep(w * 0.35, w, abs(d)); }
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0), fres = pow(1.0 - ndv, 2.0);
  float ao = vAttr.y, ridge = smoothstep(0.1, 0.7, vAttr.x), crease = smoothstep(0.2, 1.0, -vAttr.x);
  vec3 L = normalize(vec3(-0.3, 0.6, 0.75));
  float diff = max(dot(N, L), 0.0), spec = pow(max(dot(N, normalize(L + V)), 0.0), 36.0);
  vec3 ice = vec3(0.62, 0.85, 1.0), col;
  if (uMat < 0.5) {
    // X-ray bone: lit where it faces you, a darker band as it turns away, then a bright icy rim at the edge;
    // cavities dark, crests catching the light.
    vec3 deep = vec3(0.04, 0.10, 0.19), mid = vec3(0.24, 0.50, 0.72);
    float front = pow(ndv, 0.9) * (0.7 + 0.3 * diff);
    col = mix(deep, mid, front * ao);
    col = mix(col, ice, clamp(pow(1.0 - ndv, 1.8) * 1.1 + ridge * 0.55, 0.0, 1.0) * ao * uGlow);
    col += ice * spec * 0.15 * ao;
    col *= 1.0 - 0.45 * crease;
    // Sutures (fine, faint): down the forehead, across the top and back, across the bridge of the nose, at the
    // outer rim of each socket, and under the nose.
    vec3 o = vObj; float ax = abs(o.x), s = 0.0;
    float cor = (o.y - 3.5) * 0.2571 + (o.z - 2.0) * 0.9664;
    s = max(s, line(o.x - 0.6 * zig(o.y, 18.0), 0.05) * step(2.0, o.y) * step(3.0, o.z) * (1.0 - smoothstep(6.5, 7.5, o.y)));
    s = max(s, line(cor - zig(o.x + o.y, 9.0), 0.05) * step(1.0, o.y));
    s = max(s, line(o.x - zig(o.z, 14.0), 0.05) * step(cor, 0.0) * step(6.0, o.y));
    s = max(s, line(o.y - 1.45 - 0.5 * zig(o.x, 22.0), 0.05) * step(ax, 0.7) * step(7.6, o.z));
    s = max(s, line(o.y - 0.95 - 0.5 * zig(o.z, 20.0), 0.05) * step(4.5, ax) * step(4.2, o.z) * step(o.z, 6.2));
    s = max(s, line(o.x - 0.4 * zig(o.y, 22.0), 0.04) * step(o.y, -3.8) * step(-4.9, o.y) * step(7.6, o.z));
    col = mix(col, ice, s * 0.3 * ao);
    // Darkness that deepens into the eye sockets and the nose (without it the back wall of a socket, which faces you,
    // catches the light and looks like an eye).
    vec2 orb = vec2((ax - 2.95) / 2.0, (o.y + 0.15) / 1.8);
    float sock = (1.0 - smoothstep(0.85, 1.15, length(orb))) * smoothstep(6.3, 3.6, o.z) * smoothstep(1.6, 2.6, o.z);
    float nose = (1.0 - smoothstep(0.8, 1.05, ax)) * smoothstep(-3.9, -3.4, o.y) * (1.0 - smoothstep(-0.7, -0.2, o.y)) * smoothstep(8.0, 5.5, o.z) * smoothstep(2.2, 3.2, o.z);
    col *= 1.0 - 0.8 * max(sock, nose);
    col += ice * 0.14 * exp(-pow((o.y - uScan) / 0.3, 2.0)) * (0.25 + fres) * ao;
    vec3 e = vec3(ax, o.y, o.z) - vec3(2.9, -0.2, 3.9);
    col += vec3(0.2, 0.5, 1.0) * uEye * exp(-dot(e, e) / 1.4);
  } else {
    vec3 enamel = vec3(0.66, 0.88, 0.97);
    col = enamel * (0.55 + 0.4 * ndv + 0.25 * diff) * (0.55 + 0.45 * ao);   // the lower row sits in more shadow, so lean less on it
    col = mix(col, vec3(0.85, 0.95, 1.0), fres * 0.45 * uGlow);
    col += vec3(1.0) * spec * 0.45 * ao;
    col *= 1.0 - 0.4 * crease;
    col += vec3(0.5, 0.75, 1.0) * uClack * 0.25;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

  const X = { status: 'idle', progress: 0, builder: null, gl: null, canvas: null, prog: null, loc: {}, tris: 0, error: '' };

  function initGL() {
    const opts = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true };
    const canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl2', opts);
    if (!gl) {
      gl = canvas.getContext('webgl', opts);
      if (gl && !gl.getExtension('OES_element_index_uint')) gl = null;   // needs 32-bit indices
    }
    if (!gl) throw new Error('WebGL is not available in this browser');
    const shader = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    for (const a of ['aPos', 'aNrm', 'aAttr']) X.loc[a] = gl.getAttribLocation(prog, a);
    for (const u of ['uRot', 'uJaw', 'uHinge', 'uGlide', 'uIsJaw', 'uYOff', 'uCam', 'uScale', 'uCenter', 'uMat', 'uGlow', 'uEye', 'uScan', 'uClack'])
      X.loc[u] = gl.getUniformLocation(prog, u);
    Object.assign(X, { gl, canvas, prog });
  }
  function upload() {
    const gl = X.gl;
    X.tris = 0;
    for (const P of PARTS) {
      P.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, P.vb); gl.bufferData(gl.ARRAY_BUFFER, P.mesh.vbo, gl.STATIC_DRAW);
      P.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, P.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, P.mesh.ibo, gl.STATIC_DRAW);
      P.count = P.mesh.count; X.tris += P.count / 3;
      P.mesh = null;                                   // the GPU has it now
    }
  }

  // Runs the mesh builder until this frame's time budget is spent.
  function pump(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const r = X.builder.next();
      if (r.done) { upload(); X.status = 'ready'; return; }
      X.progress = r.value;
    }
  }

  function message(api, text, frac) {
    const { ctx, W, H } = api;
    const r = Math.min(W, H) * 0.06, cx = W / 2, cy = H / 2;
    ctx.save();
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.strokeStyle = 'rgba(120, 180, 230, 0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (frac !== null) {
      ctx.strokeStyle = 'rgba(160, 215, 255, 0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(170, 210, 240, 0.85)';
    ctx.font = `${Math.max(12, r * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy + r * 1.7);
    ctx.restore();
  }

  function draw(api) {
    const { ctx, W, H, state } = api;
    M.step(api);
    const sk = M.sk;
    api.clearStage();
    M.drawVersion(ctx, W, H, 'X-ray Skull');

    if (X.status === 'idle') {
      try { initGL(); X.builder = buildAll(); X.status = 'building'; } catch (e) { X.status = 'failed'; X.error = e.message; }
    }
    if (X.status === 'failed') { message(api, `X-ray Skull can't run here: ${X.error}`, null); return; }
    if (X.status === 'building') {
      pump(28);
      if (X.status === 'building') { message(api, `Building the skull… ${Math.round(X.progress * 100)}%`, X.progress); return; }
    }

    const gl = X.gl, L = X.loc, cv = X.canvas;
    const pw = ctx.canvas.width, ph = ctx.canvas.height;
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(X.prog);

    // The same rotation, perspective and placement as the wireframe Skull (see place() in skull.js), in cm.
    const U = M.U, { sc, cx, cy } = M.layout(W, H);
    const cyw = Math.cos(sk.yaw), syw = Math.sin(sk.yaw), cp = Math.cos(sk.pitch), sp = Math.sin(sk.pitch);
    gl.uniformMatrix3fv(L.uRot, false, [cyw, sp * syw, -cp * syw, 0, cp, sp, syw, -sp * cyw, cp * cyw]);
    const cj = Math.cos(sk.jaw), sj = Math.sin(sk.jaw);
    gl.uniformMatrix3fv(L.uJaw, false, [1, 0, 0, 0, cj, sj, 0, -sj, cj]);
    gl.uniform3f(L.uHinge, 0, M.CONDYLE[1], M.CONDYLE[2]);
    gl.uniform1f(L.uGlide, M.glide() / U);
    gl.uniform1f(L.uYOff, M.Y_OFF / U);
    gl.uniform1f(L.uCam, M.CAMERA / U);
    gl.uniform2f(L.uScale, sc * U * 2 / W, sc * U * 2 / H);
    gl.uniform2f(L.uCenter, cx / W * 2 - 1, 1 - cy / H * 2);
    gl.uniform1f(L.uGlow, 0.9 + 0.3 * sk.flare + 0.15 * (state.beat || 0));
    gl.uniform1f(L.uEye, 0.12 + 0.45 * sk.flare);
    gl.uniform1f(L.uScan, mix(-11.5, 11, (sk.clock * 0.1) % 1));
    gl.uniform1f(L.uClack, sk.clack);

    for (const P of PARTS) {
      gl.bindBuffer(gl.ARRAY_BUFFER, P.vb);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, P.ib);
      gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(L.aNrm); gl.vertexAttribPointer(L.aNrm, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(L.aAttr); gl.vertexAttribPointer(L.aAttr, 2, gl.FLOAT, false, 32, 24);
      gl.uniform1f(L.uMat, P.mat);
      gl.uniform1f(L.uIsJaw, P.jaw);
      gl.drawElements(gl.TRIANGLES, P.count, gl.UNSIGNED_INT, 0);
    }
    ctx.drawImage(cv, 0, 0, W, H);
  }

  MRD.xray = X;
  MRD.register({
    name: 'X-ray Skull', draw, motion: true,
    reverseLabel: 'Skull sweeps the other way',
    debug: () => [
      ['Mesh', X.status === 'ready' ? `${Math.round(X.tris / 1000)}k triangles` : X.status === 'building' ? `building ${Math.round(X.progress * 100)}%` : X.status],
      ['Jaw', `${(M.sk.jaw * 180 / Math.PI).toFixed(0)}°`, M.sk.jaw / M.JAW_MAX],
    ],
  });
})();
