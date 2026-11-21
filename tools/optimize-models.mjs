// Offline asset pass: simplifies the heavy prop meshes with meshoptimizer and repacks every
// glTF-JSON model (base64 buffers) as a binary .glb next to it.
//
//   npm i --no-save meshoptimizer          # or MESHOPT_MODULE=/abs/path/to/meshoptimizer/index.js
//   node tools/optimize-models.mjs         # writes public/assets/**/<name>.glb
//   node tools/optimize-models.mjs --dry   # only prints triangle counts / errors per ratio
//
// The original .json sources live in git history (before the .glb switch) if a re-run is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modSpec = process.env.MESHOPT_MODULE ? pathToFileURL(process.env.MESHOPT_MODULE).href : 'meshoptimizer';
const { MeshoptSimplifier } = await import(modSpec);
await MeshoptSimplifier.ready;

const DRY = process.argv.includes('--dry');

// ratio = target fraction of triangles kept; maxError = relative to mesh extent (0.004 = 0.4%)
const JOBS = [
  { src: 'public/assets/models/crate.json', simplify: { ratio: 0.3, maxError: 0.0052, minTris: 400 } },
  { src: 'public/assets/models/barrel.json', simplify: { ratio: 0.45, maxError: 0.0095, minTris: 400 } },
  { src: 'public/assets/models/lamp.json', simplify: { ratio: 0.1, maxError: 0.0026, minTris: 400 } },
  { src: 'public/assets/chars/man.json' },
  { src: 'public/assets/chars/soldier.json' }
];

const COMP = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array
};
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function decodeBuffers(gltf, dir) {
  return gltf.buffers.map(b => {
    if (b.uri?.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    return fs.readFileSync(path.join(dir, b.uri));
  });
}

function readAccessor(gltf, bins, ai) {
  const acc = gltf.accessors[ai];
  if (acc.sparse) throw new Error(`sparse accessor ${ai} not supported`);
  const T = COMP[acc.componentType];
  const n = NUM[acc.type];
  const out = new T(acc.count * n);
  if (acc.bufferView === undefined) return out;
  const bv = gltf.bufferViews[acc.bufferView];
  const bin = bins[bv.buffer];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const elem = T.BYTES_PER_ELEMENT * n;
  const stride = bv.byteStride || elem;
  for (let i = 0; i < acc.count; i++) {
    const src = new T(bin.buffer.slice(bin.byteOffset + base + i * stride, bin.byteOffset + base + i * stride + elem));
    out.set(src, i * n);
  }
  return out;
}

function simplifyPrimitive(gltf, bins, prim, opts, label) {
  const posA = readAccessor(gltf, bins, prim.attributes.POSITION);
  const nrmA = prim.attributes.NORMAL !== undefined ? readAccessor(gltf, bins, prim.attributes.NORMAL) : null;
  const uvA = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(gltf, bins, prim.attributes.TEXCOORD_0) : null;
  const idx = Uint32Array.from(readAccessor(gltf, bins, prim.indices));
  const vCount = posA.length / 3;
  const tris = idx.length / 3;
  if (tris < opts.minTris) return null;

  // Normals + UVs drive the attribute-aware metric so seams and shading stay intact
  const aStride = (nrmA ? 3 : 0) + (uvA ? 2 : 0);
  const attrs = new Float32Array(vCount * Math.max(1, aStride));
  const weights = [];
  if (nrmA) weights.push(0.5, 0.5, 0.5);
  if (uvA) weights.push(1, 1);
  for (let v = 0; v < vCount; v++) {
    let o = v * aStride;
    if (nrmA) { attrs[o++] = nrmA[v * 3]; attrs[o++] = nrmA[v * 3 + 1]; attrs[o++] = nrmA[v * 3 + 2]; }
    if (uvA) { attrs[o++] = uvA[v * 2]; attrs[o++] = uvA[v * 2 + 1]; }
  }
  const scale = MeshoptSimplifier.getScale(posA, 3);

  const run = (ratio, maxError) => {
    const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
    return aStride
      ? MeshoptSimplifier.simplifyWithAttributes(idx, posA, 3, attrs, aStride, weights, null, target, maxError, [])
      : MeshoptSimplifier.simplify(idx, posA, 3, target, maxError, []);
  };

  if (DRY) {
    for (const r of [0.5, 0.35, 0.25, 0.18, 0.12, 0.08]) {
      const [res, err] = run(r, 1);
      console.log(`  ${label}: ratio ${r} -> ${res.length / 3} tris, err ${(err * scale * 1000).toFixed(2)}mm (${(err * 100).toFixed(3)}%)`);
    }
  }
  const [res, err] = run(opts.ratio, opts.maxError);
  console.log(`  ${label}: ${tris} -> ${res.length / 3} tris (err ${(err * scale * 1000).toFixed(2)}mm, extent ${scale.toFixed(2)})`);
  return { indices: res, posA, attributes: prim.attributes };
}

// Rebuilds accessors/bufferViews into one tightly packed binary chunk, compacting simplified primitives
function repack(gltf, bins, replaced) {
  const chunks = [];
  let offset = 0;
  const views = [];
  const accessors = [];
  const push = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    offset += buf.length;
    return views.length - 1;
  };
  const addAccessor = (src, typed, target, extra = {}) => {
    const acc = { ...src, ...extra };
    delete acc.byteOffset;
    acc.bufferView = push(typed, target);
    accessors.push(acc);
    return accessors.length - 1;
  };

  const vertexAccessors = new Set();
  const indexAccessors = new Set();
  for (const m of gltf.meshes) {
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes)) vertexAccessors.add(a);
      if (p.indices !== undefined) indexAccessors.add(p.indices);
    }
  }

  // Untouched accessors keep their data (re-packed); simplified primitives get fresh compacted ones
  const remapAcc = new Map();
  gltf.accessors.forEach((acc, ai) => {
    const target = vertexAccessors.has(ai) ? 34962 : indexAccessors.has(ai) ? 34963 : undefined;
    remapAcc.set(ai, addAccessor(acc, readAccessor(gltf, bins, ai), target));
  });

  for (const m of gltf.meshes) {
    for (const p of m.primitives) {
      const r = replaced.get(p);
      if (!r) {
        for (const k in p.attributes) p.attributes[k] = remapAcc.get(p.attributes[k]);
        if (p.indices !== undefined) p.indices = remapAcc.get(p.indices);
        continue;
      }
      const remap = new Int32Array(r.posA.length / 3).fill(-1);
      let nv = 0;
      for (const i of r.indices) if (remap[i] < 0) remap[i] = nv++;
      const newIdx = nv < 65536 ? new Uint16Array(r.indices.length) : new Uint32Array(r.indices.length);
      r.indices.forEach((v, i) => { newIdx[i] = remap[v]; });

      for (const k in p.attributes) {
        const ai = p.attributes[k];
        const src = gltf.accessors[ai];
        const data = readAccessor(gltf, bins, ai);
        const n = NUM[src.type];
        const out = new data.constructor(nv * n);
        for (let v = 0; v < remap.length; v++) {
          if (remap[v] >= 0) out.set(data.subarray(v * n, v * n + n), remap[v] * n);
        }
        const extra = { count: nv };
        if (k === 'POSITION') {
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (let v = 0; v < nv; v++) {
            for (let c = 0; c < 3; c++) {
              min[c] = Math.min(min[c], out[v * 3 + c]);
              max[c] = Math.max(max[c], out[v * 3 + c]);
            }
          }
          Object.assign(extra, { min, max });
        }
        p.attributes[k] = addAccessor(src, out, 34962, extra);
      }
      const isrc = gltf.accessors[p.indices];
      p.indices = addAccessor(isrc, newIdx, 34963, {
        count: newIdx.length,
        componentType: nv < 65536 ? 5123 : 5125,
        min: undefined,
        max: undefined
      });
    }
  }

  // Remap the remaining accessor references (skins, animations)
  for (const s of gltf.skins || []) {
    if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = remapAcc.get(s.inverseBindMatrices);
  }
  for (const a of gltf.animations || []) {
    for (const smp of a.samplers) {
      smp.input = remapAcc.get(smp.input);
      smp.output = remapAcc.get(smp.output);
    }
  }

  // Drop accessors no longer referenced (originals of simplified primitives)
  const used = new Set();
  for (const m of gltf.meshes) for (const p of m.primitives) {
    Object.values(p.attributes).forEach(a => used.add(a));
    if (p.indices !== undefined) used.add(p.indices);
  }
  for (const s of gltf.skins || []) if (s.inverseBindMatrices !== undefined) used.add(s.inverseBindMatrices);
  for (const a of gltf.animations || []) for (const smp of a.samplers) { used.add(smp.input); used.add(smp.output); }

  const finalAcc = [];
  const finalViews = [];
  const finalChunks = [];
  let fo = 0;
  const accMap = new Map();
  accessors.forEach((acc, ai) => {
    if (!used.has(ai)) return;
    const bv = views[acc.bufferView];
    const src = Buffer.concat(chunks).subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
    const pad = (4 - (fo % 4)) % 4;
    if (pad) { finalChunks.push(Buffer.alloc(pad)); fo += pad; }
    finalViews.push({ buffer: 0, byteOffset: fo, byteLength: bv.byteLength, ...(bv.target ? { target: bv.target } : {}) });
    finalChunks.push(src);
    fo += bv.byteLength;
    const clean = { ...acc, bufferView: finalViews.length - 1 };
    if (clean.min === undefined) delete clean.min;
    if (clean.max === undefined) delete clean.max;
    finalAcc.push(clean);
    accMap.set(ai, finalAcc.length - 1);
  });
  for (const m of gltf.meshes) for (const p of m.primitives) {
    for (const k in p.attributes) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices !== undefined) p.indices = accMap.get(p.indices);
  }
  for (const s of gltf.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
  for (const a of gltf.animations || []) for (const smp of a.samplers) {
    smp.input = accMap.get(smp.input);
    smp.output = accMap.get(smp.output);
  }

  const bin = Buffer.concat(finalChunks);
  gltf.accessors = finalAcc;
  gltf.bufferViews = finalViews;
  gltf.buffers = [{ byteLength: bin.length }];
  return bin;
}

function writeGlb(file, gltf, bin) {
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
  const jsonLen = json.length + jsonPad.length;
  const binLen = bin.length + binPad.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonLen + 8 + binLen, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonLen, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binLen, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, json, jsonPad, bh, bin, binPad]));
}

for (const job of JOBS) {
  const src = path.join(ROOT, job.src);
  const gltf = JSON.parse(fs.readFileSync(src, 'utf8'));
  const bins = decodeBuffers(gltf, path.dirname(src));
  console.log(job.src);
  const replaced = new Map();
  if (job.simplify) {
    for (const m of gltf.meshes) {
      m.primitives.forEach((p, pi) => {
        const r = simplifyPrimitive(gltf, bins, p, job.simplify, `${m.name}#${pi}`);
        if (r) replaced.set(p, r);
      });
    }
  }
  if (DRY) continue;
  const bin = repack(gltf, bins, replaced);
  const out = src.replace(/\.json$/, '.glb');
  writeGlb(out, gltf, bin);
  console.log(`  -> ${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB (was ${(fs.statSync(src).size / 1024).toFixed(0)} KB)`);
}
