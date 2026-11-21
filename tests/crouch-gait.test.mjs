import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { captureCrouchRig, poseCrouchWalk } from '../src/entities/CrouchGait.js';
import { CharacterFactory } from '../src/entities/CharacterFactory.js';

function walkingRig() {
  const mesh = new THREE.Group();
  const bones = {};
  function joint(name, parent, x, y, z) {
    const bone = new THREE.Bone();
    bone.position.set(x, y, z);
    parent.add(bone);
    bones[name] = bone;
    return bone;
  }
  const hips = joint('Hips', mesh, 0, .96, 0);
  const spine = joint('Spine1', hips, 0, .22, 0);
  joint('Head', spine, 0, .48, 0);
  for (const [side, z] of [['Left', -.12], ['Right', .12]]) {
    const thigh = joint(side + 'UpLeg', hips, 0, 0, z);
    const shin = joint(side + 'Leg', thigh, 0, -.45, 0);
    const foot = joint(side + 'Foot', shin, 0, -.41, 0);
    joint(side + 'ToeBase', foot, .12, -.05, 0);
  }
  mesh.userData.bones = bones;
  mesh.userData.crouchRig = captureCrouchRig(mesh, bones);
  const positionOf = bone => bone.getWorldPosition(new THREE.Vector3());
  function frame(dx = 0, dz = 0) {
    // The animation mixer supplies a fresh base pose each frame.
    for (const bone of Object.values(bones)) bone.quaternion.identity();
    mesh.position.y = 0;
    mesh.position.x += dx;
    mesh.position.z += dz;
    poseCrouchWalk(CharacterFactory.prototype, mesh, 1, 1 / 60);
    return { left: positionOf(bones.LeftFoot), right: positionOf(bones.RightFoot), head: positionOf(bones.Head) };
  }
  return { frame, mesh };
}

test('crouched feet alternate, the supporting foot stays planted and the head stays low', () => {
  for (const [dx, dz] of [[.026, 0], [-.026, 0], [0, .026]]) {
    const { frame } = walkingRig();
    let last = frame();
    let planted = 0;
    let leftRaised = 0;
    let rightRaised = 0;
    for (let i = 0; i < 135; i++) {
      const now = frame(dx, dz);
      if (i > 30) {
        assert.ok(now.head.y < 1.32);
        if (now.left.y > now.right.y + .04) leftRaised++;
        if (now.right.y > now.left.y + .04) rightRaised++;
        for (const foot of ['left', 'right']) {
          if (now[foot].distanceTo(last[foot]) < .003) planted++;
        }
        if (dz) assert.ok(now.left.z < now.right.z - .02, 'feet should keep their order when stepping sideways');
      }
      last = now;
    }
    assert.ok(leftRaised > 10 && rightRaised > 10);
    assert.ok(planted > 65);
    for (let i = 0; i < 52; i++) last = frame();
    assert.ok(Math.abs(last.left.y - last.right.y) < .003);
    assert.ok(last.head.y < 1.32);
  }
});
