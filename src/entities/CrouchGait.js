import * as THREE from 'three';
import { crouchStride, sneakStride, playerStanceHeight } from '../config/constants.js';

const clamp = THREE.MathUtils.clamp;
const hip = new THREE.Vector3(), axis = new THREE.Vector3(), bend = new THREE.Vector3();
const kneeGoal = new THREE.Vector3(), ankleGoal = new THREE.Vector3(), forward = new THREE.Vector3();
const right = new THREE.Vector3(), home = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), origin = new THREE.Vector3();
const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), turn = new THREE.Quaternion();

export function captureCrouchRig(mesh, bones) {
  const legs = [];
  for (const side of ['Left', 'Right']) {
    const thigh = bones[side + 'UpLeg'], shin = bones[side + 'Leg'], foot = bones[side + 'Foot'];
    if (!thigh || !shin || !foot) return null;
    const rest = mesh.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    const toe = bones[side + 'ToeBase'];
    // The standing rig puts the toe joint just above the sole. Keep that sole on the floor.
    if (toe) rest.y += 0.05 - mesh.worldToLocal(toe.getWorldPosition(a)).y;
    const upper = thigh.getWorldPosition(a).distanceTo(shin.getWorldPosition(b));
    const lower = shin.getWorldPosition(a).distanceTo(foot.getWorldPosition(b));
    const flat = mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foot.getWorldQuaternion(worldQ));
    legs.push({
      thigh, shin, foot, rest, flat, upper, lower, before: new THREE.Vector3(), beforeQ: new THREE.Quaternion(),
      plant: new THREE.Vector3(), lastFoot: new THREE.Vector3(), plantQ: new THREE.Quaternion(), soleQ: new THREE.Quaternion()
    });
  }
  const outward = Math.sign(legs[1].rest.z - legs[0].rest.z) || 1;
  legs[0].rest.z -= outward * 0.05;
  legs[1].rest.z += outward * 0.05;
  const sideStride = Math.abs(legs[1].rest.z - legs[0].rest.z) * 1.6;
  return { legs, sideStride, phase: 0, weight: 0, turnWeight: 0, fast: 0, lastX: NaN, lastZ: NaN, lastYaw: 0, dx: 1, dz: 0 };
}

function pointJoint(joint, child, goal) {
  joint.getWorldPosition(origin);
  child.getWorldPosition(a).sub(origin).normalize();
  b.copy(goal).sub(origin).normalize();
  turn.setFromUnitVectors(a, b).multiply(joint.getWorldQuaternion(worldQ));
  joint.quaternion.copy(joint.parent.getWorldQuaternion(parentQ).invert().multiply(turn));
}

function placeLeg(leg, goal, facing, scale) {
  leg.thigh.getWorldPosition(hip);
  axis.copy(goal).sub(hip);
  const upper = leg.upper * scale, lower = leg.lower * scale;
  const distance = clamp(axis.length(), Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
  axis.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  bend.copy(facing).addScaledVector(axis, -axis.dot(facing)).normalize();
  kneeGoal.copy(hip).addScaledVector(axis, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  pointJoint(leg.thigh, leg.shin, kneeGoal);
  pointJoint(leg.shin, leg.foot, goal);
}

export function poseCrouchWalk(cf, mesh, amount, dt, lean = 0) {
  poseGait(cf, mesh, 0, amount, dt, lean, 0, false);
}

export function posePlayerGait(cf, mesh, sneak, crouch, dt, lean = 0, gunReady = 0) {
  poseGait(cf, mesh, sneak, crouch, dt, lean, gunReady, true);
}

function advanceGait(gait, mesh, dt, amount, mix, player) {
  const x = mesh.position.x, z = mesh.position.z, yaw = mesh.rotation.y;
  const dx = x - gait.lastX, dz = z - gait.lastZ;
  const deltaYaw = Math.atan2(Math.sin(yaw - gait.lastYaw), Math.cos(yaw - gait.lastYaw));
  gait.lastX = x;
  gait.lastZ = z;
  gait.lastYaw = yaw;
  if (amount < 0.005) {
    gait.phase = gait.weight = gait.turnWeight = gait.fast = 0;
    for (const leg of gait.legs) leg.planted = undefined;
    return 0;
  }
  let travelled = 0;
  let pivotStep = 0;
  if (dt > 0) {
    const distance = Math.hypot(dx, dz);
    const maxDistance = Math.max(0.30, dt * 9);
    const moving = distance > 0.0005 && distance < maxDistance;
    if (!Number.isFinite(distance) || distance > maxDistance) {
      for (const leg of gait.legs) leg.planted = undefined;
    } else {
      // A planted pair of feet must take a step when the shoulders turn far enough, even at zero speed.
      pivotStep = player ? Math.abs(deltaYaw) / 1.45 : 0;
    }
    if (moving) {
      travelled = distance;
      const turnBlend = gait.weight < 0.05 ? 1 : 1 - Math.exp(-dt * 15);
      gait.dx += (dx / distance - gait.dx) * turnBlend;
      gait.dz += (dz / distance - gait.dz) * turnBlend;
    }
    gait.weight += ((moving ? 1 : 0) - gait.weight) * Math.min(1, dt * 15);
    const targetFast = moving ? clamp((travelled / dt - 2.15) / 1.45, 0, 1) : 0;
    gait.fast += (targetFast - gait.fast) * Math.min(1, dt * 10);
    const turning = Math.min(1, pivotStep / dt);
    gait.turnWeight += (turning - gait.turnWeight) * Math.min(1, dt * 15);
  }
  right.set(0, 0, 1).applyQuaternion(mesh.quaternion);
  const sideAmount = Math.abs(gait.dx * right.x + gait.dz * right.z);
  const stride = THREE.MathUtils.lerp(crouchStride(sideAmount, gait.sideStride), sneakStride(sideAmount, gait.fast * mix), mix) * mesh.scale.y;
  gait.phase = (gait.phase + Math.max(travelled / stride, pivotStep)) % 1;
  return stride;
}

function pitchBone(cf, bone, angle) {
  if (bone && angle) cf._rotateBoneWorldAxis(bone, right, angle);
}

function poseTorso(cf, bones, sneak, crouch, tuck, gunReady, sway, fastSneak = 0) {
  // Natural stealth stalker hunch: stronger hip-hinge (-0.27) + smooth progressive spine curve (zero sharp waist kink).
  pitchBone(cf, bones.Hips, -0.27 * sneak - 0.18 * tuck);
  pitchBone(cf, bones.Spine, -0.63 * sneak - 0.24 * tuck);
  pitchBone(cf, bones.Spine1, -0.31 * sneak - 0.08 * fastSneak - 0.36 * crouch);
  pitchBone(cf, bones.Spine2, -0.12 * sneak);
  pitchBone(cf, bones.Neck, 0.70 * sneak + 0.08 * fastSneak + 0.20 * crouch + 0.09 * tuck);
  pitchBone(cf, bones.Head, 0.34 * sneak + 0.12 * tuck);
  if (bones.Spine2 && sway) cf._rotateBoneWorldAxis(bones.Spine2, forward, sway);
  // Counter the exact chest pitch sum (-1.33 rad at sneak=1) at the shoulders so raised guns stay level.
  const carry = (0.95 + 0.38 * gunReady) * sneak + 0.08 * fastSneak + (0.38 + 0.40 * gunReady) * tuck;
  pitchBone(cf, bones.LeftShoulder, carry);
  pitchBone(cf, bones.RightShoulder, carry);
}

function plantPlayerFoot(leg, gait, phase, eased, stride) {
  const planted = phase < 0.5;
  if (leg.planted === undefined) {
    leg.plant.copy(ankleGoal);
    leg.plantQ.copy(worldQ);
  } else if (planted && !leg.planted) {
    leg.plant.copy(leg.lastFoot);
    leg.plantQ.copy(leg.soleQ);
  }
  leg.planted = planted;
  if (planted) {
    ankleGoal.x = leg.plant.x;
    ankleGoal.z = leg.plant.z;
    leg.soleQ.copy(leg.plantQ);
  } else {
    const lead = 0.25 * stride * gait.weight;
    ankleGoal.x = THREE.MathUtils.lerp(leg.plant.x, home.x + gait.dx * lead, eased);
    ankleGoal.z = THREE.MathUtils.lerp(leg.plant.z, home.z + gait.dz * lead, eased);
    leg.soleQ.copy(leg.plantQ).slerp(worldQ, eased);
  }
  leg.lastFoot.copy(ankleGoal);
}

function poseGait(cf, mesh, sneak, crouch, dt, lean, gunReady, player) {
  const gait = mesh.userData.crouchRig;
  if (!gait) return;
  const amount = Math.min(1, sneak + crouch);
  const mix = amount ? sneak / amount : 0;
  if (player) mesh.userData.pivot.position.x = -0.055 * sneak - 0.13 * crouch;
  const stride = advanceGait(gait, mesh, dt, amount, mix, player);
  if (!stride) return;
  const size = mesh.scale.y;
  forward.set(1, 0, 0).applyQuaternion(mesh.quaternion);
  const motion = Math.max(gait.weight, gait.turnWeight);
  for (const leg of gait.legs) {
    leg.foot.getWorldPosition(leg.before);
    leg.foot.getWorldQuaternion(leg.beforeQ);
  }
  const length = gait.legs[0].upper + gait.legs[0].lower;
  const fastSneak = sneak * (gait.fast || 0);
  const bob = Math.cos(gait.phase * Math.PI * 4) * (0.014 * crouch + 0.006 * sneak + 0.006 * fastSneak) * motion;
  const floor = mesh.position.y;
  let drop = (length * (0.49 * crouch + 0.056 * sneak * sneak + 0.036 * fastSneak) + bob) * size;
  mesh.position.y -= drop;
  const bones = mesh.userData.bones;
  const tuck = player ? crouch : 0;
  const sway = Math.sin(gait.phase * 2 * Math.PI) * (0.025 * sneak + 0.014 * fastSneak + 0.045 * crouch) * motion;
  poseTorso(cf, bones, sneak, crouch, tuck, gunReady, sway + lean * 0.25 * amount, fastSneak);
  if (player && bones.HeadTop_End) {
    // The hat brim and crown extend past the rig's head marker, especially when angled down.
    const top = bones.HeadTop_End.getWorldPosition(b).y + (0.12 + 0.022 * tuck) * size;
    const clearance = floor + playerStanceHeight(sneak, crouch);
    const extra = Math.max(0, top - clearance) * amount;
    mesh.position.y -= extra;
    drop += extra;
  }
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < gait.legs.length; i++) {
    const leg = gait.legs[i];
    const phase = (gait.phase + i * 0.5) % 1;
    const swing = Math.max(0, phase * 2 - 1);
    const eased = swing * swing * (3 - 2 * swing);
    const reach = phase < 0.5 ? 0.25 - phase : -0.25 + 0.5 * eased;
    const offset = stride * gait.weight * reach;
    home.copy(leg.rest);
    home.z *= 1 - 0.14 * mix;
    if (player) home.y -= 0.042;
    mesh.localToWorld(home);
    home.y += drop;
    ankleGoal.copy(home);
    ankleGoal.x += gait.dx * offset;
    ankleGoal.z += gait.dz * offset;
    worldQ.copy(mesh.quaternion).multiply(leg.flat);
    if (player) plantPlayerFoot(leg, gait, phase, eased, stride);
    else leg.soleQ.copy(worldQ);
    const lift = 0.105 - 0.050 * mix + 0.032 * mix * (gait.fast || 0);
    ankleGoal.y += Math.sin(Math.PI * swing) ** 2 * lift * size * motion;
    ankleGoal.lerp(leg.before, 1 - amount);
    placeLeg(leg, ankleGoal, forward, size);
    turn.copy(leg.beforeQ).slerp(leg.soleQ, amount);
    leg.foot.quaternion.copy(leg.foot.parent.getWorldQuaternion(parentQ).invert().multiply(turn));
  }
}
