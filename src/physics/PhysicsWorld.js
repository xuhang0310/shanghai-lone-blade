import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  GROUP_WORLD,
  GROUP_PROP,
  GROUP_PLAYER,
  GROUP_ENEMY,
  GROUP_DEBRIS,
  GROUP_PROJECTILE,
  GROUP_HANGING,
  PLAYER_RADIUS,
  makeCollisionGroups
} from '../config/constants.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

export class PhysicsWorld {
  constructor() {
    this.ready = false;
    this.world = null;
    this.eventQueue = null;
    this.charController = null;
    this.colliderMap = new Map();
    this.bodyMap = new Map();
    this.dynamicLinks = []; // { body, mesh, life, maxLife, fade, onStep }
    this.hangingLanterns = []; // { anchorBody, lanternBody, joint, collider, mesh, broken, tx, ty }
    this.projectiles = []; // { body, collider, mesh, data }
    this.pendingRemoveBodies = [];
    this.pendingRemoveJoints = [];
    this.playerBody = null;
    this.playerCollider = null;
    this.playerHalfHeight = 0.46;
    this.lastGrounded = true;
    this.onProjectileContact = null;
  }

  async init() {
    if (this.ready) return;
    await RAPIER.init();
    this.ready = true;
  }

  reset() {
    if (this.charController && this.world) {
      try { this.world.removeCharacterController(this.charController); } catch {}
    }
    if (this.eventQueue) {
      try { this.eventQueue.free(); } catch {}
    }
    if (this.world) {
      try { this.world.free(); } catch {}
    }
    this.colliderMap.clear();
    this.bodyMap.clear();
    this.dynamicLinks = [];
    this.hangingLanterns = [];
    this.projectiles = [];
    this.pendingRemoveBodies = [];
    this.pendingRemoveJoints = [];
    this.playerBody = null;
    this.playerCollider = null;

    this.world = new RAPIER.World({ x: 0, y: -19.0, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.charController = this.world.createCharacterController(0.03);
    this.charController.enableAutostep(0.35, 0.22, true);
    this.charController.enableSnapToGround(0.22);
    this.charController.setApplyImpulsesToDynamicBodies(true);
    this.charController.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.charController.setMinSlopeSlideAngle((30 * Math.PI) / 180);
  }

  flushPending() {
    for (const j of this.pendingRemoveJoints) {
      try { this.world.removeImpulseJoint(j, true); } catch {}
    }
    this.pendingRemoveJoints.length = 0;

    for (const b of this.pendingRemoveBodies) {
      if (!b) continue;
      try {
        const nCols = b.numColliders();
        for (let i = 0; i < nCols; i++) {
          const c = b.collider(i);
          if (c) this.colliderMap.delete(c.handle);
        }
        this.bodyMap.delete(b.handle);
        this.world.removeRigidBody(b);
      } catch {}
    }
    this.pendingRemoveBodies.length = 0;
  }

  warmupStep() {
    if (!this.world) return;
    this.world.step();
  }

  addGroundPlane(width, depth) {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(width * 0.5, -0.25, depth * 0.5)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width * 0.65, 0.25, depth * 0.65)
        .setFriction(0.85)
        .setCollisionGroups(makeCollisionGroups(GROUP_WORLD, 0xffff)),
      rb
    );
    this.colliderMap.set(col.handle, { kind: 'ground' });
    return col;
  }

  addStaticBox(cx, cy, cz, hx, hy, hz, rotY = 0, meta = { kind: 'wall' }, group = GROUP_WORLD) {
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz);
    if (rotY) {
      _q.setFromAxisAngle(_yAxis, rotY);
      rbDesc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    const rb = this.world.createRigidBody(rbDesc);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.75)
        .setCollisionGroups(makeCollisionGroups(group, 0xffff)),
      rb
    );
    if (meta) this.colliderMap.set(col.handle, meta);
    this.bodyMap.set(rb.handle, rb);
    return { rb, col };
  }

  createPlayer(x, y, z) {
    const halfH = this.playerHalfHeight;
    const centerY = y + halfH + PLAYER_RADIUS;
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, centerY, z)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, PLAYER_RADIUS)
        .setCollisionGroups(makeCollisionGroups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY)),
      rb
    );
    this.playerBody = rb;
    this.playerCollider = col;
    this.colliderMap.set(col.handle, { kind: 'player' });
    return { rb, col };
  }

  setPlayerPosition(x, footY, z) {
    if (!this.playerBody) return;
    const centerY = footY + this.playerHalfHeight + PLAYER_RADIUS;
    this.playerBody.setNextKinematicTranslation({ x, y: centerY, z });
    this.playerBody.setTranslation({ x, y: centerY, z }, true);
  }

  movePlayer(desiredDx, desiredDy, desiredDz) {
    if (!this.playerBody || !this.playerCollider) {
      return { x: 0, y: 0, z: 0, grounded: true };
    }
    this.charController.computeColliderMovement(
      this.playerCollider,
      { x: desiredDx, y: desiredDy, z: desiredDz },
      undefined,
      makeCollisionGroups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP)
    );
    const move = this.charController.computedMovement();
    const grounded = this.charController.computedGrounded();
    const cur = this.playerBody.translation();
    const nx = cur.x + move.x;
    const ny = cur.y + move.y;
    const nz = cur.z + move.z;
    this.playerBody.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.lastGrounded = grounded;
    return {
      x: nx,
      y: ny - (this.playerHalfHeight + PLAYER_RADIUS),
      z: nz,
      grounded
    };
  }

  createEnemyCollider(enemy, x, z, radius, height) {
    const halfH = Math.max(0.15, height * 0.5 - radius);
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, halfH + radius, z)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, radius)
        .setCollisionGroups(makeCollisionGroups(GROUP_ENEMY, GROUP_WORLD | GROUP_PROP | GROUP_PROJECTILE)),
      rb
    );
    this.colliderMap.set(col.handle, { kind: 'enemy', enemy });
    this.bodyMap.set(rb.handle, rb);
    return { rb, col, radius, halfH };
  }

  updateEnemyCollider(e, x, z, height) {
    if (!e.phys) return;
    const cy = Math.max(e.phys.radius + 0.05, height * 0.5);
    e.phys.rb.setNextKinematicTranslation({ x, y: cy, z });
  }

  queueRemoveBody(rb) {
    if (rb) this.pendingRemoveBodies.push(rb);
  }

  createDynamicBarrel(mesh, x, y, z, radius, halfHeight, meta) {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + halfHeight, z)
        .setLinearDamping(0.45)
        .setAngularDamping(0.6)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius)
        .setDensity(1.4)
        .setFriction(0.7)
        .setRestitution(0.2)
        .setCollisionGroups(makeCollisionGroups(GROUP_PROP, GROUP_WORLD | GROUP_PROP | GROUP_PLAYER | GROUP_ENEMY | GROUP_DEBRIS | GROUP_PROJECTILE)),
      rb
    );
    this.colliderMap.set(col.handle, meta);
    this.bodyMap.set(rb.handle, rb);
    const link = { body: rb, col, mesh, life: Infinity, maxLife: Infinity, fade: false, yOffset: -halfHeight };
    this.dynamicLinks.push(link);
    return link;
  }

  removeDynamicLink(link, parent) {
    if (!link) return;
    if (link.mesh && parent) parent.remove(link.mesh);
    const idx = this.dynamicLinks.indexOf(link);
    if (idx !== -1) this.dynamicLinks.splice(idx, 1);
    if (link.body) {
      this.pendingRemoveBodies.push(link.body);
      link.body = null;
    }
  }

  spawnDynamicDebris(mesh, x, y, z, hx, hy, hz, vx, vy, vz, avx, avy, avz, life = 7.5) {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: avx, y: avy, z: avz })
        .setLinearDamping(0.25)
        .setAngularDamping(0.35)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(0.8)
        .setFriction(0.65)
        .setRestitution(0.32)
        .setCollisionGroups(makeCollisionGroups(GROUP_DEBRIS, GROUP_WORLD | GROUP_PROP | GROUP_DEBRIS)),
      rb
    );
    this.bodyMap.set(rb.handle, rb);
    const link = { body: rb, col, mesh, life, maxLife: life, fade: true, yOffset: 0 };
    this.dynamicLinks.push(link);
    return link;
  }

  createHangingLantern(ax, ay, az, mesh, ropeLen = 0.34) {
    const anchorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(ax, ay, az)
    );
    const lanternBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(ax, ay - ropeLen, az)
        .setLinearDamping(0.45)
        .setAngularDamping(0.85)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.22)
        .setDensity(1.2)
        .setRestitution(0.35)
        .setCollisionGroups(makeCollisionGroups(GROUP_HANGING, GROUP_WORLD | GROUP_PROP | GROUP_DEBRIS)),
      lanternBody
    );
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: ropeLen, z: 0 }),
      anchorBody,
      lanternBody,
      true
    );
    const entry = { anchorBody, lanternBody, col, joint, mesh, broken: false, hitCount: 0 };
    this.colliderMap.set(col.handle, { kind: 'lantern', entry });
    this.hangingLanterns.push(entry);
    return entry;
  }

  hitLantern(entry, dx, dy, dz, power = 1.6) {
    if (!entry || entry.broken) return false;
    entry.lanternBody.applyImpulse({ x: dx * power, y: dy * power, z: dz * power }, true);
    entry.hitCount++;
    if (entry.hitCount >= 1 && entry.joint) {
      entry.broken = true;
      this.pendingRemoveJoints.push(entry.joint);
      entry.joint = null;
      return true;
    }
    return false;
  }

  spawnProjectile(mesh, x, y, z, vx, vy, vz, isMolotov, data) {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 })
        .setCcdEnabled(true)
        .setLinearDamping(0.15)
        .setAngularDamping(0.4)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.11)
        .setDensity(1.5)
        .setFriction(0.6)
        .setRestitution(isMolotov ? 0.08 : 0.48)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(makeCollisionGroups(GROUP_PROJECTILE, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY)),
      rb
    );
    const entry = { body: rb, collider: col, mesh, isMolotov, data, dead: false };
    this.colliderMap.set(col.handle, { kind: 'projectile', entry });
    this.projectiles.push(entry);
    return entry;
  }

  spawnCorpseBody(mesh, x, z, initialYaw, dirSign, pushX, pushZ, scale = 1, slideImpulse = 4.5) {
    const halfH = 0.72 * scale;
    _q.setFromAxisAngle(_yAxis, initialYaw);
    _q2.setFromAxisAngle(_zAxis, dirSign * 0.34);
    _q.multiply(_q2);
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.82 * scale, z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinvel(pushX * slideImpulse, 1.3, pushZ * slideImpulse)
        .setAngvel({
          x: pushZ * 6.0 + (Math.random() - 0.5) * 1.6,
          y: (Math.random() - 0.5) * 2.5,
          z: -pushX * 6.0 + (Math.random() - 0.5) * 1.6
        })
        .setLinearDamping(1.2)
        .setAngularDamping(2.2)
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15 * scale, halfH, 0.27 * scale)
        .setDensity(1.6)
        .setFriction(0.88)
        .setRestitution(0.04)
        .setCollisionGroups(makeCollisionGroups(GROUP_DEBRIS, GROUP_WORLD | GROUP_PROP | GROUP_DEBRIS)),
      rb
    );
    this.colliderMap.set(col.handle, { kind: 'corpse', body: rb, mesh });
    // Align waist pivot (~0.82*scale) cleanly so sprawled corpse rests flat on wet ground
    const link = {
      body: rb,
      col,
      mesh,
      life: 24,
      maxLife: 24,
      fade: true,
      localOffset: new THREE.Vector3(0, -0.82 * scale, 0)
    };
    this.dynamicLinks.push(link);
    return link;
  }

  applyExplosionImpulse(x, y, z, radius, strength) {
    const pushBody = (rb, massMul = 1) => {
      if (!rb) return;
      const t = rb.translation();
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      const d = Math.hypot(dx, dy, dz) || 0.01;
      if (d > radius) return;
      const falloff = (1 - d / radius) * strength * massMul;
      rb.wakeUp();
      rb.applyImpulse(
        {
          x: (dx / d) * falloff,
          y: Math.max(0.35, dy / d + 0.55) * falloff,
          z: (dz / d) * falloff
        },
        true
      );
    };

    for (const l of this.dynamicLinks) {
      if (l.body && l.life > 0) pushBody(l.body, l.fade ? 0.45 : 1.0);
    }
    for (const h of this.hangingLanterns) {
      if (!h.broken) pushBody(h.lanternBody, 0.35);
    }
  }

  castRay(ox, oy, oz, dx, dy, dz, maxDist, groupMask, excludeCollider = null) {
    if (!this.world) return null;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ray = new RAPIER.Ray(
      { x: ox, y: oy, z: oz },
      { x: dx / len, y: dy / len, z: dz / len }
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      makeCollisionGroups(0xffff, groupMask),
      excludeCollider || undefined
    );
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      dist: t,
      point: {
        x: ox + (dx / len) * t,
        y: oy + (dy / len) * t,
        z: oz + (dz / len) * t
      },
      normal: hit.normal,
      collider: hit.collider,
      meta: this.colliderMap.get(hit.collider.handle) || null
    };
  }

  step(dt, scene) {
    if (!this.world) return;
    this.flushPending();
    this.world.timestep = Math.min(0.033, Math.max(0.004, dt));
    this.world.step(this.eventQueue);

    // Drain collision events for grenades/molotovs
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const m1 = this.colliderMap.get(h1);
      const m2 = this.colliderMap.get(h2);
      if (m1?.kind === 'projectile' && !m1.entry.dead) {
        this.onProjectileContact?.(m1.entry, m2 || null);
      } else if (m2?.kind === 'projectile' && !m2.entry.dead) {
        this.onProjectileContact?.(m2.entry, m1 || null);
      }
    });

    // Sync dynamic meshes
    for (let i = this.dynamicLinks.length - 1; i >= 0; i--) {
      const l = this.dynamicLinks[i];
      if (l.life !== Infinity) {
        l.life -= dt;
        if (l.life <= 0) {
          scene?.remove(l.mesh);
          this.pendingRemoveBodies.push(l.body);
          this.dynamicLinks.splice(i, 1);
          continue;
        }
        if (l.fade && l.life < 1.2 && l.mesh.scale) {
          const s = Math.max(0.01, l.life / 1.2);
          if (!l._baseScale) l._baseScale = l.mesh.scale.clone();
          l.mesh.scale.copy(l._baseScale).multiplyScalar(s);
        }
      }
      const p = l.body.translation();
      const r = l.body.rotation();
      l.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      const cr = l.mesh?.userData?.corpseRelax;
      if (cr && cr.t < cr.dur) {
        cr.t = Math.min(cr.dur, cr.t + dt);
        const k = cr.t / cr.dur;
        const s = k * k * (3 - 2 * k);
        for (const tr of cr.tracks) {
          tr.bone.quaternion.slerpQuaternions(tr.fromQ, tr.toQ, s);
        }
      }
      if (l.localOffset) {
        _v.copy(l.localOffset).applyQuaternion(l.mesh.quaternion);
        l.mesh.position.set(p.x + _v.x, p.y + _v.y, p.z + _v.z);
      } else if (l.yOffset) {
        _v.set(0, l.yOffset, 0).applyQuaternion(l.mesh.quaternion);
        l.mesh.position.set(p.x + _v.x, p.y + _v.y, p.z + _v.z);
      } else {
        l.mesh.position.set(p.x, p.y, p.z);
      }
    }

    for (const h of this.hangingLanterns) {
      const p = h.lanternBody.translation();
      const r = h.lanternBody.rotation();
      h.mesh.position.set(p.x, p.y, p.z);
      h.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (h.glowSprite) h.glowSprite.position.set(p.x, p.y, p.z);
      if (h.wireLine && !h.broken) {
        const ap = h.anchorBody.translation();
        const pos = h.wireLine.geometry.attributes.position;
        pos.setXYZ(0, ap.x, ap.y, ap.z);
        pos.setXYZ(1, p.x, p.y + 0.18, p.z);
        pos.needsUpdate = true;
      } else if (h.wireLine && h.broken) {
        h.wireLine.visible = false;
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.dead) {
        this.pendingRemoveBodies.push(pr.body);
        this.projectiles.splice(i, 1);
        continue;
      }
      const p = pr.body.translation();
      const r = pr.body.rotation();
      pr.mesh.position.set(p.x, p.y, p.z);
      pr.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  getBodyCount() {
    return this.world ? this.world.bodies.len() : 0;
  }
}
