import * as THREE from 'three';
import { MELEE_WINDUP, MELEE_RECOVERY, enemyStanceHeight } from '../config/constants.js';
import { motionVariant } from './Motion.js';

// Location-based hit reactions (RDR / Euphoria style, procedural):
//   head  -> head snaps back (hat flies)        torso -> stagger, twisting away from the hit side
//   legs  -> stumble down onto one knee, limp   gun arm -> weapon knocked out of the hand, surrender
//   badly wounded -> collapse and crawl away until bleeding out
// classifyHit() names the body part; EnemyManager drives the states; driveEnemyClips() plays the matching
// Mixamo clip when one has been converted (tools/convert-mixamo.mjs), and poseReaction() layers procedural
// motion for whatever no clip covers.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = x => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
// Fast attack, eased release: 0 -> 1 -> 0 over `dur`, peaking at `peak` (fraction)
const pulse = (t, dur, peak) => {
  const u = clamp(t / dur, 0, 1);
  return u < peak ? smooth(u / peak) : 1 - smooth((u - peak) / (1 - peak));
};

const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _foot = new THREE.Vector3();

// Bend the rig and lower the hips by the actual change in foot height.
// Both hero presets and the NPC rigs use the same named leg chains.
export function poseLowStance(cf, mesh, amount, side = 0) {
  if (amount < 0.005) return;
  const b = mesh.userData.bones;
  if (!b.LeftFoot || !b.RightFoot) return;
  const sole = () => Math.min(b.LeftFoot.getWorldPosition(_foot).y, b.RightFoot.getWorldPosition(_foot).y);
  const original = sole();
  _right.set(0, 0, 1).applyQuaternion(mesh.quaternion);
  _fwd.set(1, 0, 0).applyQuaternion(mesh.quaternion);
  for (const leg of ['Left', 'Right']) {
    cf._rotateBoneWorldAxis(b[leg + 'UpLeg'], _right, 1.12 * amount);
    cf._rotateBoneWorldAxis(b[leg + 'Leg'], _right, -2.14 * amount);
    cf._rotateBoneWorldAxis(b[leg + 'Foot'], _right, 1.02 * amount);
  }
  if (b.Spine1) cf._rotateBoneWorldAxis(b.Spine1, _right, -0.32 * amount);
  if (b.Neck) cf._rotateBoneWorldAxis(b.Neck, _right, 0.22 * amount);
  if (side && b.Spine2) cf._rotateBoneWorldAxis(b.Spine2, _fwd, 0.28 * side);
  mesh.position.y += original - sole();
}

export function classifyHit(e, pt, head) {
  if (head) return 'head';
  const k = (e.ht || 1.8) / 1.8;
  const y = pt.y * 1.8 / enemyStanceHeight(e);
  const s = Math.sin(e.ang);
  const c = Math.cos(e.ang);
  const lr = (-(pt.x - e.x) * s + (pt.z - e.z) * c) / k; // + = enemy's right
  if (y < 0.86) return lr >= 0 ? 'legR' : 'legL';
  if (y > 0.95 && y < 1.5 && Math.abs(lr) > 0.2) return lr > 0 ? 'armR' : 'armL';
  return 'torso';
}

const HIT_CLIPS = {
  headSnap: ['HitHead', 'HitBody'],
  stagger: ['HitBody', 'HitStomach'],
  kneel: ['KneelHit']
};

// Picks the overlay clip for the enemy's state; returns the loop key in use (or null). One-shot hit
// clips play once per reaction; looping states (crawl, surrender, limp) hold until the state ends.
export function driveEnemyClips(cf, m, e) {
  const u = m.userData;
  const clips = u.clips;
  if (!clips) return null;
  if (e.executing) {
    if (u.ov) cf.stopClip(m, 0.12);
    return (e.clipLoop = null);
  }

  const r = e.react;
  if (r && r !== e._clipReact) {
    e._clipReact = r;
    const opts = (HIT_CLIPS[r.kind] || []).filter(k => clips[k]);
    const family = r.kind === 'headSnap' ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
    const key = family && motionVariant(clips, family, u.lastHit);
    if (key && cf.playClip(m, key, { fadeIn: 0.05, fadeOut: 0.3 })) u.lastHit = r.clip = key;
  }

  let loop = null;
  if (e.downed && clips.Crawl) loop = 'Crawl';
  else if (e.handsUp && clips.Surrender && !(r?.kind === 'disarm' && r.t < 0.35)) loop = 'Surrender';
  else if (e.limpT > 0 && e.moving && clips.InjuredWalk) loop = 'InjuredWalk';
  e.clipLoop = loop;

  const ov = u.ov;
  if (ov && !ov.loop && !ov.stopping) return loop; // let the hit clip finish; the loop resumes after
  if (loop) {
    if (!ov || ov.key !== loop || ov.stopping) cf.playClip(m, loop, { loop: true, fadeIn: loop === 'Crawl' ? 0.4 : 0.25, fadeOut: 0.3 });
    if (loop === 'InjuredWalk') cf.setClipSpeed(m, clamp((e.spd || 1.5) / 1.4, 0.7, 1.6));
  } else if (ov && ov.loop && !ov.stopping) {
    cf.stopClip(m, 0.3);
  }
  return loop;
}

// Death clip for how and where the enemy was hit, or null for the procedural fall
export function deathClipFor(e, part, dx, dz, clips) {
  if (!clips) return null;
  const fromBehind = (dx || 0) * Math.cos(e.ang) + (dz || 0) * Math.sin(e.ang) > 0;
  if (part === 'head' && clips.DeathHead) return motionVariant(clips, 'DeathHead');
  if (part === 'legL' || part === 'legR' || fromBehind) return motionVariant(clips, 'DeathForward');
  return motionVariant(clips, 'DeathBack');
}

// Arm pose for the reaction (fed to poseMesh through userData.execPose), or null
export function reactionArmPose(e, time) {
  if (e.clipLoop === 'Crawl' || e.clipLoop === 'Surrender' || e.proneTurning) return null;
  if (e.downed) {
    const ph = 0.5 + 0.5 * Math.sin(e.walk * 2.4);
    const w = e.react?.kind === 'down' ? smooth(e.react.t / 0.5) : 1;
    return { a: 'crawl_l', b: 'crawl_r', t: ph, w };
  }
  if (e.handsUp) {
    const r = e.react?.kind === 'disarm' ? e.react : null;
    if (r && r.t < 0.35) return { a: 'disarm_fling', b: 'disarm_fling', t: 1, w: smooth(r.t / 0.12) };
    const tremble = 0.06 * Math.sin(time * 23);
    return { a: 'disarm_fling', b: 'surrender', t: 1, w: clamp(0.94 + tremble, 0, 1) };
  }
  if (!e.react && !e.downed) {
    if (e.windupT > 0) {
      const phase = 1 - e.windupT / MELEE_WINDUP;
      return phase < 0.72
        ? { a: 'wary_guard', b: 'melee_windup', t: smooth(phase / 0.72), w: 1 }
        : { a: 'melee_windup', b: 'strike', t: smooth((phase - 0.72) / 0.28), w: 1 };
    }
    if (e.recoveryT > 0) return { a: 'strike', b: 'wary_guard', t: smooth(1 - e.recoveryT / MELEE_RECOVERY), w: 1 };
    if (e.guarding) return { a: 'wary_guard', b: 'wary_guard', t: 0, w: 0.85 };
  }
  return null;
}

// Whole-body reaction layer, applied right after CharacterFactory.poseMesh()
export function poseReaction(cf, m, e) {
  const u = m.userData;
  const r = e.react?.clip ? null : e.react;
  const limping = e.limpT > 0 && e.moving && !e.downed && e.clipLoop !== 'InjuredWalk';
  const proneProc = e.downed && e.clipLoop !== 'Crawl' && !e.proneTurning;
  if (!r && !proneProc && !limping) {
    if (u.reactPivot) {
      u.reactPivot = false;
      u.pivot.rotation.z = 0;
      u.pivot.position.set(0, 0.9, 0);
    }
    return;
  }
  u.reactPivot = true;
  const B = u.bones;
  const t = r ? r.t : 0;

  // 1. Whole-body placement first, so the bone rotations below see this frame's pivot
  let drop = 0;
  let prone = 0;
  let kneel = 0;
  let snap = 0;
  let stag = 0;
  if (r?.kind === 'headSnap') snap = pulse(t, r.dur, 0.14);
  else if (r?.kind === 'stagger' || r?.kind === 'disarm') stag = pulse(t, r.dur, 0.2);
  else if (r?.kind === 'kneel') kneel = Math.min(smooth(t / 0.24), 1 - smooth((t - (r.dur - 0.4)) / 0.4));
  if (proneProc) prone = r?.kind === 'down' ? smooth(t / 0.55) : 1;
  const step = limping ? Math.abs(Math.sin(e.walk * Math.PI * 0.5)) : 0;
  drop = Math.max(0.06 * stag, 0.44 * kneel, 0.045 * step);
  u.pivot.rotation.z = -Math.PI * 0.5 * 0.97 * prone;
  u.pivot.position.set(-0.32 * prone, 0.9 - drop - 0.66 * prone, 0);

  // 2. Bone layer in world axes of the character (right = pitch axis, up = twist axis)
  _right.set(0, 0, 1).applyQuaternion(m.quaternion);
  _fwd.set(1, 0, 0).applyQuaternion(m.quaternion);
  const rot = (bone, axis, a) => {
    if (bone && Math.abs(a) > 1e-4) cf._rotateBoneWorldAxis(bone, axis, a);
  };

  if (snap) {
    rot(B.Spine2, _right, 0.16 * snap);
    rot(B.Neck, _right, 0.2 * snap);
    rot(B.Head, _right, 0.5 * snap);
    rot(B.Head, _up, 0.25 * snap * r.side);
  }
  if (stag) {
    rot(B.Spine1, _up, -0.38 * stag * r.side);
    rot(B.Spine2, _right, 0.24 * stag);
    rot(B.Head, _right, 0.14 * stag);
  }
  if (kneel) {
    // Hit leg folds to put the knee down, the other leg plants its foot forward
    const hitL = r.side < 0;
    rot(hitL ? B.LeftUpLeg : B.RightUpLeg, _right, -0.12 * kneel);
    rot(hitL ? B.LeftLeg : B.RightLeg, _right, -1.45 * kneel);
    rot(hitL ? B.RightUpLeg : B.LeftUpLeg, _right, 1.38 * kneel);
    rot(hitL ? B.RightLeg : B.LeftLeg, _right, -1.4 * kneel);
    rot(B.Spine1, _right, -0.3 * kneel);
    rot(B.Head, _right, 0.18 * kneel);
  }
  if (prone) {
    // Head up looking ahead, legs dragging with a weak alternating push
    const ph = Math.sin(e.walk * 2.4);
    const buckle = r?.kind === 'down' ? pulse(t, 0.55, 0.45) : 0;
    rot(B.Neck, _right, -0.45 * prone);
    rot(B.Head, _right, -0.35 * prone);
    rot(B.LeftUpLeg, _right, (0.12 + 0.12 * ph) * prone);
    rot(B.RightUpLeg, _right, (0.12 - 0.12 * ph) * prone);
    rot(B.LeftLeg, _right, (-0.25 - 0.2 * Math.max(0, ph)) * prone - 0.9 * buckle);
    rot(B.RightLeg, _right, (-0.25 - 0.2 * Math.max(0, -ph)) * prone - 0.9 * buckle);
  }
  if (step) rot(B.Spine1, _fwd, 0.16 * (e.limpSide || 1) * step);
}
