import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function partSpec(geo, color, pos, scale = [1, 1, 1], rot = [0, 0, 0]) {
  _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  _q.setFromEuler(_e);
  _p.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
  _s.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
  return { geo, color, matrix: new THREE.Matrix4().compose(_p, _q, _s) };
}

export function buildColoredGeometry(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  let offset = 0;

  for (const { geo, color, matrix } of parts) {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    // Three r187 ColorManagement automatically converts CSS hex to linear RGB
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (g.index) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + offset);
    } else {
      for (let i = 0; i < p.count; i++) idx.push(i + offset);
    }
    offset += p.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.userData.shared = true;
  return out;
}

export function buildMultiMatGeometry(entries) {
  // entries: [{ geo, pos, rot, scale, matIndex }]
  const geos = [];
  const matIndices = [];
  for (const e of entries) {
    const g = e.geo.clone();
    _e.set(e.rot?.[0] || 0, e.rot?.[1] || 0, e.rot?.[2] || 0);
    _q.setFromEuler(_e);
    _p.set(e.pos?.[0] || 0, e.pos?.[1] || 0, e.pos?.[2] || 0);
    _s.set(e.scale?.[0] ?? 1, e.scale?.[1] ?? 1, e.scale?.[2] ?? 1);
    _m4.compose(_p, _q, _s);
    g.applyMatrix4(_m4);
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (g.index) {
      const nonIdx = g.toNonIndexed();
      g.dispose();
      geos.push(nonIdx);
    } else {
      geos.push(g);
    }
    matIndices.push(e.matIndex ?? 0);
  }

  const merged = mergeGeometries(geos, true);
  // Group consecutive primitives sharing the same matIndex or rewrite group materialIndex
  if (merged && merged.groups) {
    merged.groups.forEach((grp, i) => {
      grp.materialIndex = matIndices[i];
    });
  }
  geos.forEach(g => g.dispose());
  merged.userData.shared = true;
  return merged;
}
