import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Grid of rows (each row = one vertex per segment, wrapping) -> indexed geometry with position/color/aOcc
class Grid {
  constructor(segs) {
    this.segs = segs;
    this.pos = [];
    this.col = [];
    this.occ = [];
    this.idx = [];
  }

  vert(x, y, z, c, o = 0) {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.occ.push(o);
    return this.pos.length / 3 - 1;
  }

  // flip=false: faces point "outward" for rows ordered bottom->top on a wall, or rim->center on a cap
  strip(rowA, rowB, flip = false) {
    const n = this.segs;
    for (let i = 0; i < n; i++) {
      const a = rowA[i];
      const b = rowA[(i + 1) % n];
      const c = rowB[i];
      const d = rowB[(i + 1) % n];
      if (flip) this.idx.push(a, c, b, b, c, d);
      else this.idx.push(a, b, c, b, d, c);
    }
  }

  fan(row, center) {
    const n = this.segs;
    for (let i = 0; i < n; i++) this.idx.push(row[i], row[(i + 1) % n], center);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(this.occ, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// 1930s snap-brim fedora in hat space: crown base centred at the origin, +Z = front, +X = wearer's left.
// Teardrop centre-dent crown with front pinches, grosgrain band with side bow, brim that snaps down at the
// front and turns up at the back.
export function buildFedoraGeometry({ felt = '#382d23', band = '#16110e', ax = 0.116, az = 0.137 } = {}) {
  const segs = 56;
  const feltC = new THREE.Color(felt);
  const bandC = new THREE.Color(band);
  const tmpC = new THREE.Color();
  const shade = k => tmpC.copy(feltC).multiplyScalar(k).clone();

  const H0 = 0.118;
  const creaseDepth = 0.026;
  const crease = (x, z, azTop) => creaseDepth * Math.exp(-((x / 0.03) ** 2)) * (1 - smooth(0.62, 1.0, Math.abs(z) / azTop));
  const pinchAt = th => 0.015 * (Math.exp(-((angDiff(th, 0.74) / 0.36) ** 2)) + Math.exp(-((angDiff(th, -0.74) / 0.36) ** 2)));

  // --- Crown walls + dented top ---
  const crown = new Grid(segs);
  const wallRows = 10;
  const capRows = 6;
  const rows = [];
  const rim = [];
  for (let r = 0; r <= wallRows; r++) {
    const v = r / wallRows;
    const row = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const H = H0 - 0.007 * cz;
      const taper = 1 - 0.14 * Math.pow(v, 1.5);
      const pinch = pinchAt(th) * smooth(0.45, 1, v);
      const x = sx * (ax * taper - pinch);
      const z = cz * (az * taper - pinch);
      const cr = crease(x, z, az * 0.86) * smooth(0.55, 1, v);
      const y = v * H - cr;
      row.push(crown.vert(x, y, z, shade(0.93 + 0.09 * v), (cr / creaseDepth) * 0.35));
      if (r === wallRows) rim.push({ x, z, H });
    }
    rows.push(row);
  }
  for (let k = 1; k < capRows; k++) {
    const t = k / capRows;
    const row = [];
    for (let i = 0; i < segs; i++) {
      const p = rim[i];
      const x = p.x * (1 - t);
      const z = p.z * (1 - t);
      const cr = crease(x, z, az * 0.86);
      const y = p.H + 0.009 * (1 - (1 - t) * (1 - t)) - cr;
      row.push(crown.vert(x, y, z, shade(1.03), (cr / creaseDepth) * 0.4));
    }
    rows.push(row);
  }
  const center = crown.vert(0, H0 + 0.009 - creaseDepth, 0, shade(1.0), 0.4);
  for (let r = 0; r < rows.length - 1; r++) crown.strip(rows[r], rows[r + 1]);
  crown.fan(rows[rows.length - 1], center);

  // --- Grosgrain band (slightly proud of the wall) ---
  const bandG = new Grid(segs);
  const bandRows = [];
  for (const v of [0.05, 0.17, 0.29]) {
    const row = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const taper = 1 - 0.14 * Math.pow(v, 1.5);
      const pinch = pinchAt(th) * smooth(0.45, 1, v);
      const off = 0.0032;
      const x = Math.sin(th) * (ax * taper - pinch + off);
      const z = Math.cos(th) * (az * taper - pinch + off);
      row.push(bandG.vert(x, v * (H0 - 0.007 * Math.cos(th)), z, bandC, 0.1));
    }
    bandRows.push(row);
  }
  bandG.strip(bandRows[0], bandRows[1]);
  bandG.strip(bandRows[1], bandRows[2]);

  // --- Snap brim: top, underside and rolled edge ---
  const bx = ax + 0.064;
  const bz = az + 0.07;
  const brimY = (th, t) => {
    const cz = Math.cos(th);
    const sx = Math.sin(th);
    const pitch = cz > 0 ? -0.027 * cz * cz : 0.024 * cz * cz;
    return pitch * Math.pow(t, 1.5) + 0.01 * sx * sx * t * t;
  };
  const brim = new Grid(segs);
  const brimRings = 6;
  const top = [];
  const bottom = [];
  for (let r = 0; r <= brimRings; r++) {
    const t = r / brimRings;
    const rowT = [];
    const rowB = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const x = Math.sin(th) * (ax + (bx - ax) * t);
      const z = Math.cos(th) * (az + (bz - az) * t);
      const y = brimY(th, t);
      rowT.push(brim.vert(x, y + 0.0024, z, shade(0.97 - 0.05 * t), 0.15 * (1 - t)));
      rowB.push(brim.vert(x, y - 0.0024, z, shade(0.72), 0.45));
    }
    top.push(rowT);
    bottom.push(rowB);
  }
  for (let r = 0; r < brimRings; r++) {
    brim.strip(top[r], top[r + 1], true);
    brim.strip(bottom[r], bottom[r + 1]);
  }
  brim.strip(bottom[brimRings], top[brimRings]);

  // --- Side bow on the band (wearer's left) ---
  const bow = new THREE.BoxGeometry(0.008, 0.024, 0.034);
  bow.rotateZ(-0.06);
  bow.translate(ax * 0.985 + 0.007, 0.02, -0.012);
  bow.deleteAttribute('uv');
  const bowCol = new Float32Array(bow.attributes.position.count * 3);
  for (let i = 0; i < bow.attributes.position.count; i++) bowCol.set([bandC.r, bandC.g, bandC.b], i * 3);
  bow.setAttribute('color', new THREE.BufferAttribute(bowCol, 3));
  bow.setAttribute('aOcc', new THREE.BufferAttribute(new Float32Array(bow.attributes.position.count), 1));

  const parts = [crown.build(), bandG.build(), brim.build(), bow];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.userData.shared = true;
  return merged;
}
