import * as THREE from 'three';
import {
  GRAVITY,
  PLAYER_WALK_SPEED,
  PLAYER_SPEED,
  PLAYER_ROLL_SPEED,
  PLAYER_JUMP_VEL,
  PLAYER_HEIGHT,
  PLAYER_SNEAK_SPEED,
  PLAYER_SNEAK_FAST_SPEED,
  PLAYER_CROUCH_SPEED,
  PLAYER_CROUCH_FAST_SPEED,
  playerStanceHeight,
  crouchStride,
  sneakStride,
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
const STEP_TIME = 0.34;
const stepDistance = t => 1.85 * t * t * (3 - 2 * t);

export class PlayerController {
  constructor() {
    this.unlockedWeapons = [];
    this.loadout = [];
    this.walkDefault = true;
    this.combatStance = false;
    this.resetAll();
  }

  get hasGun() {
    return this.loadout.length > 0 && this.gun >= 0 && !!WEAPONS[this.gun];
  }

  unlockWeapon(wIdx, autoEquip = true) {
    if (wIdx < 0 || wIdx >= WEAPONS.length) return false;
    const isNew = !this.unlockedWeapons.includes(wIdx);
    if (isNew) this.unlockedWeapons.push(wIdx);
    const w = WEAPONS[wIdx];
    this.mags[wIdx] = w.mag;
    this.res[wIdx] = w.initRes === Infinity ? Infinity : Math.max(this.res[wIdx] || 0, w.initRes);
    if (autoEquip) {
      let sIdx = this.loadout.indexOf(wIdx);
      if (sIdx === -1) {
        if (this.loadout.length < 3) {
          this.loadout.push(wIdx);
          sIdx = this.loadout.length - 1;
        } else {
          sIdx = clamp(this.slot, 0, 2);
          this.loadout[sIdx] = wIdx;
        }
      }
      this.slot = sIdx;
      this.gun = wIdx;
      this.melee = false;
      this.cancelReload();
    }
    return isNew;
  }

  resetAll(keepLoadout = false) {
    const savedUnlocked = keepLoadout && Array.isArray(this.unlockedWeapons) ? this.unlockedWeapons.slice() : [];
    const savedLoadout = keepLoadout && Array.isArray(this.loadout)
      ? this.loadout.filter(i => savedUnlocked.includes(i)).slice(0, 3)
      : [];
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.05;
    this.maxHp = 100;
    this.hp = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.staminaDelay = 0;
    this.staminaRegen = 45;
    this.maxFlasks = 4;
    this.flasks = 4;
    this.flaskHeal = 65;
    this.flaskCd = 0;
    this.armor = 0;
    this.unlockedWeapons = savedUnlocked;
    this.loadout = savedLoadout;
    this.slot = 0;
    this.gun = this.loadout.length ? this.loadout[0] : -1;
    this.mags = WEAPONS.map(w => w.mag);
    this.res = WEAPONS.map(w => w.initRes);
    this.nades = 3;
    this.molo = 1;
    this.sneak = false;
    this.sneakK = 0;
    this.crouch = false;
    this.crouchK = 0;
    this.air = false;
    this.still = 0;
    this.cd = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.rollT = 0;
    this.rollDur = 0.42;
    this.rollLocalF = 1;
    this.rollLocalR = 0;
    this.rollCd = 0;
    this.stepT = 0;
    this.rdx = 0;
    this.rdz = 0;
    this.inv = 0;
    this.walk = 0;
    this.stepAccum = 0;
    this.execT = 0;
    this.nadeCd = 0;
    this.moving = false;
    this.sprinting = false;
    this.briskLow = false;
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
    this.melee = !this.loadout.length; // start blade-drawn when carrying no firearms yet
    this.rootT = 0; // feet planted by a melee swing (Melee drives the lunge itself)
    this.scopeZoomIdx = 0;
    this.breathSteady = false;
    this.fovKick = 0;
    this.camRoll = 0;
    this.camBack = 0;
  }

  addCameraImpact({ fov = 0, roll = 0, back = 0 } = {}) {
    this.fovKick = clamp((this.fovKick || 0) + fov, -4.5, 5.2);
    this.camRoll = clamp((this.camRoll || 0) + roll, -0.055, 0.055);
    this.camBack = clamp((this.camBack || 0) + back, 0, 0.34);
  }

  resetForLevel(x, z) {
    this.x = x;
    this.y = 0;
    this.z = z;
    this.vy = 0;
    this.ang = -Math.PI / 2;
    this.pitch = 0.05;
    this.sneak = false;
    this.sneakK = 0;
    this.crouch = false;
    this.crouchK = 0;
    this.air = false;
    this.rollT = 0;
    this.rollDur = 0.42;
    this.rollLocalF = 1;
    this.rollLocalR = 0;
    this.rollCd = 0;
    this.stepT = 0;
    this.diveT = 0;
    this.execT = 0;
    this.stepAccum = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.sprinting = false;
    this.briskLow = false;
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
    this.rootT = 0;
    this.scopeZoomIdx = 0;
    this.breathSteady = false;
    this.fovKick = 0;
    this.camRoll = 0;
    this.camBack = 0;
    if (this.loadout.length) {
      if (this.slot >= this.loadout.length) this.slot = 0;
      this.gun = this.loadout[this.slot];
      this.melee = false;
    } else {
      this.slot = 0;
      this.gun = -1;
      this.melee = true;
    }
    this.stamina = this.maxStamina;
    this.staminaDelay = 0;
    this.flaskCd = 0;
  }

  applyProgression(prog, healFull = false) {
    if (!prog) return;
    const prevMaxHp = this.maxHp || 100;
    const prevMaxFlasks = this.maxFlasks || 4;
    this.maxHp = prog.maxHp;
    this.maxStamina = prog.maxStamina;
    this.staminaRegen = prog.staminaRegen;
    this.maxFlasks = prog.maxFlasks;
    this.flaskHeal = prog.flaskHeal;
    if (healFull) {
      this.hp = this.maxHp;
      this.stamina = this.maxStamina;
      this.flasks = this.maxFlasks;
    } else {
      if (this.maxHp > prevMaxHp) this.hp = this.maxHp;
      else this.hp = Math.min(this.hp, this.maxHp);
      if (this.maxFlasks > prevMaxFlasks) this.flasks = Math.min(this.maxFlasks, this.flasks + (this.maxFlasks - prevMaxFlasks));
      this.stamina = Math.min(this.stamina, this.maxStamina);
    }
  }

  canRoll() {
    return !(this.rollCd > 0 || this.stepT > 0 || this.rollT > 0 || this.diveT > 0 || this.air || this.execT > 0);
  }

  canQuickStep() {
    return !(this.rollCd > 0 || this.stepT > 0 || this.rollT > 0 || this.diveT > 0 || this.air ||
      this.execT > 0 || this.rootT > 0 || this.bulletTime);
  }

  // Elden-Ring "even 1 point of stamina lets you act" rule: never lock out a lifesaving dodge while any green remains!
  consumeStamina(cost, delay = 0.36) {
    if (!cost || cost <= 0) return true;
    if (this.stamina <= 0.5) return false;
    const overdraw = cost > this.stamina;
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = Math.max(this.staminaDelay, delay + (overdraw ? 0.18 : 0));
    return true;
  }

  restoreStamina(amount) {
    if (!amount || amount <= 0) return;
    this.stamina = Math.min(this.maxStamina, this.stamina + amount);
  }

  updateStamina(dt, isGuarding = false, busyMelee = false, inCombat = true) {
    if (this.flaskCd > 0) this.flaskCd = Math.max(0, this.flaskCd - dt);
    // Authentic Elden Ring rule: out of combat, sprinting drains ZERO stamina and recovery is brisk!
    if (this.sprinting && this.moving && !this.lowered) {
      if (inCombat) {
        this.stamina = Math.max(0, this.stamina - 11 * dt);
        this.staminaDelay = Math.max(this.staminaDelay, 0.26);
        return;
      }
    }
    if (this.rollT > 0 || this.stepT > 0 || busyMelee) {
      // Do not keep inflating delay during the action itself; simply pause regen until the motion completes
      this.staminaDelay = Math.max(this.staminaDelay, 0.14);
      return;
    }
    if (this.staminaDelay > 0) {
      this.staminaDelay = Math.max(0, this.staminaDelay - dt);
      return;
    }
    if (this.stamina < this.maxStamina) {
      const mult = !inCombat ? 1.35 : isGuarding ? 0.45 : 1.0;
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * mult * dt);
    }
  }

  drinkFlask(audio) {
    if (this.flasks <= 0 || this.flaskCd > 0 || this.hp <= 0 || this.hp >= this.maxHp) return 0;
    this.flasks--;
    this.flaskCd = 0.72;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + this.flaskHeal);
    audio?.sfx?.('pick');
    return Math.round(this.hp - before);
  }

  get scopeK() {
    if (this.melee || !WEAPONS[this.gun]?.scoped || this.execT > 0 || this.rollT > 0 || this.diveT > 0) return 0;
    return clamp((this.ads - 0.35) / 0.55, 0, 1);
  }

  get isScoped() {
    return this.scopeK > 0.45;
  }

  get scopeZoomLabel() {
    const labels = WEAPONS[this.gun]?.zoomLabels || ['4×', '8×'];
    return labels[this.scopeZoomIdx % labels.length];
  }

  get currentScopeFov() {
    const fovs = WEAPONS[this.gun]?.zoomFovs || [16.5, 9.2];
    return fovs[this.scopeZoomIdx % fovs.length];
  }

  toggleScopeZoom(audio, say) {
    const g = WEAPONS[this.gun];
    if (!g?.scoped) return false;
    const n = (g.zoomFovs || [16.5, 9.2]).length;
    this.scopeZoomIdx = (this.scopeZoomIdx + 1) % n;
    audio?.sfx?.('tick');
    say?.(`狙击倍镜：${this.scopeZoomLabel}`);
    return true;
  }

  currentHeight() {
    if (this.rollT > 0 || this.diveT > 0) return PLAYER_ROLL_HEIGHT;
    return playerStanceHeight(this.sneakK, this.crouchK) - 0.18 * this.stepLean;
  }

  get sneaking() {
    const lowReady = (this.sneak && this.sneakK >= .55) || (this.crouch && this.crouchK >= .55);
    return this.hp > 0 && lowReady && !this.air && !this.sprinting && !this.bulletTime &&
      this.rollT <= 0 && this.diveT <= 0 && this.stepT <= 0 && this.rootT <= 0 &&
      this.reloadT <= 0 && this.gunHoldT <= 0 && this.ads < 0.2;
  }

  get lowered() {
    return this.sneak || this.crouch;
  }

  get shoulderDrop() {
    return 0.19 * this.sneakK + 0.55 * this.crouchK;
  }

  toggleStance(stance) {
    if (this.air || this.rollT > 0 || this.diveT > 0 || this.execT > 0) return;
    this.sneak = stance === 'sneak' && !this.sneak;
    this.crouch = stance === 'crouch' && !this.crouch;
  }

  get stepLean() {
    return this.stepT > 0 ? Math.sin(Math.PI * this.stepT / STEP_TIME) : 0;
  }

  quickStep(input, audio) {
    if (this.rollCd > 0 || this.stepT > 0 || this.rollT > 0 || this.diveT > 0 || this.air ||
        this.execT > 0 || this.rootT > 0 || this.bulletTime) return false;
    this.cancelReload();
    const axes = input.getMoveAxes();
    const f = Math.abs(axes.f) + Math.abs(axes.r) < 0.20 ? -1 : axes.f;
    const len = Math.hypot(f, axes.r);
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    this.rdx = (c * f - s * axes.r) / len;
    this.rdz = (s * f + c * axes.r) / len;
    this.stepT = STEP_TIME;
    this.rollCd = 0.82;
    this.sprinting = false;
    audio.sfx('roll');
    return true;
  }

  jump(audio, state, physics) {
    if (this.air || this.stepT > 0 || this.rollT > 0 || this.diveT > 0 || state !== 'play') return;
    if (physics?.canSetPlayerHeight?.(PLAYER_HEIGHT) === false) return;
    this.sneak = this.crouch = false;
    this.vy = PLAYER_JUMP_VEL;
    this.air = true;
    audio.sfx('roll');
  }

  roll(input, audio, forcedAxes = null) {
    if (this.rollCd > 0 || this.stepT > 0 || this.rollT > 0 || this.diveT > 0 || this.air || this.execT > 0) return false;
    this.cancelReload();
    this.rootT = 0;
    const raw = forcedAxes || input.getMoveAxes();
    let f = raw.f || 0;
    let r = raw.r || 0;
    const alen = Math.hypot(f, r);
    if (alen > 1) { f /= alen; r /= alen; }
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    let dx = c * f - s * r;
    let dz = s * f + c * r;
    if (!dx && !dz) {
      // No direction held: in cold-weapon melee, evade cleanly backward; with guns, roll forward
      f = this.melee ? -1 : 1;
      r = 0;
      dx = c * f;
      dz = s * f;
    }
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    this.rollLocalF = f;
    this.rollLocalR = r;
    // Shootdodge slow-mo dive is strictly for firearms — never hijack cold-weapon Right-Click Block + A/D Roll!
    if (!this.melee && (this.bulletTime || input.mouse?.right) && this.focus >= 16 && (raw.f || raw.r)) {
      this.rdx = dx;
      this.rdz = dz;
      this.sneak = this.crouch = false;
      this.diveT = 0.82;
      this.rollCd = 1.15;
      this.vy = 3.5;
      this.air = true;
      this.focus = Math.max(0, this.focus - 14);
      audio.sfx('slowon');
      audio.sfx('roll');
      return true;
    }
    this.rdx = dx;
    this.rdz = dz;
    this.sneak = this.crouch = false;
    this.rollDur = this.melee ? 0.38 : 0.50;
    this.rollT = this.rollDur;
    this.rollCd = this.melee ? 0.46 : 0.90;
    audio.sfx('roll');
    return true;
  }

  switchSlot(slotIdx, charFactory, audio, say) {
    if (slotIdx < 0 || slotIdx >= this.loadout.length) return;
    this.slot = slotIdx;
    const wIdx = this.loadout[slotIdx];
    if (wIdx === this.gun) return;
    this.gun = wIdx;
    this.cancelReload();
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
    this.cancelReload();
    this.cd = 0.25;
    audio.sfx('tick');
    if (this.mesh) charFactory.setGun(this.mesh, WEAPONS[i].modelKey);
  }

  nextGun(charFactory, audio, say) {
    if (this.loadout.length <= 1) return;
    const nextSlot = (this.slot + 1) % this.loadout.length;
    this.switchSlot(nextSlot, charFactory, audio, say);
  }

  cancelReload() {
    this.reloadT = 0;
    this.reloadDur = 0;
  }

  reload(audio) {
    if (!this.hasGun) return;
    const g = WEAPONS[this.gun];
    if (this.reloadT > 0 || this.mags[this.gun] >= g.mag || this.res[this.gun] <= 0) return;
    const dur = g.id === 'shotgun' ? 0.38 : g.reload;
    this.reloadT = dur;
    this.reloadDur = dur;
    audio.sfx('reload');
  }

  stepReload(dt, audio) {
    if (this.reloadT <= 0) return;
    if (!this.hasGun) {
      this.cancelReload();
      return;
    }
    const g = WEAPONS[this.gun];
    this.reloadT -= dt;
    if (this.reloadT > 0) return;
    if (g.id === 'shotgun') {
      if (this.mags[this.gun] < g.mag && this.res[this.gun] > 0) {
        this.mags[this.gun]++;
        this.res[this.gun]--;
        audio?.sfx?.('tick');
      }
      if (this.mags[this.gun] < g.mag && this.res[this.gun] > 0) {
        this.reloadT = 0.36;
        this.reloadDur = 0.36;
      } else {
        this.cancelReload();
      }
      return;
    }
    const need = g.mag - this.mags[this.gun];
    const take = Math.min(need, this.res[this.gun]);
    this.mags[this.gun] += take;
    this.res[this.gun] -= take;
    this.cancelReload();
  }

  updateMovement(dt, input, physics, audio, onLandDust, levelStyle = 'cobble') {
    // Non-locked keyboard / gentle outer-edge camera yaw (locked during executions!)
    if (this.execT <= 0) {
      if (input.keys.ArrowLeft) this.ang -= dt * 2.2;
      if (input.keys.ArrowRight) this.ang += dt * 2.2;
      if (!input.locked && !input.isTouch && input.mouse.moved) {
        const k = (input.mouse.x / Math.max(1, window.innerWidth) - 0.5) * 2;
        const a = Math.abs(k);
        if (a > 0.72) this.ang += Math.sign(k) * (a - 0.72) * 2.2 * dt;
      }
      this.ang = Math.atan2(Math.sin(this.ang), Math.cos(this.ang));
    }

    this.cd -= dt;
    this.rollCd -= dt;
    this.nadeCd -= dt;
    if (this.inv > 0) this.inv -= dt;
    if (this.execT > 0) this.execT = Math.max(0, this.execT - dt);
    if (this.rootT > 0) this.rootT = Math.max(0, this.rootT - dt);
    if (this.gunHoldT > 0) this.gunHoldT = Math.max(0, this.gunHoldT - dt);

    const wantAds = input.mouse.right && !input.isTouch && !this.melee && this.rollT <= 0 && this.stepT <= 0 && this.reloadT <= 0 && this.execT <= 0 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 12);
    this.bloom = Math.max(0, this.bloom - dt * 2.4);
    this.recoil -= this.recoil * Math.min(1, dt * 7);
    const kickDecay = Math.exp(-Math.max(0, dt) * 14);
    this.fovKick *= kickDecay;
    this.camRoll *= Math.exp(-Math.max(0, dt) * 12);
    this.camBack *= kickDecay;
    if (Math.abs(this.fovKick) < 0.01) this.fovKick = 0;
    if (Math.abs(this.camRoll) < 0.0005) this.camRoll = 0;
    if (this.camBack < 0.002) this.camBack = 0;
    const blend = Math.min(1, dt * 10);
    const sneakK = this.sneakK + (Number(this.sneak) - this.sneakK) * blend;
    const crouchK = this.crouchK + (Number(this.crouch) - this.crouchK) * blend;
    const height = playerStanceHeight(sneakK, crouchK);
    const targetHeight = playerStanceHeight(Number(this.sneak), Number(this.crouch));
    const blocked = targetHeight > height + .002 && physics.canSetPlayerHeight?.(targetHeight) === false;
    if (blocked || physics.setPlayerHeight?.(height) === false) {
      // Restore the lower stance when the desired posture would put the head through cover.
      this.crouch = this.crouchK > this.sneakK;
      this.sneak = !this.crouch;
    } else {
      this.sneakK = sneakK;
      this.crouchK = crouchK;
    }

    const { f, r } = input.getMoveAxes();
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    const mx = c * f - s * r;
    const mz = s * f + c * r;
    const hasMove = !!(mx || mz);
    const sideAmount = Math.abs(r) / (Math.hypot(f, r) || 1);

    const shiftHeld = !!(input.keys.ShiftLeft || input.keys.ShiftRight);
    this.breathSteady = this.isScoped && (shiftHeld || this.lowered);
    const stickMag = input.sticks.move ? Math.hypot(input.sticks.move.dx, input.sticks.move.dy) : 1;
    const wantFast = input.isTouch ? stickMag > 0.72 : this.walkDefault ? shiftHeld : !shiftHeld;
    const canFast =
      hasMove &&
      wantAds === 0 &&
      this.rollT <= 0 &&
      this.stepT <= 0 &&
      this.diveT <= 0 &&
      this.stamina > 0.5 &&
      wantFast;
    this.sprinting = !this.lowered && canFast;
    this.briskLow = this.lowered && canFast;

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
    const stepping = this.stepT > 0;
    if (this.execT > 0 || (this.rootT > 0 && this.rollT <= 0 && this.diveT <= 0)) {
      this.moving = false;
      this.sprinting = false;
      this.briskLow = false;
    } else if (stepping) {
      const start = 1 - this.stepT / STEP_TIME;
      this.stepT = Math.max(0, this.stepT - dt);
      const length = stepDistance(1 - this.stepT / STEP_TIME) - stepDistance(start);
      moveX = this.rdx * length;
      moveZ = this.rdz * length;
      this.moving = true;
      this.walk += length * 2.7;
    } else if (this.rollT > 0) {
      this.rollT = Math.max(0, this.rollT - dt);
      const rollSpd = PLAYER_ROLL_SPEED * (this.melee ? 1.24 : 1.0);
      moveX = this.rdx * rollSpd * dt;
      moveZ = this.rdz * rollSpd * dt;
      this.walk += dt * 20;
    } else if (this.diveT > 0) {
      this.diveT -= dt;
      moveX = this.rdx * PLAYER_ROLL_SPEED * 1.08 * dt;
      moveZ = this.rdz * PLAYER_ROLL_SPEED * 1.08 * dt;
      this.moving = true;
    } else {
      let sp = this.sprinting ? PLAYER_SPEED : PLAYER_WALK_SPEED;
      if (this.lowered) {
        const baseLow = this.sneak
          ? (this.briskLow ? PLAYER_SNEAK_FAST_SPEED : PLAYER_SNEAK_SPEED)
          : (this.briskLow ? PLAYER_CROUCH_FAST_SPEED : PLAYER_CROUCH_SPEED);
        sp = baseLow * (1 - 0.23 * sideAmount) * (f < 0 ? 0.88 : 1);
      }
      if (this.ads > 0.05) sp = sp * (1 - 0.32 * this.ads);
      moveX = mx * sp * dt;
      moveZ = mz * sp * dt;
      this.moving = hasMove;
      if (this.moving) this.walk += dt * (this.sprinting ? 11.5 : this.briskLow ? 9.2 : 6.8);
    }

    const prevVy = this.vy;
    this.vy = this.air || this.vy > 0 ? this.vy - GRAVITY * dt : -2.5;
    const dy = this.vy * dt;

    const moved = physics.movePlayer(moveX, dy, moveZ, this.execT <= 0 && this.rootT <= 0);
    const travelled = Math.hypot(moved.x - this.x, moved.z - this.z);
    if (stepping && Math.hypot(moveX, moveZ) > 0.02 && travelled < 0.006) {
      this.stepT = 0;
      this.moving = false;
    }
    if (this.lowered && travelled < 0.001) {
      this.moving = false;
      this.briskLow = false;
    }
    if (this.moving && !stepping && moved.grounded && this.rollT <= 0 && this.diveT <= 0 && this.execT <= 0) {
      const interval = this.ads > 0.5 ? 0.48 : this.sprinting ? 0.29 : 0.46;
      const stride = this.sneak ? sneakStride(sideAmount, this.briskLow ? 1 : 0) : crouchStride(sideAmount);
      this.stepAccum += this.lowered ? travelled / (stride * 0.5) : dt / interval;
      if (this.stepAccum >= 1) {
        this.stepAccum %= 1;
        const stepVol = this.sneak
          ? (this.briskLow ? 0.13 : 0.08)
          : this.crouch
            ? (this.briskLow ? 0.13 : 0.10)
            : this.sprinting
              ? 0.25
              : 0.16;
        audio.playStep(levelStyle, stepVol, this.lowered);
      }
    } else this.stepAccum = Math.min(this.stepAccum, 0.5);
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
    const shoulderY = this.camY + 1.62 - this.shoulderDrop;
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

    const dmax = Math.max(1.15, 3.40 - 0.16 * this.gunReady - 1.74 * this.ads + (this.camBack || 0));
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

    const scopeK = this.scopeK;
    const swayScale = scopeK * (this.breathSteady ? 0.0011 : this.moving ? 0.0075 : 0.0036);
    const swayYaw = swayScale ? Math.sin(time * 1.45) * swayScale : 0;
    const swayPitch = swayScale ? Math.cos(time * 2.1) * swayScale * 0.72 : 0;
    const aimAng = this.ang + swayYaw;
    const aimPe = pe + swayPitch;
    const ac = Math.cos(aimAng);
    const as = Math.sin(aimAng);
    const acp = Math.cos(aimPe);
    const asp = Math.sin(aimPe);

    const sk = shake * (scopeK > 0.5 ? 0.09 : 0.26);
    const eyeX = this.x + ac * 0.22;
    const eyeY = Math.max(0.45, shoulderY + 0.04);
    const eyeZ = this.z + as * 0.22;
    const stdX = (sx + backDx * dist) * (1 - scopeK) + eyeX * scopeK;
    const stdY = Math.max(0.28, shoulderY + 0.15 + backDy * dist) * (1 - scopeK) + eyeY * scopeK;
    const stdZ = (sz + backDz * dist) * (1 - scopeK) + eyeZ * scopeK;
    const stdLookX = stdX + ac * acp * 20;
    const stdLookY = stdY - asp * 20;
    const stdLookZ = stdZ + as * acp * 20;

    const fk = (this.fovKick || 0) * (1 - scopeK * 0.65);
    const normalFov = baseFov * (1 - 0.28 * this.ads) - 4.5 * (this.btK || 0) + muzzle * 0.5 + fk;
    let fovTarget = scopeK > 0.005
      ? normalFov * (1 - scopeK) + (this.currentScopeFov - 1.5 * (this.btK || 0) + fk * 0.35) * scopeK
      : normalFov;

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
      const da = Math.atan2(Math.sin(orbAng - a0), Math.cos(orbAng - a0));
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
      if (this.camRoll) camera.rotateZ(this.camRoll * (1 - scopeK * 0.72));
    }

    if (Math.abs(fovTarget - camera.fov) > 0.01) {
      camera.fov = fovTarget;
      camera.updateProjectionMatrix();
    }
  }

  aim3D(camera, physics) {
    let dx, dy, dz;
    if (this.scopeK > 0.25 && camera?.getWorldDirection) {
      camera.getWorldDirection(_tmpV);
      dx = _tmpV.x;
      dy = _tmpV.y;
      dz = _tmpV.z;
    } else {
      const pe = this.pitch - this.recoil;
      const cp = Math.cos(pe);
      dx = Math.cos(this.ang) * cp;
      dy = -Math.sin(pe);
      dz = Math.sin(this.ang) * cp;
    }
    const ox = camera.position.x;
    const oy = camera.position.y;
    const oz = camera.position.z;

    const startOffset = this.scopeK > 0.5 ? 0.35 : Math.hypot(this.x - ox, this.z - oz) + 0.45;
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
      220,
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
        hit: (k === 'enemy' && !hit.meta.enemy.disarmed) || k === 'barrel' || k === 'lantern',
        enemy: k === 'enemy' && !hit.meta.enemy.disarmed ? hit.meta.enemy : null
      };
    }

    return {
      x: ox + dx * 220,
      y: oy + dy * 220,
      z: oz + dz * 220,
      d: 220,
      hit: false,
      enemy: null
    };
  }
}
