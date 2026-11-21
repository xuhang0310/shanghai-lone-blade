import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'three/addons/libs/fflate.module.js';
import { driveTurn, motionVariant } from '../src/systems/Motion.js';
import { AssetManager } from '../src/core/AssetManager.js';

test('the official catalog retains a distinct preview for every entry, including same-name variants', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../public/assets/chars/mixamo-catalog.json', import.meta.url)));
  const previews = catalog.items.flatMap(row => {
    assert.equal(row.previews.length, row.variants || 1);
    for (const path of row.previews) assert.match(new URL(path, catalog.previewBase).protocol, /^https:$/);
    return row.previews;
  });
  assert.equal(new Set(previews).size, catalog.entries);
  assert.equal(catalog.items.filter(row => row.pack).length, catalog.packs);
});

test('preview-only clips retry failed loads, share concurrent requests, and leave gameplay clips alone', async t => {
  const assets = new AssetManager();
  assets.mixamoAnims.wave = { n: 2, file: 'motions/test.json' };
  const tracks = { hips: [0, 0, 0, 0, 0, 0], q: { Hips: [0, 0, 0, 1, 0, 0, 0, 1] } };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: ++calls > 1, json: async () => ({ man: tracks, soldier: tracks }) }));
  await assert.rejects(assets.loadMotion('wave'));
  const [a, b] = await Promise.all([assets.loadMotion('wave'), assets.loadMotion('wave')]);
  assert.equal(a, b);
  assert.equal(await assets.loadMotion('wave'), a);
  assert.equal(calls, 2);
  assert.equal(a.man.name, 'wave');
  assert.equal(a.soldier.tracks.length, 2);
  assert.equal(assets.manClips.wave, undefined);
});

test('turns accumulate across the angle seam, select a matching stance, and yield to reactions', () => {
  const m = { userData: { clips: {
    TurnRight: { userData: { family: 'TurnRight', stance: 'crouch' } },
    TurnRight2: { userData: { family: 'TurnRight', stance: 'standing' } }
  } } };
  let played = null;
  const cf = {
    playClip(mesh, key, opts) { played = key; mesh.userData.ov = { key, ...opts }; return true; },
    stopClip(mesh) { mesh.userData.ov.stopping = true; }
  };
  const turn = (angle, stance) => driveTurn(cf, m, angle, stance, 1 / 60);
  turn(3, 'standing');
  turn(-3.1, 'standing');
  assert.equal(played, null);
  turn(-2.65, 'standing');
  assert.equal(played, 'TurnRight2');
  turn(-2.45, null);
  assert.ok(m.userData.ov.stopping);
  turn(0, 'crouch');
  turn(0.7, 'crouch');
  assert.equal(played, 'TurnRight');
  m.userData.ov = { key: 'HitHead', loop: false };
  turn(1.6, 'crouch');
  assert.equal(m.userData.ov.key, 'HitHead');
  assert.equal(motionVariant(m.userData.clips, 'TurnRight', 'TurnRight'), 'TurnRight2');
  assert.equal(motionVariant({}, 'HitHead'), null);
});

test('a nested ZIP imports every take, merges copies, and a broken input preserves the last library', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsg-motion-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input');
  fs.mkdirSync(path.join(input, 'pack'), { recursive: true });
  const base = fs.readFileSync(new URL('../public/assets/chars/man.glb', import.meta.url));
  const source = JSON.parse(base.toString('utf8', 20, 20 + base.readUInt32LE(12)));
  const nodes = source.nodes.map(({ name, children, matrix, translation, rotation, scale }) =>
    ({ name, children, matrix, translation, rotation, scale }));
  const frames = Buffer.from(new Float32Array([0, 1, 0, 0, 0, 1, 0, 0.6, 0, 0.8]).buffer);
  const animations = [['Head Hit', 'Head'], ['Wave Hello', 'RightArm']].map(([name, joint]) => ({
    name, samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: nodes.findIndex(n => n.name?.endsWith(joint)), path: 'rotation' } }]
  }));
  const gltf = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scenes: source.scenes, scene: source.scene, nodes, animations,
    buffers: [{ byteLength: frames.length, uri: 'data:application/octet-stream;base64,' + frames.toString('base64') }],
    bufferViews: [{ buffer: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' }]
  }));
  fs.writeFileSync(path.join(input, 'pack', 'motions.zip'), zipSync({
    'first/Actor.gltf': gltf, 'second/Actor.gltf': gltf
  }));
  const dest = path.join(dir, 'library.json');
  const run = () => spawnSync(process.execPath, ['tools/convert-mixamo.mjs', '--src', input, '--out', dest], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const good = fs.readFileSync(dest, 'utf8');
  const catalog = JSON.parse(good);
  assert.deepEqual(Object.keys(catalog).sort(), ['HitHead', 'MixamoWaveHello']);
  assert.ok(catalog.HitHead.man && catalog.HitHead.soldier);
  const wave = JSON.parse(fs.readFileSync(path.join(dir, catalog.MixamoWaveHello.file), 'utf8'));
  for (const rig of [wave.man, wave.soldier]) {
    assert.equal(rig.q.RightArm.length, 31 * 4);
    assert.notDeepEqual(rig.q.RightArm.slice(0, 4), rig.q.RightArm.slice(-4));
  }
  fs.writeFileSync(path.join(input, 'damaged.fbx'), 'damaged');
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(dest, 'utf8'), good);
});

test('shipped anims-mixamo.json includes all 5 extra combat/stealth clips for both man and soldier rigs', () => {
  const lib = JSON.parse(fs.readFileSync(new URL('../public/assets/chars/anims-mixamo.json', import.meta.url), 'utf8'));
  for (const key of ['ProneLeftTurn', 'HitBody', 'DeathBack', 'Surrender', 'KneelHit']) {
    const clip = lib[key];
    assert.ok(clip, `missing ${key}`);
    assert.equal(clip.family, key);
    assert.ok(clip.n >= 20 && clip.dur > 0.5, `${key} duration`);
    if (clip.synthetic) {
      assert.match(clip.label, /（(?:合成|镜像)）/, `${key} synthetic label`);
      assert.ok(!/\.fbx$/i.test(clip.src || ''), `${key} synthetic clip must not fake an .fbx filename`);
    }
    for (const rig of ['man', 'soldier']) {
      assert.equal(clip[rig].hips.length, clip.n * 3, `${key}.${rig}.hips`);
      assert.equal(clip[rig].q.Hips.length, clip.n * 4, `${key}.${rig}.Hips`);
      assert.equal(clip[rig].q.RightArm.length, clip.n * 4, `${key}.${rig}.RightArm`);
    }
  }
  assert.equal(lib.ProneLeftTurn.stance, 'prone');
  assert.equal(lib.ProneLeftTurn.man.turnYaw.length, lib.ProneLeftTurn.n);
  assert.equal(lib.Surrender.loop, true);
});

test('fill-missing-motions preserves genuine Mixamo clips while filling missing placeholders', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsg-fill-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const full = JSON.parse(fs.readFileSync(new URL('../public/assets/chars/anims-mixamo.json', import.meta.url), 'utf8'));
  const target = path.join(dir, 'anims.json');
  const genuineHit = { label: 'Real Mixamo Hit', family: 'HitBody', dur: 1, n: 2, loop: false, src: 'Real Hit.fbx', man: { hips: [0,0,0,0,0,0], q: {} }, soldier: { hips: [0,0,0,0,0,0], q: {} } };
  fs.writeFileSync(target, JSON.stringify({ ProneRightTurn: full.ProneRightTurn, HitBody: genuineHit }));
  const res = spawnSync(process.execPath, ['tools/fill-missing-motions.mjs', '--out', target], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(out.HitBody.label, 'Real Mixamo Hit', 'real Mixamo clip must not be overwritten');
  assert.equal(out.HitBody.synthetic, undefined);
  for (const key of ['ProneLeftTurn', 'DeathBack', 'Surrender', 'KneelHit']) {
    assert.equal(out[key].synthetic, true, `${key} filled as synthetic placeholder`);
  }
});

test('ensureHeroPreset lazy-loads alternate hero models on demand and deduplicates concurrent calls', async () => {
  const assets = new AssetManager();
  let loads = 0;
  assets._glLoader = {
    async loadAsync(url) {
      loads++;
      assert.equal(url, 'assets/chars/hero-xia.glb');
      return { scene: { userData: {}, updateMatrixWorld() {}, traverse() {} } };
    }
  };
  const [a, b] = await Promise.all([assets.ensureHeroPreset('xia'), assets.ensureHeroPreset('xia')]);
  assert.equal(loads, 1);
  assert.equal(a, b);
  assert.equal(await assets.ensureHeroPreset('xia'), a);
  assert.equal(loads, 1);
});

test('the selected ranger ships with the animation rig and the coat mask used by the game', async () => {
  const assets = new AssetManager();
  let url;
  assets._glLoader = { async loadAsync(path) {
    url = path;
    return { scene: { userData: {}, updateMatrixWorld() {}, traverse() {} } };
  } };
  await assets.ensureHeroPreset('ranger');
  assert.equal(url, 'assets/chars/hero-ranger-tripo.glb');

  function readRig(assetPath) {
    const file = fs.readFileSync(new URL('../public/' + assetPath, import.meta.url));
    const end = 20 + file.readUInt32LE(12);
    const doc = JSON.parse(file.toString('utf8', 20, end));
    const skin = doc.skins[0];
    const accessor = doc.accessors[skin.inverseBindMatrices];
    const view = doc.bufferViews[accessor.bufferView];
    const start = end + 8 + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return { doc, joints: skin.joints.map(j => doc.nodes[j]), binds: file.subarray(start, start + accessor.count * 64) };
  }

  const hero = readRig(url);
  const base = readRig('assets/chars/man.glb');
  assert.deepEqual(hero.joints, base.joints);
  assert.deepEqual(hero.binds, base.binds);
  const body = hero.doc.nodes.find(node => node.name === 'Male');
  assert.equal(body.skin, 0);
  for (const { attributes } of hero.doc.meshes[body.mesh].primitives) {
    for (const name of ['JOINTS_0', 'WEIGHTS_0', '_COAT_SWAY']) {
      assert.equal(hero.doc.accessors[attributes[name]].count, hero.doc.accessors[attributes.POSITION].count);
    }
  }
});

test('ensureLevelTextures loads only the target chapter texture sets and deduplicates concurrent loads', async () => {
  const assets = new AssetManager();
  const urls = [];
  assets._texLoader = {
    load(url, onLoad) {
      urls.push(url);
      queueMicrotask(() => onLoad({ wrapS: 0, wrapT: 0, anisotropy: 1 }));
    }
  };
  await Promise.all([assets.ensureLevelTextures(0), assets.ensureLevelTextures(0)]);
  assert.equal(urls.length, 12, 'Level 1 loads only 4 required texture sets × 3 maps (12 files instead of all 24)');
  assert.ok(assets.tex.concrete_floor_worn_001?.diff && assets.tex.cobblestone_05?.diff && assets.tex.red_bricks_04?.nor && assets.tex.brick_wall_006?.rough);
  assert.equal(assets.tex.worn_planks, undefined, 'Level 2 textures are deferred until needed/background preload');
});
