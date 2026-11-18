import * as THREE from 'three';
import {
  GRAVITY,
  PLAYER_SPEED,
  PLAYER_ROLL_SPEED,
  PLAYER_JUMP_VEL,
  PLAYER_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_ROLL_HEIGHT,
  WEAPONS,
  GROUP_WORLD,
  GROUP_PROP,
  GROUP_ENEMY,
  GROUP_HANGING
} from '../config/constants.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _tmpV = new THREE.Vector3();

export class PlayerController {
  constructor() {
    this.resetAll();
  }

  resetAll() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.2;
    this.hp = 100;
    this.armor = 0;
    this.gun = 0;
    this.mags = [8, 30, 6, 0];
    this.res = [Infinity, 60, 12, 0];
    this.nades = 3;
    this.molo = 1;
    this.crouch = false;
    this.crouchK = 0;
    this.air = false;
    this.still = 0;
    this.cd = 0;
    this.reloadT = 0;
    this.rollT = 0;
    this.rollCd = 0;
    this.rdx = 0;
    this.rdz = 0;
    this.inv = 0;
    this.walk = 0;
    this.nadeCd = 0;
    this.moving = false;
    this.ads = 0;
    this.recoil = 0;
    this.bloom = 0;
    this.camY = 0;
    this.focus = 100;
    this.bulletTime = false;
    this.btK = 0;
    this.mesh = null;
  }

  resetForLevel(x, z) {
    this.x = x;
    this.y = 0;
    this.z = z;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.2;
    this.crouch = false;
    this.crouchK = 0;
    this.air = false;
    this.rollT = 0;
    this.reloadT = 0;
    this.ads = 0;
    this.recoil = 0;
    this.bloom = 0;
    this.camY = 0;
    this.still = 0;
    this.bulletTime = false;
    this.btK = 0;
  }

  currentHeight() {
    if (this.rollT > 0) return PLAYER_ROLL_HEIGHT;
    return this.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  }

  jump(audio, state) {
    if (this.air || this.rollT > 0 || state !== 'play') return;
    this.crouch = false;
    this.vy = PLAYER_JUMP_VEL;
    this.air = true;
    audio.sfx('roll');
  }

  roll(input, audio) {
    if (this.rollCd > 0 || this.rollT > 0 || this.air) return;
    const { f, r } = input.getMoveAxes();
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    let dx = c * f - s * r;
    let dz = s * f + c * r;
    if (!dx && !dz) {
      dx = c;
      dz = s;
    }
    this.rdx = dx;
    this.rdz = dz;
    this.crouch = false;
    this.rollT = 0.5;
    this.rollCd = 1.0;
    audio.sfx('roll');
  }

  switchGun(i, charFactory, audio, say) {
    if (i === this.gun) return;
    if (this.mags[i] + this.res[i] <= 0) {
      say(`${WEAPONS[i].name}没有弹药`);
      return;
    }
    this.gun = i;
    this.reloadT = 0;
    this.cd = 0.25;
    audio.sfx('tick');
    if (this.mesh) charFactory.setGun(this.mesh, WEAPONS[i].snd);
  }

  nextGun(charFactory, audio, say) {
    for (let j = 1; j <= 4; j++) {
      const i = (this.gun + j) % 4;
      if (this.mags[i] + this.res[i] > 0) {
        this.switchGun(i, charFactory, audio, say);
        return;
      }
    }
  }

  reload(audio) {
    const g = WEAPONS[this.gun];
    if (this.reloadT > 0 || this.mags[this.gun] >= g.mag || this.res[this.gun] <= 0) return;
    this.reloadT = g.reload;
    audio.sfx('reload');
  }

  updateMovement(dt, input, physics, audio, onLandDust) {
    // Non-locked keyboard / screen-edge camera yaw
    if (input.keys.ArrowLeft) this.ang -= dt * 2.4;
    if (input.keys.ArrowRight) this.ang += dt * 2.4;
    if (!input.locked && !input.isTouch) {
      const k = (input.mouse.x / window.innerWidth - 0.5) * 2;
      const a = Math.abs(k);
      if (a > 0.25) this.ang += Math.sign(k) * (a - 0.25) * 3.6 * dt;
    }

    this.cd -= dt;
    this.rollCd -= dt;
    this.nadeCd -= dt;
    if (this.inv > 0) this.inv -= dt;

    const wantAds = input.mouse.right && !input.isTouch && this.rollT <= 0 && this.reloadT <= 0 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 12);
    this.bloom = Math.max(0, this.bloom - dt * 2.4);
    this.recoil -= this.recoil * Math.min(1, dt * 7);
    this.crouchK += ((this.crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);

    const { f, r } = input.getMoveAxes();
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    const mx = c * f - s * r;
    const mz = s * f + c * r;

    let moveX = 0;
    let moveZ = 0;
    if (this.rollT > 0) {
      this.rollT -= dt;
      moveX = this.rdx * PLAYER_ROLL_SPEED * dt;
      moveZ = this.rdz * PLAYER_ROLL_SPEED * dt;
      this.walk += dt * 20;
    } else {
      const sp = PLAYER_SPEED * (1 - 0.5 * this.ads) * (this.crouch ? 0.5 : 1);
      moveX = mx * sp * dt;
      moveZ = mz * sp * dt;
      this.moving = !!(mx || mz);
      if (this.moving) this.walk += dt * 11;
    }

    const prevVy = this.vy;
    this.vy = this.air || this.vy > 0 ? this.vy - GRAVITY * dt : -2.5;
    const dy = this.vy * dt;

    const moved = physics.movePlayer(moveX, dy, moveZ);
    this.x = moved.x;
    this.y = moved.y;
    this.z = moved.z;

    if (moved.grounded) {
      if (prevVy < -4.2) {
        onLandDust?.(this.x, this.y, this.z);
        audio.sfx('land');
      }
      this.vy = 0;
      this.air = false;
    } else {
      this.air = true;
    }

    if (this.y < -2) {
      this.y = 0;
      this.vy = 0;
      physics.setPlayerPosition(this.x, 0, this.z);
    }

    this.still = this.moving || this.rollT > 0 || this.air ? 0 : this.still + dt;
    this.camY += (this.y - this.camY) * Math.min(1, dt * 9);
  }

  updateCamera(camera, baseFov, state, time, muzzle, shake, physics) {
    let yaw = this.ang;
    if (state === 'menu') yaw = -Math.PI / 2 + Math.sin(time * 0.15) * 0.5;

    const pe = this.pitch - this.recoil;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cp = Math.cos(pe);
    const spv = Math.sin(pe);

    // Shoulder position with wall occlusion check
    const targetSx = this.x - s * 0.82;
    const targetSz = this.z + c * 0.82;
    const shoulderY = this.camY + 1.75 - 0.5 * this.crouchK;
    let sx = targetSx;
    let sz = targetSz;
    const shRay = physics.castRay(
      this.x,
      shoulderY,
      this.z,
      targetSx - this.x,
      0,
      targetSz - this.z,
      0.92,
      GROUP_WORLD,
      physics.playerCollider
    );
    if (shRay && shRay.dist < 0.85) {
      const k = Math.max(0.15, (shRay.dist - 0.15) / 0.85);
      sx = this.x + (targetSx - this.x) * k;
      sz = this.z + (targetSz - this.z) * k;
    }

    const dmax = 4.75 - 1.88 * this.ads;
    const backDx = -c * cp;
    const backDy = spv;
    const backDz = -s * cp;
    let dist = dmax;

    const camHit = physics.castRay(
      sx,
      shoulderY + 0.15,
      sz,
      backDx,
      backDy,
      backDz,
      dmax,
      GROUP_WORLD,
      physics.playerCollider
    );
    if (camHit) dist = Math.max(0.45, camHit.dist - 0.35);

    const sk = shake * 0.25;
    camera.position.set(
      sx + backDx * dist + rnd(-sk, sk),
      Math.max(0.28, shoulderY + 0.15 + backDy * dist + rnd(-sk, sk)),
      sz + backDz * dist + rnd(-sk, sk)
    );
    _tmpV.set(
      camera.position.x + c * cp * 10,
      camera.position.y - spv * 10,
      camera.position.z + s * cp * 10
    );
    camera.lookAt(_tmpV);

    const f = baseFov * (1 - 0.3 * this.ads) - 4.5 * (this.btK || 0) + muzzle * 0.5;
    if (Math.abs(f - camera.fov) > 0.01) {
      camera.fov = f;
      camera.updateProjectionMatrix();
    }
  }

  aim3D(camera, physics) {
    const pe = this.pitch - this.recoil;
    const cp = Math.cos(pe);
    const dx = Math.cos(this.ang) * cp;
    const dy = -Math.sin(pe);
    const dz = Math.sin(this.ang) * cp;
    const ox = camera.position.x;
    const oy = camera.position.y;
    const oz = camera.position.z;

    const startOffset = Math.hypot(this.x - ox, this.z - oz) + 0.45;
    const sx = ox + dx * startOffset;
    const sy = oy + dy * startOffset;
    const sz = oz + dz * startOffset;

    const hit = physics.castRay(
      sx,
      sy,
      sz,
      dx,
      dy,
      dz,
      140,
      GROUP_WORLD | GROUP_PROP | GROUP_ENEMY | GROUP_HANGING,
      physics.playerCollider
    );

    if (hit) {
      const k = hit.meta?.kind;
      return {
        x: hit.point.x,
        y: Math.max(0, hit.point.y),
        z: hit.point.z,
        d: hit.dist + startOffset,
        hit: k === 'enemy' || k === 'barrel' || k === 'lantern'
      };
    }

    return {
      x: ox + dx * 140,
      y: oy + dy * 140,
      z: oz + dz * 140,
      d: 140,
      hit: false
    };
  }
}
