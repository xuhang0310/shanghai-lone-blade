import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHAR_STYLES } from '../config/constants.js';
import { partSpec, buildColoredGeometry } from '../utils/GeometryBuilder.js';
import { WEAPON_TIPS } from './WeaponFactory.js';
import { weldIndex, buildAdjacency, taubinSmooth, shellNormals, bakeVertexAO } from './MeshSculpt.js';
import { applyCharacterLook, applyHeroOcclusion, setOcclusion } from './CharacterLook.js';
import { buildFedoraGeometry } from './HatGeometry.js';
import { BLADE, MELEE_WEAPONS, buildColdWeaponGeometry, createBladeMaterials, buildTasselGeometry, createTasselMaterial } from './BladeModel.js';
import { captureCrouchRig } from './CrouchGait.js';

const ARMS = [
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'
];

const FINGERS = [];
for (const side of ['Left', 'Right']) {
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    for (let j = 1; j <= 3; j++) FINGERS.push(`${side}Hand${f}${j}`);
  }
}

// Segment directions in the held prop's local frame. The three lower fingers
// wrap its far side, the thumb opposes them, and the index follows the side.
const HOLD_FINGERS = {
  Thumb:  [[.77, .42, .56], [.92, .01, .40], [.97, -.24, -.06]],
  Index:  [[1, .48, -.12], [1, .40, .02], [1, .14, .08]],
  Middle: [[.16, -.05, -1], [-1, -.04, .02], [-.87, .05, .75]],
  Ring:   [[.08, -.09, -1], [-1, -.06, -.08], [-.92, .06, .65]],
  Pinky:  [[.12, -.10, -1], [-.96, -.07, -.32], [-.82, .12, .76]]
};

// Bones that get procedural rotations on top of the clips (arm poses, exec twist, aim/flinch pitch, hit
// reactions, blade IK + finger grip); their clean clip pose is restored before every mixer update
const PROC_BONES = [...ARMS, 'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', ...FINGERS];

const POSE = {
  carry_pistol:        [[0.08, -0.96, 0.16], [0.44, -0.88, 0.03], null, null],
  carry_long:          [[0.16, -0.88, 0.22], [0.78, -0.32, -0.28], [0.48, -0.80, 0.16], [0.80, -0.22, 0.44]],
  hip_pistol:          [[0.70, -0.48, 0.15], [0.96, 0.09, -0.12], [0.54, -0.66, 0.22], [0.74, 0.12, 0.48]],
  pistol:              [[0.85, -0.3, 0.12], [0.97, 0.12, -0.14], [0.72, -0.45, 0.3], [0.8, 0.24, 0.52]],
  long:                [[0.22, -0.9, 0.25], [0.92, 0.2, -0.3], [0.74, -0.5, 0.22], [0.78, 0.12, 0.6]],
  strike:              [[0.8, 0.35, 0.1], [0.9, 0.05, -0.25], [0.28, -0.52, -0.49], [0.66, 0.63, 0.30]],
  wary_guard:          [[0.12, -0.72, 0.45], [0.66, 0.58, -0.35], [0.28, -0.52, -0.49], [0.66, 0.63, 0.30]],
  melee_windup:        [[-0.47, 0.28, 0.69], [-0.20, 0.87, 0.35], [0.48, -0.41, -0.33], [0.74, 0.34, 0.25]],
  exec_grab:           [[0.52, -0.45, 0.28], [0.82, 0.22, -0.28], [0.82, -0.22, 0.12], [0.94, 0.08, 0.22]],
  exec_whip:           [[0.84, -0.12, -0.12], [0.84, 0.06, -0.44], [0.64, -0.42, 0.18], [0.78, 0.06, 0.40]],
  exec_aim_pistol:     [[0.92, -0.06, 0.08], [0.98, 0.08, -0.06], [0.38, -0.78, -0.08], [0.72, -0.18, 0.46]],
  exec_long_coil:      [[0.18, -0.88, 0.28], [0.86, 0.24, -0.34], [0.68, -0.54, 0.24], [0.76, 0.16, 0.62]],
  exec_long_bash:      [[0.46, -0.66, 0.20], [0.92, 0.16, -0.26], [0.86, -0.28, 0.18], [0.86, 0.12, 0.48]],
  exec_stealth_slash:  [[0.82, -0.16, -0.24], [0.74, 0.04, -0.58], [0.74, -0.22, 0.24], [0.82, 0.12, 0.48]],
  exec_victim_stagger: [[0.16, -0.92, 0.20], [0.52, -0.46, -0.18], [0.18, -0.92, -0.18], [0.48, -0.48, 0.18]],
  reload_mag_a:        [[0.48, -0.58, 0.08], [0.74, -0.08, -0.44], [0.16, -0.92, -0.18], [0.46, -0.64, 0.24]],
  reload_mag_b:        [[0.52, -0.52, 0.05], [0.78, -0.04, -0.42], [0.54, -0.56, 0.26], [0.72, 0.08, 0.56]],
  // Hit reactions (directions in standing space: +X forward, +Y up, +Z right; prone maps up -> forward)
  disarm_fling:        [[-0.28, 0.32, 0.9], [-0.18, 0.62, 0.76], [0.2, -0.86, -0.46], [0.5, -0.5, -0.2]],
  surrender:           [[0.14, 0.6, 0.79], [0.08, 0.98, 0.12], [0.14, 0.6, -0.79], [0.08, 0.98, -0.12]],
  crawl_l:             [[0.6, -0.3, 0.7], [0.4, 0.8, 0.2], [0.35, 0.9, -0.3], [0.35, 0.92, -0.15]],
  crawl_r:             [[0.35, 0.9, 0.3], [0.35, 0.92, 0.15], [0.6, -0.3, -0.7], [0.4, 0.8, -0.2]]
};

const _q2 = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _yDown = new THREE.Vector3(0, -1, 0);
const _ikQ0 = new THREE.Quaternion();
const _ikQ1 = new THREE.Quaternion();
const _ikS = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikW = new THREE.Vector3();
const _ikD = new THREE.Vector3();
const _ikP = new THREE.Vector3();
const _ikM1 = new THREE.Matrix4();
const _ikM2 = new THREE.Matrix4();
const _bE = new THREE.Vector3();
const _bN = new THREE.Vector3();
const _bQ = new THREE.Quaternion();
const _bDw = new THREE.Vector3();
const _bEw = new THREE.Vector3();
const _bGR = new THREE.Vector3();
const _bGL = new THREE.Vector3();
const _bWR = new THREE.Vector3();
const _bWL = new THREE.Vector3();
const _bPR = new THREE.Vector3();
const _bPL = new THREE.Vector3();

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

function capturePropFingers(bones, prop) {
  const orientation = prop.getWorldQuaternion(new THREE.Quaternion());
  const direction = new THREE.Vector3();
  const pose = [];
  for (const [finger, segments] of Object.entries(HOLD_FINGERS)) {
    const rest = [];
    segments.forEach((xyz, i) => {
      const bone = bones[`RightHand${finger}${i + 1}`];
      if (!bone) return;
      rest.push([bone, bone.quaternion.clone()]);
      direction.fromArray(xyz).applyQuaternion(orientation);
      pointBone(bone, direction.x, direction.y, direction.z);
      pose.push([bone, bone.quaternion.clone()]);
    });
    for (const [bone, q] of rest) bone.quaternion.copy(q);
  }
  return pose;
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

// Both the tailored GLB and the generated coats use the male rig's Y-up bind coordinates.
function addCoatSway(material, timeUniform, swayUniform, masked = false) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.userData.sway = swayUniform;
  if (masked) material.defines = { ...material.defines, HERO_COAT_MASK: 1 };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uCoatSway = swayUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec3 uCoatSway;
        #ifdef HERO_COAT_MASK
          attribute float _coat_sway;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (transformed.y < 0.24) {
          float skirtK = clamp((0.24 - transformed.y) / 0.58, 0.0, 1.0);
          skirtK = skirtK * skirtK;
          #ifdef HERO_COAT_MASK
            skirtK *= _coat_sway;
          #endif
          float windW = sin(uTime * 5.2 + transformed.x * 11.0 + transformed.z * 7.0) * 0.02 * skirtK;
          transformed.x += uCoatSway.x * skirtK + windW;
          transformed.z += uCoatSway.z * skirtK - abs(uCoatSway.z) * 0.14 * skirtK;
          transformed.y += uCoatSway.y * skirtK;
          vec2 radD = length(transformed.xz) > 0.001 ? normalize(transformed.xz) : vec2(0.0, -1.0);
          transformed.xz += radD * (length(uCoatSway.xz) * 0.32 + 0.014) * skirtK;
        }`);
  };
  material.customProgramCacheKey = () => previousKey + '|coat-sway';
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
    this._roughTex = null;
    this._dying = new Set();
    this._initHairShader(this._sharedHairMat);
    applyCharacterLook(this._sharedHairMat, { rim: 0.42, key: 'hair' });
    applyCharacterLook(this.gr.M.hat, { rim: 0.28, key: 'hat' });
  }

  // Pomade-combed hair: fine comb grooves running front-to-back modulate albedo and gloss
  _initHairShader(mat) {
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vHairP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vHairP = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vHairP;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float hairComb = sin(vHairP.x * 540.0 + sin(vHairP.z * 36.0 + vHairP.y * 22.0) * 1.7);
          float hairFine = sin(vHairP.x * 1830.0 + vHairP.z * 64.0);
          diffuseColor.rgb *= 0.84 + 0.12 * hairComb + 0.04 * hairFine;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = 0.38 + 0.16 * (0.5 - 0.5 * hairComb);`);
    };
    mat.customProgramCacheKey = () => 'pomade-hair';
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
    const legSet = new Set([1, 2, 6, 7]);
    const footSet = new Set([3, 4, 5, 8, 9, 10]);
    const hipSet = new Set([0]);

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
        vertKind[i] = isScalp ? 1 : 6; // hair / scalp, else face & head skin
      } else if (handW > 0.45) {
        vertKind[i] = 3; // hands / gloves
      } else if (armW > 0.42 && handW <= 0.45) {
        const absX = Math.abs(x);
        if (absX > 0.39 && y < 0.16) vertKind[i] = 4; // wrist / cuff zone
        else vertKind[i] = 2; // sleeve
      } else if (torsoW > 0.4 && y > 0.44 && y < 0.72 && z > 0.13 && Math.abs(x) < 0.068) {
        vertKind[i] = 5; // front chest V-shirt / tie zone
      } else if (weightOf(i, footSet) > 0.45) {
        vertKind[i] = 8; // shoes
      } else if (weightOf(i, legSet) > 0.45 || (weightOf(i, hipSet) > 0.5 && y < 0.17)) {
        vertKind[i] = 7; // trousers
      }
    }

    // Build the UV region mask (R channel = region code * 16) with an exact, non-antialiased rasterizer:
    // canvas antialiasing blends region edges into other codes' values (e.g. sleeve edge -> "hair" dots)
    const w = this.assets.skinImg.width;
    const h = this.assets.skinImg.height;
    const codes = new Uint8Array(w * h);
    const fillTri = (x0, y0, x1, y1, x2, y2, code) => {
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) return;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const b0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * inv;
          const b1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * inv;
          if (b0 < -0.002 || b1 < -0.002 || 1 - b0 - b1 < -0.002) continue;
          codes[py * w + px] = code;
        }
      }
    };

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
      fillTri(u0 * w, v0 * h, u1 * w, v1 * h, u2 * w, v2 * h, finalTag);
    }

    // Grow regions 2px into unmasked texels so bilinear filtering at UV seams samples the right colour
    for (let pass = 0; pass < 2; pass++) {
      const src = codes.slice();
      for (let py = 1; py < h - 1; py++) {
        for (let px = 1; px < w - 1; px++) {
          const k = py * w + px;
          if (src[k]) continue;
          const n = src[k - 1] || src[k + 1] || src[k - w] || src[k + w];
          if (n) codes[k] = n;
        }
      }
    }
    const maskData = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < w * h; k++) maskData[k * 4] = codes[k] * 16;

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

    // Baked contact occlusion (armpits, collar line, eye sockets, fingers) shared by every man-model character
    const weld = weldIndex(pos);
    const adj = buildAdjacency(idx, weld);
    const ao = bakeVertexAO(pos, new THREE.BufferAttribute(smoothNor, 3), idx, weld, { adj });
    setOcclusion(geo, ao, 0.9);

    this._maleMeta = {
      geo, pos, nor, uv, jnt, wgt, idx, smoothNor,
      vertKind, maskData, sliceEnv, weightOf, armSet, handSet, torsoSet,
      weld, adj, ao
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
    const shirtWhite = srgbCol('#c9c0ad');
    const shoeCol = srgbCol('#1c1814');

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

      // 6. Face & head keep their painted detail (brows, mustache, eyes)
      if (mVal >= 92 && mVal <= 102) continue;

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn > 20) continue;

      // 7./8. Trousers and polished shoes are picked by body region, not by how dark the pixel is
      if (mVal >= 108 && mVal <= 118) {
        const k = Math.min(1.7, (Math.max(l, 9) / 22) * grain);
        p[i] = Math.min(255, pa.r * 255 * k);
        p[i + 1] = Math.min(255, pa.g * 255 * k);
        p[i + 2] = Math.min(255, pa.b * 255 * k);
        continue;
      }
      if (mVal >= 124 && mVal <= 134) {
        const k = 0.55 + Math.min(1, l / 60) * 0.6;
        p[i] = Math.min(255, shoeCol.r * 255 * k);
        p[i + 1] = Math.min(255, shoeCol.g * 255 * k);
        p[i + 2] = Math.min(255, shoeCol.b * 255 * k);
        continue;
      }

      // Everything else grey is shirt/vest cloth; dark seams become deeper shades of it, not speckles
      if (l < 200) {
        const target = isTailored ? vestCol : sh;
        const k = (Math.max(l, 26) / 135) * grain;
        p[i] = Math.min(255, target.r * 255 * k);
        p[i + 1] = Math.min(255, target.g * 255 * k);
        p[i + 2] = Math.min(255, target.b * 255 * k);
      }
    }

    // Soften the painted eye whites (face UV island, bottom-left) so faces stop reading as wide-eyed stares
    for (let py = 880; py < c.height; py++) {
      for (let px = 0; px < 200; px++) {
        const i = (py * c.width + px) * 4;
        const r = p[i];
        const g = p[i + 1];
        const b = p[i + 2];
        const mx = Math.max(r, g, b);
        if (mx < 175 || mx - Math.min(r, g, b) > 34) continue;
        const k = Math.min(1, 196 / mx);
        p[i] = r * k * 1.02;
        p[i + 1] = g * k * 0.98;
        p[i + 2] = b * k * 0.93;
      }
    }

    x.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return (this.skinCache[kind] = t);
  }

  // Region roughness for the man model (G channel): satin skin, glossy leather & silk, matte wool
  _getRoughTex() {
    if (this._roughTex) return this._roughTex;
    const meta = this._getMaleMeta();
    const im = this.assets.skinImg;
    const S = 512;
    const step = im.width / S;
    const src = document.createElement('canvas');
    src.width = src.height = S;
    const sx = src.getContext('2d');
    sx.drawImage(im, 0, 0, S, S);
    const sp = sx.getImageData(0, 0, S, S).data;
    const out = sx.createImageData(S, S);
    const o = out.data;
    const mask = meta.maskData;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const i = (py * S + px) * 4;
        const m = mask[(Math.floor(py * step) * im.width + Math.floor(px * step)) * 4];
        const r = sp[i];
        const g = sp[i + 1];
        const b = sp[i + 2];
        let rough;
        if (m >= 12 && m <= 22) rough = 0.58; // scalp under the hair shell
        else if (m >= 26 && m <= 38) rough = 0.92; // wool sleeves
        else if (m >= 42 && m <= 54) rough = 0.46; // hands / leather gloves
        else if (m >= 58 && m <= 70) rough = 0.72; // starched cuffs
        else if (m >= 74 && m <= 88) rough = 0.6; // shirt front & silk tie
        else if (m >= 108 && m <= 118) rough = 0.9; // wool trousers
        else if (m >= 124 && m <= 134) rough = 0.36; // polished shoes
        else if (Math.max(r, g, b) - Math.min(r, g, b) > 20) rough = r > g * 1.55 ? 0.4 : 0.5; // skin, lips
        else rough = 0.93; // woven cloth
        o[i] = o[i + 1] = o[i + 2] = Math.round(rough * 255);
        o[i + 3] = 255;
      }
    }
    sx.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(src);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    return (this._roughTex = t);
  }

  _getHairSkinGeo(hatted = false) {
    this._hairGeo ??= {};
    if (this._hairGeo[hatted]) return this._hairGeo[hatted];
    const meta = this._getMaleMeta();
    const { pos, smoothNor, idx, vertKind, weld, adj, ao } = meta;

    // Scalp triangles as canonical (welded) vertices so the shell stays watertight across UV seams
    const tris = [];
    const verts = new Set();
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if (vertKind[a] !== 1 && vertKind[b] !== 1 && vertKind[c] !== 1) continue;
      if (pos.getY(a) <= 0.74 || pos.getY(b) <= 0.74 || pos.getY(c) <= 0.74) continue;
      const t = [weld[a], weld[b], weld[c]];
      tris.push(t);
      for (const v of t) verts.add(v);
    }

    // Push out along smooth normals (thicker on the crown, thin at the nape), then relax the lumps away
    const P = new Float32Array(pos.count * 3);
    for (const v of verts) {
      const y = pos.getY(v);
      const napeFade = clamp((y - 0.755) / 0.08, 0.25, 1.0);
      const crown = (y - 0.88) / 0.08;
      const cs = clamp(crown, 0, 1);
      const push = hatted
        ? (y > 0.925 ? 0.0035 : 0.0068) * napeFade
        : (0.009 + 0.005 * cs * cs * (3 - 2 * cs)) * napeFade;
      P[v * 3] = pos.getX(v) + smoothNor[v * 3] * push;
      P[v * 3 + 1] = y + smoothNor[v * 3 + 1] * push;
      P[v * 3 + 2] = pos.getZ(v) + smoothNor[v * 3 + 2] * push;
    }
    const pinned = new Set();
    for (const v of verts) {
      for (const u of adj.get(v) || []) {
        if (!verts.has(u)) {
          pinned.add(v);
          break;
        }
      }
    }
    taubinSmooth(P, verts, adj, pinned, 3);
    // Smoothing must never pull the shell back into the scalp (temples would show skin through)
    for (const v of verts) {
      const o = v * 3;
      const d =
        (P[o] - pos.getX(v)) * smoothNor[o] +
        (P[o + 1] - pos.getY(v)) * smoothNor[o + 1] +
        (P[o + 2] - pos.getZ(v)) * smoothNor[o + 2];
      const minOut = pinned.has(v) ? 0.0025 : hatted && pos.getY(v) > 0.925 ? 0.003 : 0.0058;
      if (d < minOut) {
        P[o] += smoothNor[o] * (minOut - d);
        P[o + 1] += smoothNor[o + 1] * (minOut - d);
        P[o + 2] += smoothNor[o + 2] * (minOut - d);
      }
    }
    const N = shellNormals(P, tris, pos.count);

    const remap = new Map();
    const outPos = [];
    const outNor = [];
    const outOcc = [];
    for (const v of verts) {
      remap.set(v, remap.size);
      outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      outNor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      outOcc.push(clamp((1 - ao[v]) * 0.9, 0, 1));
    }
    const index = [];
    for (const [a, b, c] of tris) index.push(remap.get(a), remap.get(b), remap.get(c));
    const n = remap.size;
    const skIdx = new Uint16Array(n * 4);
    const skWgt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skIdx[i * 4] = 39;
      skWgt[i * 4] = 1;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(outOcc, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skIdx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skWgt, 4));
    g.setIndex(index);
    g.userData.shared = true;
    return (this._hairGeo[hatted] = g);
  }

  _buildHatBaseGeo(s) {
    const G = this.gr.G;
    const hc = s.hatCol || '#2a221b';
    const parts = [];

    if (s.hat === 'fedora') {
      return buildFedoraGeometry({ felt: hc, band: s.band || '#161210' });
    }
    if (s.hat === 'fedora-legacy') {
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
        partSpec(G.sph, hc, [0, 0.03, -0.006], [0.124, 0.066, 0.142]),
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
    const { pos, smoothNor, idx, jnt, wgt, sliceEnv, weightOf, armSet, handSet, torsoSet, ao } = meta;

    const outPos = [];
    const outNor = [];
    const outCol = [];
    const outJnt = [];
    const outWgt = [];
    const outOcc = [];

    const coatCol = new THREE.Color(s.coat || s.shirt);
    const lapelCol = new THREE.Color(s.coat || s.shirt).multiplyScalar(1.16);
    const scarfCol = new THREE.Color(s.scarf || '#8f221d');
    const beltCol = new THREE.Color('#191412');
    const buckleCol = new THREE.Color('#d4a448');

    const pushSkinnedVert = (x, y, z, nx, ny, nz, col, j0, j1, j2, j3, w0, w1, w2, w3, occ = 0.12) => {
      outPos.push(x, y, z);
      outNor.push(nx, ny, nz);
      outCol.push(col.r, col.g, col.b);
      outJnt.push(j0, j1, j2, j3);
      outWgt.push(w0, w1, w2, w3);
      outOcc.push(occ);
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
        wgt.getX(i), wgt.getY(i), wgt.getZ(i), wgt.getW(i),
        clamp((1 - ao[i]) * 0.85, 0, 1)
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

    // 2b. Turned-up collar, notched lapels & buttons draped onto the chest surface
    this._addCoatTailoring(s, meta, pushSkinnedVert, coatCol);

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
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(outOcc, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outJnt, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outWgt, 4));
    g.userData.shared = true;
    return (this._outfitCache[kind] = g);
  }

  _addCoatTailoring(s, meta, emit, coatCol) {
    const { pos, smoothNor, jnt, wgt, weightOf, torsoSet } = meta;
    const smoothstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };

    // Front chest samples of the bind-pose body, for draping flat pieces onto the coat surface
    const front = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.24 || y > 0.74 || pos.getZ(i) < 0.05 || smoothNor[i * 3 + 2] < 0.2) continue;
      if (weightOf(i, torsoSet) < 0.4) continue;
      front.push(i);
    }
    const surfAt = (x, y, lift) => {
      const near = [];
      for (const i of front) {
        const dx = pos.getX(i) - x;
        const dy = pos.getY(i) - y;
        const d2 = dx * dx + dy * dy;
        if (near.length < 4 || d2 < near[near.length - 1].d2) {
          near.push({ i, d2 });
          near.sort((a, b) => a.d2 - b.d2);
          if (near.length > 4) near.pop();
        }
      }
      let wz = 0;
      let z = 0;
      const n = new THREE.Vector3();
      for (const { i, d2 } of near) {
        const w = 1 / (d2 + 1e-6);
        wz += w;
        z += pos.getZ(i) * w;
        n.x += smoothNor[i * 3] * w;
        n.y += smoothNor[i * 3 + 1] * w;
        n.z += smoothNor[i * 3 + 2] * w;
      }
      n.normalize();
      const src = near[0].i;
      return {
        p: [x + n.x * lift, y + n.y * lift, z / wz + n.z * lift],
        n,
        j: [jnt.getX(src), jnt.getY(src), jnt.getZ(src), jnt.getW(src)],
        w: [wgt.getX(src), wgt.getY(src), wgt.getZ(src), wgt.getW(src)]
      };
    };
    const put = (v, col, occ) => emit(v.p[0], v.p[1], v.p[2], v.n.x, v.n.y, v.n.z, col, ...v.j, ...v.w, occ);
    // Front-facing (+Z) quad from corners laid out left->right on screen: a b (bottom), c d (top)
    const quad = (a, b, c, d, col, occ) => {
      put(a, col, occ); put(b, col, occ); put(c, col, occ);
      put(b, col, occ); put(d, col, occ); put(c, col, occ);
    };

    const xC = -0.006;
    const lapelCol = coatCol.clone().multiplyScalar(1.14);
    const edgeCol = coatCol.clone().multiplyScalar(0.78);
    const shadowCol = coatCol.clone().multiplyScalar(0.42);

    // Notched lapels following the V opening, widening from the top button to the collar notch
    for (const side of [-1, 1]) {
      const rows = 10;
      let prev = null;
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const y = 0.455 + t * (0.662 - 0.455);
        const edge = xC + side * (y - 0.42) * 0.34;
        const w = 0.076 * smoothstep(0, 0.72, t);
        const tilt = v => {
          v.n = v.n.clone().add(new THREE.Vector3(side * 0.42, 0.12, 0)).normalize();
          return v;
        };
        const inner = tilt(surfAt(edge - side * 0.004, y, 0.017 + 0.004 * t));
        const outerY = r === rows ? y - 0.026 : y;
        const outer = tilt(surfAt(edge + side * w, outerY, 0.016));
        const gap = surfAt(edge + side * (w + 0.0045), outerY - 0.001, 0.0125);
        if (prev) {
          const col = r === rows ? edgeCol : lapelCol;
          if (side > 0) {
            quad(prev.inner, prev.outer, inner, outer, col, 0.1);
            quad(prev.outer, prev.gap, outer, gap, shadowCol, 0.6);
          } else {
            quad(prev.outer, prev.inner, outer, inner, col, 0.1);
            quad(prev.gap, prev.outer, gap, outer, shadowCol, 0.6);
          }
        }
        prev = { inner, outer, gap };
      }
    }

    // Tie down the shirt front, between the lapels
    if (s.tie) {
      const tieCol = new THREE.Color(s.tie);
      const knotCol = tieCol.clone().multiplyScalar(0.8);
      const prof = [[0.656, 0.011], [0.632, 0.013], [0.6, 0.016], [0.53, 0.019], [0.47, 0.022], [0.446, 0]];
      for (let k = 0; k < prof.length - 1; k++) {
        const [y0, w0] = prof[k + 1];
        const [y1, w1] = prof[k];
        const lift = 0.0045;
        const a = surfAt(xC - w0, y0, lift);
        const b = surfAt(xC + w0, y0, lift);
        const c = surfAt(xC - w1, y1, lift);
        const d = surfAt(xC + w1, y1, lift);
        quad(a, b, c, d, k === prof.length - 2 ? knotCol : tieCol, 0.15);
      }
    }

    // Buttons: double-breasted on the trench, single row on long coats
    if (s.trench || s.longcoat) {
      const cols = s.trench ? [-0.058, 0.058] : [0];
      const ys = s.trench ? [0.425, 0.355, 0.29] : [0.405, 0.335, 0.265];
      const btn = new THREE.Color('#241a13');
      const segs = 8;
      for (const bx of cols) {
        for (const by of ys) {
          const c = surfAt(xC + bx, by, 0.0175);
          const t1 = new THREE.Vector3(1, 0, 0).addScaledVector(c.n, -c.n.x).normalize();
          const t2 = new THREE.Vector3().crossVectors(c.n, t1);
          const ring = [];
          for (let k = 0; k < segs; k++) {
            const a = (k / segs) * Math.PI * 2;
            const off = t1.clone().multiplyScalar(Math.cos(a) * 0.0085).addScaledVector(t2, Math.sin(a) * 0.0085);
            ring.push({ ...c, p: [c.p[0] + off.x, c.p[1] + off.y, c.p[2] + off.z] });
          }
          const mid = { ...c, p: [c.p[0] + c.n.x * 0.002, c.p[1] + c.n.y * 0.002, c.p[2] + c.n.z * 0.002] };
          for (let k = 0; k < segs; k++) {
            put(mid, btn, 0.05);
            put(ring[k], btn, 0.2);
            put(ring[(k + 1) % segs], btn, 0.2);
          }
        }
      }
    }

    // Turned-up noir collar, open at the front; stands clear of the hero's scarf
    const rx0 = s.scarf ? 0.104 : 0.09;
    const rz0 = s.scarf ? 0.112 : 0.098;
    const cz = 0.064;
    const th0 = 0.62;
    const th1 = Math.PI * 2 - 0.62;
    const segs = 26;
    const ringPt = (th, k) => {
      const back = (1 - Math.cos(th)) * 0.5;
      const yb = 0.664 + 0.022 * back;
      const hgt = 0.038 + 0.03 * back;
      const flare = 0.018 * k;
      const x = Math.sin(th) * (rx0 + flare);
      const z = cz + Math.cos(th) * (rz0 + flare);
      const n = new THREE.Vector3(Math.sin(th), -0.3, Math.cos(th)).normalize();
      const wN = 0.15 + 0.4 * k;
      return { p: [x - 0.002, yb + hgt * k, z], n, j: [13, 38, 0, 0], w: [1 - wN, wN, 0, 0] };
    };
    for (let i = 0; i < segs; i++) {
      const a = th0 + ((th1 - th0) * i) / segs;
      const b = th0 + ((th1 - th0) * (i + 1)) / segs;
      const a0 = ringPt(a, 0);
      const b0 = ringPt(b, 0);
      const a1 = ringPt(a, 1);
      const b1 = ringPt(b, 1);
      put(a0, coatCol, 0.35); put(b0, coatCol, 0.35); put(a1, lapelCol, 0.05);
      put(b0, coatCol, 0.35); put(b1, lapelCol, 0.05); put(a1, lapelCol, 0.05);
    }
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

  _prepareHeroMaterials(inner) {
    const materials = new Map();
    const sway = { value: new THREE.Vector3() };
    let body = null;
    let coat = null;
    const anisotropy = Math.min(4, this.gr.renderer.capabilities.getMaxAnisotropy());
    const prepare = (source, geometry) => {
      if (materials.has(source)) return materials.get(source);
      const material = source.clone();
      material.userData.own = true;
      const hasCoatMask = geometry.hasAttribute('_coat_sway');
      if (hasCoatMask || source.name.startsWith('HeroWool')) {
        addCoatSway(material, this.gr.timeUniform, sway, hasCoatMask);
        coat = material;
      }
      if (geometry.hasAttribute('_hero_occ')) applyHeroOcclusion(material);
      for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
        if (texture && texture.anisotropy !== anisotropy) {
          texture.anisotropy = anisotropy;
          texture.needsUpdate = true;
        }
      }
      materials.set(source, material);
      return material;
    };
    inner.traverse(o => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material)
        ? o.material.map(source => prepare(source, o.geometry))
        : prepare(o.material, o.geometry);
      if (!body || o.name === 'Male' || o.parent?.name === 'Male') {
        body = Array.isArray(o.material) ? o.material[0] : o.material;
      }
    });
    return { body, coat };
  }

  createPerson(kind, gunKey, presetId = 'ranger') {
    const s = CHAR_STYLES[kind];
    const isSoldier = s.model === 'soldier';
    const isHero = kind === 'hero';
    const heroModel = isHero && this.assets.glb[`hero-${presetId}`];
    const baseModel = heroModel || this.assets.glb[s.model];
    const metrics = isSoldier ? this.assets.soldierMetrics : this.assets.manMetrics;
    const clips = isSoldier ? this.assets.soldierClips : this.assets.manClips;

    const g = new THREE.Group();
    const inner = SkeletonUtils.clone(baseModel);

    let mat;
    let coatMat = null;
    if (heroModel) {
      const materials = this._prepareHeroMaterials(inner);
      mat = materials.body;
      coatMat = materials.coat;
    } else {
      mat = new THREE.MeshStandardMaterial({
        map: this._getSkinTex(kind),
        ...(isSoldier
          ? { roughness: 0.88 }
          : { normalMap: this.assets.manNor, normalScale: new THREE.Vector2(0.75, 0.75), roughnessMap: this._getRoughTex(), roughness: 1 }),
        metalness: 0.0,
        envMapIntensity: 0.26
      });
      mat.userData.own = true;
      applyCharacterLook(mat, { rim: 0.34, key: 'body' });
    }

    const pivot = new THREE.Group();
    pivot.position.y = 0.9;
    g.add(pivot);

    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(metrics.scale);
    inner.position.set(metrics.offX, metrics.footY - 0.9, metrics.offZ);
    pivot.add(inner);

    const bones = {};
    let bodySkinnedMesh = null;
    let hatMesh = heroModel ? inner.getObjectByName('HeroHat') : null;
    inner.traverse(o => {
      if (o.isBone && !bones[o.name]) bones[o.name] = o;
      if (o.isMesh) {
        if (isSoldier && o.name === 'Helmet') {
          o.visible = !!s.helmet;
          if (o.visible) hatMesh = o;
        }
        if (o.isSkinnedMesh && (!bodySkinnedMesh || o.name === 'Male')) bodySkinnedMesh = o;
        if (!heroModel) o.material = mat;
        // Shen's individual brow hairs use translucent cards directly on the
        // skin. A depth-only shadow pass would project the whole carrier.
        o.castShadow = !(heroModel && o.material.name === 'eyebrow001');
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });

    // Bind true SkinnedMesh hair, hat, and multi-bone matte wool trench coat directly to Male's skeleton
    if (!heroModel && !isSoldier && bodySkinnedMesh) {
      const parentArmature = bodySkinnedMesh.parent;
      const bindMat = bodySkinnedMesh.bindMatrix;
      const skel = bodySkinnedMesh.skeleton;

      const hairMesh = new THREE.SkinnedMesh(this._getHairSkinGeo(s.hat === 'fedora' || s.hat === 'cap'), this._sharedHairMat);
      hairMesh.castShadow = true;
      hairMesh.receiveShadow = true;
      hairMesh.frustumCulled = false;
      parentArmature.add(hairMesh);
      hairMesh.bind(skel, bindMat);

      const hatGeo = this._getHatSkinGeo(kind);
      if (hatGeo) {
        hatMesh = new THREE.SkinnedMesh(hatGeo, this.gr.M.hat);
        hatMesh.castShadow = true;
        hatMesh.receiveShadow = true;
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
        coatMat.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
              varying vec3 vClothBindPos;`
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              vClothBindPos = position;`
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
        addCoatSway(coatMat, this.gr.timeUniform, { value: new THREE.Vector3() });
        applyCharacterLook(coatMat, { rim: 0.3, key: 'coat' });
        const outfitMesh = new THREE.SkinnedMesh(outfitGeo, coatMat);
        outfitMesh.castShadow = true;
        outfitMesh.receiveShadow = true;
        outfitMesh.frustumCulled = false;
        parentArmature.add(outfitMesh);
        outfitMesh.bind(skel, bindMat);
      }
    }

    const crouchRig = captureCrouchRig(g, bones);
    const mixer = new THREE.AnimationMixer(inner);
    const acts = {};
    const w = { RelaxIdle: 1, Idle: 0, Walk: 0, Run: 0 };
    for (const n in w) {
      if (!clips[n]) continue;
      acts[n] = mixer.clipAction(clips['Loco' + n] || clips[n]);
      acts[n].play();
      acts[n].setEffectiveWeight(w[n]);
    }
    mixer.update(0);
    g.updateMatrixWorld(true);

    // Pose-aware bounds padded for aim/crouch/death poses, so off-screen characters get culled in every pass
    inner.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.computeBoundingSphere();
      o.boundingSphere.radius = o.boundingSphere.radius * 1.4 + 0.6 / o.matrixWorld.getMaxScaleOnAxis();
      o.frustumCulled = true;
    });

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
      'knife', 'carry_pistol', 'carry_long', 'hip_pistol', 'pistol', 'long', 'strike', 'wary_guard', 'melee_windup',
      'exec_grab', 'exec_whip', 'exec_aim_pistol', 'exec_long_coil', 'exec_long_bash',
      'exec_stealth_slash', 'exec_victim_stagger', 'disarm_fling', 'surrender', 'crawl_l', 'crawl_r'
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
        cls === 'carry_pistol'
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
        if (heroModel && cls !== 'knife') xf[cls].fingers = capturePropFingers(bones, tmp);
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
      clips,
      ov: null,
      dk: 0,
      bones,
      mat,
      coatMat,
      hatMesh,
      rest,
      gun,
      glint,
      mixer,
      crouchRig,
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
      rate: 1
    };

    this.setGun(g, gunKey || s.gun);
    if (s.scale) {
      const bulk = s.scale > 1.2 ? 1.06 : 1;
      g.scale.set(s.scale * bulk, s.scale, s.scale * bulk);
    }
    return g;
  }

  setGun(g, k) {
    const u = g.userData;
    const cls = k === 'knife' ? 'knife' : (k === 'pistol' || k === 'browning' || k === 'revolver') ? 'pistol' : 'long';
    const x = u.xf[cls];
    u.propFingers = x.fingers;
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
    const ovW = this._updateOverlay(u, dt);
    const baseK = 1 - ovW;
    u.lowTurnWeight = Math.min(1, (u.ov?.turn === 'crouch' ? u.ov.w : 0) + (u.ovOld?.turn === 'crouch' ? u.ovOld.w : 0));
    for (const n in u.acts) {
      let targetW = 0;
      if (mode === 'RelaxIdle') {
        if (n === 'RelaxIdle') targetW = 1 - 0.26 * rK;
        else if (n === 'Idle') targetW = 0.26 * rK;
      } else if (n === mode) {
        targetW = 1;
      }
      u.w[n] = (u.w[n] ?? 0) + (targetW - (u.w[n] ?? 0)) * blendRate;
      u.acts[n].setEffectiveWeight(u.w[n] * baseK);
      u.acts[n].timeScale = u.rate;
    }
    // AnimationMixer only rewrites a bone when its sampled value changes, so on dt = 0 frames (freeze-frame tableau)
    // last frame's procedural twist/pitch would stack every frame and spin the torso. Start from the clean clip pose.
    this._restoreAnimBase(u);
    u.mixer.update(dt);
    this._captureAnimBase(u);

    if (!u.dead && u.execPose) {
      const pa = u.poses[u.execPose.a];
      const pb = u.poses[u.execPose.b || u.execPose.a];
      const pt = clamp(u.execPose.t ?? 0, 0, 1);
      const pw = clamp(u.execPose.w ?? 1, 0, 1) * baseK;
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
          b.quaternion.slerp(u.carryPose[n], locoBlend * baseK);
        }
        // 2. Smoothly raise into Gun-Ready / ADS pose when aiming, firing, or in combat stance
        if (rK > 0.005) {
          _q2.copy(u.hipPose[n] || u.aimPose[n]).slerp(u.aimPose[n], adsK);
          b.quaternion.slerp(_q2, rK * baseK);
        }
      }
      if (u.gun.visible && u.propFingers) {
        for (const [bone, q] of u.propFingers) bone.quaternion.slerp(q, baseK);
      }
    }

    const pitchScale = 0.18 + 0.82 * rK;
    const pitchTilt = (aimPitch * pitchScale + flinch * 0.35) * baseK;
    const yawTwist = (u.execTwist || 0) * baseK;
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
    this._restoreAnimBase(u);
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

  // --- Mixamo clip layer (assets/chars/anims-mixamo.json, built by tools/convert-mixamo.mjs) ---
  // One overlay clip at a time plays over the base Idle/Walk/Run blend: base weights and the procedural
  // arm/aim layers scale by (1 - overlay weight), so a hit reaction fully owns the body at its peak.

  hasClip(m, key) {
    return !!m.userData.clips?.[key];
  }

  _clipAction(u, key) {
    u.extra ??= {};
    return (u.extra[key] ??= u.mixer.clipAction(u.clips[key]));
  }

  playClip(m, key, { loop = false, fadeIn = 0.1, fadeOut = 0.22, speed = 1, turn = null } = {}) {
    const u = m.userData;
    if (!u.clips?.[key] || u.dead) return false;
    const cur = u.ov;
    // A re-hit right after the same flinch started just lets it run on
    if (cur && cur.key === key && !cur.stopping && !loop && cur.t < 0.12) return true;
    const clip = u.clips[key];
    const footwork = turn === 'standing';
    let act;
    if (footwork) {
      // A standing pivot only contributes leg motion, leaving aim and both hands on the weapon.
      if (!clip.userData.footwork) {
        const legs = clip.tracks.filter(t => /^(Hips|(?:Left|Right)(?:UpLeg|Leg|Foot|ToeBase))\./.test(t.name));
        const step = new THREE.AnimationClip(key + 'Footwork', clip.duration, legs.map(t => t.clone()));
        clip.userData.footwork = THREE.AnimationUtils.makeClipAdditive(step);
      }
      act = u.mixer.clipAction(clip.userData.footwork);
    } else act = this._clipAction(u, key);
    if (cur && cur.act !== act) {
      // Cross-fade: the outgoing clip keeps playing while it fades under the new one
      if (u.ovOld) u.ovOld.act.stop();
      u.ovOld = { act: cur.act, w: cur.w, fade: fadeIn, footwork: cur.footwork, turn: cur.turn };
    }
    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    act.clampWhenFinished = true;
    act.timeScale = speed;
    act.setEffectiveWeight(0);
    act.play();
    const w0 = cur && cur.act === act ? cur.w : 0;
    u.ov = { key, act, loop, fadeIn, fadeOut, speed, turn, footwork, t: 0, dur: clip.duration / speed, w: w0, stopping: false };
    return true;
  }

  stopClip(m, fadeOut = 0.22) {
    const ov = m.userData.ov;
    if (!ov) return;
    ov.stopping = true;
    ov.fadeOut = fadeOut;
  }

  setClipSpeed(m, speed) {
    const ov = m.userData.ov;
    if (ov) ov.act.timeScale = speed;
  }

  // Advances overlay fades; returns the total overlay weight (base layers get the rest)
  _updateOverlay(u, dt) {
    let old = 0;
    if (u.ovOld) {
      const o = u.ovOld;
      o.w = Math.max(0, o.w - dt / Math.max(0.01, o.fade));
      if (o.w <= 0) {
        o.act.stop();
        u.ovOld = null;
      } else {
        o.act.setEffectiveWeight(o.w);
        old = o.footwork ? 0 : o.w;
      }
    }
    const ov = u.ov;
    if (!ov) return Math.min(1, old);
    ov.t += dt;
    const ending = ov.stopping || (!ov.loop && ov.t >= ov.dur - ov.fadeOut);
    ov.w = ending ? Math.max(0, ov.w - dt / Math.max(0.01, ov.fadeOut)) : Math.min(1, ov.w + dt / Math.max(0.01, ov.fadeIn));
    if (ending && ov.w <= 0) {
      ov.act.stop();
      u.ov = null;
      return Math.min(1, old);
    }
    ov.act.setEffectiveWeight(ov.w);
    return Math.min(1, (ov.footwork ? 0 : ov.w) + old);
  }

  // Death by clip: the corpse keeps animating (see updateDying) until the fall has played out
  playDeathClip(m, key) {
    const u = m.userData;
    if (!key || !u.clips?.[key]) return false;
    u.dead = true;
    u.pose = null;
    u.execPose = null;
    u.execTwist = 0;
    u.aimPose = null;
    u.carryPose = null;
    m.scale.y = m.scale.x;
    for (const n in u.acts) u.acts[n].timeScale = 0;
    if (u.ovOld) {
      u.ovOld.act.stop();
      u.ovOld = null;
    }
    const act = this._clipAction(u, key);
    if (u.ov && u.ov.act !== act) u.ov.act.timeScale = 0;
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.timeScale = 1;
    act.setEffectiveWeight(0);
    act.play();
    u.dying = { act, t: 0, dur: u.clips[key].duration, fade: 0.1, ovW: u.ov && !u.ov.footwork ? u.ov.w : 0 };
    this._dying.add(m);
    return true;
  }

  updateDying(dt) {
    for (const m of this._dying) {
      const u = m.userData;
      const d = u.dying;
      if (!d || !m.parent) {
        this._dying.delete(m);
        continue;
      }
      d.t += dt;
      const w = Math.min(1, d.t / d.fade);
      for (const n in u.acts) u.acts[n].setEffectiveWeight((u.w[n] ?? 0) * (1 - d.ovW) * (1 - w));
      if (u.ov) u.ov.act.setEffectiveWeight(d.ovW * (1 - w));
      d.act.setEffectiveWeight(w);
      this._restoreAnimBase(u);
      u.mixer.update(dt);
      if (d.t >= d.dur) {
        if (u.ov) u.ov.act.stop();
        u.ov = null;
        u.dying = null;
        this._dying.delete(m);
      }
    }
  }

  clearDying() {
    this._dying.clear();
  }

  // --- Dadao (blade-first melee, see systems/Melee.js) ---------------------------------------------

  attachBlade(m, weaponKind = 'dadao') {
    const u = m.userData;
    const kind = MELEE_WEAPONS[weaponKind] ? weaponKind : 'dadao';
    const meta = MELEE_WEAPONS[kind];
    if (u.blade && u.bladeKind === kind) return u.blade;
    if (!this._bladeMats) {
      this._weaponGeos = {};
      this._bladeMats = createBladeMaterials(this.gr.timeUniform);
      this._tasselGeo = buildTasselGeometry();
      this._tasselGeo.userData.shared = true;
      this._tasselMat = createTasselMaterial(this.gr.timeUniform);
    }
    const geo = (this._weaponGeos[kind] ??= buildColdWeaponGeometry(kind));
    if (u.blade) {
      m.remove(u.blade);
    }
    const blade = new THREE.Mesh(geo, this._bladeMats.materials);
    blade.castShadow = true;
    blade.visible = false;
    const tassel = new THREE.Mesh(this._tasselGeo, this._tasselMat);
    tassel.position.set(meta.tasselX ?? (meta.pommelX - 0.027), 0, 0);
    tassel.scale.setScalar(meta.tasselScale || 1.0);
    tassel.castShadow = true;
    blade.add(tassel);
    m.add(blade);
    u.blade = blade;
    u.bladeKind = kind;
    u.bladeMeta = meta;
    u.bladeBlood = this._bladeMats.blood;
    u.tassel = { mesh: tassel, dir: new THREE.Vector3(0, -1, 0), vel: new THREE.Vector3(), prev: null };
    // Hand frames in bone-local space: wrist -> middle knuckle, and toward the thumb
    u.handAxes = {};
    for (const side of ['Left', 'Right']) {
      const hand = u.bones[`${side}Hand`];
      const mid = u.bones[`${side}HandMiddle1`];
      const th = u.bones[`${side}HandThumb1`];
      if (!hand || !mid || !th) continue;
      const a = mid.position.clone().normalize();
      const b = th.position.clone().addScaledVector(a, -th.position.dot(a)).normalize();
      u.handAxes[side] = { a, b, c: new THREE.Vector3().crossVectors(a, b) };
    }
    return blade;
  }

  // Two-bone arm IK: swing upper arm & forearm from their rest pose (like the authored POSE presets) so
  // the wrist reaches `target`, elbow bending toward `pole`; blended over the animated pose by `w`
  _ikArm(u, side, target, pole, w) {
    const up = u.bones[`${side}Arm`];
    const fo = u.bones[`${side}ForeArm`];
    const ha = u.bones[`${side}Hand`];
    if (!up || !fo || !ha || w <= 0.001) return;
    _ikQ0.copy(up.quaternion);
    _ikQ1.copy(fo.quaternion);
    up.quaternion.copy(u.rest[`${side}Arm`]);
    fo.quaternion.copy(u.rest[`${side}ForeArm`]);
    up.updateWorldMatrix(true, true);
    const S = up.getWorldPosition(_ikS);
    const E0 = fo.getWorldPosition(_ikE);
    const W0 = ha.getWorldPosition(_ikW);
    const a = S.distanceTo(E0);
    const b = E0.distanceTo(W0);
    const toT = _ikD.copy(target).sub(S);
    const d = clamp(toT.length(), 0.05, (a + b) * 0.998);
    toT.normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const pn = _ikP.copy(pole).addScaledVector(toT, -pole.dot(toT));
    if (pn.lengthSq() < 1e-6) pn.set(0, -1, 0);
    pn.normalize();
    const elbow = _ikE.copy(S).addScaledVector(toT, x).addScaledVector(pn, h);
    pointBone(up, elbow.x - S.x, elbow.y - S.y, elbow.z - S.z);
    const wx = S.x + toT.x * d - elbow.x;
    const wy = S.y + toT.y * d - elbow.y;
    const wz = S.z + toT.z * d - elbow.z;
    pointBone(fo, wx, wy, wz);
    if (w < 0.999) {
      up.quaternion.copy(_ikQ0.slerp(up.quaternion, w));
      fo.quaternion.copy(_ikQ1.slerp(fo.quaternion, w));
    }
  }

  // Hand closed around the grip: knuckles along the edge direction, thumb side toward the blade
  _gripHand(u, side, edgeW, bladeW, w) {
    const ax = u.handAxes?.[side];
    const hand = u.bones[`${side}Hand`];
    if (!ax || !hand || w <= 0.001) return;
    hand.parent.updateWorldMatrix(true, false);
    const c2 = _ikD.crossVectors(edgeW, bladeW);
    _ikM1.makeBasis(ax.a, ax.b, ax.c);
    _ikM2.makeBasis(edgeW, bladeW, c2);
    _ikM2.multiply(_ikM1.transpose());
    const qWorld = _ikQ0.setFromRotationMatrix(_ikM2);
    const qParent = hand.parent.getWorldQuaternion(_ikQ1);
    const qLocal = qParent.invert().multiply(qWorld);
    hand.quaternion.slerp(qLocal, w);
    hand.updateWorldMatrix(false, true);
    // Curl the fingers round the handle (about the palm's lateral axis, toward the palm)
    const palm = side === 'Right' ? _ikS.crossVectors(bladeW, edgeW) : _ikS.crossVectors(edgeW, bladeW);
    const axis = _ikW.crossVectors(edgeW, palm).normalize();
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      [1.15, 1.25, 0.85].forEach((ang, j) => {
        const b = u.bones[`${side}Hand${f}${j + 1}`];
        if (b) this._rotateBoneWorldAxis(b, axis, ang * w);
      });
    }
    for (let j = 1; j <= 3; j++) {
      const b = u.bones[`${side}HandThumb${j}`];
      if (b) this._rotateBoneWorldAxis(b, axis, 0.45 * w);
    }
  }

  // Applies a blade pose from Melee: blade transform in character space, torso layer, both-hand IK grip
  poseBlade(m, pose, show, dt) {
    const u = m.userData;
    const blade = u.blade;
    if (!blade) return;
    blade.visible = show;
    if (!show) return;
    m.updateMatrixWorld(true);

    // Torso: twist about world up, lean about the character's right axis
    const right = _v1.set(0, 0, 1).applyQuaternion(m.quaternion);
    if (Math.abs(pose.tw) > 1e-3) {
      this._rotateBoneWorldAxis(u.bones.Spine1, _yUp, pose.tw * 0.45);
      this._rotateBoneWorldAxis(u.bones.Spine2, _yUp, pose.tw * 0.55);
    }
    if (Math.abs(pose.ln) > 1e-3) {
      this._rotateBoneWorldAxis(u.bones.Spine1, right, -pose.ln * 0.5);
      this._rotateBoneWorldAxis(u.bones.Spine2, right, -pose.ln * 0.5);
    }

    // Blade in character space: X = blade, Y = cutting edge, Z = flat
    const D = pose.d;
    const E = _bE.copy(pose.e).addScaledVector(D, -pose.e.dot(D)).normalize();
    const N = _bN.crossVectors(D, E);
    blade.position.copy(pose.g);
    blade.quaternion.setFromRotationMatrix(_ikM1.makeBasis(D, E, N));
    blade.updateMatrixWorld(true);

    const meta = u.bladeMeta || BLADE;
    const qW = blade.getWorldQuaternion(_bQ);
    const Dw = _bDw.copy(D).applyQuaternion(m.quaternion);
    const Ew = _bEw.copy(E).applyQuaternion(m.quaternion);
    const gripR = blade.localToWorld(_bGR.set(0, 0, 0));
    const gripL = blade.localToWorld(_bGL.set(meta.leftGripX, 0, 0));
    // Wrist sits behind the grip, opposite the knuckles
    const wristR = _bWR.copy(gripR).addScaledVector(Ew, -0.072);
    const wristL = _bWL.copy(gripL).addScaledVector(Ew, -0.072);
    const poleR = _bPR.set(-0.3, -1, 0.55).applyQuaternion(m.quaternion);
    const poleL = _bPL.set(-0.3, -1, -0.55).applyQuaternion(m.quaternion);
    this._ikArm(u, 'Right', wristR, poleR, 1);
    this._gripHand(u, 'Right', Ew, Dw, 1);
    if (pose.l > 0.01) {
      this._ikArm(u, 'Left', wristL, poleL, pose.l);
      this._gripHand(u, 'Left', Ew, Dw, pose.l);
    }

    // Red silk tassel: spring toward hanging straight down, dragged by the tassel mount's motion
    const t = u.tassel;
    const pommel = blade.localToWorld(_bGR.set(meta.tasselX ?? (meta.pommelX - 0.027), 0, 0));
    if (t.prev && dt > 0) {
      const v = _bWR.copy(pommel).sub(t.prev).divideScalar(dt);
      t.vel.addScaledVector(v, -0.02 * 60 * dt);
      t.vel.y -= 9.8 * dt * 0.6;
      t.vel.addScaledVector(t.dir, -t.vel.dot(t.dir));
      t.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
      t.dir.addScaledVector(t.vel, dt).normalize();
    }
    t.prev = (t.prev || new THREE.Vector3()).copy(pommel);
    const dirLocal = _bWL.copy(t.dir).applyQuaternion(qW.invert()).normalize();
    t.mesh.quaternion.setFromUnitVectors(_yDown, dirLocal);
  }

  _restoreAnimBase(u) {
    if (!u.animBase) return;
    for (const [b, q] of u.animBase) b.quaternion.copy(q);
  }

  _captureAnimBase(u) {
    if (!u.animBase) {
      u.animBase = new Map();
      for (const n of PROC_BONES) if (u.bones[n]) u.animBase.set(u.bones[n], new THREE.Quaternion());
    }
    for (const [b, q] of u.animBase) q.copy(b.quaternion);
  }

  _rotateBoneWorldAxis(bone, worldAxis, angle) {
    bone.updateWorldMatrix(true, false);
    const wq = bone.getWorldQuaternion(_wq);
    const pq = bone.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(worldAxis, angle);
    bone.quaternion.copy(pq.invert().multiply(_q.multiply(wq)));
  }
}
