import * as THREE from 'three';

const _m = new THREE.Matrix4();

// Spatially chunked InstancedMesh batches: one draw call per (template mesh part, chunk) instead of one
// per prop, while the chunks keep frustum culling effective in the camera, shadow and reflection passes.
// Usage: add()/addDynamic() while building the level, finalize() once, then remove()/sync() at runtime.
export class PropInstancer {
  constructor(parent, chunkSize = 48) {
    this.parent = parent;
    this.chunkSize = chunkSize;
    this.batches = new Map();
    this.dynamic = [];
    this._parts = new WeakMap();
  }

  _partsOf(template) {
    let parts = this._parts.get(template);
    if (parts) return parts;
    template.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    parts = [];
    template.traverse(o => {
      if (!o.isMesh) return;
      parts.push({
        id: o.uuid,
        name: o.name,
        geometry: o.geometry,
        material: o.material,
        castShadow: o.castShadow,
        receiveShadow: o.receiveShadow,
        rel: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
      });
    });
    this._parts.set(template, parts);
    return parts;
  }

  _add(template, matrix, dynamic) {
    const handle = { slots: [], alive: true, proxy: null };
    const cx = Math.floor(matrix.elements[12] / this.chunkSize);
    const cz = Math.floor(matrix.elements[14] / this.chunkSize);
    for (const part of this._partsOf(template)) {
      const key = `${part.id}|${cx}|${cz}|${dynamic ? 'd' : 's'}`;
      let batch = this.batches.get(key);
      if (!batch) {
        batch = { part, items: [], mesh: null, dynamic, dirty: false };
        this.batches.set(key, batch);
      }
      const item = { matrix: new THREE.Matrix4().multiplyMatrices(matrix, part.rel), index: -1 };
      batch.items.push(item);
      handle.slots.push({ batch, item, rel: part.rel });
    }
    return handle;
  }

  add(template, matrix) {
    return this._add(template, matrix, false);
  }

  // Instances that follow a physics-driven proxy Object3D (position/quaternion/scale) via sync()
  addDynamic(template, proxy) {
    proxy.updateMatrix();
    const handle = this._add(template, proxy.matrix, true);
    handle.proxy = proxy;
    this.dynamic.push(handle);
    return handle;
  }

  finalize() {
    for (const batch of this.batches.values()) {
      const { part, items } = batch;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
      mesh.name = `inst:${part.name}`;
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = part.receiveShadow;
      if (batch.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      items.forEach((it, i) => {
        it.index = i;
        mesh.setMatrixAt(i, it.matrix);
      });
      mesh.computeBoundingSphere();
      batch.mesh = mesh;
      this.parent.add(mesh);
    }
  }

  remove(handle) {
    if (!handle?.alive) return;
    handle.alive = false;
    for (const { batch, item } of handle.slots) {
      const items = batch.items;
      const last = items[items.length - 1];
      if (last !== item) {
        items[item.index] = last;
        last.index = item.index;
        batch.mesh.setMatrixAt(last.index, last.matrix);
      }
      items.pop();
      batch.mesh.count = items.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
    if (handle.proxy) this.dynamic.splice(this.dynamic.indexOf(handle), 1);
  }

  // Copies moved proxies into their instance slots; sleeping bodies cost one matrix compare
  sync() {
    for (const h of this.dynamic) {
      h.proxy.updateMatrix();
      for (const s of h.slots) {
        _m.multiplyMatrices(h.proxy.matrix, s.rel);
        if (_m.equals(s.item.matrix)) continue;
        s.item.matrix.copy(_m);
        s.batch.mesh.setMatrixAt(s.item.index, _m);
        s.batch.dirty = true;
      }
    }
    for (const h of this.dynamic) {
      for (const s of h.slots) {
        const b = s.batch;
        if (!b.dirty) continue;
        b.dirty = false;
        b.mesh.instanceMatrix.needsUpdate = true;
        b.mesh.computeBoundingSphere();
      }
    }
  }

  get drawCalls() {
    return this.batches.size;
  }
}
