import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterFactory } from '../src/entities/CharacterFactory.js';
import { AssetManager } from '../src/core/AssetManager.js';
import { captureCrouchRig, posePlayerGait } from '../src/entities/CrouchGait.js';
import { PlayerController } from '../src/entities/Player.js';

const factory = CharacterFactory.prototype;
const assets = new AssetManager();
const idle = JSON.parse(readFileSync(new URL('../public/assets/chars/anims.json', import.meta.url))).Idle;
const idleClip = assets._clipFromTracks('Idle', idle.n, { hips: idle.hipsY, q: idle.q });
const dt = 1 / 60;

async function heroRig(preset) {
  // Load the shipped skeleton, skin weights and clothing into Three.js without browser textures.
  const file = readFileSync(new URL(`../public/assets/chars/hero-${preset}.glb`, import.meta.url));
  const length = file.readUInt32LE(12);
  const document = JSON.parse(file.toString('utf8', 20, 20 + length));
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  for (const key of ['materials', 'images', 'textures', 'samplers']) delete document[key];
  file.fill(0x20, 20, 20 + length);
  file.write(JSON.stringify(document), 20, length, 'utf8');
  const { scene: inner } = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.length), '');
  const bones = {};
  const headwear = [];
  inner.traverse(obj => {
    if (obj.isBone) {
      obj.name = obj.name.replace(/^mixamorig:?/, '');
      bones[obj.name] = obj;
    }
    if (obj.isSkinnedMesh && /HeroHat|braid01|Portrait/.test(obj.name)) headwear.push(obj);
  });
  assert.ok(headwear.length);
  const mesh = new THREE.Group();
  const pivot = new THREE.Group();
  const relaxClip = assets._buildRelaxIdleClip(inner);
  const metrics = assets._measureRig(inner, idleClip);
  mesh.add(pivot);
  pivot.position.y = .9;
  pivot.add(inner);
  inner.rotation.y = Math.PI / 2;
  inner.scale.setScalar(metrics.scale);
  inner.position.set(metrics.offX, metrics.footY - .9, metrics.offZ);
  const mixer = new THREE.AnimationMixer(inner);
  mesh.userData = {
    bones, pivot, mixer, crouchRig: captureCrouchRig(mesh, bones),
    w: { RelaxIdle: 1, Idle: 0 }, rate: 1,
    acts: { RelaxIdle: mixer.clipAction(relaxClip).play(), Idle: mixer.clipAction(idleClip).play() }
  };
  let x = 0, z = 0, heading = 0;
  function frame(sneak, crouch, dx = 0, dz = 0, yaw = 0, ready = .22) {
    x += dx;
    z += dz;
    heading += yaw;
    factory.poseMesh(mesh, x, z, heading, crouch > .4 ? 'Idle' : 'RelaxIdle', dt, 0, 0, ready);
    mesh.position.y = 0;
    const grip = bones.RightHand.getWorldQuaternion(new THREE.Quaternion());
    posePlayerGait(factory, mesh, sneak, crouch, dt, 0, ready);
    const pos = b => bones[b].getWorldPosition(new THREE.Vector3());
    const hips = pos('Hips'), neck = pos('Neck'), head = pos('Head');
    const forward = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const trunk = neck.clone().sub(hips);
    const pelvis = pos('Spine').sub(hips);
    const knee = pos('LeftLeg');
    const kneeBend = Math.PI - pos('LeftUpLeg').sub(knee).angleTo(pos('LeftFoot').sub(knee));
    return {
      hips, head, lean: Math.atan2(trunk.dot(forward), trunk.y),
      pelvisTilt: Math.atan2(pelvis.dot(forward), pelvis.y), kneeBend,
      gripRotation: grip.angleTo(bones.RightHand.getWorldQuaternion(new THREE.Quaternion())),
      left: pos('LeftFoot'), right: pos('RightFoot'),
      leftKnee: pos('LeftLeg'), rightKnee: pos('RightLeg')
    };
  }
  function highestVertex() {
    mesh.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let top = -Infinity;
    for (const part of headwear) {
      part.skeleton.update();
      for (let i = 0; i < part.geometry.attributes.position.count; i++) {
        part.localToWorld(part.getVertexPosition(i, v));
        top = Math.max(top, v.y);
      }
    }
    return top;
  }
  return { frame, highestVertex };
}

for (const preset of ['ranger', 'xia']) {
  test(`${preset} bends at the waist while keeping the pelvis high, and can still fold under a low beam`, async () => {
    const rig = await heroRig(preset);
    const p = new PlayerController();
    let standing;
    for (let i = 0; i < 60; i++) standing = rig.frame(0, 0);
    let last = standing;
    for (let i = 1; i <= 25; i++) {
      const now = rig.frame(i / 25, 0);
      assert.ok(now.head.distanceTo(last.head) < .035, 'the posture change should be continuous');
      assert.ok(now.hips.y > standing.hips.y - .15, 'the transition must keep the hips high');
      last = now;
    }
    assert.ok(last.hips.y > standing.hips.y - .15, `pelvis dropped ${standing.hips.y - last.hips.y} m`);
    assert.ok(last.pelvisTilt > standing.pelvisTilt + .12, 'the pelvis should tip at the hip joint');
    assert.ok(last.kneeBend < .71, `resting knee flexion ${last.kneeBend} radians`);
    assert.ok(last.lean > .53 && last.lean < 1.08, `waist tilt ${last.lean} radians`);
    assert.ok(last.head.y < standing.head.y - .12);
    assert.ok(last.leftKnee.y > .46 && last.rightKnee.y > .46);
    p.sneakK = 1;
    assert.ok(rig.highestVertex() <= p.currentHeight() + .015, 'hat/hair must fit under the stealth clearance');
    for (let i = 1; i <= 60; i++) last = rig.frame(Math.max(0, 1 - i / 24), Math.min(1, i / 24));
    assert.ok(last.hips.y < standing.hips.y - .4 && last.head.y < 1.25);
    assert.ok(last.leftKnee.y > .18 && last.rightKnee.y > .18, 'a crouch keeps the knees off the floor');
    p.sneakK = 0;
    p.crouchK = 1;
    assert.ok(rig.highestVertex() <= p.currentHeight() + .015, 'deep crouch must keep headwear inside its clearance');
    for (const [sneak, crouch] of [[1, 0], [0, 1]]) {
      for (let i = 0; i < 50; i++) last = rig.frame(sneak, crouch, 0, 0, 0, 1);
      assert.ok(last.gripRotation < .065, 'bending the trunk must preserve the direction of a raised gun');
    }
  });

  test(`${preset} keeps a planted support foot when sneaking in every direction and turning in place`, async () => {
    for (const [dx, dz, yaw] of [[.024, 0, 0], [.060, 0, 0], [-.022, 0, 0], [0, -.019, 0], [0, .019, 0], [.013, .013, 0], [0, 0, .035], [0, 0, -.035]]) {
      const rig = await heroRig(preset);
      let last = rig.frame(1, 0);
      let planted = 0, leftUp = 0, rightUp = 0;
      for (let i = 0; i < 105; i++) {
        const now = rig.frame(1, 0, dx, dz, yaw);
        if (i > 15) {
          assert.ok(now.hips.y > .93 && now.lean > .50 && now.leftKnee.y > .4 && now.rightKnee.y > .4);
          if (Math.min(now.left.distanceTo(last.left), now.right.distanceTo(last.right)) < .004) planted++;
          if (now.left.y > now.right.y + .022) leftUp++;
          if (now.right.y > now.left.y + .022) rightUp++;
          if (dz && !yaw) assert.ok(now.left.z < now.right.z - .025, 'feet crossed while strafing');
        }
        last = now;
      }
      assert.ok(planted > 65 && leftUp > 6 && rightUp > 6, `motion ${[dx, dz, yaw]}: ${[planted, leftUp, rightUp]}`);
      for (let i = 0; i < 45; i++) last = rig.frame(1, 0);
      assert.ok(Math.abs(last.left.y - last.right.y) < .005);
    }
  });
}
