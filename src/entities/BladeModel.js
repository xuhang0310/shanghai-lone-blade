import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 1930s 二十九军大刀 (dadao): single-edged broad blade with a thick spine, bevelled edge and the
// characteristic clipped point; round iron disc guard, cord-wrapped two-hand grip, iron ring pommel and
// a red silk tassel. Weapon space: origin at the right-hand grip, +X toward the tip, +Y = cutting edge
// side, +Z = flat of the blade. Material groups: 0 blade steel, 1 grip wrap, 2 iron fittings.

export const BLADE = {
  guardX: 0.06, // blade starts just past the guard
  tipX: 0.76,
  pommelX: -0.245,
  leftGripX: -0.115 // left hand sits below the right on the long grip
};

export const MELEE_WEAPONS = {
  dadao: {
    id: 'dadao',
    name: '二十九军式大刀',
    guardX: 0.06,
    tipX: 0.76,
    pommelX: -0.245,
    leftGripX: -0.115,
    tasselX: -0.272,
    tasselScale: 1.0
  },
  spear: {
    id: 'spear',
    name: '梨花红缨长枪',
    guardX: 0.96,
    tipX: 1.44,
    pommelX: -0.78,
    leftGripX: -0.34,
    tasselX: 0.95,
    tasselScale: 1.38
  },
  axe: {
    id: 'axe',
    name: '玄铁宣花巨斧',
    guardX: 0.44,
    tipX: 0.96,
    pommelX: -0.46,
    leftGripX: -0.26,
    tasselX: -0.48,
    tasselScale: 0.92
  },
  mace: {
    id: 'mace',
    name: '玄铁狼牙重棒',
    guardX: 0.36,
    tipX: 0.98,
    pommelX: -0.44,
    leftGripX: -0.24,
    tasselX: -0.46,
    tasselScale: 0.85
  },
  guandao: {
    id: 'guandao',
    name: '青龙偃月重关刀',
    guardX: 0.56,
    tipX: 1.38,
    pommelX: -0.78,
    leftGripX: -0.35,
    tasselX: 0.56,
    tasselScale: 1.55
  }
};

function bladeGeometry() {
  // Stations along the blade: [x, spineY, edgeY]
  const st = [
    [0.06, -0.021, 0.019],
    [0.2, -0.022, 0.026],
    [0.4, -0.024, 0.035],
    [0.58, -0.025, 0.043],
    [0.66, -0.0255, 0.044],
    [0.71, -0.026, 0.032],
    [0.735, -0.026, 0.017],
    [0.752, -0.0255, 0.003]
  ];
  const tip = [0.762, -0.024];
  // Cross-section around the blade (spine top -> bevel -> edge -> bevel -> spine bottom), z = flat axis
  const section = (sy, ey, x) => {
    const taper = 1 - Math.max(0, (x - 0.45) / 0.36) * 0.45; // thinner toward the point
    const tSpine = 0.0042 * taper;
    const bevelY = sy + (ey - sy) * 0.62;
    const tBevel = 0.0026 * taper;
    return [
      [sy, tSpine],
      [bevelY, tBevel],
      [ey, 0.00025],
      [bevelY, -tBevel],
      [sy, -tSpine]
    ];
  };
  const pos = [];
  const idx = [];
  const ring = [];
  for (const [x, sy, ey] of st) {
    const base = pos.length / 3;
    for (const [y, z] of section(sy, ey, x)) pos.push(x, y, z);
    ring.push(base);
  }
  const n = 5;
  for (let r = 0; r < ring.length - 1; r++) {
    const a = ring[r];
    const b = ring[r + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
    }
  }
  // Point: fan to the tip vertex; flat spine end-cap at the guard
  const tipI = pos.length / 3;
  pos.push(tip[0], tip[1], 0);
  const last = ring[ring.length - 1];
  for (let k = 0; k < n; k++) idx.push(last + k, tipI, last + ((k + 1) % n));
  const first = ring[0];
  idx.push(first + 0, first + 2, first + 1, first + 0, first + 3, first + 2, first + 0, first + 4, first + 3);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Flat-ish shading: split into a non-indexed mesh so the bevel reads as a crisp edge highlight
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const uv = new Float32Array(flat.attributes.position.count * 2);
  for (let i = 0; i < flat.attributes.position.count; i++) {
    uv[i * 2] = flat.attributes.position.getX(i);
    uv[i * 2 + 1] = flat.attributes.position.getY(i);
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return flat;
}

function along(geo, x, r = 0) {
  // Cylinder/torus helpers come Y-up; lay them along the weapon's X axis
  geo.rotateZ(-Math.PI / 2);
  if (r) geo.rotateX(r);
  geo.translate(x, 0, 0);
  return geo;
}

export function buildDadaoGeometry() {
  const parts = [];
  const groups = [];
  const add = (geo, mat) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
    groups.push(mat);
  };

  add(bladeGeometry(), 0);
  // Iron disc guard + brass-less iron collar
  add(along(new THREE.CylinderGeometry(0.043, 0.043, 0.007, 28), 0.054), 2);
  add(along(new THREE.CylinderGeometry(0.019, 0.017, 0.022, 14), 0.043), 2);
  // Long grip, cord-wrapped (UVs drive the wrap texture)
  add(along(new THREE.CylinderGeometry(0.0155, 0.0165, 0.27, 16, 1), -0.1), 1);
  // Pommel cap + ring for the tassel
  add(along(new THREE.CylinderGeometry(0.018, 0.0155, 0.018, 14), -0.24), 2);
  // Ring in the plane of the blade, standing off the end of the pommel
  const ring = new THREE.TorusGeometry(0.013, 0.0035, 8, 18);
  ring.translate(-0.262, 0, 0);
  add(ring, 2);

  const merged = mergeGeometries(parts, true);
  merged.groups.forEach((g, i) => {
    g.materialIndex = groups[i];
  });
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  merged.userData.shared = true;
  return merged;
}

function finalizeParts(parts, groups) {
  const clean = parts.map(geo => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const merged = mergeGeometries(clean, true);
  merged.groups.forEach((g, i) => {
    g.materialIndex = groups[i];
  });
  for (const p of clean) p.dispose();
  merged.computeBoundingSphere();
  merged.userData.shared = true;
  return merged;
}

// Helper: extruded symmetric diamond/beveled blade from 2D profile stations [x, yBot, yTop, halfThick]
function loftBlade(stations, tipX, tipY) {
  const pos = [];
  const idx = [];
  const rings = [];
  for (const [x, yb, yt, th] of stations) {
    const base = pos.length / 3;
    const midY = (yb + yt) * 0.5;
    // 4-point diamond cross-section: bottom edge -> +Z ridge -> top edge -> -Z ridge
    pos.push(x, yb, 0.0005, x, midY, th, x, yt, 0.0005, x, midY, -th);
    rings.push(base);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
    }
  }
  const tipI = pos.length / 3;
  pos.push(tipX, tipY, 0);
  const last = rings[rings.length - 1];
  for (let k = 0; k < 4; k++) idx.push(last + k, tipI, last + ((k + 1) % 4));
  const first = rings[0];
  idx.push(first, first + 2, first + 1, first, first + 3, first + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const uv = new Float32Array(flat.attributes.position.count * 2);
  for (let i = 0; i < flat.attributes.position.count; i++) {
    uv[i * 2] = flat.attributes.position.getX(i);
    uv[i * 2 + 1] = flat.attributes.position.getY(i);
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return flat;
}

// 1. 梨花红缨长枪 (Spear): long tapered polearm shaft + crimson silk tassel collar + diamond leaf blade
export function buildSpearGeometry() {
  const parts = [];
  const groups = [];
  const add = (geo, mat) => { parts.push(geo); groups.push(mat); };

  // Long pole shaft (-0.78 -> +0.96, length 1.74m)
  add(along(new THREE.CylinderGeometry(0.0155, 0.0165, 1.74, 14), 0.09), 1);
  // Grip bindings & iron rings
  add(along(new THREE.CylinderGeometry(0.0185, 0.0185, 0.14, 14), -0.34), 2);
  add(along(new THREE.CylinderGeometry(0.0185, 0.0185, 0.14, 14), 0.0), 2);
  // Rear iron butt counterweight spike
  add(along(new THREE.CylinderGeometry(0.019, 0.014, 0.08, 12), -0.80), 2);
  const buttSpike = new THREE.ConeGeometry(0.014, 0.07, 10);
  buttSpike.rotateZ(Math.PI / 2);
  buttSpike.translate(-0.875, 0, 0);
  add(buttSpike, 0);
  // Flared spearhead socket + lotus throat collar (tassel hangs here at x = 0.95)
  add(along(new THREE.CylinderGeometry(0.024, 0.017, 0.07, 14), 0.965), 2);
  add(along(new THREE.CylinderGeometry(0.032, 0.022, 0.024, 14), 0.995), 2);
  // Gleaming leaf-shaped double-edged spearhead (x: 1.00 -> 1.44)
  add(loftBlade([
    [1.00, -0.018, 0.018, 0.010],
    [1.08, -0.048, 0.048, 0.012],
    [1.18, -0.042, 0.042, 0.010],
    [1.30, -0.025, 0.025, 0.007],
    [1.38, -0.011, 0.011, 0.004]
  ], 1.445, 0), 0);

  return finalizeParts(parts, groups);
}

// 2. 玄铁宣花巨斧 (Great War Axe): heavy iron-bound haft + sweeping twin crescent steel head + spike
export function buildAxeGeometry() {
  const parts = [];
  const groups = [];
  const add = (geo, mat) => { parts.push(geo); groups.push(mat); };

  // Heavy war-axe haft (-0.46 -> +0.84, length 1.30m)
  add(along(new THREE.CylinderGeometry(0.0185, 0.0195, 1.30, 14), 0.19), 1);
  // Reinforced steel grip collars & pommel
  add(along(new THREE.CylinderGeometry(0.024, 0.021, 0.05, 14), -0.46), 2);
  add(along(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 14), -0.26), 2);
  add(along(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 14), 0.0), 2);
  // Thick forged iron axe-head socket cheeks
  const socket = new THREE.BoxGeometry(0.18, 0.08, 0.054);
  socket.translate(0.64, 0.0, 0);
  add(socket, 2);
  // Main sweeping crescent cutting blade (+Y side: massive bearded battleaxe arc!)
  add(loftBlade([
    [0.44, 0.02, 0.21, 0.011],
    [0.54, 0.025, 0.245, 0.014],
    [0.68, 0.025, 0.255, 0.014],
    [0.80, 0.02, 0.225, 0.010],
    [0.88, 0.01, 0.15, 0.006]
  ], 0.90, 0.04), 0);
  // Counter-edge back-axe / armor-piercing beak (-Y side)
  add(loftBlade([
    [0.50, -0.135, -0.02, 0.009],
    [0.64, -0.155, -0.025, 0.011],
    [0.78, -0.12, -0.02, 0.008]
  ], 0.84, -0.03), 0);
  // Top thrusting war-spike above axe socket
  const topSpike = new THREE.ConeGeometry(0.024, 0.16, 6);
  topSpike.rotateZ(-Math.PI / 2);
  topSpike.translate(0.90, 0, 0);
  add(topSpike, 0);

  return finalizeParts(parts, groups);
}

// 3. 玄铁狼牙重棒 (Spiked Wolf-Tooth War Mace / Langyabang): heavy octagonal iron head + 24 steel spikes
export function buildMaceGeometry() {
  const parts = [];
  const groups = [];
  const add = (geo, mat) => { parts.push(geo); groups.push(mat); };

  // Iron-wrapped war shaft (-0.44 -> +0.38)
  add(along(new THREE.CylinderGeometry(0.018, 0.019, 0.82, 14), -0.03), 1);
  add(along(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 16), 0.34), 2);
  add(along(new THREE.CylinderGeometry(0.024, 0.020, 0.05, 12), -0.45), 2);
  // Heavy tapered iron club barrel (+0.36 -> +0.92)
  add(along(new THREE.CylinderGeometry(0.062, 0.028, 0.56, 10), 0.64), 2);
  add(along(new THREE.CylinderGeometry(0.036, 0.062, 0.06, 10), 0.93), 2);
  // 24 gleaming steel wolf-tooth spikes projecting radially from the club barrel
  for (let r = 0; r < 4; r++) {
    const sx = 0.45 + r * 0.135;
    const rad = 0.032 + r * 0.010;
    const spkLen = 0.055 + r * 0.008;
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + (r % 2) * (Math.PI / 6);
      const spk = new THREE.ConeGeometry(0.0125, spkLen, 6);
      spk.translate(0, rad + spkLen * 0.42, 0);
      spk.rotateX(ang);
      spk.translate(sx, 0, 0);
      add(spk, 0);
    }
  }
  // Crowning top iron spike
  const crown = new THREE.ConeGeometry(0.022, 0.10, 8);
  crown.rotateZ(-Math.PI / 2);
  crown.translate(0.99, 0, 0);
  add(crown, 0);

  return finalizeParts(parts, groups);
}

// 4. 青龙偃月重关刀 (Boss Guandao Polearm): towering crescent moon heavy blade + dragon collar + butt spike
export function buildGuandaoGeometry() {
  const parts = [];
  const groups = [];
  const add = (geo, mat) => { parts.push(geo); groups.push(mat); };

  // Heavy bronze-ferruled polearm shaft (-0.78 -> +0.58, length 1.36m)
  add(along(new THREE.CylinderGeometry(0.0195, 0.0205, 1.36, 16), -0.10), 1);
  // Grip ferrules & decorative bands
  for (const gx of [-0.62, -0.35, 0.0, 0.34]) {
    add(along(new THREE.CylinderGeometry(0.023, 0.023, 0.038, 14), gx), 2);
  }
  // Weighted iron butt-lance spike counterweight (-0.78 -> -0.92)
  add(along(new THREE.CylinderGeometry(0.025, 0.017, 0.07, 14), -0.80), 2);
  const tailSpike = new THREE.ConeGeometry(0.017, 0.10, 8);
  tailSpike.rotateZ(Math.PI / 2);
  tailSpike.translate(-0.88, 0, 0);
  add(tailSpike, 0);
  // Ornate dragon-head throat guard + twin wing lugs (tassel hangs here at x = 0.56)
  add(along(new THREE.CylinderGeometry(0.036, 0.024, 0.09, 16), 0.565), 2);
  const lug = new THREE.BoxGeometry(0.07, 0.145, 0.042);
  lug.translate(0.60, 0.02, 0);
  add(lug, 2);
  // Colossal sweeping crescent-moon heavy blade (x: 0.61 -> 1.38) with hooked dorsal barb!
  add(loftBlade([
    [0.61, -0.032, 0.075, 0.012],
    [0.74, -0.038, 0.125, 0.014],
    [0.92, -0.056, 0.168, 0.015], // dorsal spine cloud-hook flare + wide belly
    [1.08, -0.035, 0.178, 0.013],
    [1.22, -0.028, 0.145, 0.010],
    [1.32, -0.024, 0.078, 0.006]
  ], 1.39, -0.018), 0);
  // Sculpted dorsal spine hook (云钩) on the back edge
  add(loftBlade([
    [0.86, -0.095, -0.036, 0.009],
    [0.95, -0.115, -0.048, 0.008],
    [1.02, -0.068, -0.036, 0.006]
  ], 0.82, -0.105), 0);

  return finalizeParts(parts, groups);
}

export function buildColdWeaponGeometry(kind = 'dadao') {
  if (kind === 'spear') return buildSpearGeometry();
  if (kind === 'axe') return buildAxeGeometry();
  if (kind === 'mace') return buildMaceGeometry();
  if (kind === 'guandao') return buildGuandaoGeometry();
  return buildDadaoGeometry();
}

function gripWrapTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#1b1410';
  x.fillRect(0, 0, 64, 256);
  // Diamond cord wrap over a darker under-binding
  for (let y = -32; y < 288; y += 16) {
    for (const dir of [1, -1]) {
      x.strokeStyle = '#3b2a1e';
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(64, y + dir * 16);
      x.stroke();
      x.strokeStyle = 'rgba(120,88,60,0.45)';
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(0, y - 1.5);
      x.lineTo(64, y - 1.5 + dir * 16);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Blade steel with a blood layer: uBlood (0..1) fills from the edge and point toward the spine,
// wet and darker than the polished steel, broken up by drip streaks
export function createBladeMaterials(timeUniform) {
  const blood = { value: 0 };
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb9c0c8,
    metalness: 0.92,
    roughness: 0.2,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide
  });
  steel.onBeforeCompile = shader => {
    shader.uniforms.uBlood = blood;
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBladeP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBladeP = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBlood;
        varying vec3 vBladeP;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float along = clamp((vBladeP.x - 0.06) / 0.7, 0.0, 1.0);
        float edgeSide = smoothstep(-0.018, 0.03, vBladeP.y);
        float streak = bHash(vec2(floor(vBladeP.x * 160.0), 3.0));
        float coverage = uBlood * (0.35 + 0.65 * along) * 1.6;
        float bloodMask = smoothstep(0.0, 0.25, coverage * edgeSide + (streak - 0.6) * 0.5 * uBlood);
        // Polished edge bevel reads brighter than the forge-dark spine
        float bevel = smoothstep(0.55, 0.85, (vBladeP.y + 0.024) / 0.068);
        diffuseColor.rgb *= mix(0.62, 1.12, bevel);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.012, 0.008), bloodMask);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, bloodMask);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.15, bloodMask);`);
  };
  steel.customProgramCacheKey = () => 'dadao-steel';
  const wrap = new THREE.MeshStandardMaterial({ map: gripWrapTexture(), roughness: 0.92, metalness: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.55, metalness: 0.8 });
  for (const m of [steel, wrap, iron]) m.userData.shared = true;
  return { materials: [steel, wrap, iron], blood };
}

// Red silk tassel: two ribbons hanging from the pommel ring. Built along -Y from the origin so the
// pivot can simply be pointed along the (simulated) hang direction.
export function buildTasselGeometry() {
  const parts = [];
  for (const [w, len, off] of [[0.026, 0.3, 0.004], [0.022, 0.24, -0.004]]) {
    const g = new THREE.PlaneGeometry(w, len, 1, 8);
    g.translate(0, -len / 2, off);
    const p = g.attributes.position;
    // Gather at the knot, flare at the ends
    for (let i = 0; i < p.count; i++) {
      const y = -p.getY(i) / len;
      p.setX(i, p.getX(i) * (0.35 + 0.65 * y));
    }
    parts.push(g);
  }
  const knot = new THREE.SphereGeometry(0.009, 8, 6);
  knot.deleteAttribute('uv');
  knot.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(knot.attributes.position.count * 2), 2));
  const merged = mergeGeometries([...parts.map(p => p.toNonIndexed()), knot.toNonIndexed()], false);
  merged.computeVertexNormals();
  return merged;
}

export function createTasselMaterial(timeUniform) {
  const m = new THREE.MeshStandardMaterial({ color: 0x9e1610, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hang = clamp(-position.y / 0.3, 0.0, 1.0);
        transformed.z += sin(uTime * 9.0 + position.y * 26.0 + position.x * 40.0) * 0.012 * hang * hang;
        transformed.x += sin(uTime * 6.3 + position.y * 18.0) * 0.006 * hang;`);
  };
  m.customProgramCacheKey = () => 'dadao-tassel';
  m.userData.shared = true;
  return m;
}
