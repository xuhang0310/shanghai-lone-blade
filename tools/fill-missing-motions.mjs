// Synthesizes & calibrates the 5 missing combat/stealth motion clips on both game rigs (man + soldier)
// and merges them into public/assets/chars/anims-mixamo.json:
//   - ProneLeftTurn : world-space sagittal mirror of Mixamo ProneRightTurn (with negated turnYaw)
//   - HitBody       : torso gunshot stagger & recovery
//   - DeathBack     : backward fall onto cobblestones (ground-clamped resting corpse)
//   - Surrender     : seamless looping hands-up trembling surrender
//   - KneelHit      : leg-shot drop onto one knee, pained clutch, and struggle back up
//
// Run: node tools/fill-missing-motions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.ProgressEvent ??= class extends Event {};
globalThis.self ??= globalThis;

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? path.resolve(process.argv[i + 1]) : def;
};
const FORCE = process.argv.includes('--force');
const MIXAMO_PATH = arg('--out', path.join(ROOT, 'public/assets/chars/anims-mixamo.json'));
const ANIMS_PATH = path.join(ROOT, 'public/assets/chars/anims.json');
const FPS = 30;

const TRACKED = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'
];

const AIM = {
  Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: 'LeftToe_End',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase', RightToeBase: 'RightToe_End'
};

const MIRROR_BONE = name =>
  name.startsWith('Left') ? 'Right' + name.slice(4)
    : name.startsWith('Right') ? 'Left' + name.slice(5)
      : name;

const norm = name => name.replace(/^mixamorig\d*:?/i, '');
const toArrayBuffer = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const r5 = v => Math.round(v * 1e5) / 1e5;
const r4 = v => Math.round(v * 1e4) / 1e4;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = x => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const smoother = x => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const pulse = (u, peak) => (u < peak ? smooth(u / peak) : 1 - smooth((u - peak) / (1 - peak)));

function nodeMap(root) {
  const map = {};
  root.traverse(o => {
    const n = norm(o.name);
    if (n && !(n in map)) map[n] = o;
  });
  return map;
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
  for (const n of [...TRACKED, 'HeadTop_End']) {
    if (!nodes[n]) throw new Error(`${kind}.glb missing bone ${n}`);
  }

  const restLocal = {};
  const restWorldQ = {};
  const restWorldP = {};
  for (const n of TRACKED) {
    restLocal[n] = { q: nodes[n].quaternion.clone(), p: nodes[n].position.clone() };
    restWorldQ[n] = nodes[n].getWorldQuaternion(new THREE.Quaternion());
    restWorldP[n] = nodes[n].getWorldPosition(new THREE.Vector3());
  }

  const hipsParent = nodes.Hips.parent;
  const hipsParentQ = hipsParent.getWorldQuaternion(new THREE.Quaternion());
  const hipsParentInv = hipsParent.matrixWorld.clone().invert();

  // Compute Idle frame-0 baseline (matches AssetManager & convert-mixamo.mjs)
  const idleHipsLocal =
    kind === 'man'
      ? new THREE.Vector3().fromArray(idle.hipsY, 0)
      : nodes.Hips.position.clone();
  const idleLocalQ = {};
  nodes.Hips.position.copy(idleHipsLocal);
  for (const n of TRACKED) {
    if (idle.q[n]) nodes[n].quaternion.fromArray(idle.q[n], 0);
    idleLocalQ[n] = nodes[n].quaternion.clone();
  }
  scene.updateMatrixWorld(true);
  const idleToeY = Math.min(
    nodes.LeftToeBase.getWorldPosition(new THREE.Vector3()).y,
    nodes.RightToeBase.getWorldPosition(new THREE.Vector3()).y
  );
  const idleHipsW = nodes.Hips.getWorldPosition(new THREE.Vector3());
  const tLeg = idleHipsW.y - idleToeY;

  const setIdlePose = () => {
    nodes.Hips.position.copy(idleHipsLocal);
    for (const n of TRACKED) nodes[n].quaternion.copy(idleLocalQ[n]);
    scene.updateMatrixWorld(true);
  };

  const setRestPose = () => {
    for (const n of TRACKED) {
      nodes[n].quaternion.copy(restLocal[n].q);
      nodes[n].position.copy(restLocal[n].p);
    }
    scene.updateMatrixWorld(true);
  };

  setRestPose();
  return {
    kind, scene, nodes, restLocal, restWorldQ, restWorldP,
    hipsParentQ, hipsParentInv, idleHipsLocal, idleLocalQ, idleToeY, idleHipsW, tLeg,
    setIdlePose, setRestPose
  };
}

// World-space axes matching both man.glb and soldier.glb: +X = left, +Y = up, +Z = forward
const AXIS_LEFT = new THREE.Vector3(1, 0, 0);
const AXIS_UP = new THREE.Vector3(0, 1, 0);
const AXIS_FWD = new THREE.Vector3(0, 0, 1);

function rotBoneWorld(rig, name, axis, angle) {
  if (!angle || Math.abs(angle) < 1e-6) return;
  const b = rig.nodes[name];
  if (!b) return;
  b.updateWorldMatrix(true, false);
  const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const wq = b.getWorldQuaternion(new THREE.Quaternion());
  const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(pq.invert().multiply(dq.multiply(wq))).normalize();
  b.updateWorldMatrix(false, true);
}

function pointBoneWorld(rig, name, targetDir, weight = 1) {
  const b = rig.nodes[name];
  const childName = AIM[name];
  const ch = childName && rig.nodes[childName];
  if (!b || !ch || weight <= 1e-5) return;
  b.updateWorldMatrix(true, true);
  const cur = ch.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
  const goal = targetDir.clone().normalize();
  const dq = new THREE.Quaternion().setFromUnitVectors(cur, goal);
  if (weight < 0.999) dq.slerp(new THREE.Quaternion(), 1 - weight);
  const wq = b.getWorldQuaternion(new THREE.Quaternion());
  const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(pq.invert().multiply(dq.multiply(wq))).normalize();
  b.updateWorldMatrix(false, true);
}

function shiftHipsWorld(rig, dx, dy, dz) {
  const w = rig.nodes.Hips.getWorldPosition(new THREE.Vector3());
  w.x += dx;
  w.y += dy;
  w.z += dz;
  rig.nodes.Hips.position.copy(w.applyMatrix4(rig.hipsParentInv));
  rig.scene.updateMatrixWorld(true);
}

function groundLowest(rig, boneNames, floorY) {
  rig.scene.updateMatrixWorld(true);
  let minY = Infinity;
  const tmp = new THREE.Vector3();
  for (const n of boneNames) {
    if (!rig.nodes[n]) continue;
    const y = rig.nodes[n].getWorldPosition(tmp).y;
    if (y < minY) minY = y;
  }
  if (Number.isFinite(minY)) shiftHipsWorld(rig, 0, floorY - minY, 0);
  return minY;
}

function clampAboveFloor(rig, boneNames, floorY) {
  rig.scene.updateMatrixWorld(true);
  let minY = Infinity;
  const tmp = new THREE.Vector3();
  for (const n of boneNames) {
    if (!rig.nodes[n]) continue;
    const y = rig.nodes[n].getWorldPosition(tmp).y;
    if (y < minY) minY = y;
  }
  if (Number.isFinite(minY) && minY < floorY) shiftHipsWorld(rig, 0, floorY - minY, 0);
}

function recordFrames(rig, n, poseFn) {
  const q = {};
  for (const b of TRACKED) q[b] = [];
  const hips = [];
  const prev = {};
  let minToeY = Infinity;
  let endHeadY = 0;
  const tmp = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    rig.setIdlePose();
    poseFn(rig, u, i);
    rig.scene.updateMatrixWorld(true);

    const hl = rig.nodes.Hips.position;
    hips.push(r4(hl.x), r4(hl.y), r4(hl.z));
    for (const b of TRACKED) {
      const v = rig.nodes[b].quaternion.clone().normalize();
      if (prev[b] && prev[b].dot(v) < 0) v.set(-v.x, -v.y, -v.z, -v.w);
      prev[b] = v.clone();
      q[b].push(r5(v.x), r5(v.y), r5(v.z), r5(v.w));
    }
    const lt = rig.nodes.LeftToeBase.getWorldPosition(tmp).y;
    const rt = rig.nodes.RightToeBase.getWorldPosition(tmp).y;
    minToeY = Math.min(minToeY, lt, rt);
    if (i === n - 1) endHeadY = rig.nodes.Head.getWorldPosition(tmp).y;
  }
  rig.setRestPose();
  return { data: { hips, q }, minToeY, endHeadY };
}

// 1. ProneLeftTurn: world-space sagittal reflection (X -> -X) of Mixamo ProneRightTurn
function mirrorProneTurn(rig, srcTrack, n) {
  const q = {};
  for (const b of TRACKED) q[b] = [];
  const hips = [];
  const prev = {};
  const mirrorMat = new THREE.Matrix4().makeScale(-1, 1, 1);
  const mRot = new THREE.Matrix4();
  const mOut = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();

  const restInv = {};
  for (const b of TRACKED) restInv[b] = rig.restWorldQ[b].clone().invert();

  const srcWorldQ = {};
  for (let i = 0; i < n; i++) {
    // Load source frame onto rig to read exact world rotations and hips offset
    rig.nodes.Hips.position.set(srcTrack.hips[i * 3], srcTrack.hips[i * 3 + 1], srcTrack.hips[i * 3 + 2]);
    for (const b of TRACKED) {
      rig.nodes[b].quaternion.set(
        srcTrack.q[b][i * 4], srcTrack.q[b][i * 4 + 1], srcTrack.q[b][i * 4 + 2], srcTrack.q[b][i * 4 + 3]
      );
    }
    rig.scene.updateMatrixWorld(true);
    for (const b of TRACKED) srcWorldQ[b] = rig.nodes[b].getWorldQuaternion(new THREE.Quaternion());
    const srcHipsW = rig.nodes.Hips.getWorldPosition(tmpP);

    // Mirror hips lateral offset around rig.idleHipsW.x
    const mirHipsW = new THREE.Vector3(
      rig.idleHipsW.x - (srcHipsW.x - rig.idleHipsW.x),
      srcHipsW.y,
      srcHipsW.z
    );
    const mirHipsL = mirHipsW.applyMatrix4(rig.hipsParentInv);
    hips.push(r4(mirHipsL.x), r4(mirHipsL.y), r4(mirHipsL.z));

    // Mirror each bone's world delta rotation: ΔR_m = M * (R_src(b') * R_rest(b')^-1) * M
    const targetWorldQ = {};
    for (const b of TRACKED) {
      const partner = MIRROR_BONE(b);
      const delta = srcWorldQ[partner].clone().multiply(restInv[partner]);
      mRot.makeRotationFromQuaternion(delta);
      mOut.copy(mirrorMat).multiply(mRot).multiply(mirrorMat);
      tmpQ.setFromRotationMatrix(mOut);
      targetWorldQ[b] = tmpQ.clone().multiply(rig.restWorldQ[b]).normalize();
    }

    // Convert world target rotations back to local quaternions
    for (const b of TRACKED) {
      const parentQ = b === 'Hips' ? rig.hipsParentQ : targetWorldQ[norm(rig.nodes[b].parent.name)];
      const loc = parentQ.clone().invert().multiply(targetWorldQ[b]).normalize();
      if (prev[b] && prev[b].dot(loc) < 0) loc.set(-loc.x, -loc.y, -loc.z, -loc.w);
      prev[b] = loc.clone();
      q[b].push(r5(loc.x), r5(loc.y), r5(loc.z), r5(loc.w));
    }
  }
  rig.setRestPose();
  const turnYaw = (srcTrack.turnYaw || []).map(v => r5(-v));
  return { hips, q, turnYaw };
}

// 2. HitBody: snappy upper-torso gunshot stagger & recovery
function poseHitBody(rig, u) {
  const k = pulse(u, 0.22);
  const recoil = pulse(u, 0.30);
  const sway = Math.sin(u * Math.PI * 2) * (1 - u) * 0.25;

  // Pelvis recoils back & drops slightly into bent knees
  rotBoneWorld(rig, 'Hips', AXIS_LEFT, -0.14 * k);
  rotBoneWorld(rig, 'Hips', AXIS_UP, -0.22 * recoil);
  rotBoneWorld(rig, 'Hips', AXIS_FWD, 0.06 * k);

  // Chest snaps backward and twists from hit on right shoulder/chest
  rotBoneWorld(rig, 'Spine', AXIS_LEFT, -0.22 * k);
  rotBoneWorld(rig, 'Spine1', AXIS_LEFT, -0.24 * k);
  rotBoneWorld(rig, 'Spine1', AXIS_UP, -0.34 * recoil + 0.12 * sway);
  rotBoneWorld(rig, 'Spine2', AXIS_LEFT, -0.16 * k);
  rotBoneWorld(rig, 'Spine2', AXIS_FWD, -0.10 * k);
  rotBoneWorld(rig, 'Neck', AXIS_LEFT, -0.18 * k);
  rotBoneWorld(rig, 'Head', AXIS_LEFT, -0.28 * k);
  rotBoneWorld(rig, 'Head', AXIS_UP, 0.22 * recoil);

  // Arms jolt outward/upward defensively
  rotBoneWorld(rig, 'LeftShoulder', AXIS_FWD, 0.18 * k);
  rotBoneWorld(rig, 'LeftArm', AXIS_FWD, 0.36 * k);
  rotBoneWorld(rig, 'LeftArm', AXIS_LEFT, -0.32 * k);
  rotBoneWorld(rig, 'LeftForeArm', AXIS_LEFT, -0.35 * k);
  rotBoneWorld(rig, 'RightShoulder', AXIS_FWD, -0.24 * k);
  rotBoneWorld(rig, 'RightArm', AXIS_FWD, -0.42 * k);
  rotBoneWorld(rig, 'RightArm', AXIS_LEFT, -0.22 * k);
  rotBoneWorld(rig, 'RightForeArm', AXIS_LEFT, -0.45 * k);

  // Legs bend slightly to absorb recoil without lifting feet
  rotBoneWorld(rig, 'LeftUpLeg', AXIS_LEFT, -0.24 * recoil);
  rotBoneWorld(rig, 'LeftLeg', AXIS_LEFT, 0.44 * recoil);
  rotBoneWorld(rig, 'LeftFoot', AXIS_LEFT, -0.20 * recoil);
  rotBoneWorld(rig, 'RightUpLeg', AXIS_LEFT, -0.16 * recoil);
  rotBoneWorld(rig, 'RightLeg', AXIS_LEFT, 0.36 * recoil);
  rotBoneWorld(rig, 'RightFoot', AXIS_LEFT, -0.18 * recoil);

  shiftHipsWorld(rig, -0.04 * rig.tLeg * recoil, 0, -0.16 * rig.tLeg * recoil);
  groundLowest(rig, ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'], rig.idleToeY);
}

// 3. DeathBack: dramatic backward collapse onto back on the cobblestones
function poseDeathBack(rig, u) {
  const hit = smooth(u / 0.22);
  const fall = smoother((u - 0.14) / 0.62);
  const settle = smooth((u - 0.72) / 0.28);
  const bounce = u > 0.70 ? Math.sin(clamp((u - 0.70) / 0.22, 0, 1) * Math.PI) * 0.06 : 0;

  // Hips pitch backward to horizontal supine (-1.50 rad about +left) with natural slight roll & yaw
  const pitch = -0.24 * hit * (1 - fall * 0.6) - 1.48 * fall + bounce;
  const roll = 0.14 * fall;
  const yaw = -0.16 * hit - 0.12 * fall;
  rotBoneWorld(rig, 'Hips', AXIS_UP, yaw);
  rotBoneWorld(rig, 'Hips', AXIS_FWD, roll);
  rotBoneWorld(rig, 'Hips', AXIS_LEFT, pitch);

  // Spine arches on impact, then flattens naturally onto pavement
  const arch = hit * (1 - settle * 0.75);
  rotBoneWorld(rig, 'Spine', AXIS_LEFT, -0.18 * arch + 0.08 * settle);
  rotBoneWorld(rig, 'Spine1', AXIS_LEFT, -0.20 * arch + 0.06 * settle);
  rotBoneWorld(rig, 'Spine2', AXIS_LEFT, -0.14 * arch);
  rotBoneWorld(rig, 'Neck', AXIS_LEFT, -0.22 * hit * (1 - fall * 0.6) + 0.12 * settle);
  rotBoneWorld(rig, 'Head', AXIS_LEFT, -0.28 * hit * (1 - fall * 0.5) + 0.16 * settle);
  rotBoneWorld(rig, 'Head', AXIS_UP, 0.34 * fall);

  // Arms fling wide & collapse flat beside body on the cobblestones
  const armW = smooth(u / 0.55);
  pointBoneWorld(rig, 'LeftArm', new THREE.Vector3(0.84, 0.55 * (1 - fall) - 0.04, -0.32 - 0.22 * settle), armW);
  pointBoneWorld(rig, 'LeftForeArm', new THREE.Vector3(0.76, 0.42 * (1 - fall) - 0.05, -0.58), armW);
  pointBoneWorld(rig, 'RightArm', new THREE.Vector3(-0.88, 0.50 * (1 - fall) - 0.04, -0.14 + 0.24 * settle), armW);
  pointBoneWorld(rig, 'RightForeArm', new THREE.Vector3(-0.82, 0.36 * (1 - fall) - 0.05, 0.32), armW);

  // Legs buckle slightly early in fall, then straighten & splay flat onto the street
  const legFlat = smoother((u - 0.26) / 0.56);
  const kneePeak = pulse(clamp((u - 0.08) / 0.42, 0, 1), 0.45);
  rotBoneWorld(rig, 'LeftUpLeg', AXIS_LEFT, -0.32 * kneePeak);
  rotBoneWorld(rig, 'LeftLeg', AXIS_LEFT, 0.65 * kneePeak);
  rotBoneWorld(rig, 'RightUpLeg', AXIS_LEFT, -0.40 * kneePeak);
  rotBoneWorld(rig, 'RightLeg', AXIS_LEFT, 0.78 * kneePeak);
  if (legFlat > 1e-4) {
    pointBoneWorld(rig, 'LeftUpLeg', new THREE.Vector3(0.18, 0.04 * (1 - settle), 0.98), legFlat);
    pointBoneWorld(rig, 'LeftLeg', new THREE.Vector3(0.22, -0.06, 0.97), legFlat);
    pointBoneWorld(rig, 'RightUpLeg', new THREE.Vector3(-0.22, 0.08 * (1 - settle), 0.97), legFlat);
    pointBoneWorld(rig, 'RightLeg', new THREE.Vector3(-0.26, -0.08, 0.96), legFlat);
  }

  // Translate hips backward and down onto cobblestones, keeping corpse strictly above floor
  const backDist = -0.14 * hit * rig.tLeg - 0.64 * fall * rig.tLeg;
  const sideDist = 0.06 * fall * rig.tLeg;
  const dropY = -0.86 * fall * rig.tLeg + bounce * 0.28 * rig.tLeg;
  shiftHipsWorld(rig, sideDist, dropY, backDist);

  // Grounding: keep standing feet on floor early, then prevent any torso/head/limb penetration below floor
  if (fall < 0.25) {
    groundLowest(rig, ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'], rig.idleToeY);
  } else {
    clampAboveFloor(rig, [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'HeadTop_End',
      'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'
    ], rig.idleToeY + 0.03 * rig.tLeg);
  }
}

// 4. Surrender: seamless looping hands-up trembling surrender
function poseSurrender(rig, u) {
  const th = u * Math.PI * 2;
  const breath = Math.sin(th);
  const tremble = Math.sin(th * 4) * 0.035 + Math.sin(th * 6) * 0.018;
  const glance = Math.sin(th + 0.7) * 0.14;

  // Wary slightly bent knees & slightly leaned back chest
  rotBoneWorld(rig, 'Hips', AXIS_LEFT, -0.05 + 0.015 * breath);
  rotBoneWorld(rig, 'Spine', AXIS_LEFT, -0.04 + 0.02 * breath);
  rotBoneWorld(rig, 'Spine1', AXIS_LEFT, -0.04 + 0.02 * breath);
  rotBoneWorld(rig, 'Spine2', AXIS_LEFT, -0.03);
  rotBoneWorld(rig, 'Neck', AXIS_LEFT, 0.06);
  rotBoneWorld(rig, 'Head', AXIS_LEFT, 0.06 + 0.02 * breath);
  rotBoneWorld(rig, 'Head', AXIS_UP, glance);

  // Both arms raised clearly above shoulders with bent elbows and palms facing forward
  pointBoneWorld(rig, 'LeftArm', new THREE.Vector3(0.76, 0.42 + 0.04 * breath + tremble, 0.32), 1);
  pointBoneWorld(rig, 'LeftForeArm', new THREE.Vector3(0.08 + tremble, 0.96, 0.26), 1);
  pointBoneWorld(rig, 'LeftHand', new THREE.Vector3(0.05, 0.94, 0.34), 0.85);

  pointBoneWorld(rig, 'RightArm', new THREE.Vector3(-0.76, 0.44 + 0.04 * breath - tremble, 0.32), 1);
  pointBoneWorld(rig, 'RightForeArm', new THREE.Vector3(-0.08 - tremble, 0.96, 0.26), 1);
  pointBoneWorld(rig, 'RightHand', new THREE.Vector3(-0.05, 0.94, 0.34), 0.85);

  // Soft defensive knees planted on floor
  rotBoneWorld(rig, 'LeftUpLeg', AXIS_LEFT, -0.14 - 0.02 * breath);
  rotBoneWorld(rig, 'LeftLeg', AXIS_LEFT, 0.26 + 0.04 * breath);
  rotBoneWorld(rig, 'LeftFoot', AXIS_LEFT, -0.12 - 0.02 * breath);
  rotBoneWorld(rig, 'RightUpLeg', AXIS_LEFT, -0.12 - 0.02 * breath);
  rotBoneWorld(rig, 'RightLeg', AXIS_LEFT, 0.24 + 0.04 * breath);
  rotBoneWorld(rig, 'RightFoot', AXIS_LEFT, -0.12 - 0.02 * breath);

  groundLowest(rig, ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'], rig.idleToeY);
}

// 5. KneelHit: leg-shot drop onto right knee (rear shin grounded flat along cobblestones), clutch leg, recover
function poseKneelHit(rig, u) {
  const down = smooth(u / 0.24);
  const up = 1 - smooth((u - 0.72) / 0.28);
  const k = Math.min(down, up);
  const painSway = k * Math.sin(u * Math.PI * 5) * 0.05;

  // Pelvis tilts forward and drops onto right knee
  rotBoneWorld(rig, 'Hips', AXIS_LEFT, 0.14 * k);
  rotBoneWorld(rig, 'Hips', AXIS_UP, -0.16 * k);
  rotBoneWorld(rig, 'Spine', AXIS_LEFT, 0.24 * k);
  rotBoneWorld(rig, 'Spine1', AXIS_LEFT, 0.22 * k);
  rotBoneWorld(rig, 'Spine2', AXIS_LEFT, 0.16 * k);
  rotBoneWorld(rig, 'Spine2', AXIS_FWD, -0.12 * k + painSway);
  rotBoneWorld(rig, 'Neck', AXIS_LEFT, -0.12 * k);
  rotBoneWorld(rig, 'Head', AXIS_LEFT, -0.16 * k);
  rotBoneWorld(rig, 'Head', AXIS_UP, 0.16 * k);

  // Left leg steps forward into a grounded 90-degree lunge; right knee + rear shin settle along the floor
  pointBoneWorld(rig, 'LeftUpLeg', new THREE.Vector3(0.08, -0.14, 0.98), k);
  pointBoneWorld(rig, 'LeftLeg', new THREE.Vector3(0.04, -0.98, 0.14), k);
  pointBoneWorld(rig, 'LeftFoot', new THREE.Vector3(0.04, -0.22, 0.97), k);

  pointBoneWorld(rig, 'RightUpLeg', new THREE.Vector3(-0.08, -0.96, -0.20), k);
  pointBoneWorld(rig, 'RightLeg', new THREE.Vector3(-0.04, -0.16, -0.98), k);
  pointBoneWorld(rig, 'RightFoot', new THREE.Vector3(-0.04, -0.56, -0.82), k);

  // Right arm reaches toward wounded leg/knee, left arm braces outward for balance
  pointBoneWorld(rig, 'RightArm', new THREE.Vector3(-0.22, -0.88, 0.42), k * 0.92);
  pointBoneWorld(rig, 'RightForeArm', new THREE.Vector3(0.24, -0.78, 0.56), k * 0.92);
  pointBoneWorld(rig, 'LeftArm', new THREE.Vector3(0.56, -0.74, 0.36), k * 0.85);
  pointBoneWorld(rig, 'LeftForeArm', new THREE.Vector3(0.32, -0.68, 0.66), k * 0.85);

  shiftHipsWorld(rig, -0.03 * rig.tLeg * k, -0.44 * rig.tLeg * k, 0.06 * rig.tLeg * k);
  groundLowest(rig, ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot', 'RightLeg'], rig.idleToeY);
}

// -----------------------------------------------------------------------------
const anims = JSON.parse(fs.readFileSync(ANIMS_PATH, 'utf8'));
const mixamo = JSON.parse(fs.readFileSync(MIXAMO_PATH, 'utf8'));
const rigs = {
  man: await loadTargetRig('man', anims.Idle),
  soldier: await loadTargetRig('soldier', anims.Idle)
};

// Never overwrite genuine Mixamo FBX clips unless --force is passed
const shouldFill = key => FORCE || !mixamo[key] || Boolean(mixamo[key].synthetic);
const filledKeys = [];

// 1) Mirror ProneRightTurn -> ProneLeftTurn
if (shouldFill('ProneLeftTurn')) {
  if (!mixamo.ProneRightTurn?.man || !mixamo.ProneRightTurn?.soldier) {
    console.warn('跳过 ProneLeftTurn：缺少源动作 ProneRightTurn');
  } else {
    const src = mixamo.ProneRightTurn;
    mixamo.ProneLeftTurn = {
      label: 'Prone Left Turn（镜像）',
      family: 'ProneLeftTurn',
      stance: 'prone',
      synthetic: true,
      dur: src.dur,
      n: src.n,
      loop: false,
      src: '合成（镜像自 Prone Right Turn.fbx）',
      man: mirrorProneTurn(rigs.man, src.man, src.n),
      soldier: mirrorProneTurn(rigs.soldier, src.soldier, src.n)
    };
    filledKeys.push('ProneLeftTurn');
    console.log(`ProneLeftTurn（镜像）: ${src.n} 帧 (${src.dur}s), mirrored from ProneRightTurn`);
  }
} else {
  console.log('ProneLeftTurn: 保留真实 Mixamo 动作');
}

// 2-5) Calibrated world-space synthetic placeholders for missing combat clips
const SYNTH_SRC = '合成占位（放入真实 Mixamo FBX 后运行 npm run anims 自动替换）';
const specs = [
  { key: 'HitBody', label: 'Hit Reaction（合成）', n: 31, loop: false, fn: poseHitBody },
  { key: 'DeathBack', label: 'Falling Back Death（合成）', n: 46, loop: false, fn: poseDeathBack },
  { key: 'Surrender', label: 'Surrender（合成）', n: 49, loop: true, fn: poseSurrender },
  { key: 'KneelHit', label: 'Kneeling Hit（合成）', n: 43, loop: false, fn: poseKneelHit }
];

for (const s of specs) {
  if (!shouldFill(s.key)) {
    console.log(`${s.key}: 保留真实 Mixamo 动作`);
    continue;
  }
  const entry = {
    label: s.label,
    family: s.key,
    synthetic: true,
    dur: r4((s.n - 1) / FPS),
    n: s.n,
    loop: s.loop,
    src: SYNTH_SRC
  };
  const notes = [];
  for (const kind of ['man', 'soldier']) {
    const res = recordFrames(rigs[kind], s.n, s.fn);
    entry[kind] = res.data;
    const dip = ((rigs[kind].idleToeY - res.minToeY) / rigs[kind].tLeg * 100).toFixed(1);
    notes.push(`${kind}: toeDip=${dip}%, endHeadY=${res.endHeadY.toFixed(2)}`);
  }
  mixamo[s.key] = entry;
  filledKeys.push(s.key);
  console.log(`${s.key}（合成）: ${s.n} 帧 (${entry.dur}s, loop=${s.loop}) | ${notes.join(' | ')}`);
}

// Validate every synthesized clip before writing atomically
for (const key of filledKeys) {
  const c = mixamo[key];
  for (const kind of ['man', 'soldier']) {
    const d = c[kind];
    if (d.hips.length !== c.n * 3) throw new Error(`${key}.${kind} hips length mismatch`);
    for (const v of d.hips) if (!Number.isFinite(v)) throw new Error(`${key}.${kind} non-finite hip`);
    for (const b of TRACKED) {
      const arr = d.q[b];
      if (!arr || arr.length !== c.n * 4) throw new Error(`${key}.${kind}.${b} q length mismatch`);
      for (let i = 0; i < c.n; i++) {
        const len = Math.hypot(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
        if (!Number.isFinite(len) || Math.abs(len - 1) > 0.01) {
          throw new Error(`${key}.${kind}.${b}[${i}] bad quat len ${len}`);
        }
      }
    }
  }
}

if (!filledKeys.length) {
  console.log('所有动作均已存在真实 Mixamo 版本，无需补入合成占位。');
  process.exit(0);
}

const temp = MIXAMO_PATH + '.' + process.pid + '.tmp';
try {
  fs.writeFileSync(temp, JSON.stringify(mixamo));
  fs.renameSync(temp, MIXAMO_PATH);
} finally {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
console.log(`\n已补入 ${filledKeys.length} 个合成/镜像动作至 ${path.relative(ROOT, MIXAMO_PATH)}：共 ${Object.keys(mixamo).length} 个动画，${(fs.statSync(MIXAMO_PATH).size / 1024).toFixed(0)} KB`);
