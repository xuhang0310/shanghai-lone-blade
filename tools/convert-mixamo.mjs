// Mixamo FBX -> game animation clips for both character rigs (man + soldier).
//
//   node tools/convert-mixamo.mjs                      # anim-src/*.fbx -> public/assets/chars/anims-mixamo.json
//   node tools/convert-mixamo.mjs --src dir --out f.json
//
// Retargeting is done in world space, so it does not depend on the source rig's bone axes (Mixamo FBX
// bones are X/Y/Z-aligned, the game's glTF rigs use Blender's bone-along-Y axes) or on its rest pose
// (the man rig is bound in an A-pose, Mixamo in a T-pose):
//   target world rot(t) = W * [src world rot(t) * src rest world rot^-1] * W^-1 * R_rest * target rest world rot
// where W aligns the two rigs' facing frames and R_rest swings each target bone's rest direction onto the
// source's. Hips motion is scaled by leg length and anchored to the game's Idle pose so feet stay on the
// ground and clips blend with Idle/Walk/Run without popping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

globalThis.ProgressEvent ??= class extends Event {};
globalThis.self ??= globalThis;

const THREE = await import('three');
const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? path.resolve(process.argv[i + 1]) : def;
};
const SRC_DIR = arg('--src', path.join(ROOT, 'anim-src'));
const OUT = arg('--out', path.join(ROOT, 'public/assets/chars/anims-mixamo.json'));
const FPS = 30;

// Bones driven by game clips (same set as anims.json), parents first
const TRACKED = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'
];
// Child joint that defines each bone's direction (rest-pose alignment between rigs)
const AIM = {
  Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: 'LeftToe_End',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase', RightToeBase: 'RightToe_End'
};

// File name (lower-cased, letters/digits only) -> clip key used by the game. First match wins.
// Unmatched files are still converted under a key made from the file name.
const MANIFEST = [
  // Mixamo Great Sword / Sword & Shield / Pro Melee Pack auto-mapping (plug-and-play cold-weapon mocap!)
  { key: 'SwordJumpAttack', test: n => /sword|blade|melee|axe/.test(n) && /jump|leap|overhead|highspin/.test(n) && /attack|slash|chop|strike/.test(n) },
  { key: 'SwordSpin', test: n => /sword|blade|melee|axe/.test(n) && /spin|whirl|360|round/.test(n) },
  { key: 'SwordHeavy', test: n => /sword|blade|melee|axe/.test(n) && /heavy|power|downward|overhead|casting|slash4|slash5/.test(n) },
  { key: 'SwordSlash2', test: n => /sword|blade|melee/.test(n) && /slash2|slash3|inward|backhand|combo2/.test(n) },
  { key: 'SwordSlash1', test: n => /sword|blade|melee/.test(n) && /slash|attack|strike|combo/.test(n) },
  { key: 'SwordBlockHit', test: n => /sword|blade|shield|melee/.test(n) && /block/.test(n) && /impact|hit|react/.test(n) },
  { key: 'SwordBlock', test: n => /sword|blade|shield|melee/.test(n) && /block|guard|parry/.test(n), loop: true },
  { key: 'SwordStrafeL', test: n => /sword|blade|melee/.test(n) && /strafe/.test(n) && /left/.test(n), loop: true, inPlace: true },
  { key: 'SwordStrafeR', test: n => /sword|blade|melee/.test(n) && /strafe/.test(n) && /right/.test(n), loop: true, inPlace: true },
  { key: 'SwordRun', test: n => /sword|blade|melee/.test(n) && /run/.test(n), loop: true, inPlace: true },
  { key: 'SwordWalk', test: n => /sword|blade|melee/.test(n) && /walk/.test(n), loop: true, inPlace: true },
  { key: 'SwordIdle', test: n => /sword|blade|melee/.test(n) && /idle/.test(n), loop: true },
  { key: 'ProneRightTurn', test: n => /prone|crawl/.test(n) && /turn/.test(n) && /right/.test(n), turn: true, inPlace: true },
  { key: 'ProneLeftTurn', test: n => /prone|crawl/.test(n) && /turn/.test(n) && /left/.test(n), turn: true, inPlace: true },
  { key: 'TurnLeft', test: n => /^(?:unarmed|standing|crouch(?:ing)?)?(?:turnleft|leftturn)\d*$/.test(n), turn: true, inPlace: true },
  { key: 'TurnRight', test: n => /^(?:unarmed|standing|crouch(?:ing)?)?(?:turnright|rightturn)\d*$/.test(n), turn: true, inPlace: true },
  { key: 'LocoWalk', test: n => /^(?:unarmed|male|female)?(?:walk|walking)(?:forward)?$/.test(n), loop: true, inPlace: true },
  { key: 'LocoRun', test: n => /^(?:unarmed|male|female)?(?:run|running|jog|jogging)(?:forward)?$/.test(n), loop: true, inPlace: true },
  { key: 'LocoIdle', test: n => /^(?:unarmed|standing|male|female)?idle$/.test(n), loop: true },
  { key: 'DeathHead', test: n => /headshot/.test(n) || (/head/.test(n) && /death|dying/.test(n)) },
  { key: 'DeathForward', test: n => /death|dying/.test(n) && /forward|fromtheback|fromback|intheback/.test(n) },
  { key: 'DeathBack', test: n => /death|dying/.test(n) },
  { key: 'HitHead', test: n => /head/.test(n) && /hit/.test(n) },
  { key: 'HitStomach', test: n => /stomach|gut|kidney/.test(n) },
  { key: 'HitBody', test: n => /hit|reaction/.test(n) },
  { key: 'InjuredWalk', test: n => /injured|limp/.test(n) && /walk/.test(n) && !/back/.test(n), loop: true, inPlace: true },
  { key: 'Crawl', test: n => /crawl/.test(n), loop: true, inPlace: true },
  { key: 'Surrender', test: n => /surrender|handsup/.test(n), loop: true },
  { key: 'KneelHit', test: n => /kneel/.test(n) },
  { key: 'DrawPistol', test: n => /draw/.test(n) },
  { key: 'PistolStrafeL', test: n => /pistol/.test(n) && /strafe/.test(n) && /left/.test(n), loop: true, inPlace: true },
  { key: 'PistolStrafeR', test: n => /pistol/.test(n) && /strafe/.test(n) && /right/.test(n), loop: true, inPlace: true },
  { key: 'PistolStrafe', test: n => /pistol/.test(n) && /strafe/.test(n), loop: true, inPlace: true },
  { key: 'PistolWalkBack', test: n => /pistol/.test(n) && /walk/.test(n) && /back/.test(n), loop: true, inPlace: true },
  { key: 'PistolWalk', test: n => /pistol/.test(n) && /walk/.test(n), loop: true, inPlace: true },
  { key: 'PistolRun', test: n => /pistol/.test(n) && /run/.test(n), loop: true, inPlace: true },
  { key: 'PistolIdle', test: n => /pistol/.test(n) && /idle/.test(n), loop: true }
];

const norm = name => name.replace(/^mixamorig\d*:?/i, '');
const toArrayBuffer = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// First node per normalized name, depth-first: the same node PropertyBinding animates
function nodeMap(root) {
  const map = {};
  root.traverse(o => {
    const n = norm(o.name);
    if (n && !(n in map)) map[n] = o;
  });
  return map;
}

function snapshot(nodes) {
  const q = {};
  const p = {};
  for (const n in nodes) {
    q[n] = nodes[n].getWorldQuaternion(new THREE.Quaternion());
    p[n] = nodes[n].getWorldPosition(new THREE.Vector3());
  }
  return { q, p };
}

// Rotation whose X/Y/Z axes are the rig's left/up/forward directions (from its rest skeleton)
function facingFrame(p) {
  const up = p.Head.clone().sub(p.Hips).normalize();
  const left = p.LeftArm.clone().sub(p.RightArm);
  left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
}

function loadGlb(file) {
  const buf = fs.readFileSync(file);
  return new Promise((res, rej) => new GLTFLoader().parse(toArrayBuffer(buf), '', res, rej));
}

async function loadTargetRig(kind, idle) {
  const gltf = await loadGlb(path.join(ROOT, `public/assets/chars/${kind}.glb`));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const nodes = nodeMap(scene);
  for (const n of [...TRACKED, 'HeadTop_End']) if (!nodes[n]) throw new Error(`${kind}.glb: missing bone ${n}`);
  for (const n of TRACKED.slice(1)) {
    if (!TRACKED.includes(norm(nodes[n].parent.name))) throw new Error(`${kind}.glb: ${n} has an untracked parent`);
  }
  const rest = snapshot(nodes);
  const restLocal = {};
  for (const n of TRACKED) restLocal[n] = { q: nodes[n].quaternion.clone(), p: nodes[n].position.clone() };
  const hipsParent = nodes.Hips.parent;
  const hipsParentQ = hipsParent.getWorldQuaternion(new THREE.Quaternion());
  const hipsParentInv = hipsParent.matrixWorld.clone().invert();

  // The game's Idle frame 0 (as AssetManager builds it) anchors where clips put the hips and feet
  const restHips = nodes.Hips.position.clone();
  const idleHips =
    kind === 'man'
      ? new THREE.Vector3().fromArray(idle.hipsY, 0)
      : restHips.clone(); // soldier Idle keeps its own rest hips at frame 0
  nodes.Hips.position.copy(idleHips);
  for (const n of TRACKED) {
    if (idle.q[n]) nodes[n].quaternion.fromArray(idle.q[n], 0);
  }
  scene.updateMatrixWorld(true);
  const idleToeY = nodes.LeftToeBase.getWorldPosition(new THREE.Vector3()).y;
  const idleHipsW = nodes.Hips.getWorldPosition(new THREE.Vector3());
  const restore = () => {
    for (const n of TRACKED) {
      nodes[n].quaternion.copy(restLocal[n].q);
      nodes[n].position.copy(restLocal[n].p);
    }
    scene.updateMatrixWorld(true);
  };
  restore();
  return { kind, scene, nodes, rest, hipsParentQ, hipsParentInv, idleToeY, idleHipsW, restore };
}

function parseSource(file, buf) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.fbx') {
    // With Skin exports can include large embedded images. Only bone transforms are sampled.
    const manager = new THREE.LoadingManager();
    const textures = new THREE.Loader(manager);
    textures.load = url => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return new THREE.Texture();
    };
    manager.addHandler(/^\./, textures);
    return Promise.resolve(new FBXLoader(manager).parse(toArrayBuffer(buf), ''));
  }
  return new GLTFLoader().parseAsync(toArrayBuffer(buf), '').then(g => Object.assign(g.scene, { animations: g.animations }));
}

function classify(base) {
  const n = base.replace(/\s*\(\d+\)$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = MANIFEST.find(m => m.key.toLowerCase() === n) || MANIFEST.find(m => m.test(n));
  if (hit) return { key: hit.key, loop: !!hit.loop, inPlace: !!hit.inPlace, turn: !!hit.turn, matched: true };
  const key = base.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, s, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  return { key: 'Mixamo' + (key || 'Clip'), loop: false, inPlace: false, matched: false };
}

const r5 = v => Math.round(v * 1e5) / 1e5;
const r4 = v => Math.round(v * 1e4) / 1e4;

function retarget(src, sNodes, sRest, clip, rig, opts) {
  const W = rig.restFrame.clone().multiply(facingFrame(sRest.p).invert());
  const Winv = W.clone().invert();

  const align = {};
  for (const n of TRACKED) {
    const c = AIM[n];
    if (!c || !sNodes[c] || !rig.nodes[c]) {
      align[n] = new THREE.Quaternion();
      continue;
    }
    const dT = rig.rest.p[c].clone().sub(rig.rest.p[n]).normalize();
    const dS = sRest.p[c].clone().sub(sRest.p[n]).normalize().applyQuaternion(W);
    align[n] = new THREE.Quaternion().setFromUnitVectors(dT, dS);
  }
  const base = {};
  for (const n of TRACKED) base[n] = align[n].clone().multiply(rig.rest.q[n]);

  const sRestInv = {};
  for (const n of TRACKED) sRestInv[n] = sRest.q[n].clone().invert();

  const worldTargets = sq => {
    const out = {};
    for (const n of TRACKED) {
      const d = sq[n].clone().multiply(sRestInv[n]);
      out[n] = W.clone().multiply(d).multiply(Winv).multiply(base[n]);
    }
    return out;
  };
  const toLocal = Qw => {
    const loc = { Hips: rig.hipsParentQ.clone().invert().multiply(Qw.Hips) };
    for (const n of TRACKED.slice(1)) {
      loc[n] = Qw[norm(rig.nodes[n].parent.name)].clone().invert().multiply(Qw[n]);
    }
    return loc;
  };
  const apply = (loc, hipsLocal) => {
    for (const n of TRACKED) rig.nodes[n].quaternion.copy(loc[n]);
    rig.nodes.Hips.position.copy(hipsLocal);
    rig.scene.updateMatrixWorld(true);
  };

  // Leg-length scale and the hips anchor: with the source standing at rest, the target's toe sits
  // exactly where the game's Idle pose puts it
  const sLeg = sRest.p.Hips.y - sRest.p.LeftToeBase.y;
  apply(toLocal(worldTargets(sRest.q)), rig.nodes.Hips.position.clone());
  const hipsW = rig.nodes.Hips.getWorldPosition(new THREE.Vector3());
  const toeW = rig.nodes.LeftToeBase.getWorldPosition(new THREE.Vector3());
  const tLeg = hipsW.y - toeW.y;
  const k = tLeg / sLeg;
  const anchor = new THREE.Vector3(rig.idleHipsW.x, rig.idleToeY + tLeg, rig.idleHipsW.z);

  const mixer = new THREE.AnimationMixer(src);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true; // sample the real last frame instead of wrapping to frame 0
  action.play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const hipsW0 = [];
  const frames = [];
  const sDirs = [];
  const turnYaw = [];
  let lastBearing;
  let yaw = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    mixer.setTime(clip.duration * i / (n - 1));
    src.updateMatrixWorld(true);
    const s = snapshot(sNodes);
    const targets = worldTargets(s.q);
    const unturn = new THREE.Quaternion();
    if (opts.turn) {
      // The controller owns facing. Keep the footwork and tilt, and save the authored heading
      // separately so the library viewer can reproduce the full original turn.
      const side = s.p.LeftUpLeg.clone().sub(s.p.RightUpLeg).applyQuaternion(W);
      const bearing = Math.atan2(-side.z, side.x);
      if (lastBearing !== undefined) yaw += Math.atan2(Math.sin(bearing - lastBearing), Math.cos(bearing - lastBearing));
      lastBearing = bearing;
      turnYaw.push(r5(yaw));
      unturn.setFromAxisAngle(up, -yaw);
      for (const bone of TRACKED) targets[bone].premultiply(unturn);
    }
    frames.push(toLocal(targets));
    hipsW0.push(s.p.Hips.clone().sub(sRest.p.Hips).applyQuaternion(W).multiplyScalar(k));
    const dirs = {};
    for (const b of TRACKED) {
      const c = AIM[b];
      if (c && s.p[c]) dirs[b] = s.p[c].clone().sub(s.p[b]).normalize().applyQuaternion(W).applyQuaternion(unturn);
    }
    sDirs.push(dirs);
  }

  // Start every clip over the Idle hips (no sideways pop when blending in); in-place loops also lose
  // their net horizontal travel but keep the sway
  const x0 = hipsW0[0].x;
  const z0 = hipsW0[0].z;
  const endX = opts.inPlace ? hipsW0[n - 1].x - x0 : 0;
  const endZ = opts.inPlace ? hipsW0[n - 1].z - z0 : 0;
  hipsW0.forEach((d, i) => {
    const f = i / (n - 1);
    d.x -= x0 + endX * f;
    d.z -= z0 + endZ * f;
    if (opts.turn) d.applyAxisAngle(up, -turnYaw[i]);
  });

  // Build tracks (quaternion sign kept continuous) and verify by forward kinematics
  const q = {};
  for (const b of TRACKED) q[b] = [];
  const hips = [];
  const prev = {};
  let maxErr = 0;
  let minToe = Infinity;
  let headHeight = 0;
  frames.forEach((loc, i) => {
    for (const b of TRACKED) {
      const v = loc[b];
      if (prev[b] && prev[b].dot(v) < 0) v.set(-v.x, -v.y, -v.z, -v.w);
      prev[b] = v.clone();
      q[b].push(r5(v.x), r5(v.y), r5(v.z), r5(v.w));
    }
    const hw = anchor.clone().add(hipsW0[i]);
    const hl = hw.clone().applyMatrix4(rig.hipsParentInv);
    hips.push(r4(hl.x), r4(hl.y), r4(hl.z));
    apply(loc, hl);
    if (opts.turn) headHeight += rig.nodes.Head.getWorldPosition(_t).y - rig.idleToeY;
    for (const b in sDirs[i]) {
      const c = AIM[b];
      if (!rig.nodes[c]) continue;
      const d = rig.nodes[c].getWorldPosition(new THREE.Vector3()).sub(rig.nodes[b].getWorldPosition(new THREE.Vector3())).normalize();
      maxErr = Math.max(maxErr, d.angleTo(sDirs[i][b]));
    }
    minToe = Math.min(minToe, rig.nodes.LeftToeBase.getWorldPosition(_t).y, rig.nodes.RightToeBase.getWorldPosition(_t).y);
  });
  rig.restore();
  mixer.stopAllAction();
  mixer.uncacheRoot(src);
  return {
    data: opts.turn ? { hips, q, turnYaw } : { hips, q },
    n,
    report: { maxErrDeg: (maxErr * 180) / Math.PI, legScale: k, toeDip: (rig.idleToeY - minToe) / tLeg,
      heightRatio: headHeight / (n * (rig.rest.p.Head.y - rig.rest.p.LeftToeBase.y)) }
  };
}
const _t = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
if (!fs.existsSync(SRC_DIR)) {
  console.error(`找不到动画源文件夹：${SRC_DIR}`);
  process.exit(1);
}
const supported = /\.(fbx|glb|gltf)$/i;
const nameOrder = new Intl.Collator('en', { numeric: true });
function compareNames(a, b) {
  const original = s => s.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
  return nameOrder.compare(original(a), original(b)) || a.length - b.length || nameOrder.compare(a, b);
}
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__MACOSX' ? [] : listFiles(file);
    return e.isFile() && (supported.test(e.name) || /\.zip$/i.test(e.name)) ? [file] : [];
  });
}
const files = listFiles(SRC_DIR).sort(compareNames);
if (!files.length) {
  console.error(`${SRC_DIR} 里没有动作文件或 ZIP 包`);
  process.exit(1);
}

const idle = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/chars/anims.json'), 'utf8')).Idle;
const rigs = [await loadTargetRig('man', idle), await loadTargetRig('soldier', idle)];
for (const rig of rigs) rig.restFrame = facingFrame(rig.rest.p);

// A pack stays on disk as downloaded. Inflate one member at a time and never extract archive paths.
function* members(file) {
  const name = path.relative(SRC_DIR, file).split(path.sep).join('/');
  const bytes = fs.readFileSync(file);
  if (!/\.zip$/i.test(file)) {
    yield { name, bytes };
    return;
  }
  const names = [];
  unzipSync(bytes, { filter: entry => {
    if (supported.test(entry.name) && !/(^|\/)(__MACOSX\/|\._)/.test(entry.name)) names.push(entry.name);
    return false;
  } });
  for (const member of names.sort(compareNames)) {
    const data = unzipSync(bytes, { filter: entry => entry.name === member });
    yield { name: name + '/' + member, bytes: data[member] };
  }
}

const out = Object.create(null);
const live = new Set(['DeathHead', 'DeathForward', 'DeathBack', 'HitHead', 'HitBody', 'HitStomach',
  'KneelHit', 'Crawl', 'Surrender', 'InjuredWalk', 'TurnLeft', 'TurnRight', 'ProneLeftTurn', 'ProneRightTurn',
  'LocoWalk', 'LocoRun', 'LocoIdle']);
const seenFiles = new Set();
const motions = new Set();
const counts = new Map();
const rows = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let failures = 0;
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
async function convertSource(f, bytes) {
  const stem = path.posix.basename(f, path.posix.extname(f)).split('@').at(-1);
  const fingerprint = hash(bytes) + ':' + classify(stem).key;
  if (seenFiles.has(fingerprint)) return;
  seenFiles.add(fingerprint);
  const src = await parseSource(f, bytes);
  const clips = (src.animations || []).filter(c => c.duration > 0 && c.tracks.some(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    return nodeName && TRACKED.includes(norm(nodeName)) && (propertyName === 'position' || propertyName === 'quaternion');
  }));
  if (!clips.length) {
    rows.push('  ' + f + '  跳过（无人体动作）');
    return;
  }
  const sampledBones = new Set([...TRACKED, ...Object.values(AIM)]);
  const sNodes = Object.fromEntries(Object.entries(nodeMap(src)).filter(([name]) => sampledBones.has(name)));
  for (const b of TRACKED) if (!sNodes[b]) throw new Error('缺少骨骼 ' + b);
  src.updateMatrixWorld(true);
  const sRest = snapshot(sNodes);
  for (const [index, clip] of clips.entries()) {
    const take = clip.name.split('|').at(-1).trim();
    let label = stem;
    if (clips.length > 1) label = take && !/^(mixamo\.com|take \d+)$/i.test(take) ? take : stem + ' ' + (index + 1);
    const info = classify(label);
    const entry = { label, family: info.key, dur: 0, n: 0, loop: info.loop, src: f };
    const tracks = {};
    const notes = [];
    for (const rig of rigs) {
      const r = retarget(src, sNodes, sRest, clip, rig, info);
      entry.n = r.n;
      entry.dur = r4((r.n - 1) / FPS);
      tracks[rig.kind] = r.data;
      if (rig.kind === 'man' && info.turn) {
        entry.stance = info.key.startsWith('Prone') ? 'prone' : r.report.heightRatio < 0.75 ? 'crouch' : 'standing';
      }
      if (r.report.maxErrDeg > 1) notes.push(`${rig.kind} 方向误差 ${r.report.maxErrDeg.toFixed(2)}°`);
      if (rig.kind === 'man') {
        notes.push(`误差 ${r.report.maxErrDeg.toFixed(3)}°`, `腿长比 ${r.report.legScale.toFixed(4)}`, `脚尖最低 ${(r.report.toeDip * 100).toFixed(1)}% 腿长`);
      }
    }
    const json = JSON.stringify(tracks);
    const digest = hash(json);
    if (motions.has(info.key + digest)) continue;
    motions.add(info.key + digest);
    const indexInFamily = (counts.get(info.key) || 0) + 1;
    counts.set(info.key, indexInFamily);
    let key = info.key;
    for (let i = 2; out[key]; i++) key = info.key + i;
    if (live.has(info.key) && indexInFamily <= 3) Object.assign(entry, tracks);
    else {
      entry.file = 'motions/' + digest.slice(0, 24) + '.json';
      const file = path.join(path.dirname(OUT), entry.file);
      if (!fs.existsSync(file)) writeAtomic(file, json);
    }
    out[key] = entry;
    rows.push('  ' + f + '  ->  ' + key + '  ' + entry.n + ' 帧  ' + notes.join('，'));
  }
}
for (const file of files) {
  try {
    for (const { name, bytes } of members(file)) {
      try { await convertSource(name, bytes); }
      catch (e) { failures++; rows.push('  ' + name + '  失败：' + e.message); }
    }
  } catch (e) {
    failures++; rows.push('  ' + file + '  失败：' + e.message);
  }
}

console.log(rows.join('\n'));
if (failures || !Object.keys(out).length) {
  console.error('没有更新游戏动作库，请检查上面的转换结果。');
  process.exit(1);
}
writeAtomic(OUT, JSON.stringify(out));
console.log(`\n写入 ${path.relative(ROOT, OUT)}：${Object.keys(out).length} 个动画，${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
