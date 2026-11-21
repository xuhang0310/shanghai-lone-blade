import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

const hasCustomShader = m => Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') || m.isShaderMaterial;

function isFrozen(o, root, exclude) {
  for (let p = o; p && p !== root; p = p.parent) {
    if (!p.visible || p.userData.dynamic || exclude.has(p)) return true;
  }
  return false;
}

function layoutKey(geo) {
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) return null;
  const parts = [];
  for (const k of Object.keys(geo.attributes).sort()) {
    const a = geo.attributes[k];
    if (a.isInterleavedBufferAttribute) return null;
    parts.push(`${k}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return parts.join(',');
}

// Extracts triangles [start, start + count) of a mesh into a compact world-space geometry
function bakePiece(mesh, start, count, rootInv) {
  const geo = mesh.geometry;
  const m = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
  _nm.getNormalMatrix(m);
  const flip = m.determinant() < 0;
  const total = geo.index ? geo.index.count : geo.attributes.position.count;
  const end = Math.min(total, start + count);
  const src = geo.index ? geo.index.array : null;

  const remap = new Map();
  const order = [];
  const idx = new Uint32Array(end - start);
  for (let i = start; i < end; i++) {
    const v = src ? src[i] : i;
    let nv = remap.get(v);
    if (nv === undefined) {
      nv = order.length;
      remap.set(v, nv);
      order.push(v);
    }
    idx[i - start] = nv;
  }
  if (flip) {
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }

  const out = new THREE.BufferGeometry();
  for (const k in geo.attributes) {
    const a = geo.attributes[k];
    const arr = new a.array.constructor(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) {
      for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.array[order[i] * a.itemSize + c];
    }
    if (k === 'position') {
      for (let i = 0; i < order.length; i++) {
        _v.fromArray(arr, i * 3).applyMatrix4(m).toArray(arr, i * 3);
      }
    } else if (k === 'normal') {
      for (let i = 0; i < order.length; i++) {
        _n.fromArray(arr, i * 3).applyMatrix3(_nm).normalize().toArray(arr, i * 3);
      }
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Bakes static opaque meshes (and static line wires) under `root` into one merged mesh per
// (material, shadow flags, vertex layout, spatial chunk). Objects with userData.dynamic (or inside
// such a group) and anything in `exclude` are left alone.
export function batchStatic(root, { chunkSize = 48, exclude = new Set() } = {}) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pieces = [];
  const meshPieces = new Map();
  const lines = [];

  root.traverse(o => {
    if (isFrozen(o, root, exclude)) return;
    if (o.isLine && !o.isLineSegments && o.material && !o.material.transparent) {
      lines.push(o);
      return;
    }
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const geo = o.geometry;
    const layout = layoutKey(geo);
    if (!layout) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(m => !m || m.transparent || !m.depthWrite || hasCustomShader(m) || m.userData.noBatch)) return;

    const ranges = Array.isArray(o.material)
      ? geo.groups.map(g => ({ start: g.start, count: g.count, material: o.material[g.materialIndex] }))
      : [{ start: 0, count: Infinity, material: o.material }];
    const list = [];
    for (const r of ranges) {
      if (!r.material) continue;
      list.push({ mesh: o, ...r, layout });
    }
    if (list.length) meshPieces.set(o, list);
  });

  // Chunk + key every piece; a mesh is only batched when each of its pieces has company
  const counts = new Map();
  for (const [mesh, list] of meshPieces) {
    for (const p of list) {
      p.geo = bakePiece(mesh, p.start, p.count, rootInv);
      p.geo.computeBoundingBox();
      p.geo.boundingBox.getCenter(_v);
      const cx = Math.floor(_v.x / chunkSize);
      const cz = Math.floor(_v.z / chunkSize);
      p.key = `${p.material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${p.layout}|${cx},${cz}`;
      counts.set(p.key, (counts.get(p.key) || 0) + 1);
    }
  }

  const buckets = new Map();
  let removed = 0;
  for (const [mesh, list] of meshPieces) {
    if (!list.every(p => counts.get(p.key) > 1)) {
      for (const p of list) p.geo.dispose();
      continue;
    }
    for (const p of list) {
      let b = buckets.get(p.key);
      if (!b) buckets.set(p.key, (b = { material: p.material, cast: mesh.castShadow, receive: mesh.receiveShadow, geos: [] }));
      b.geos.push(p.geo);
    }
    mesh.removeFromParent();
    removed++;
  }

  let created = 0;
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, b.material);
    m.name = 'static-batch';
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    m.matrixAutoUpdate = false;
    root.add(m);
    created++;
  }

  // Static polyline wires -> one LineSegments per material & chunk
  const lineBuckets = new Map();
  for (const l of lines) {
    const pos = l.geometry.attributes.position;
    if (!pos || pos.count < 2) continue;
    const m = new THREE.Matrix4().multiplyMatrices(rootInv, l.matrixWorld);
    _v.fromBufferAttribute(pos, 0).applyMatrix4(m);
    const key = `${l.material.uuid}|${Math.floor(_v.x / chunkSize)},${Math.floor(_v.z / chunkSize)}`;
    let b = lineBuckets.get(key);
    if (!b) lineBuckets.set(key, (b = { material: l.material, pts: [] }));
    for (let i = 0; i < pos.count - 1; i++) {
      b.pts.push(_v.fromBufferAttribute(pos, i).applyMatrix4(m).clone(), _v.fromBufferAttribute(pos, i + 1).applyMatrix4(m).clone());
    }
    l.removeFromParent();
    l.geometry.dispose();
  }
  for (const b of lineBuckets.values()) {
    const seg = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(b.pts), b.material);
    seg.name = 'static-wires';
    seg.matrixAutoUpdate = false;
    root.add(seg);
  }

  return { removed, created, lines: lines.length, lineBatches: lineBuckets.size };
}

// Drops groups left without renderable descendants after batching (cheaper scene traversals)
export function pruneEmptyGroups(root) {
  const walk = o => {
    for (let i = o.children.length - 1; i >= 0; i--) walk(o.children[i]);
    if (o !== root && o.type === 'Group' && o.children.length === 0 && !o.userData.dynamic) o.removeFromParent();
  };
  walk(root);
}
