import * as THREE from 'three';

// Mesh utilities for deriving clean garment shells and baked shading from the base body mesh.
// All functions work on canonical ("welded") vertex ids so UV/normal seams never tear apart.

// Canonical vertex id per position: seam duplicates collapse onto the first vertex at that spot
export function weldIndex(pos, eps = 1e-5) {
  const map = new Map();
  const weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`;
    let c = map.get(key);
    if (c === undefined) {
      c = i;
      map.set(key, i);
    }
    weld[i] = c;
  }
  return weld;
}

export function buildAdjacency(idx, weld) {
  const adj = new Map();
  const link = (a, b) => {
    if (a === b) return;
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (let i = 0; i < idx.count; i += 3) {
    const a = weld[idx.getX(i)];
    const b = weld[idx.getX(i + 1)];
    const c = weld[idx.getX(i + 2)];
    link(a, b); link(b, a);
    link(b, c); link(c, b);
    link(a, c); link(c, a);
  }
  return adj;
}

// Taubin λ|μ smoothing (no shrinkage) of P (xyz per canonical id) over `verts`. Pinned vertices stay
// put, and links leaving `verts` or rejected by `cut(a, b)` are ignored so separate parts don't web.
export function taubinSmooth(P, verts, adj, pinned, iterations, cut = null) {
  const tmp = new Float32Array(P.length);
  const moved = [];
  const pass = f => {
    moved.length = 0;
    for (const v of verts) {
      if (pinned.has(v)) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const u of adj.get(v) || []) {
        if (!verts.has(u) || (cut && cut(v, u))) continue;
        sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2];
        n++;
      }
      if (!n) continue;
      const o = v * 3;
      tmp[o] = P[o] + f * (sx / n - P[o]);
      tmp[o + 1] = P[o + 1] + f * (sy / n - P[o + 1]);
      tmp[o + 2] = P[o + 2] + f * (sz / n - P[o + 2]);
      moved.push(v);
    }
    for (const v of moved) {
      const o = v * 3;
      P[o] = tmp[o]; P[o + 1] = tmp[o + 1]; P[o + 2] = tmp[o + 2];
    }
  };
  for (let i = 0; i < iterations; i++) {
    pass(0.5);
    pass(-0.53);
  }
}

// Area-weighted vertex normals for the triangles in `tris` ([a, b, c] canonical ids) over positions P
export function shellNormals(P, tris, size) {
  const N = new Float32Array(size * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const [i, j, k] of tris) {
    a.fromArray(P, i * 3); b.fromArray(P, j * 3); c.fromArray(P, k * 3);
    ab.subVectors(b, a); ac.subVectors(c, a);
    ab.cross(ac);
    for (const v of [i, j, k]) {
      N[v * 3] += ab.x; N[v * 3 + 1] += ab.y; N[v * 3 + 2] += ab.z;
    }
  }
  for (let v = 0; v < size; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
    N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
  }
  return N;
}

// Per-vertex ambient occlusion: voxelize the surface, then march cosine-weighted hemisphere rays.
// Runs once per base mesh (~5.6k verts) in a few tens of milliseconds.
export function bakeVertexAO(pos, nor, idx, weld, { cell = 0.011, rays = 40, maxDist = 0.26, adj = null } = {}) {
  const box = new THREE.Box3().setFromBufferAttribute(pos).expandByScalar(cell * 3);
  const nx = Math.ceil((box.max.x - box.min.x) / cell);
  const ny = Math.ceil((box.max.y - box.min.y) / cell);
  const nz = Math.ceil((box.max.z - box.min.z) / cell);
  const grid = new Uint8Array(nx * ny * nz);
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - box.min.x) / cell);
    const j = Math.floor((y - box.min.y) / cell);
    const k = Math.floor((z - box.min.z) / cell);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return (k * ny + j) * nx + i;
  };

  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), p = new THREE.Vector3();
  const AB = new THREE.Vector3(), AC = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    A.fromBufferAttribute(pos, idx.getX(t));
    B.fromBufferAttribute(pos, idx.getX(t + 1));
    C.fromBufferAttribute(pos, idx.getX(t + 2));
    AB.subVectors(B, A);
    AC.subVectors(C, A);
    const steps = Math.max(1, Math.ceil(Math.max(A.distanceTo(B), B.distanceTo(C), A.distanceTo(C)) / (cell * 0.5)));
    for (let u = 0; u <= steps; u++) {
      for (let v = 0; v <= steps - u; v++) {
        p.copy(A).addScaledVector(AB, u / steps).addScaledVector(AC, v / steps);
        const ci = cellOf(p.x, p.y, p.z);
        if (ci >= 0) grid[ci] = 1;
      }
    }
  }

  // Cosine-weighted Fibonacci hemisphere (z = up)
  const dirs = [];
  for (let r = 0; r < rays; r++) {
    const u = (r + 0.5) / rays;
    const phi = r * 2.399963;
    const s = Math.sqrt(u);
    dirs.push(new THREE.Vector3(Math.cos(phi) * s, Math.sin(phi) * s, Math.sqrt(1 - u)));
  }

  const ao = new Float32Array(pos.count).fill(1);
  const done = new Map();
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3(), o = new THREE.Vector3();
  const stepLen = cell * 0.7;
  for (let i = 0; i < pos.count; i++) {
    const c = weld[i];
    if (done.has(c)) {
      ao[i] = done.get(c);
      continue;
    }
    n.fromBufferAttribute(nor, i).normalize();
    t1.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    o.fromBufferAttribute(pos, i).addScaledVector(n, cell * 2.2);
    let occ = 0;
    for (const dl of dirs) {
      d.set(0, 0, 0).addScaledVector(t1, dl.x).addScaledVector(t2, dl.y).addScaledVector(n, dl.z);
      // Skip the first couple of cells: grazing rays otherwise re-hit the vertex's own surface voxels
      for (let s = cell * 1.5; s < maxDist; s += stepLen) {
        const ci = cellOf(o.x + d.x * s, o.y + d.y * s, o.z + d.z * s);
        if (ci < 0) break;
        if (grid[ci]) {
          occ += 1 - (s / maxDist) * 0.6;
          break;
        }
      }
    }
    const v = 1 - occ / rays;
    done.set(c, v);
    ao[i] = v;
  }

  // Outlier-robust relax over the welded surface: a vertex can't be far darker than its ring
  if (adj) {
    let cur = new Map(done);
    for (let it = 0; it < 3; it++) {
      const next = new Map();
      for (const [c, v] of cur) {
        let sum = 0;
        let n = 0;
        for (const u of adj.get(c) || []) {
          const w = cur.get(u);
          if (w === undefined) continue;
          sum += w;
          n++;
        }
        const avg = n ? sum / n : v;
        next.set(c, Math.max(v, avg * 0.72) * 0.5 + avg * 0.5);
      }
      cur = next;
    }
    for (let i = 0; i < pos.count; i++) ao[i] = Math.max(0.3, cur.get(weld[i]));
  }
  return ao;
}
