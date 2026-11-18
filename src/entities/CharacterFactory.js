import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHAR_STYLES } from '../config/constants.js';
import { partSpec, buildColoredGeometry } from '../utils/GeometryBuilder.js';
import { WEAPON_TIPS } from './WeaponFactory.js';

const ARMS = [
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'
];

const POSE = {
  carry_pistol:        [[0.08, -0.96, 0.16], [0.44, -0.88, 0.03], null, null],
  carry_long:          [[0.16, -0.88, 0.22], [0.78, -0.32, -0.28], [0.48, -0.80, 0.16], [0.80, -0.22, 0.44]],
  hip_pistol:          [[0.70, -0.48, 0.15], [0.96, 0.09, -0.12], [0.54, -0.66, 0.22], [0.74, 0.12, 0.48]],
  pistol:              [[0.85, -0.3, 0.12], [0.97, 0.12, -0.14], [0.72, -0.45, 0.3], [0.8, 0.24, 0.52]],
  long:                [[0.22, -0.9, 0.25], [0.92, 0.2, -0.3], [0.74, -0.5, 0.22], [0.78, 0.12, 0.6]],
  strike:              [[0.8, 0.35, 0.1], [0.9, 0.05, -0.25], null, null],
  exec_grab:           [[0.52, -0.45, 0.28], [0.82, 0.22, -0.28], [0.82, -0.22, 0.12], [0.94, 0.08, 0.22]],
  exec_whip:           [[0.84, -0.12, -0.12], [0.84, 0.06, -0.44], [0.64, -0.42, 0.18], [0.78, 0.06, 0.40]],
  exec_aim_pistol:     [[0.92, -0.06, 0.08], [0.98, 0.08, -0.06], [0.38, -0.78, -0.08], [0.72, -0.18, 0.46]],
  exec_long_coil:      [[0.18, -0.88, 0.28], [0.86, 0.24, -0.34], [0.68, -0.54, 0.24], [0.76, 0.16, 0.62]],
  exec_long_bash:      [[0.46, -0.66, 0.20], [0.92, 0.16, -0.26], [0.86, -0.28, 0.18], [0.86, 0.12, 0.48]],
  exec_stealth_slash:  [[0.82, -0.16, -0.24], [0.74, 0.04, -0.58], [0.74, -0.22, 0.24], [0.82, 0.12, 0.48]],
  exec_victim_stagger: [[0.16, -0.92, 0.20], [0.52, -0.46, -0.18], [0.18, -0.92, -0.18], [0.48, -0.48, 0.18]]
};

const _q2 = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function pointBone(b, x, y, z) {
  const ch = b.children.find(c => c.isBone);
  if (!ch) return;
  b.updateWorldMatrix(true, true);
  const cur = ch.getWorldPosition(_v2).sub(b.getWorldPosition(_v1)).normalize();
  const dq = new THREE.Quaternion().setFromUnitVectors(cur, _v1.set(x, y, z).normalize());
  const wq = b.getWorldQuaternion(_wq);
  const pq = b.parent.getWorldQuaternion(_pq);
  b.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
  b.updateWorldMatrix(false, true);
}

// Compute smooth vertex normals averaged across coincident vertex positions
function computeSmoothNormals(pos, idx) {
  const accum = new Map();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();

  const keyOf = i =>
    `${Math.round(pos.getX(i) * 2000)}_${Math.round(pos.getY(i) * 2000)}_${Math.round(pos.getZ(i) * 2000)}`;

  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    const b = idx.getX(i + 1);
    const c = idx.getX(i + 2);
    vA.fromBufferAttribute(pos, a);
    vB.fromBufferAttribute(pos, b);
    vC.fromBufferAttribute(pos, c);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    fn.crossVectors(e1, e2);
    for (const vi of [a, b, c]) {
      const k = keyOf(vi);
      let acc = accum.get(k);
      if (!acc) {
        acc = new THREE.Vector3();
        accum.set(k, acc);
      }
      acc.add(fn);
    }
  }

  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const acc = accum.get(keyOf(i));
    if (acc && acc.lengthSq() > 1e-12) {
      fn.copy(acc).normalize();
      out[i * 3] = fn.x;
      out[i * 3 + 1] = fn.y;
      out[i * 3 + 2] = fn.z;
    } else {
      out[i * 3 + 1] = 1;
    }
  }
  return out;
}

export class CharacterFactory {
  constructor(gameRenderer, assets, weaponFactory) {
    this.gr = gameRenderer;
    this.assets = assets;
    this.wf = weaponFactory;
    this.skinCache = {};
    this.hatCache = {};
    this.officerHatGeo = null;
    this._maleMeta = null;
    this._hairGeo = null;
    this._outfitCache = {};
    this._sharedHairMat = new THREE.MeshStandardMaterial({
      color: 0x1a1513,
      roughness: 0.86,
      metalness: 0.04
    });
    this._sharedHairMat.userData.shared = true;
  }

  _getMaleMeta() {
    if (this._maleMeta) return this._maleMeta;
    let male = null;
    this.assets.glb.man.traverse(o => {
      if (o.isSkinnedMesh && !male) male = o;
    });
    const geo = male.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const jnt = geo.attributes.skinIndex;
    const wgt = geo.attributes.skinWeight;
    const idx = geo.index;
    const smoothNor = computeSmoothNormals(pos, idx);

    // Joint weights helper
    const weightOf = (vi, jointSet) => {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        if (jointSet.has(jnt.getComponent(vi, k))) sum += wgt.getComponent(vi, k);
      }
      return sum;
    };

    const headSet = new Set([39]);
    const armSet = new Set([14, 15, 16, 41, 42, 43]);
    const handSet = new Set();
    for (let j = 17; j <= 37; j++) handSet.add(j);
    for (let j = 44; j <= 64; j++) handSet.add(j);
    const torsoSet = new Set([0, 11, 12, 13]);
    const bodyLegSet = new Set([0, 1, 2, 6, 7, 11, 12, 13]);

    // Classify every vertex of Male
    const vertKind = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const hw = weightOf(i, headSet);
      const handW = weightOf(i, handSet);
      const armW = weightOf(i, armSet);
      const torsoW = weightOf(i, torsoSet);

      if (hw > 0.45) {
        const isScalp =
          (y > 0.752 && z < 0.098) ||
          (y > 0.928 && z < 0.185) ||
          (Math.abs(x) > 0.072 && y > 0.805 && z < 0.142);
        if (isScalp) vertKind[i] = 1; // hair / scalp
      } else if (handW > 0.45) {
        vertKind[i] = 3; // hands / gloves
      } else if (armW > 0.42 && handW <= 0.45) {
        const absX = Math.abs(x);
        if (absX > 0.39 && y < 0.16) vertKind[i] = 4; // wrist / cuff zone
        else vertKind[i] = 2; // sleeve
      } else if (torsoW > 0.4 && y > 0.44 && y < 0.72 && z > 0.13 && Math.abs(x) < 0.068) {
        vertKind[i] = 5; // front chest V-shirt / tie zone
      }
    }

    // Build 1024x1024 UV region mask Canvas from Male mesh triangles
    const w = this.assets.skinImg.width;
    const h = this.assets.skinImg.height;
    const mc = document.createElement('canvas');
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext('2d');
    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, w, h);

    const codeCols = ['', '#101010', '#202020', '#303030', '#404040', '#505050'];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      const ka = vertKind[a];
      const kb = vertKind[b];
      const kc = vertKind[c];
      const tag = ka || kb || kc;
      if (!tag) continue;
      // Pick dominant non-zero tag
      const finalTag = (ka === kb && ka) ? ka : (kb === kc && kb) ? kb : (ka === kc && ka) ? ka : tag;

      const u0 = uv.getX(a), v0 = uv.getY(a);
      const u1 = uv.getX(b), v1 = uv.getY(b);
      const u2 = uv.getX(c), v2 = uv.getY(c);
      if (
        Math.max(Math.abs(u0 - u1), Math.abs(u1 - u2), Math.abs(u0 - u2)) > 0.35 ||
        Math.max(Math.abs(v0 - v1), Math.abs(v1 - v2), Math.abs(v0 - v2)) > 0.35
      ) continue;

      mctx.beginPath();
      mctx.moveTo(u0 * w, v0 * h);
      mctx.lineTo(u1 * w, v1 * h);
      mctx.lineTo(u2 * w, v2 * h);
      mctx.closePath();
      mctx.fillStyle = codeCols[finalTag];
      mctx.strokeStyle = codeCols[finalTag];
      mctx.lineWidth = 2.5;
      mctx.fill();
      mctx.stroke();
    }

    const maskData = mctx.getImageData(0, 0, w, h).data;

    // Sample torso/hips/thighs radial envelope by height slice
    const sliceEnv = [];
    for (let y0 = -0.36; y0 <= 0.28; y0 += 0.04) {
      let minX = 9, maxX = -9, minZ = 9, maxZ = -9;
      for (let i = 0; i < pos.count; i++) {
        if (weightOf(i, bodyLegSet) < 0.5) continue;
        const y = pos.getY(i);
        if (Math.abs(y - y0) > 0.035) continue;
        const x = pos.getX(i);
        const z = pos.getZ(i);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      if (minX < maxX) {
        sliceEnv.push({
          y: y0,
          cx: (minX + maxX) * 0.5,
          cz: (minZ + maxZ) * 0.5,
          rx: (maxX - minX) * 0.5,
          rz: (maxZ - minZ) * 0.5
        });
      }
    }

    this._maleMeta = {
      geo, pos, nor, uv, jnt, wgt, idx, smoothNor,
      vertKind, maskData, sliceEnv, weightOf, armSet, handSet, torsoSet
    };
    return this._maleMeta;
  }

  _getSkinTex(kind) {
    if (this.skinCache[kind]) return this.skinCache[kind];
    const s = CHAR_STYLES[kind];

    if (s.model === 'soldier') {
      const im = this.assets.soldierImg;
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      if (kind === 'officer') {
        x.fillStyle = 'rgba(42,36,18,0.28)';
        x.fillRect(0, 0, c.width, c.height);
      }
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return (this.skinCache[kind] = t);
    }

    const meta = this._getMaleMeta();
    const im = this.assets.skinImg;
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    const mask = meta.maskData;

    const srgbCol = hex => new THREE.Color(hex).convertLinearToSRGB();
    const sh = srgbCol(s.shirt);
    const pa = srgbCol(s.pants);
    const sleeveCol = srgbCol(s.coat || s.shirt);
    const vestCol = srgbCol(s.vest || s.shirt);
    const tieCol = srgbCol(s.tie || '#7a1c18');
    const hairCol = srgbCol('#191412');
    const gloveCol = srgbCol('#1c1917');
    const cuffCol = srgbCol('#e2dcd0');
    const shirtWhite = srgbCol('#dfd9cd');

    const isTailored = !!(s.trench || s.longcoat || s.cloak);

    for (let i = 0; i < p.length; i += 4) {
      const r = p[i];
      const g = p[i + 1];
      const b = p[i + 2];
      const l = (r + g + b) / 3;
      const pxIdx = i >> 2;
      const px = pxIdx % c.width;
      const py = (pxIdx / c.width) | 0;
      const mVal = mask[i];
      const zig = ((px >> 2) & 1) ? ((px + py) & 3) : ((px - py + 1024) & 3);
      const twill = (zig - 1.5) * 0.032;
      const grain = 0.92 + (((px * 7 + py * 13) ^ (px >> 2)) & 15) / 135 + twill;

      // 1. Hair / Scalp coverage: eliminate pink bald patch completely
      if (mVal >= 12 && mVal <= 22) {
        const k = clamp(l / 155, 0.55, 1.15) * grain;
        p[i] = Math.min(255, hairCol.r * 255 * k);
        p[i + 1] = Math.min(255, hairCol.g * 255 * k);
        p[i + 2] = Math.min(255, hairCol.b * 255 * k);
        continue;
      }

      // 2. Full long sleeves (covers bare forearms in winter rain)
      if (mVal >= 26 && mVal <= 38) {
        const k = clamp(l / 145, 0.68, 1.15) * grain;
        p[i] = Math.min(255, sleeveCol.r * 255 * k);
        p[i + 1] = Math.min(255, sleeveCol.g * 255 * k);
        p[i + 2] = Math.min(255, sleeveCol.b * 255 * k);
        continue;
      }

      // 3. Leather gloves for trench/suit characters
      if (mVal >= 42 && mVal <= 54) {
        if (isTailored && kind !== 'hostage') {
          const k = clamp(l / 155, 0.6, 1.1) * grain;
          p[i] = Math.min(255, gloveCol.r * 255 * k);
          p[i + 1] = Math.min(255, gloveCol.g * 255 * k);
          p[i + 2] = Math.min(255, gloveCol.b * 255 * k);
        }
        continue;
      }

      // 4. White shirt cuffs at wrists
      if (mVal >= 58 && mVal <= 70) {
        const col = isTailored && kind !== 'hostage' ? cuffCol : sleeveCol;
        const k = clamp(l / 155, 0.72, 1.15) * grain;
        p[i] = Math.min(255, col.r * 255 * k);
        p[i + 1] = Math.min(255, col.g * 255 * k);
        p[i + 2] = Math.min(255, col.b * 255 * k);
        continue;
      }

      // 5. Front V-neck dress shirt + tie for trench/suit roles
      if (mVal >= 74 && mVal <= 88 && isTailored) {
        const u = px / c.width;
        const v = py / c.height;
        // Center seam of chest UV: add white shirt + dark/red tie stripe
        const isTie = Math.abs(Math.sin(u * Math.PI * 16) * 0.5) < 0.11 && v > 0.35;
        const col = kind === 'hostage' ? sh : isTie ? tieCol : shirtWhite;
        const k = clamp(l / 138, 0.75, 1.18);
        p[i] = Math.min(255, col.r * 255 * k);
        p[i + 1] = Math.min(255, col.g * 255 * k);
        p[i + 2] = Math.min(255, col.b * 255 * k);
        continue;
      }

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn > 20) continue;

      if (l > 88 && l < 200) {
        const target = isTailored ? vestCol : sh;
        const k = (l / 135) * grain;
        p[i] = Math.min(255, target.r * 255 * k);
        p[i + 1] = Math.min(255, target.g * 255 * k);
        p[i + 2] = Math.min(255, target.b * 255 * k);
      } else if (l < 34 && b >= r) {
        const k = (l / 22) * grain;
        p[i] = Math.min(255, pa.r * 255 * k);
        p[i + 1] = Math.min(255, pa.g * 255 * k);
        p[i + 2] = Math.min(255, pa.b * 255 * k);
      }
    }

    x.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return (this.skinCache[kind] = t);
  }

  _getHairSkinGeo() {
    if (this._hairGeo) return this._hairGeo;
    const meta = this._getMaleMeta();
    const { pos, smoothNor, idx, vertKind } = meta;

    const outPos = [];
    const outNor = [];
    const outJnt = [];
    const outWgt = [];

    const pushVert = vi => {
      const x = pos.getX(vi);
      const y = pos.getY(vi);
      const z = pos.getZ(vi);
      const nx = smoothNor[vi * 3];
      const ny = smoothNor[vi * 3 + 1];
      const nz = smoothNor[vi * 3 + 2];
      const napeFade = clamp((y - 0.755) / 0.08, 0.25, 1.0);
      const comb = 0.0014 * Math.sin(x * 115 + y * 30);
      const push = (0.009 + (y > 0.92 ? 0.005 : 0)) * napeFade + comb;
      outPos.push(x + nx * push, y + ny * push, z + nz * push);
      outNor.push(nx, ny, nz);
      outJnt.push(39, 0, 0, 0);
      outWgt.push(1, 0, 0, 0);
    };

    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if (vertKind[a] === 1 || vertKind[b] === 1 || vertKind[c] === 1) {
        if (pos.getY(a) > 0.74 && pos.getY(b) > 0.74 && pos.getY(c) > 0.74) {
          pushVert(a);
          pushVert(b);
          pushVert(c);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outJnt, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outWgt, 4));
    g.userData.shared = true;
    return (this._hairGeo = g);
  }

  _buildHatBaseGeo(s) {
    const G = this.gr.G;
    const hc = s.hatCol || '#2a221b';
    const parts = [];

    if (s.hat === 'fedora') {
      // Elliptical fedora crown & brim sized accurately to skull (rx=0.10, rz=0.12)
      const lathe = new THREE.LatheGeometry(
        [
          [0.001, 0.132], [0.072, 0.132], [0.098, 0.118], [0.108, 0.03],
          [0.116, 0.018], [0.194, 0.008], [0.208, 0.0], [0.194, -0.008], [0.001, -0.008]
        ].map(p => new THREE.Vector2(p[0], p[1])),
        24
      );
      parts.push(
        partSpec(lathe, hc, [0, 0, 0], [1.06, 1.0, 1.18]),
        partSpec(G.cyl, s.band || '#161210', [0, 0.032, 0], [0.114, 0.026, 0.128])
      );
      lathe.dispose();
    } else if (s.hat === 'cap') {
      parts.push(
        partSpec(G.sph, hc, [0, 0.028, -0.006], [0.116, 0.062, 0.134]),
        partSpec(G.sph, '#14151a', [0, -0.002, 0.118], [0.092, 0.015, 0.078], [0.15, 0, 0])
      );
    } else if (s.hat === 'band') {
      parts.push(
        partSpec(G.cyl, hc, [0, -0.02, 0], [0.111, 0.034, 0.128]),
        partSpec(G.box, hc, [0.02, -0.025, -0.134], [0.022, 0.024, 0.09], [0.35, -0.3, 0])
      );
    }
    return buildColoredGeometry(parts);
  }

  createStandaloneHatMesh(kind) {
    const s = CHAR_STYLES[kind];
    if (!s) return null;
    let geo = null;
    if (s.hat === 'officer') {
      geo = this._getOfficerHatGeo();
    } else if (s.hat) {
      geo = this._buildHatBaseGeo(s);
    } else if (s.helmet) {
      const G = this.gr.G;
      geo = buildColoredGeometry([
        partSpec(G.dome, '#565134', [0, -0.02, 0], [0.135, 0.125, 0.145]),
        partSpec(G.cyl, '#46422a', [0, -0.02, 0], [0.142, 0.016, 0.152])
      ]);
    }
    if (!geo) return null;
    const m = new THREE.Mesh(geo, this.gr.M.hat);
    m.castShadow = true;
    return m;
  }

  _getHatSkinGeo(kind) {
    if (this.hatCache[kind] !== undefined) return this.hatCache[kind];
    const s = CHAR_STYLES[kind];
    if (!s.hat || s.model === 'soldier') return (this.hatCache[kind] = null);

    const baseGeo = this._buildHatBaseGeo(s);
    // Transform into Male Head bind space: center (-0.001, 0.928, 0.068), pitched forward -0.08 rad
    const xf = new THREE.Matrix4().compose(
      new THREE.Vector3(-0.001, 0.926, 0.068),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    baseGeo.applyMatrix4(xf);

    const vCount = baseGeo.attributes.position.count;
    const skIdx = new Uint16Array(vCount * 4);
    const skWgt = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
      skIdx[i * 4] = 39;
      skWgt[i * 4] = 1;
    }
    baseGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skIdx, 4));
    baseGeo.setAttribute('skinWeight', new THREE.BufferAttribute(skWgt, 4));
    baseGeo.userData.shared = true;
    return (this.hatCache[kind] = baseGeo);
  }

  _getOfficerHatGeo() {
    if (this.officerHatGeo) return this.officerHatGeo;
    const G = this.gr.G;
    const hc = CHAR_STYLES.officer.hatCol;
    const parts = [
      partSpec(G.cyl, hc, [-0.012, 0.055, 0], [0.145, 0.072, 0.135], [0, 0, -0.09]),
      partSpec(G.cyl, '#1d1c18', [-0.005, 0.016, 0], [0.125, 0.036, 0.118]),
      partSpec(G.sph, '#111114', [0.112, -0.006, 0], [0.085, 0.014, 0.096], [0, 0, -0.2]),
      partSpec(G.box, '#d9a441', [0.125, 0.048, 0], [0.012, 0.025, 0.025])
    ];
    return (this.officerHatGeo = buildColoredGeometry(parts));
  }

  _getOutfitSkinGeo(kind) {
    if (this._outfitCache[kind] !== undefined) return this._outfitCache[kind];
    const s = CHAR_STYLES[kind];
    if (!(s.trench || s.longcoat || s.cloak)) {
      return (this._outfitCache[kind] = null);
    }

    const meta = this._getMaleMeta();
    const { pos, smoothNor, idx, jnt, wgt, sliceEnv, weightOf, armSet, handSet, torsoSet } = meta;

    const outPos = [];
    const outNor = [];
    const outCol = [];
    const outJnt = [];
    const outWgt = [];

    const coatCol = new THREE.Color(s.coat || s.shirt);
    const lapelCol = new THREE.Color(s.coat || s.shirt).multiplyScalar(1.16);
    const scarfCol = new THREE.Color(s.scarf || '#8f221d');
    const beltCol = new THREE.Color('#191412');
    const buckleCol = new THREE.Color('#d4a448');

    const pushSkinnedVert = (x, y, z, nx, ny, nz, col, j0, j1, j2, j3, w0, w1, w2, w3) => {
      outPos.push(x, y, z);
      outNor.push(nx, ny, nz);
      outCol.push(col.r, col.g, col.b);
      outJnt.push(j0, j1, j2, j3);
      outWgt.push(w0, w1, w2, w3);
    };

    // 1. Upper Coat + Full Sleeves extracted directly from Male mesh (zero clipping!)
    const isVOpening = i => {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      return y > 0.44 && z > 0.115 && Math.abs(x + 0.006) < (y - 0.42) * 0.34;
    };

    const headNeckSet = new Set([38, 39]);
    const isUpperCoatVert = i => {
      const y = pos.getY(i);
      const hw = weightOf(i, handSet);
      if (hw > 0.42) return false;
      if (weightOf(i, headNeckSet) > 0.45) return false;
      const aw = weightOf(i, armSet);
      const tw = weightOf(i, torsoSet);
      if (aw > 0.35 && y > -0.02) return true;
      if (tw > 0.4 && y >= 0.16 && y <= 0.722) return !isVOpening(i);
      return false;
    };

    const pushExtractedVert = i => {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = smoothNor[i * 3];
      const ny = smoothNor[i * 3 + 1];
      const nz = smoothNor[i * 3 + 2];
      const aw = weightOf(i, armSet);
      const isCuff = aw > 0.4 && Math.abs(x) > 0.37 && y < 0.16;
      const nearLapel = y > 0.44 && z > 0.11 && Math.abs(Math.abs(x + 0.006) - (y - 0.42) * 0.34) < 0.036;
      const offset = isCuff ? 0.015 : nearLapel ? 0.016 : 0.011;
      const backSeam = z < -0.04 && Math.abs(x) < 0.013 ? 0.88 : 1.0;
      const gatherFold = y < 0.32 ? 0.94 + 0.06 * Math.sin(x * 36 + z * 30) : 1.0;
      const shade = backSeam * gatherFold;
      const baseC = nearLapel ? lapelCol : coatCol;
      const col = { r: baseC.r * shade, g: baseC.g * shade, b: baseC.b * shade };

      pushSkinnedVert(
        x + nx * offset,
        y + ny * offset,
        z + nz * offset,
        nx,
        ny,
        nz,
        col,
        jnt.getX(i), jnt.getY(i), jnt.getZ(i), jnt.getW(i),
        wgt.getX(i), wgt.getY(i), wgt.getZ(i), wgt.getW(i)
      );
    };

    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if (isUpperCoatVert(a) && isUpperCoatVert(b) && isUpperCoatVert(c)) {
        pushExtractedVert(a);
        pushExtractedVert(b);
        pushExtractedVert(c);
      }
    }

    // 2. Fitted Skinned Scarf Collar for hero (tracks Spine2=13 / Neck=38 smoothly)
    if (s.scarf) {
      const nSeg = 22;
      const scRings = [
        { y: 0.665, rx: 0.088, rz: 0.095, cz: 0.068, wS: 0.75, wN: 0.25 },
        { y: 0.705, rx: 0.092, rz: 0.098, cz: 0.072, wS: 0.45, wN: 0.55 },
        { y: 0.735, rx: 0.082, rz: 0.088, cz: 0.074, wS: 0.25, wN: 0.75 }
      ];
      for (let r = 0; r < scRings.length - 1; r++) {
        const R0 = scRings[r];
        const R1 = scRings[r + 1];
        for (let k = 0; k < nSeg; k++) {
          const t0 = (k / nSeg) * Math.PI * 2;
          const t1 = ((k + 1) / nSeg) * Math.PI * 2;
          const pt = (R, th) => ({
            x: -0.002 + Math.sin(th) * R.rx,
            y: R.y,
            z: R.cz + Math.cos(th) * R.rz,
            nx: Math.sin(th),
            ny: 0.15,
            nz: Math.cos(th)
          });
          const p00 = pt(R0, t0), p10 = pt(R0, t1), p01 = pt(R1, t0), p11 = pt(R1, t1);
          const emit = (p, R) => pushSkinnedVert(p.x, p.y, p.z, p.nx, p.ny, p.nz, scarfCol, 13, 38, 0, 0, R.wS, R.wN, 0, 0);
          emit(p00, R0); emit(p10, R0); emit(p11, R1);
          emit(p00, R0); emit(p11, R1); emit(p01, R1);
        }
      }
    }

    // 3. Anatomical Multi-Bone Skinned Trench Skirt + Belt (100% immune to leg clipping!)
    const envAt = y => {
      if (y >= sliceEnv[sliceEnv.length - 1].y) return sliceEnv[sliceEnv.length - 1];
      if (y <= sliceEnv[0].y) return sliceEnv[0];
      for (let i = 0; i < sliceEnv.length - 1; i++) {
        const a = sliceEnv[i];
        const b = sliceEnv[i + 1];
        if (y >= a.y && y <= b.y) {
          const f = (y - a.y) / (b.y - a.y);
          return {
            y,
            cx: a.cx + (b.cx - a.cx) * f,
            cz: a.cz + (b.cz - a.cz) * f,
            rx: a.rx + (b.rx - a.rx) * f,
            rz: a.rz + (b.rz - a.rz) * f
          };
        }
      }
      return sliceEnv[0];
    };

    const yTop = 0.255;
    const yBot = -0.34;
    const rows = 14;
    const cols = 32;
    // Open front slit around +Z (theta = 0 in sin/cos polar coords around cz!)
    const slitHalf = s.trench ? 0.28 : 0.22;
    const thetaStart = slitHalf;
    const thetaEnd = Math.PI * 2 - slitHalf;

    const skirtGrid = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = yTop + (yBot - yTop) * t;
      const env = envAt(y);
      // Waist hugs tightly (+0.016m); flares gracefully toward knee (+0.048m)
      const padX = 0.018 + t * 0.038;
      const padZ = 0.018 + t * 0.052;
      const rx = env.rx + padX;
      const rz = env.rz + padZ;
      const rowVerts = [];

      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const th = thetaStart + (thetaEnd - thetaStart) * u;
        const pleatWave = Math.sin(th * 7);
        const pleat = 1 + 0.035 * pleatWave * t;
        const vx = env.cx + Math.sin(th) * rx * pleat;
        const vz = env.cz + Math.cos(th) * rz * pleat;
        const nx = Math.sin(th);
        const nz = Math.cos(th);
        const lenN = Math.hypot(nx, nz) || 1;
        const backVent = Math.cos(th) < -0.92 && Math.abs(Math.sin(th)) < 0.12 ? 0.85 : 1.0;
        const foldAO = (0.93 + 0.07 * pleatWave * (0.3 + 0.7 * t)) * backVent;

        // Weight smoothly transitions from 100% Hips(0) at waist to 90% UpLegs(1/6) at hem
        const legTotal = Math.pow(t, 0.78) * 0.90;
        const hipsW = 1 - legTotal;
        const leftFrac = clamp(0.5 + (vx - env.cx) / 0.14, 0, 1);
        const lW = legTotal * leftFrac;
        const rW = legTotal * (1 - leftFrac);

        rowVerts.push({
          x: vx,
          y,
          z: vz,
          nx: nx / lenN,
          ny: 0.08,
          nz: nz / lenN,
          hipsW,
          lW,
          rW,
          foldAO
        });
      }
      skirtGrid.push(rowVerts);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = skirtGrid[r][c];
        const b = skirtGrid[r][c + 1];
        const d = skirtGrid[r + 1][c];
        const e = skirtGrid[r + 1][c + 1];
        const emit = v =>
          pushSkinnedVert(
            v.x, v.y, v.z, v.nx, v.ny, v.nz,
            { r: coatCol.r * v.foldAO, g: coatCol.g * v.foldAO, b: coatCol.b * v.foldAO },
            0, 1, 6, 0, v.hipsW, v.lW, v.rW, 0
          );
        emit(a); emit(d); emit(e);
        emit(a); emit(e); emit(b);
      }
    }

    // 4. Fitted Skinned Waist Belt + Brass Buckle (for trench)
    if (s.trench) {
      const bEnv = envAt(0.245);
      const bY0 = 0.22;
      const bY1 = 0.268;
      const bRx = bEnv.rx + 0.025;
      const bRz = bEnv.rz + 0.025;
      const bSegs = 28;
      for (let c = 0; c < bSegs; c++) {
        const t0 = (c / bSegs) * Math.PI * 2;
        const t1 = ((c + 1) / bSegs) * Math.PI * 2;
        const isBuckle = Math.abs(Math.sin((t0 + t1) * 0.5)) < 0.16 && Math.cos((t0 + t1) * 0.5) > 0.85;
        const col = isBuckle ? buckleCol : beltCol;
        const x0 = bEnv.cx + Math.sin(t0) * bRx, z0 = bEnv.cz + Math.cos(t0) * bRz;
        const x1 = bEnv.cx + Math.sin(t1) * bRx, z1 = bEnv.cz + Math.cos(t1) * bRz;
        const nx0 = Math.sin(t0), nz0 = Math.cos(t0);
        const nx1 = Math.sin(t1), nz1 = Math.cos(t1);
        pushSkinnedVert(x0, bY0, z0, nx0, 0, nz0, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);
        pushSkinnedVert(x1, bY0, z1, nx1, 0, nz1, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);
        pushSkinnedVert(x1, bY1, z1, nx1, 0, nz1, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);

        pushSkinnedVert(x0, bY0, z0, nx0, 0, nz0, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);
        pushSkinnedVert(x1, bY1, z1, nx1, 0, nz1, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);
        pushSkinnedVert(x0, bY1, z0, nx0, 0, nz0, col, 0, 11, 0, 0, 0.85, 0.15, 0, 0);
      }
    }

    // 5. Boss sweeping skinned shoulder cloak with gold hem
    if (s.cloak) {
      const cRows = 10;
      const cCols = 18;
      const cTop = 0.67;
      const cBot = -0.18;
      const goldTrim = new THREE.Color('#d9a441');
      const cloakCol = new THREE.Color('#191022');
      const cg = [];
      for (let r = 0; r <= cRows; r++) {
        const t = r / cRows;
        const y = cTop + (cBot - cTop) * t;
        const rx = 0.19 + t * 0.15;
        const cz = 0.05 - t * 0.04;
        const rz = 0.11 + t * 0.06;
        const row = [];
        for (let c = 0; c <= cCols; c++) {
          const th = Math.PI * 0.62 + (Math.PI * 0.76) * (c / cCols);
          const x = Math.sin(th) * rx;
          const z = cz + Math.cos(th) * rz;
          const w2 = Math.max(0.15, 1 - t * 0.8);
          const w1 = (1 - w2) * 0.5;
          const w0 = (1 - w2) * 0.5;
          row.push({ x, y, z, nx: Math.sin(th), ny: 0.1, nz: Math.cos(th), w2, w1, w0, isTrim: t > 0.9 });
        }
        cg.push(row);
      }
      for (let r = 0; r < cRows; r++) {
        for (let c = 0; c < cCols; c++) {
          const a = cg[r][c], b = cg[r][c + 1], d = cg[r + 1][c], e = cg[r + 1][c + 1];
          const emit = v => pushSkinnedVert(v.x, v.y, v.z, v.nx, v.ny, v.nz, v.isTrim ? goldTrim : cloakCol, 13, 12, 0, 0, v.w2, v.w1, v.w0, 0);
          emit(a); emit(d); emit(e);
          emit(a); emit(e); emit(b);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outJnt, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outWgt, 4));
    g.userData.shared = true;
    return (this._outfitCache[kind] = g);
  }

  _buildSoldierAttachments(kind, g, bones) {
    const s = CHAR_STYLES[kind];
    const G = this.gr.G;
    const mat = this.gr.M.hat;
    g.updateMatrixWorld(true);

    const spPos = bones.Spine2 ? bones.Spine2.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.32, 0);
    const hpPos = bones.Hips ? bones.Hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0.96, 0);

    if (s.sash && bones.Spine2) {
      const chestParts = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4 - 0.5;
        chestParts.push(partSpec(G.box, '#482814', [spPos.x + 0.08 - Math.abs(t) * 0.03, spPos.y - 0.04 + t * 0.34, spPos.z + t * 0.26], [0.024, 0.06, 0.05], [0.65, 0, 0]));
      }
      const mesh = new THREE.Mesh(buildColoredGeometry(chestParts), mat);
      mesh.castShadow = true;
      g.add(mesh);
      g.updateMatrixWorld(true);
      bones.Spine2.attach(mesh);
    }

    if (s.pouches && bones.Hips) {
      const hipParts = [
        partSpec(G.box, '#3e3926', [hpPos.x + 0.13, hpPos.y + 0.02, hpPos.z - 0.14], [0.07, 0.11, 0.08]),
        partSpec(G.box, '#3e3926', [hpPos.x + 0.13, hpPos.y + 0.02, hpPos.z + 0.14], [0.07, 0.11, 0.08])
      ];
      const mesh = new THREE.Mesh(buildColoredGeometry(hipParts), mat);
      mesh.castShadow = true;
      g.add(mesh);
      g.updateMatrixWorld(true);
      bones.Hips.attach(mesh);
    }
  }

  _buildManPropAccessories(kind, g, bones) {
    const s = CHAR_STYLES[kind];
    const G = this.gr.G;
    const mat = this.gr.M.hat;
    g.updateMatrixWorld(true);

    const spPos = bones.Spine2 ? bones.Spine2.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.32, 0);
    const hpPos = bones.Hips ? bones.Hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0.96, 0);
    const hdPos = bones.Head ? bones.Head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.56, 0);

    if (s.bandolier && bones.Spine2) {
      const chestParts = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5 - 0.5;
        chestParts.push(partSpec(G.box, '#3a2214', [spPos.x + 0.08 - Math.abs(t) * 0.04, spPos.y - 0.04 + t * 0.36, spPos.z + t * 0.28], [0.03, 0.065, 0.05], [0.6, 0, 0]));
        chestParts.push(partSpec(G.cylLo, '#d4a448', [spPos.x + 0.095 - Math.abs(t) * 0.04, spPos.y - 0.04 + t * 0.36, spPos.z + t * 0.28], [0.011, 0.052, 0.011], [0.6, 0, 0]));
      }
      const mesh = new THREE.Mesh(buildColoredGeometry(chestParts), mat);
      mesh.castShadow = true;
      g.add(mesh);
      g.updateMatrixWorld(true);
      bones.Spine2.attach(mesh);
    }

    if (s.belt && bones.Hips) {
      const sashGeo = new THREE.CylinderGeometry(0.16, 0.168, 0.1, 18, 1, true);
      const mesh = new THREE.Mesh(buildColoredGeometry([partSpec(sashGeo, s.belt, [hpPos.x, hpPos.y + 0.02, hpPos.z], [0.92, 1, 1.08])]), mat);
      sashGeo.dispose();
      mesh.castShadow = true;
      g.add(mesh);
      g.updateMatrixWorld(true);
      bones.Hips.attach(mesh);
    }

    if (s.glasses && bones.Head) {
      const glParts = [
        partSpec(G.torus, '#c8c4b8', [hdPos.x + 0.11, hdPos.y + 0.05, hdPos.z - 0.04], [0.24, 0.24, 0.24], [0, Math.PI / 2, 0]),
        partSpec(G.torus, '#c8c4b8', [hdPos.x + 0.11, hdPos.y + 0.05, hdPos.z + 0.04], [0.24, 0.24, 0.24], [0, Math.PI / 2, 0])
      ];
      const gm = new THREE.Mesh(buildColoredGeometry(glParts), mat);
      g.add(gm);
      g.updateMatrixWorld(true);
      bones.Head.attach(gm);
    }

    if (s.cigar && bones.Head) {
      const cGrp = new THREE.Group();
      const stick = new THREE.Mesh(G.cylLo, this.gr.M.walnut);
      stick.scale.set(0.011, 0.09, 0.011);
      stick.rotation.z = Math.PI / 2 - 0.15;
      stick.position.set(hdPos.x + 0.14, hdPos.y - 0.02, hdPos.z + 0.025);
      cGrp.add(stick);

      const ember = new THREE.Mesh(
        G.sphLo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5220).multiplyScalar(2.4), toneMapped: false })
      );
      ember.scale.setScalar(0.014);
      ember.position.set(hdPos.x + 0.185, hdPos.y - 0.025, hdPos.z + 0.025);
      cGrp.add(ember);

      g.add(cGrp);
      g.updateMatrixWorld(true);
      bones.Head.attach(cGrp);
    }
  }

  createPerson(kind, gunKey) {
    const s = CHAR_STYLES[kind];
    const isSoldier = s.model === 'soldier';
    const baseModel = isSoldier ? this.assets.glb.soldier : this.assets.glb.man;
    const metrics = isSoldier ? this.assets.soldierMetrics : this.assets.manMetrics;
    const clips = isSoldier ? this.assets.soldierClips : this.assets.manClips;

    const g = new THREE.Group();
    const inner = SkeletonUtils.clone(baseModel);

    const mat = new THREE.MeshStandardMaterial({
      map: this._getSkinTex(kind),
      ...(isSoldier ? {} : { normalMap: this.assets.manNor, normalScale: new THREE.Vector2(0.75, 0.75) }),
      roughness: isSoldier ? 0.88 : 0.93,
      metalness: 0.0,
      envMapIntensity: 0.22
    });
    mat.userData.own = true;
    const isHero = kind === 'hero';

    const pivot = new THREE.Group();
    pivot.position.y = 0.9;
    g.add(pivot);

    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(metrics.scale);
    inner.position.set(metrics.offX, metrics.footY - 0.9, metrics.offZ);
    pivot.add(inner);

    const bones = {};
    let bodySkinnedMesh = null;
    let hatMesh = null;
    let coatMat = null;
    inner.traverse(o => {
      if (o.isBone && !bones[o.name]) bones[o.name] = o;
      if (o.isMesh) {
        if (isSoldier && o.name === 'Helmet') {
          o.visible = !!s.helmet;
          if (o.visible) hatMesh = o;
        }
        if (o.isSkinnedMesh && (!bodySkinnedMesh || o.name === 'Male')) bodySkinnedMesh = o;
        o.material = mat;
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });

    // Bind true SkinnedMesh hair, hat, and multi-bone matte wool trench coat directly to Male's skeleton
    if (!isSoldier && bodySkinnedMesh) {
      const parentArmature = bodySkinnedMesh.parent;
      const bindMat = bodySkinnedMesh.bindMatrix;
      const skel = bodySkinnedMesh.skeleton;

      const hairMesh = new THREE.SkinnedMesh(this._getHairSkinGeo(), this._sharedHairMat);
      hairMesh.castShadow = true;
      hairMesh.frustumCulled = false;
      parentArmature.add(hairMesh);
      hairMesh.bind(skel, bindMat);

      const hatGeo = this._getHatSkinGeo(kind);
      if (hatGeo) {
        hatMesh = new THREE.SkinnedMesh(hatGeo, this.gr.M.hat);
        hatMesh.castShadow = true;
        hatMesh.frustumCulled = false;
        parentArmature.add(hatMesh);
        hatMesh.bind(skel, bindMat);
      }

      const outfitGeo = this._getOutfitSkinGeo(kind);
      if (outfitGeo) {
        // Authentic 1930s matte woven wool / heavy gabardine cloth (zero clearcoat plastic shine!)
        coatMat = new THREE.MeshPhysicalMaterial({
          vertexColors: true,
          roughness: 0.94,
          metalness: 0.0,
          ior: 1.43,
          reflectivity: 0.08,
          envMapIntensity: 0.22,
          clearcoat: 0.0,
          sheen: 0.36,
          sheenRoughness: 0.92,
          sheenColor: new THREE.Color(0x4c4740),
          side: THREE.DoubleSide
        });
        coatMat.userData.own = true;
        const swayUniform = { value: new THREE.Vector3() };
        coatMat.userData.sway = swayUniform;
        coatMat.onBeforeCompile = shader => {
          shader.uniforms.uTime = this.gr.timeUniform;
          shader.uniforms.uCoatSway = swayUniform;
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
              uniform float uTime;
              uniform vec3 uCoatSway;
              varying vec3 vClothBindPos;`
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              vClothBindPos = position;
              if (transformed.y < 0.24) {
                float skirtK = clamp((0.24 - transformed.y) / 0.58, 0.0, 1.0);
                skirtK = skirtK * skirtK;
                float windW = sin(uTime * 5.2 + transformed.x * 11.0 + transformed.z * 7.0) * 0.02 * skirtK;
                transformed.x += uCoatSway.x * skirtK + windW;
                transformed.z += uCoatSway.z * skirtK - abs(uCoatSway.z) * 0.14 * skirtK;
                transformed.y += uCoatSway.y * skirtK;
                vec2 radD = length(transformed.xz) > 0.001 ? normalize(transformed.xz) : vec2(0.0, -1.0);
                transformed.xz += radD * (length(uCoatSway.xz) * 0.32 + 0.014) * skirtK;
              }`
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
              varying vec3 vClothBindPos;
              float clothHash(vec2 p) {
                p = fract(p * vec2(127.1, 311.7));
                p += dot(p, p + 34.23);
                return fract(p.x * p.y);
              }
              float clothWeavePattern(vec3 bp) {
                float uWrap = atan(bp.x, bp.z) * 0.28 + (bp.x + bp.z) * 0.65;
                float vWrap = bp.y;
                float colStripe = floor(uWrap * 68.0);
                float dir = mod(colStripe, 2.0) < 0.5 ? 1.0 : -1.0;
                float twill = sin((uWrap * 185.0 + vWrap * 185.0 * dir) * 6.28318);
                float crossWarp = sin((vWrap * 210.0 - uWrap * 42.0) * 6.28318);
                float nap = clothHash(floor(vec2(uWrap, vWrap) * 320.0)) - 0.5;
                return 0.5 + 0.24 * twill + 0.14 * crossWarp + 0.18 * nap;
              }`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
              float cWeave = clothWeavePattern(vClothBindPos);
              diffuseColor.rgb *= (0.86 + 0.26 * cWeave);`
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
              roughnessFactor = clamp(0.91 + 0.07 * (1.0 - cWeave), 0.89, 0.99);`
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
              float wNx = sin(vClothBindPos.x * 920.0 + vClothBindPos.y * 920.0) * 0.055;
              float wNz = cos(vClothBindPos.z * 920.0 - vClothBindPos.y * 920.0) * 0.055;
              normal = normalize(normal + vec3(wNx, (wNx - wNz) * 0.45, wNz));`
            );
        };
        coatMat.customProgramCacheKey = () => (isHero ? 'noir-matte-wool-coat-hero' : 'noir-matte-wool-coat-foe');
        const outfitMesh = new THREE.SkinnedMesh(outfitGeo, coatMat);
        outfitMesh.castShadow = true;
        outfitMesh.frustumCulled = false;
        parentArmature.add(outfitMesh);
        outfitMesh.bind(skel, bindMat);
      }
    }

    const mixer = new THREE.AnimationMixer(inner);
    const acts = {};
    const w = { RelaxIdle: 1, Idle: 0, Walk: 0, Run: 0 };
    for (const n in w) {
      if (!clips[n]) continue;
      acts[n] = mixer.clipAction(clips[n]);
      acts[n].play();
      acts[n].setEffectiveWeight(w[n]);
    }
    mixer.update(0);
    g.updateMatrixWorld(true);

    if (isSoldier) {
      if (s.hat === 'officer' && bones.HeadTop_End && bones.Head) {
        const hm = new THREE.Mesh(this._getOfficerHatGeo(), this.gr.M.hat);
        const top = bones.HeadTop_End.getWorldPosition(new THREE.Vector3());
        hm.position.set(top.x + 0.005, top.y - 0.036, top.z);
        hm.castShadow = true;
        g.add(hm);
        g.updateMatrixWorld(true);
        bones.Head.attach(hm);
        hatMesh = hm;
      }
      this._buildSoldierAttachments(kind, g, bones);
    } else {
      this._buildManPropAccessories(kind, g, bones);
    }

    // Precompute relaxed carry poses, combat ready poses, ADS poses & weapon grip transforms
    const rest = {};
    ARMS.forEach(n => { if (bones[n]) rest[n] = bones[n].quaternion.clone(); });
    const poses = {};
    const xf = {};
    const tmp = new THREE.Object3D();

    for (const cls of [
      'knife', 'carry_pistol', 'carry_long', 'hip_pistol', 'pistol', 'long', 'strike',
      'exec_grab', 'exec_whip', 'exec_aim_pistol', 'exec_long_coil', 'exec_long_bash',
      'exec_stealth_slash', 'exec_victim_stagger'
    ]) {
      ARMS.forEach(n => { if (bones[n]) bones[n].quaternion.copy(rest[n]); });
      const P4 = POSE[cls];
      if (P4) {
        pointBone(bones.RightArm, ...P4[0]);
        pointBone(bones.RightForeArm, ...P4[1]);
        if (P4[2]) {
          pointBone(bones.LeftArm, ...P4[2]);
          pointBone(bones.LeftForeArm, ...P4[3]);
        }
      }
      poses[cls] = {};
      const boneSubset =
        cls === 'carry_pistol' || cls === 'strike'
          ? ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand']
          : ARMS;
      boneSubset.forEach(n => {
        if (bones[n]) poses[cls][n] = bones[n].quaternion.clone();
      });

      if (cls === 'knife' || cls === 'pistol' || cls === 'long') {
        g.updateMatrixWorld(true);
        const h = bones.RightHand.getWorldPosition(new THREE.Vector3());
        const fd = h.clone().sub(bones.RightForeArm.getWorldPosition(new THREE.Vector3())).normalize();
        tmp.position.copy(h).addScaledVector(fd, 0.09);
        tmp.position.y += cls === 'knife' ? 0 : 0.03;
        tmp.quaternion.identity();
        tmp.scale.setScalar(1);
        if (cls === 'knife') tmp.rotation.y = -Math.PI / 2;
        g.add(tmp);
        g.updateMatrixWorld(true);
        bones.RightHand.attach(tmp);
        xf[cls] = {
          p: tmp.position.clone(),
          q: tmp.quaternion.clone(),
          s: tmp.scale.clone()
        };
        bones.RightHand.remove(tmp);
      }
    }
    ARMS.forEach(n => { if (bones[n]) bones[n].quaternion.copy(rest[n]); });

    const gun = this.wf.createWeaponMesh(gunKey || s.gun);
    bones.RightHand.add(gun);

    const glint = new THREE.Mesh(this.gr.G.sphLo, this.gr.M.glint);
    glint.scale.setScalar(0.065);
    glint.visible = false;
    gun.add(glint);

    mixer.update(Math.random() * 2);

    g.userData = {
      pivot,
      dk: 0,
      bones,
      mat,
      coatMat,
      hatMesh,
      rest,
      gun,
      glint,
      mixer,
      acts,
      w,
      poses,
      xf,
      pose: null,
      carryPose: null,
      hipPose: null,
      aimPose: null,
      melee: false,
      dead: false,
      readySmoothed: 0,
      rate: 1,
      strike: 0
    };

    this.setGun(g, gunKey || s.gun);
    if (s.scale) g.scale.setScalar(s.scale);
    return g;
  }

  setGun(g, k) {
    const u = g.userData;
    const cls = k === 'knife' ? 'knife' : (k === 'pistol' || k === 'browning' || k === 'revolver') ? 'pistol' : 'long';
    const x = u.xf[cls];
    u.gun.geometry = this.wf.getGeometry(k);
    u.melee = k === 'knife';
    u.pose = u.melee ? null : u.poses[cls];
    u.carryPose = u.melee ? null : cls === 'pistol' ? u.poses.carry_pistol : u.poses.carry_long;
    u.hipPose = u.melee ? null : cls === 'pistol' ? u.poses.hip_pistol : u.poses.long;
    u.aimPose = u.melee ? null : u.poses[cls];
    u.gun.position.copy(x.p);
    u.gun.quaternion.copy(x.q);
    u.gun.scale.copy(x.s);
    u.glint.position.set((WEAPON_TIPS[k] || 0.34) + 0.03, 0.045, 0);
  }

  poseMesh(m, x, z, ang, mode, dt, aimPitch = 0, flinch = 0, gunReady = 1, ads = 0) {
    const u = m.userData;
    m.position.x = x;
    m.position.z = z;
    m.rotation.y = -ang;

    if (u.coatMat?.userData?.sway) {
      if (u.prevX === undefined) {
        u.prevX = x;
        u.prevZ = z;
      }
      const idt = Math.max(dt, 0.004);
      const vx = (x - u.prevX) / idt;
      const vz = (z - u.prevZ) / idt;
      u.prevX = x;
      u.prevZ = z;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const fwdVel = vx * ca + vz * sa;
      const sideVel = -vx * sa + vz * ca;
      const spd = Math.hypot(fwdVel, sideVel);
      const sway = u.coatMat.userData.sway.value;
      const k = Math.min(1, dt * 10);
      sway.x += (clamp(sideVel * 0.024, -0.14, 0.14) - sway.x) * k;
      sway.y += (Math.min(0.14, spd * 0.015) - sway.y) * k;
      sway.z += (-clamp(fwdVel * 0.026, -0.12, 0.22) - sway.z) * k;
    }

    const rK = clamp(gunReady, 0, 1);
    const blendRate = Math.min(1, dt * (u.execPose ? 16.0 : 9.5));
    for (const n in u.acts) {
      let targetW = 0;
      if (mode === 'RelaxIdle') {
        if (n === 'RelaxIdle') targetW = 1 - 0.26 * rK;
        else if (n === 'Idle') targetW = 0.26 * rK;
      } else if (n === mode) {
        targetW = 1;
      }
      u.w[n] = (u.w[n] ?? 0) + (targetW - (u.w[n] ?? 0)) * blendRate;
      u.acts[n].setEffectiveWeight(u.w[n]);
    }
    u.mixer.update(dt * u.rate);

    if (!u.dead && u.execPose) {
      const pa = u.poses[u.execPose.a];
      const pb = u.poses[u.execPose.b || u.execPose.a];
      const pt = clamp(u.execPose.t ?? 0, 0, 1);
      const pw = clamp(u.execPose.w ?? 1, 0, 1);
      if (pa && pb) {
        for (const n of ARMS) {
          const b = u.bones[n];
          if (b && pa[n] && pb[n]) {
            _q2.copy(pa[n]).slerp(pb[n], pt);
            b.quaternion.slerp(_q2, pw);
          }
        }
      }
    } else if (!u.dead && !u.melee && u.aimPose) {
      const locoBlend = mode === 'Walk' ? 0.74 : mode === 'Run' ? 0.62 : 0.90;
      const adsK = clamp(ads, 0, 1);
      for (const n of ARMS) {
        const b = u.bones[n];
        if (!b) continue;
        // 1. Relaxed low-carry pose (preserving natural walk/run arm swing!)
        if (u.carryPose && u.carryPose[n]) {
          b.quaternion.slerp(u.carryPose[n], locoBlend);
        }
        // 2. Smoothly raise into Gun-Ready / ADS pose when aiming, firing, or in combat stance
        if (rK > 0.005) {
          _q2.copy(u.hipPose[n] || u.aimPose[n]).slerp(u.aimPose[n], adsK);
          b.quaternion.slerp(_q2, rK);
        }
      }
    } else if (u.strike > 0) {
      const st = u.poses.strike;
      u.bones.RightArm.quaternion.slerp(st.RightArm, u.strike);
      u.bones.RightForeArm.quaternion.slerp(st.RightForeArm, u.strike);
    }

    const pitchScale = 0.18 + 0.82 * rK;
    const pitchTilt = aimPitch * pitchScale + flinch * 0.35;
    const yawTwist = u.execTwist || 0;
    if ((Math.abs(pitchTilt) > 0.005 || Math.abs(yawTwist) > 0.005) && u.bones.Spine2) {
      m.updateMatrixWorld(true);
      if (Math.abs(yawTwist) > 0.005) {
        this._rotateBoneWorldAxis(u.bones.Spine2, _yUp, yawTwist * 0.6);
        if (u.bones.Head) this._rotateBoneWorldAxis(u.bones.Head, _yUp, yawTwist * 0.45);
      }
      if (Math.abs(pitchTilt) > 0.005) {
        const localPitchAxis = _v1.set(0, 0, 1).applyQuaternion(m.quaternion);
        this._rotateBoneWorldAxis(u.bones.Spine2, localPitchAxis, pitchTilt * 0.65);
        if (u.bones.Head) {
          this._rotateBoneWorldAxis(u.bones.Head, localPitchAxis, pitchTilt * 0.35);
        }
      }
    }
  }

  poseCorpse(m, dirSign = 1) {
    const u = m.userData;
    u.dead = true;
    u.rate = 0;
    u.pose = null;
    u.aimPose = null;
    u.carryPose = null;
    u.execPose = null;
    u.execTwist = 0;
    u.strike = 0;
    u.glint.visible = false;
    u.gun.visible = false;
    u.mat.emissive.setHex(0);
    if (u.coatMat) u.coatMat.emissive.setHex(0);
    m.scale.y = m.scale.x;

    // Snapshot full live skeletal pose (including Hips, Spine & Shoulders!) so death transition has ZERO 1-frame snaps
    const boneNames = [
      'Hips',
      'Spine',
      'Spine1',
      'Spine2',
      'Neck',
      'Head',
      'RightShoulder',
      'RightArm',
      'RightForeArm',
      'RightHand',
      'LeftShoulder',
      'LeftArm',
      'LeftForeArm',
      'LeftHand',
      'LeftUpLeg',
      'LeftLeg',
      'LeftFoot',
      'RightUpLeg',
      'RightLeg',
      'RightFoot'
    ];
    const fromQ = {};
    for (const n of boneNames) {
      if (u.bones[n]) fromQ[n] = u.bones[n].quaternion.clone();
    }

    const baseClip = u.acts.RelaxIdle ? 'RelaxIdle' : 'Idle';
    for (const n in u.acts) {
      const w = n === baseClip ? 1 : 0;
      u.w[n] = w;
      u.acts[n].setEffectiveWeight(w);
    }
    u.mixer.update(0);

    if (u.rest) {
      for (const n of ARMS) {
        if (u.bones[n] && u.rest[n]) u.bones[n].quaternion.copy(u.rest[n]);
      }
    }

    const tiltBone = (bone, rx, ry, rz) => {
      if (!bone) return;
      _q.setFromEuler(new THREE.Euler(rx, ry, rz));
      bone.quaternion.multiply(_q);
    };

    const arch = (Math.random() * 4) | 0;
    if (arch === 0) {
      tiltBone(u.bones.RightArm, 0.16, 0.08, -0.28);
      tiltBone(u.bones.RightForeArm, 0, -0.22, -0.10);
      tiltBone(u.bones.LeftArm, -0.14, -0.08, 0.28);
      tiltBone(u.bones.LeftForeArm, 0, 0.22, 0.10);
      tiltBone(u.bones.LeftUpLeg, -0.20, 0.06, 0.10);
      tiltBone(u.bones.LeftLeg, 0.26, 0, 0);
      tiltBone(u.bones.RightUpLeg, -0.08, -0.05, -0.08);
    } else if (arch === 1) {
      tiltBone(u.bones.RightArm, -0.24, 0.10, -0.36);
      tiltBone(u.bones.RightForeArm, 0.20, -0.18, 0);
      tiltBone(u.bones.LeftArm, 0.20, -0.10, 0.28);
      tiltBone(u.bones.LeftForeArm, 0.16, 0.28, 0);
      tiltBone(u.bones.LeftUpLeg, -0.06, 0.08, 0.08);
      tiltBone(u.bones.RightUpLeg, -0.24, -0.08, -0.12);
      tiltBone(u.bones.RightLeg, 0.30, 0, 0);
    } else if (arch === 2) {
      tiltBone(u.bones.RightArm, 0.10, 0.06, -0.22);
      tiltBone(u.bones.RightForeArm, -0.18, -0.28, 0);
      tiltBone(u.bones.LeftArm, -0.22, -0.08, 0.36);
      tiltBone(u.bones.LeftForeArm, 0.12, 0.18, 0.12);
      tiltBone(u.bones.LeftUpLeg, -0.16, 0.05, 0.10);
      tiltBone(u.bones.LeftLeg, 0.16, 0, 0);
      tiltBone(u.bones.RightUpLeg, -0.15, -0.06, -0.10);
      tiltBone(u.bones.RightLeg, 0.18, 0, 0);
    } else {
      tiltBone(u.bones.RightArm, -0.30, 0.08, -0.26);
      tiltBone(u.bones.RightForeArm, 0.12, -0.14, -0.12);
      tiltBone(u.bones.LeftArm, -0.26, -0.10, 0.28);
      tiltBone(u.bones.LeftForeArm, 0.10, 0.20, 0.12);
      tiltBone(u.bones.LeftUpLeg, -0.10, 0.04, 0.14);
      tiltBone(u.bones.RightUpLeg, -0.10, -0.04, -0.14);
    }
    tiltBone(u.bones.Spine1, dirSign * 0.10, 0, 0);
    tiltBone(u.bones.Spine2, dirSign * 0.12, 0, 0);
    tiltBone(u.bones.Neck, dirSign * 0.08, (Math.random() - 0.5) * 0.16, 0);
    tiltBone(u.bones.Head, dirSign * 0.08, (Math.random() - 0.5) * 0.30, 0);

    const tracks = [];
    for (const n of boneNames) {
      if (u.bones[n] && fromQ[n]) {
        tracks.push({ bone: u.bones[n], fromQ: fromQ[n], toQ: u.bones[n].quaternion.clone() });
        u.bones[n].quaternion.copy(fromQ[n]);
      }
    }
    u.corpseRelax = { t: 0, dur: 0.38, tracks };
    m.updateMatrixWorld(true);
  }

  _rotateBoneWorldAxis(bone, worldAxis, angle) {
    bone.updateWorldMatrix(true, false);
    const wq = bone.getWorldQuaternion(_wq);
    const pq = bone.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(worldAxis, angle);
    bone.quaternion.copy(pq.invert().multiply(_q.multiply(wq)));
  }
}
