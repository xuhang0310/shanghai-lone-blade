import * as THREE from 'three';
import {
  GRAVITY,
  PLAYER_WALK_SPEED,
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
    this.loadout = [0, 3, 5];
    this.walkDefault = true;
    this.combatStance = false;
    this.resetAll();
  }

  resetAll(keepLoadout = false) {
    const savedLoadout = keepLoadout && this.loadout?.length ? this.loadout.slice(0, 3) : [0, 3, 5];
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.05;
    this.hp = 100;
    this.armor = 0;
    this.loadout = savedLoadout;
    this.slot = 0;
    this.gun = this.loadout[0];
    this.mags = WEAPONS.map(w => w.mag);
    this.res = WEAPONS.map(w => w.initRes);
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
    this.stepAccum = 0;
    this.execT = 0;
    this.nadeCd = 0;
    this.moving = false;
    this.sprinting = false;
    this.gunHoldT = 0;
    this.gunReady = 0;
    this.ads = 0;
    this.recoil = 0;
    this.bloom = 0;
    this.camY = 0;
    this.focus = 100;
    this.bulletTime = false;
    this.btK = 0;
    this.diveT = 0;
    this.execCam = null;
    this.mesh = null;
  }

  resetForLevel(x, z) {
    this.x = x;
    this.y = 0;
    this.z = z;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.05;
    this.crouch = false;
    this.crouchK = 0;
    this.air = false;
    this.rollT = 0;
    this.diveT = 0;
    this.execT = 0;
    this.stepAccum = 0;
    this.reloadT = 0;
    this.sprinting = false;
    this.gunHoldT = 0;
    this.gunReady = this.combatStance ? 1 : 0;
    this.ads = 0;
    this.recoil = 0;
    this.bloom = 0;
    this.camY = 0;
    this.still = 0;
    this.bulletTime = false;
    this.btK = 0;
    this.execCam = null;
    if (!this.loadout.length) this.loadout = [0];
    if (this.slot >= this.loadout.length) this.slot = 0;
    this.gun = this.loadout[this.slot];
  }

  currentHeight() {
    if (this.rollT > 0 || this.diveT > 0) return PLAYER_ROLL_HEIGHT;
    return this.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  }

  jump(audio, state) {
    if (this.air || this.rollT > 0 || this.diveT > 0 || state !== 'play') return;
    this.crouch = false;
    this.vy = PLAYER_JUMP_VEL;
    this.air = true;
    audio.sfx('roll');
  }

  roll(input, audio) {
    if (this.rollCd > 0 || this.rollT > 0 || this.diveT > 0 || this.air) return;
    const { f, r } = input.getMoveAxes();
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    let dx = c * f - s * r;
    let dz = s * f + c * r;
    if (!dx && !dz) {
      dx = c;
      dz = s;
    }
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    if ((this.bulletTime || input.mouse.right) && this.focus >= 16 && (f || r)) {
      this.rdx = dx;
      this.rdz = dz;
      this.crouch = false;
      this.diveT = 0.82;
      this.rollCd = 1.15;
      this.vy = 3.5;
      this.air = true;
      this.focus = Math.max(0, this.focus - 14);
      audio.sfx('slowon');
      audio.sfx('roll');
      return;
    }
    this.rdx = dx;
    this.rdz = dz;
    this.crouch = false;
    this.rollT = 0.5;
    this.rollCd = 1.0;
    audio.sfx('roll');
  }

  switchSlot(slotIdx, charFactory, audio, say) {
    if (slotIdx < 0 || slotIdx >= this.loadout.length) return;
    this.slot = slotIdx;
    const wIdx = this.loadout[slotIdx];
    if (wIdx === this.gun) return;
    this.gun = wIdx;
    this.reloadT = 0;
    this.cd = 0.22;
    audio.sfx('tick');
    if (this.mesh) charFactory.setGun(this.mesh, WEAPONS[wIdx].modelKey);
    say?.(WEAPONS[wIdx].fullName);
  }

  switchGun(i, charFactory, audio, say) {
    const sIdx = this.loadout.indexOf(i);
    if (sIdx !== -1) {
      this.switchSlot(sIdx, charFactory, audio, say);
      return;
    }
    if (i < 0 || i >= WEAPONS.length || i === this.gun) return;
    if (this.mags[i] + this.res[i] <= 0) {
      say(`${WEAPONS[i].name}没有弹药`);
      return;
    }
    this.gun = i;
    this.reloadT = 0;
    this.cd = 0.25;
    audio.sfx('tick');
    if (this.mesh) charFactory.setGun(this.mesh, WEAPONS[i].modelKey);
  }

  nextGun(charFactory, audio, say) {
    if (this.loadout.length <= 1) return;
    const nextSlot = (this.slot + 1) % this.loadout.length;
    this.switchSlot(nextSlot, charFactory, audio, say);
  }

  reload(audio) {
    const g = WEAPONS[this.gun];
    if (this.reloadT > 0 || this.mags[this.gun] >= g.mag || this.res[this.gun] <= 0) return;
    this.reloadT = g.reload;
    audio.sfx('reload');
  }

  updateMovement(dt, input, physics, audio, onLandDust, levelStyle = 'cobble') {
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
    if (this.execT > 0) this.execT = Math.max(0, this.execT - dt);
    if (this.gunHoldT > 0) this.gunHoldT = Math.max(0, this.gunHoldT - dt);

    const wantAds = input.mouse.right && !input.isTouch && this.rollT <= 0 && this.reloadT <= 0 && this.execT <= 0 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 12);
    this.bloom = Math.max(0, this.bloom - dt * 2.4);
    this.recoil -= this.recoil * Math.min(1, dt * 7);
    this.crouchK += ((this.crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);

    const { f, r } = input.getMoveAxes();
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    const mx = c * f - s * r;
    const mz = s * f + c * r;
    const hasMove = !!(mx || mz);

    const shiftHeld = !!(input.keys.ShiftLeft || input.keys.ShiftRight);
    const stickMag = input.sticks.move ? Math.hypot(input.sticks.move.dx, input.sticks.move.dy) : 1;
    this.sprinting =
      hasMove &&
      !this.crouch &&
      wantAds === 0 &&
      this.rollT <= 0 &&
      this.diveT <= 0 &&
      (input.isTouch ? stickMag > 0.72 : this.walkDefault ? shiftHeld : !shiftHeld);

    const wantReady =
      wantAds > 0 ||
      input.mouse.down ||
      input.touchFire ||
      this.diveT > 0 ||
      this.gunHoldT > 0 ||
      (this.combatStance && !this.sprinting)
        ? 1
        : 0;
    this.gunReady += (wantReady - this.gunReady) * Math.min(1, dt * (wantReady ? 14 : 4.2));

    let moveX = 0;
    let moveZ = 0;
    if (this.execT > 0) {
      this.moving = false;
      this.sprinting = false;
    } else if (this.rollT > 0) {
      this.rollT -= dt;
      moveX = this.rdx * PLAYER_ROLL_SPEED * dt;
      moveZ = this.rdz * PLAYER_ROLL_SPEED * dt;
      this.walk += dt * 20;
    } else if (this.diveT > 0) {
      this.diveT -= dt;
      moveX = this.rdx * PLAYER_ROLL_SPEED * 1.08 * dt;
      moveZ = this.rdz * PLAYER_ROLL_SPEED * 1.08 * dt;
      this.moving = true;
    } else {
      let sp = this.sprinting ? PLAYER_SPEED : PLAYER_WALK_SPEED;
      if (this.crouch) sp = PLAYER_WALK_SPEED * 0.68;
      if (this.ads > 0.05) sp = sp * (1 - 0.32 * this.ads);
      moveX = mx * sp * dt;
      moveZ = mz * sp * dt;
      this.moving = hasMove;
      if (this.moving) this.walk += dt * (this.sprinting ? 11.5 : 6.8);
    }

    if (this.moving && !this.air && this.rollT <= 0 && this.diveT <= 0 && this.execT <= 0) {
      this.stepAccum += dt;
      const stepInterval = this.crouch ? 0.54 : this.ads > 0.5 ? 0.48 : this.sprinting ? 0.29 : 0.46;
      if (this.stepAccum >= stepInterval) {
        this.stepAccum = 0;
        const stepVol = this.crouch ? 0.10 : this.sprinting ? 0.25 : 0.16;
        audio.playStep(levelStyle, stepVol, this.crouch);
      }
    } else {
      this.stepAccum = Math.min(this.stepAccum, 0.2);
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

    this.still = this.moving || this.rollT > 0 || this.diveT > 0 || this.air ? 0 : this.still + dt;
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

    // Shoulder position with wall occlusion check (relaxed stroll framing -> tight over-shoulder combat framing)
    const shoulderOff = 0.58 + 0.10 * this.gunReady - 0.22 * this.ads;
    const targetSx = this.x - s * shoulderOff;
    const targetSz = this.z + c * shoulderOff;
    const shoulderY = this.camY + 1.62 - 0.46 * this.crouchK;
    let sx = targetSx;
    let sz = targetSz;
    const shRay = physics.castRay(
      this.x,
      shoulderY,
      this.z,
      targetSx - this.x,
      0,
      targetSz - this.z,
      0.85,
      GROUP_WORLD,
      physics.playerCollider
    );
    if (shRay && shRay.dist < 0.78) {
      const k = Math.max(0.15, (shRay.dist - 0.15) / 0.78);
      sx = this.x + (targetSx - this.x) * k;
      sz = this.z + (targetSz - this.z) * k;
    }

    const dmax = Math.max(1.15, 3.40 - 0.16 * this.gunReady - 1.74 * this.ads);
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

    const sk = shake * 0.26;
    const stdX = sx + backDx * dist;
    const stdY = Math.max(0.28, shoulderY + 0.15 + backDy * dist);
    const stdZ = sz + backDz * dist;
    const stdLookX = stdX + c * cp * 10;
    const stdLookY = stdY - spv * 10;
    const stdLookZ = stdZ + s * cp * 10;

    let fovTarget = baseFov * (1 - 0.28 * this.ads) - 4.5 * (this.btK || 0) + muzzle * 0.5;

    // Smooth Cylindrical Dolly Close-Up & Freeze-Frame Execution Camera (zero through-body cut, zero close-up shake jitter!)
    const ec = this.execCam;
    if (ec && ec.k > 0.005) {
      const rawK = clamp(ec.k, 0, 1);
      const ek = rawK * rawK * (3 - 2 * rawK); // C1 Hermite smoothstep
      const orbAng = ec.yaw + Math.PI + ec.side * (ec.orbOff ?? 1.06);
      const orbR = ec.dist || 1.66;
      const odx = Math.cos(orbAng);
      const odz = Math.sin(orbAng);
      const anchorY = this.camY + (ec.lookY || 1.38);
      let safeR = orbR;
      const eHit = physics.castRay(ec.mx, anchorY, ec.mz, odx, -0.04, odz, orbR + 0.24, GROUP_WORLD, physics.playerCollider);
      if (eHit) safeR = Math.max(0.75, eHit.dist - 0.26);

      // Cylindrical polar arc around (ec.mx, ec.mz) so camera orbits smoothly around hero instead of cutting through torso!
      const stdDx = stdX - ec.mx;
      const stdDz = stdZ - ec.mz;
      const r0 = Math.max(0.5, Math.hypot(stdDx, stdDz));
      const a0 = Math.atan2(stdDz, stdDx);
      const da = ((orbAng - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const curAng = a0 + da * ek;
      const curR = r0 + (safeR - r0) * ek;

      const exY = Math.max(0.60, this.camY + (ec.camYOff ?? 1.38));
      const camSk = sk * Math.max(0, 1 - ek * 0.94);

      camera.position.set(
        ec.mx + Math.cos(curAng) * curR + rnd(-camSk, camSk),
        stdY + (exY - stdY) * ek + rnd(-camSk, camSk),
        ec.mz + Math.sin(curAng) * curR + rnd(-camSk, camSk)
      );
      _tmpV.set(
        stdLookX + (ec.mx - stdLookX) * ek,
        stdLookY + (anchorY - stdLookY) * ek,
        stdLookZ + (ec.mz - stdLookZ) * ek
      );
      camera.lookAt(_tmpV);
      if (ec.roll) camera.rotateZ(ec.roll * ek);
      const targetExecFov = ec.fov || 38;
      fovTarget = fovTarget * (1 - ek) + targetExecFov * ek + (ec.fovKick || 0);
    } else {
      camera.position.set(stdX + rnd(-sk, sk), stdY + rnd(-sk, sk), stdZ + rnd(-sk, sk));
      _tmpV.set(stdLookX, stdLookY, stdLookZ);
      camera.lookAt(_tmpV);
    }

    if (Math.abs(fovTarget - camera.fov) > 0.01) {
      camera.fov = fovTarget;
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
