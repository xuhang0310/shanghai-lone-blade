import * as THREE from 'three';

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function makeBillboardMaterial(src) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: src.map } }]),
    vertexShader: `
      attribute float aOpacity;
      varying vec2 vUv;
      varying vec4 vTint;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vTint = vec4(instanceColor, aOpacity);
        vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        mvPosition.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec4 vTint;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec4 texel = texture2D(map, vUv);
        gl_FragColor = vec4(vTint.rgb * texel.rgb, vTint.a * texel.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthTest: src.depthTest,
    depthWrite: src.depthWrite,
    blending: src.blending,
    fog: src.fog,
    toneMapped: src.toneMapped
  });
}

// Turns the level's glow/steam Sprites into camera-facing instanced quads: one draw call per
// (texture, blend mode, chunk) instead of one per sprite. Sprites stay alive as detached proxies, so
// game code that moves them (steam drift, swinging lantern glows) keeps working; sync() mirrors them.
export class SpriteBatcher {
  constructor(root, chunkSize = 48) {
    this.root = root;
    this.chunkSize = chunkSize;
    this.batches = [];
  }

  build() {
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const sprites = [];
    this.root.traverse(o => {
      const m = o.material;
      if (!o.isSprite || !m?.map || m.rotation !== 0 || !m.sizeAttenuation) return;
      if (o.center.x !== 0.5 || o.center.y !== 0.5) return;
      sprites.push(o);
    });

    const groups = new Map();
    for (const sp of sprites) {
      const m = sp.material;
      const parent = new THREE.Matrix4().multiplyMatrices(rootInv, sp.parent.matrixWorld);
      _p.copy(sp.position).applyMatrix4(parent);
      const key = [m.map.uuid, m.blending, m.depthTest, m.depthWrite, m.fog, m.toneMapped,
        Math.floor(_p.x / this.chunkSize), Math.floor(_p.z / this.chunkSize)].join('|');
      if (!groups.has(key)) groups.set(key, { src: m, items: [] });
      groups.get(key).items.push({ sprite: sp, parent, last: new Float32Array(9).fill(NaN) });
    }

    const materials = new Map();
    for (const { src, items } of groups.values()) {
      const mk = [src.map.uuid, src.blending, src.depthTest, src.depthWrite, src.fog, src.toneMapped].join('|');
      if (!materials.has(mk)) {
        const mat = makeBillboardMaterial(src);
        mat.userData.own = true; // freed with the level (disposeHierarchy)
        materials.set(mk, mat);
      }
      // Own geometry per batch so the instanced opacity attribute is freed with the level
      const geo = new THREE.PlaneGeometry(1, 1);
      const opacity = new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1);
      opacity.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOpacity', opacity);
      const mesh = new THREE.InstancedMesh(geo, materials.get(mk), items.length);
      mesh.name = 'sprite-batch';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.set(1, 1, 1));
      for (const it of items) it.sprite.removeFromParent();
      const batch = { mesh, items, opacity };
      this._write(batch, true);
      this.root.add(mesh);
      this.batches.push(batch);
    }
    return sprites.length;
  }

  _write(batch, force) {
    let dirty = false;
    batch.items.forEach((it, i) => {
      const sp = it.sprite;
      const m = sp.material;
      const on = sp.visible && m.visible ? 1 : 0;
      _p.copy(sp.position).applyMatrix4(it.parent);
      const v = it.last;
      if (!force && v[0] === _p.x && v[1] === _p.y && v[2] === _p.z && v[3] === sp.scale.x * on && v[4] === sp.scale.y * on &&
        v[5] === m.opacity && v[6] === m.color.r && v[7] === m.color.g && v[8] === m.color.b) return;
      v[0] = _p.x; v[1] = _p.y; v[2] = _p.z; v[3] = sp.scale.x * on; v[4] = sp.scale.y * on;
      v[5] = m.opacity; v[6] = m.color.r; v[7] = m.color.g; v[8] = m.color.b;
      _s.set(Math.max(1e-5, v[3]), Math.max(1e-5, v[4]), 1);
      batch.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      batch.mesh.setColorAt(i, m.color);
      batch.opacity.setX(i, on ? m.opacity : 0);
      dirty = true;
    });
    if (!dirty) return;
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.mesh.instanceColor.needsUpdate = true;
    batch.opacity.needsUpdate = true;
    batch.mesh.computeBoundingSphere();
  }

  sync() {
    for (const b of this.batches) this._write(b, false);
  }
}
