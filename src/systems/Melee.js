import * as THREE from 'three';
import { BLADE } from '../entities/BladeModel.js';
import { enemyStanceHeight } from '../config/constants.js';

// Dadao melee: blade-first animation. Each attack is a set of keyframes for the blade itself (grip point
// and blade direction in character space: x forward, y up, z right) plus torso twist/lean; the hands are
// IK'd onto the grip (CharacterFactory.poseBlade). The cutting edge always leads the swing (derived from
// the tip velocity), and hits are tested against the swept blade, so what you see is what connects.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = x => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// Stances: tw = torso twist (+ turns left), ln = lean (+ bends forward), l = left-hand grip weight
const STANCE = {
  guard: { g: [0.34, 1.12, 0.08], d: [0.55, 0.78, -0.12], tw: 0.1, ln: 0.04, l: 1 },
  block: { g: [0.36, 1.32, -0.16], d: [0.16, 0.70, 0.69], tw: 0.28, ln: 0.08, l: 1 },
  broken: { g: [0.16, 0.96, 0.44], d: [-0.25, -0.45, 0.85], tw: -0.55, ln: -0.18, l: 0.2 },
  carry: { g: [0.13, 0.93, 0.25], d: [0.62, -0.72, 0.12], tw: 0, ln: 0, l: 0 },
  hip: { g: [-0.04, 0.98, -0.2], d: [-0.78, -0.5, 0.25], tw: -0.1, ln: 0, l: 0 } // drawn from the left hip
};

export const ULTIMATES = {
  iaido:     { id: 'iaido',     key: '1', name: '瞬步·居合一闪', cost: 35, cd: 10, desc: '疾风穿身拔刀斩，直接破防' },
  cleave:    { id: 'cleave',    key: '2', name: '破军·力劈华山', cost: 45, cd: 14, desc: '霸体凌空重劈，震裂地面破铁壁' },
  whirlwind: { id: 'whirlwind', key: '3', name: '孤鸿·旋风乱舞', cost: 55, cd: 18, desc: '霸体三段360°狂风连斩清场' }
};

export const SWORD_MIXAMO_MAP = {
  slashA: 'SwordSlash1',
  slashB: 'SwordSlash2',
  chop: 'SwordHeavy',
  guardCounter: 'SwordHeavy',
  spin: 'SwordSpin',
  iaido: 'SwordSlash2',
  cleave: 'SwordJumpAttack',
  whirlwind: 'SwordSpin',
  block: 'SwordBlock',
  blockHit: 'SwordBlockHit',
  idle: 'SwordIdle'
};

export function resolveSwordClip(clips, moveName) {
  if (!clips) return null;
  const key = SWORD_MIXAMO_MAP[moveName];
  return key && clips[key] ? key : null;
}

const ATTACKS = {
  // 斜劈: diagonal cut from over the right shoulder down to the left hip
  slashA: {
    dur: 0.62, active: [0.19, 0.34], cancel: 0.42, dmg: 38, postureDmg: 22, reach: 1.15, lungeMax: 1.0, hitstop: 0.064, shake: 0.16, knock: 0.34, sfx: 'swish',
    keys: [
      { t: 0.15, g: [0.0, 1.62, 0.34], d: [-0.35, 0.75, 0.45], tw: -0.45, ln: -0.05, l: 0.6 },
      { t: 0.23, g: [0.42, 1.5, 0.22], d: [0.62, 0.62, -0.48], tw: -0.08, ln: 0.06, l: 1 },
      { t: 0.29, g: [0.55, 1.18, 0.05], d: [0.88, -0.18, -0.44], tw: 0.3, ln: 0.14, l: 0.85 },
      { t: 0.37, g: [0.38, 0.86, -0.26], d: [0.45, -0.62, -0.64], tw: 0.55, ln: 0.2, l: 1 },
      { t: 0.62, stance: 'guard' }
    ]
  },
  // 横扫: backhand horizontal sweep from the left side across to the right
  slashB: {
    dur: 0.6, active: [0.16, 0.31], cancel: 0.4, dmg: 40, postureDmg: 24, reach: 1.15, lungeMax: 0.9, hitstop: 0.066, shake: 0.17, knock: 0.36, sfx: 'swish',
    keys: [
      { t: 0.12, g: [0.22, 1.2, -0.3], d: [-0.45, 0.22, -0.87], tw: 0.5, ln: 0.04, l: 1 },
      { t: 0.2, g: [0.5, 1.24, -0.12], d: [0.8, 0.1, -0.6], tw: 0.2, ln: 0.1, l: 0.9 },
      { t: 0.26, g: [0.55, 1.22, 0.12], d: [0.92, 0.06, 0.38], tw: -0.15, ln: 0.1, l: 0.85 },
      { t: 0.34, g: [0.2, 1.2, 0.42], d: [-0.2, 0.12, 0.97], tw: -0.5, ln: 0.04, l: 0.7 },
      { t: 0.6, stance: 'guard' }
    ]
  },
  // 力劈: overhead vertical chop with a big step in, ends the combo and floors weaker men
  chop: {
    dur: 0.95, active: [0.3, 0.47], cancel: 0.66, dmg: 76, postureDmg: 46, reach: 1.2, lungeMax: 1.6, hitstop: 0.105, shake: 0.36, knock: 0.62, sfx: 'swishHeavy', heavy: true,
    keys: [
      { t: 0.22, g: [0.02, 1.78, 0.06], d: [-0.55, 0.83, 0.0], tw: -0.12, ln: -0.15, l: 1 },
      { t: 0.32, g: [0.38, 1.66, 0.04], d: [0.8, 0.6, 0.0], tw: 0.0, ln: 0.02, l: 1 },
      { t: 0.38, g: [0.6, 1.18, 0.03], d: [0.9, -0.43, 0.0], tw: 0.05, ln: 0.22, l: 0.85 },
      { t: 0.47, g: [0.5, 0.8, 0.02], d: [0.6, -0.8, 0.0], tw: 0.05, ln: 0.34, l: 1 },
      { t: 0.66, g: [0.49, 0.82, 0.02], d: [0.6, -0.8, 0.0], tw: 0.05, ln: 0.32, l: 1 },
      { t: 0.95, stance: 'guard' }
    ]
  },
  // 防御反击 (Elden Ring Guard Counter): snappy golden rising-cleave right after blocking — massive posture shatter!
  guardCounter: {
    dur: 0.68, active: [0.16, 0.34], cancel: 0.48, dmg: 62, postureDmg: 58, reach: 1.32, lungeMax: 1.85, hitstop: 0.095, shake: 0.32, knock: 0.72,
    sfx: 'swishHeavy', heavy: true, hyperArmor: true, guardCounter: true,
    keys: [
      { t: 0.12, g: [0.24, 1.48, -0.22], d: [-0.28, 0.76, -0.58], tw: 0.42, ln: -0.04, l: 1 },
      { t: 0.22, g: [0.54, 1.36, 0.04], d: [0.86, 0.42, -0.26], tw: 0.08, ln: 0.14, l: 1 },
      { t: 0.31, g: [0.58, 0.96, 0.22], d: [0.82, -0.48, 0.32], tw: -0.34, ln: 0.24, l: 0.9 },
      { t: 0.46, g: [0.44, 0.92, 0.26], d: [0.58, -0.58, 0.56], tw: -0.38, ln: 0.18, l: 1 },
      { t: 0.68, stance: 'guard' }
    ]
  },
  // 回旋斩: crouched wind-up, then a full turn with the blade held out at waist height
  spin: {
    dur: 1.02, active: [0.3, 0.62], cancel: 0.78, dmg: 48, postureDmg: 32, reach: 1.25, lungeMax: 0.4, hitstop: 0.058, shake: 0.24, knock: 0.55, sfx: 'swishHeavy', heavy: true, multi: true,
    keys: [
      { t: 0.26, g: [0.05, 1.02, 0.4], d: [-0.6, 0.05, 0.8], tw: -0.6, ln: 0.15, l: 1, yaw: 0 },
      { t: 0.34, g: [0.48, 1.06, 0.2], d: [0.95, 0.0, -0.3], tw: -0.1, ln: 0.15, l: 0.8, yaw: -0.9 },
      { t: 0.48, g: [0.48, 1.06, 0.2], d: [0.95, 0.0, -0.3], tw: -0.1, ln: 0.15, l: 0.8, yaw: -3.6 },
      { t: 0.62, g: [0.44, 1.04, 0.0], d: [0.8, -0.05, -0.6], tw: 0.3, ln: 0.12, l: 1, yaw: -6.28 },
      { t: 1.02, stance: 'guard', yaw: -6.28 }
    ]
  },
  // 大招 [1] 瞬步·居合一闪: low hip coil -> blazing ghost-step dash cut through enemies (unblockable)
  iaido: {
    dur: 0.82, active: [0.19, 0.40], cancel: 0.64, dmg: 78, postureDmg: 68, reach: 1.55, lungeMax: 6.4, hitstop: 0.11, shake: 0.42, knock: 0.85,
    sfx: 'ultIaido', heavy: true, multi: true, unblockable: true, hyperArmor: true, ult: 'iaido', aoeRad: 2.45,
    keys: [
      { t: 0.16, g: [-0.06, 0.92, -0.26], d: [-0.82, -0.15, -0.55], tw: 0.62, ln: 0.28, l: 0.85 },
      { t: 0.24, g: [0.58, 1.18, -0.08], d: [0.94, 0.05, -0.32], tw: 0.15, ln: 0.24, l: 0.6 },
      { t: 0.34, g: [0.54, 1.24, 0.28], d: [0.42, 0.14, 0.89], tw: -0.58, ln: 0.14, l: 0.35 },
      { t: 0.56, g: [0.36, 1.18, 0.38], d: [0.15, 0.12, 0.98], tw: -0.55, ln: 0.08, l: 0.4 },
      { t: 0.82, stance: 'guard' }
    ]
  },
  // 大招 [2] 破军·力劈华山: hyper-armor high-arc slam that shatters ground & enemy guard
  cleave: {
    dur: 1.05, active: [0.34, 0.52], cancel: 0.78, dmg: 105, postureDmg: 90, reach: 1.5, lungeMax: 3.2, hitstop: 0.13, shake: 0.52, knock: 1.05,
    sfx: 'ultCleave', heavy: true, multi: true, unblockable: true, hyperArmor: true, ult: 'cleave', aoeRad: 4.35, slamAt: 0.42,
    keys: [
      { t: 0.26, g: [-0.06, 1.94, 0.04], d: [-0.62, 0.78, 0.0], tw: -0.18, ln: -0.22, l: 1 },
      { t: 0.36, g: [0.46, 1.72, 0.02], d: [0.84, 0.54, 0.0], tw: 0.0, ln: 0.06, l: 1 },
      { t: 0.43, g: [0.64, 0.92, 0.02], d: [0.85, -0.52, 0.0], tw: 0.08, ln: 0.38, l: 1 },
      { t: 0.72, g: [0.58, 0.76, 0.02], d: [0.72, -0.68, 0.0], tw: 0.08, ln: 0.38, l: 1 },
      { t: 1.05, stance: 'guard' }
    ]
  },
  // 大招 [3] 孤鸿·旋风乱舞: triple 360-degree cyclone slashes with hyper-armor
  whirlwind: {
    dur: 1.24, active: [0.22, 0.98], cancel: 1.06, dmg: 42, postureDmg: 30, reach: 1.5, lungeMax: 1.8, hitstop: 0.072, shake: 0.34, knock: 0.65,
    sfx: 'swishHeavy', heavy: true, multi: true, hyperArmor: true, ult: 'whirlwind', aoeRad: 3.35, waveTimes: [0.28, 0.56, 0.84],
    keys: [
      { t: 0.18, g: [0.06, 1.08, 0.42], d: [-0.55, 0.08, 0.83], tw: -0.6, ln: 0.16, l: 1, yaw: 0 },
      { t: 0.44, g: [0.54, 1.12, 0.16], d: [0.96, 0.02, -0.26], tw: 0.0, ln: 0.18, l: 0.9, yaw: -6.28 },
      { t: 0.72, g: [0.54, 1.14, 0.16], d: [0.96, 0.05, -0.26], tw: 0.0, ln: 0.18, l: 0.9, yaw: -12.56 },
      { t: 0.98, g: [0.46, 1.08, -0.06], d: [0.84, -0.08, -0.54], tw: 0.35, ln: 0.12, l: 1, yaw: -18.84 },
      { t: 1.24, stance: 'guard', yaw: -18.84 }
    ]
  },
  // Execution with the blade (timed to the finisher timeline: impact at 0.42 = the freeze-frame)
  finisher: {
    dur: 0.8, keys: [
      { t: 0.14, g: [0.05, 1.6, 0.34], d: [-0.4, 0.72, 0.56], tw: -0.5, ln: -0.05, l: 0.8 },
      { t: 0.34, g: [0.22, 1.5, 0.36], d: [0.15, 0.55, 0.82], tw: -0.35, ln: 0, l: 1 },
      { t: 0.42, g: [0.5, 1.3, 0.04], d: [0.78, 0.08, -0.62], tw: 0.2, ln: 0.1, l: 1 },
      { t: 0.56, g: [0.28, 1.08, -0.36], d: [-0.1, -0.15, -0.98], tw: 0.6, ln: 0.15, l: 1 },
      { t: 0.8, stance: 'guard' }
    ]
  },
  // Unsheathing from the left hip / putting the blade away
  draw: {
    dur: 0.42, keys: [
      { t: 0.16, g: [0.12, 1.3, 0.02], d: [0.15, 0.92, -0.35], tw: -0.05, ln: 0, l: 0 },
      { t: 0.42, stance: 'guard' }
    ]
  },
  sheathe: {
    dur: 0.4, keys: [
      { t: 0.18, g: [0.12, 1.25, 0.0], d: [0.2, 0.9, -0.38], tw: 0, ln: 0, l: 0 },
      { t: 0.4, stance: 'hip' }
    ]
  }
};
const COMBO = ['slashA', 'slashB', 'chop'];

const keyPose = k => ({
  g: new THREE.Vector3().fromArray(k.g).multiplyScalar(1),
  d: new THREE.Vector3().fromArray(k.d).normalize(),
  tw: k.tw || 0,
  ln: k.ln || 0,
  l: k.l ?? 1,
  yaw: k.yaw || 0
});
const STANCE_POSE = Object.fromEntries(Object.entries(STANCE).map(([k, v]) => [k, keyPose(v)]));
const copyPose = (o, p) => {
  o.g.copy(p.g);
  o.d.copy(p.d);
  if (p.e) o.e.copy(p.e);
  o.tw = p.tw;
  o.ln = p.ln;
  o.l = p.l;
  o.yaw = p.yaw;
  return o;
};
const newPose = () => ({ g: new THREE.Vector3(), d: new THREE.Vector3(1, 0, 0), e: new THREE.Vector3(0, -1, 0), tw: 0, ln: 0, l: 0, yaw: 0 });
// Edge direction a stance rests with: facing forward/down, square to the blade
const restEdge = (d, out) => out.set(1, -0.7, 0).addScaledVector(d, -out.set(1, -0.7, 0).dot(d)).normalize();

// Uniform Catmull-Rom on scalars/vectors between p1 and p2
const cr = (p0, p1, p2, p3, u) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Melee {
  constructor() {
    this.reset();
  }

  reset() {
    this.drawn = false; // blade in hand (drawing counts as drawn)
    this.state = 'idle'; // idle | attack | recoil
    this.atk = null;
    this.combo = 0;
    this.comboT = 0;
    this.queued = null;
    this.ready = 0; // guard (1) vs relaxed carry (0)
    this.blocking = false;
    this.blockBlend = 0;
    this.parryWindowT = 0;
    this.parryFlashT = 0;
    this.guardCounterT = 0;
    this.pose = newPose();
    restEdge(this.pose.d, this.pose.e);
    this.prevTip = null;
    this.yaw = 0;
    this.moving = false;
    this.hiddenGunPending = false;
  }

  equipInstant() {
    this.reset();
    this.drawn = true;
    this.ready = 1;
    this._poseAt(0, this.pose);
    restEdge(this.pose.d, this.pose.e);
  }

  get busy() {
    return this.state !== 'idle';
  }

  get hyperArmor() {
    return !!(this.state === 'attack' && this.atk?.def?.hyperArmor);
  }

  get isGuarding() {
    return this.drawn && this.blocking && !this.busy;
  }

  // --- input ---------------------------------------------------------------------------------
  setBlock(held, audio) {
    if (!this.drawn) {
      this.blocking = false;
      this.parryWindowT = 0;
      return;
    }
    const want = !!held;
    if (want && !this.blocking) {
      // Allow crisp Sekiro-style deflect cancel out of late attack recovery!
      if (this.state === 'attack' && this.atk && this.atk.t >= (this.atk.def.cancel ?? this.atk.def.dur)) {
        this.state = 'idle';
        this.atk = null;
        this.queued = null;
        this.yaw = 0;
      }
      if (this.state === 'idle') {
        this.parryWindowT = 0.24;
        audio?.sfx?.('tick');
      }
    }
    this.blocking = want;
  }

  triggerParryPulse() {
    this.parryFlashT = 0.16;
  }

  openGuardCounter(dur = 0.72) {
    this.guardCounterT = Math.max(this.guardCounterT || 0, dur);
  }

  // Allow snappy Sekiro/Wukong dodge-cancelling out of light/heavy swings (and late ultimate recovery)
  cancelForDodge() {
    if (this.state === 'attack' && this.atk?.def?.ult) {
      const cancelAt = (this.atk.def.cancel ?? this.atk.def.dur) * 0.78;
      if (this.atk.t < cancelAt) return false;
    }
    this.state = 'idle';
    this.atk = null;
    this.queued = null;
    this.blocking = false;
    this.parryWindowT = 0;
    this.guardCounterT = 0;
    this.yaw = 0;
    return true;
  }

  triggerUltimate(name, ctx) {
    if (!this.drawn || !ATTACKS[name]) return false;
    if (this.state === 'attack' && this.atk && this.atk.def.ult) return false;
    this.blocking = false;
    this.parryWindowT = 0;
    this.guardCounterT = 0;
    this.queued = null;
    this._attack(name, ctx);
    return true;
  }

  draw(ctx) {
    if (this.drawn || this.busy) return;
    this.drawn = true;
    this._start('draw', ctx, STANCE_POSE.hip);
    ctx.audio.sfx('bladeDraw');
  }

  sheathe(ctx) {
    if (!this.drawn) return;
    this.blocking = false;
    this._start('sheathe', ctx);
    ctx.audio.sfx('bladeSheathe');
  }

  playFinisher(ctx) {
    if (this.drawn) {
      this.blocking = false;
      this._start('finisher', ctx);
    }
  }

  press(kind, ctx) {
    if (!this.drawn) return;
    this.blocking = false;
    // Elden Ring signature Guard Counter: press attack right after blocking an enemy strike!
    if (this.state === 'idle' && this.guardCounterT > 0) {
      this.guardCounterT = 0;
      const ok = this._attack('guardCounter', ctx);
      if (ok !== false) ctx.onGuardCounter?.();
      return ok;
    }
    const want = kind === 'heavy' ? 'spin' : COMBO[this.comboT > 0 ? this.combo % COMBO.length : 0];
    if (this.state === 'idle') return this._attack(want, ctx);
    if (this.state === 'attack' && this.atk.def.dmg && !this.atk.def.ult && this.atk.t >= this.atk.def.active[0]) this.queued = kind;
  }

  // --- simulation -----------------------------------------------------------------------------
  _start(name, ctx, fromPose = null) {
    const def = ATTACKS[name];
    this.state = 'attack';
    this.atk = {
      name,
      def,
      t: 0,
      from: copyPose(newPose(), fromPose || this.pose),
      vel: 0,
      hit: new Set(),
      target: null,
      lunged: 0,
      lungeGoal: 0,
      bounced: false,
      whooshed: false,
      slamDone: false,
      waveIdx: 0
    };
    this.prevTip = null;
    const y = this.atk.from.yaw;
    this.atk.from.yaw = Math.atan2(Math.sin(y), Math.cos(y)); // a finished spin is a full turn: back to 0
  }

  // The cutting edge leads the swing: point it along the blade's motion (incl. body spin), turning at a
  // wrist-like rate so the apex of a wind-up rolls the blade over instead of flipping it in one frame
  _updateEdge(dt) {
    const p = this.pose;
    const target = _b;
    let speed = 0;
    if (this.atk) {
      const t = this.atk.t;
      const prev = this._poseAt(Math.max(0, t - 0.016), newPose());
      const tipNow = _a.copy(p.d).multiplyScalar(BLADE.tipX * 0.8).add(p.g);
      const tipPrev = _c.copy(prev.d).multiplyScalar(BLADE.tipX * 0.8).add(prev.g);
      // Express the previous tip in the current body frame (body spin moves the blade too)
      const dy = prev.yaw - p.yaw;
      const cx = Math.cos(dy);
      const sx = Math.sin(dy);
      const px = tipPrev.x;
      tipPrev.x = cx * px - sx * tipPrev.z;
      tipPrev.z = sx * px + cx * tipPrev.z;
      target.subVectors(tipNow, tipPrev);
      target.addScaledVector(p.d, -target.dot(p.d));
      speed = target.length() / 0.016;
    }
    if (speed > 1.2) target.normalize();
    else if (!this.atk) restEdge(p.d, target);
    else target.copy(p.e);
    // Rotate the stored edge toward the target, keeping it square to the blade
    const e = p.e.addScaledVector(p.d, -p.e.dot(p.d)).normalize();
    const ang = e.angleTo(target);
    const maxStep = dt * 22;
    if (ang > 1e-4) {
      const k = ang <= maxStep ? 1 : maxStep / ang;
      e.lerp(target, k).addScaledVector(p.d, -e.dot(p.d)).normalize();
    }
  }

  _attack(name, ctx) {
    const { P } = ctx;
    const def = ATTACKS[name];
    if (ctx.useStamina && def?.dmg && !def.ult && P?.consumeStamina) {
      const cost = def.guardCounter ? 8 : def.heavy ? 15 : 9;
      if (!P.consumeStamina(cost, def.heavy && !def.guardCounter ? 0.44 : 0.32)) {
        ctx.onStaminaEmpty?.();
        return false;
      }
    }
    this._start(name, ctx);
    const a = this.atk;
    if (COMBO.includes(name)) {
      this.combo = (COMBO.indexOf(name) + 1) % COMBO.length;
      this.comboT = 1.1;
    } else {
      this.combo = 0;
      this.comboT = 0;
    }
    // Prefer explicit Lock-On target when active, otherwise soft-lock nearest enemy in front
    let best = ctx.lockTarget && ctx.lockTarget.hp > 0 && !ctx.lockTarget.executing ? ctx.lockTarget : null;
    if (!best) {
      let bestScore = Infinity;
      for (const e of ctx.level.enemies) {
        if (e.hp <= 0 || e.executing) continue;
        const dx = e.x - P.x;
        const dz = e.z - P.z;
        const d = Math.hypot(dx, dz);
        if (d > a.def.reach + a.def.lungeMax + 0.8) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - P.ang), Math.cos(Math.atan2(dz, dx) - P.ang)));
        if (da > 1.25 && d > 1.4) continue;
        const score = d + da * 1.2;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    a.target = best;
    if (a.def.ult === 'iaido') {
      const td = best ? Math.hypot(best.x - P.x, best.z - P.z) : 4.2;
      a.lungeGoal = clamp(td + 1.4, 3.0, a.def.lungeMax);
    } else {
      a.lungeGoal = best
        ? clamp(Math.hypot(best.x - P.x, best.z - P.z) - a.def.reach, 0, a.def.lungeMax)
        : a.def.lungeMax * 0.35;
    }
    P.gunHoldT = Math.max(P.gunHoldT, 3);
  }

  // Blade pose of the current state at time t (fills `out`)
  _poseAt(t, out) {
    const a = this.atk;
    if (!a) {
      const s = STANCE_POSE;
      const r = smooth(this.ready);
      const b = smooth(this.blockBlend);
      out.g.lerpVectors(s.carry.g, s.guard.g, r);
      out.d.lerpVectors(s.carry.d, s.guard.d, r).normalize();
      out.tw = s.carry.tw + (s.guard.tw - s.carry.tw) * r;
      out.ln = s.carry.ln + (s.guard.ln - s.carry.ln) * r;
      out.l = r;
      if (b > 0.005) {
        out.g.lerp(s.block.g, b);
        out.d.lerp(s.block.d, b).normalize();
        out.tw += (s.block.tw - out.tw) * b;
        out.ln += (s.block.ln - out.ln) * b;
        out.l = Math.max(out.l, b);
        if (this.parryFlashT > 0) {
          // Crisp upward snap on successful parry deflect!
          out.g.y += 0.08 * (this.parryFlashT / 0.16);
          out.tw += 0.16 * (this.parryFlashT / 0.16);
        }
      }
      out.yaw = 0;
      return out;
    }
    const keys = a.keys || (a.keys = this._resolveKeys(a));
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const k1 = keys[i];
    const k2 = keys[i + 1];
    const k0 = keys[Math.max(0, i - 1)];
    const k3 = keys[Math.min(keys.length - 1, i + 2)];
    const u = clamp((t - k1.t) / Math.max(1e-4, k2.t - k1.t), 0, 1);
    for (const ax of ['x', 'y', 'z']) {
      out.g[ax] = cr(k0.p.g[ax], k1.p.g[ax], k2.p.g[ax], k3.p.g[ax], u);
      out.d[ax] = cr(k0.p.d[ax], k1.p.d[ax], k2.p.d[ax], k3.p.d[ax], u);
    }
    out.d.normalize();
    for (const s of ['tw', 'ln', 'l', 'yaw']) out[s] = cr(k0.p[s], k1.p[s], k2.p[s], k3.p[s], u);
    out.l = clamp(out.l, 0, 1);
    return out;
  }

  _resolveKeys(a) {
    const keys = [{ t: 0, p: a.from }];
    for (const k of a.def.keys) {
      const p = k.stance ? copyPose(newPose(), STANCE_POSE[k.stance]) : keyPose(k);
      if (k.stance && k.yaw !== undefined) p.yaw = k.yaw;
      keys.push({ t: k.t, p });
    }
    return keys;
  }

  // Character space -> world
  toWorld(v, P, yaw, out) {
    const a = P.ang + yaw;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return out.set(P.x + c * v.x - s * v.z, P.y + v.y, P.z + s * v.x + c * v.z);
  }

  bladePoint(pose, along, P, out) {
    _a.copy(pose.d).multiplyScalar(along).add(pose.g);
    return this.toWorld(_a, P, pose.yaw, out);
  }

  update(dt, ctx) {
    const { P } = ctx;
    if (this.comboT > 0) this.comboT = Math.max(0, this.comboT - dt);
    if (this.parryWindowT > 0) this.parryWindowT = Math.max(0, this.parryWindowT - dt);
    if (this.parryFlashT > 0) this.parryFlashT = Math.max(0, this.parryFlashT - dt);
    if (this.guardCounterT > 0) this.guardCounterT = Math.max(0, this.guardCounterT - dt);
    const wantBlock = this.isGuarding ? 1 : 0;
    this.blockBlend += (wantBlock - this.blockBlend) * Math.min(1, dt * 18);
    const relaxed = P.sprinting || (!P.combatStance && P.gunHoldT <= 0 && !this.busy && !this.blocking);
    this.ready += ((relaxed ? 0 : 1) - this.ready) * Math.min(1, dt * 7);

    if (this.state === 'idle') {
      this._poseAt(0, this.pose);
      this._updateEdge(dt);
      this.yaw = 0;
      this.moving = false;
      return;
    }

    const a = this.atk;
    const def = a.def;
    const t0 = a.t;
    a.t += dt;
    const t = a.t;
    this._poseAt(t, this.pose);
    this._updateEdge(dt);
    this.yaw = this.pose.yaw;

    // Root the player through the swing; turn into the target during the wind-up and step in
    P.rootT = Math.max(P.rootT || 0, def.dmg ? Math.max(0, (def.cancel ?? def.dur) - t) : 0);
    this.moving = false;
    if (def.dmg && def.active && a.target && t < def.active[0] + 0.04) {
      const want = Math.atan2(a.target.z - P.z, a.target.x - P.x);
      const df = Math.atan2(Math.sin(want - P.ang), Math.cos(want - P.ang));
      P.ang += clamp(df, -dt * 14, dt * 14);
    }
    if (def.dmg && def.active && a.lungeGoal > a.lunged) {
      const lungeStart = def.ult === 'iaido' ? 0.16 : 0;
      const lungeEnd = def.ult === 'iaido' ? 0.36 : def.active[0] + 0.06;
      if (t >= lungeStart && t < lungeEnd) {
        const prog = smooth((t - lungeStart) / Math.max(0.05, lungeEnd - lungeStart));
        const step = Math.max(0, a.lungeGoal * prog - a.lunged);
        if (step > 1e-4) {
          const mv = ctx.physics.movePlayer(Math.cos(P.ang) * step, 0, Math.sin(P.ang) * step);
          P.x = mv.x;
          P.z = mv.z;
          a.lunged += step;
          this.moving = true;
        }
      }
    }

    if (def.dmg && !a.whooshed && t >= def.active[0] - 0.04) {
      a.whooshed = true;
      ctx.audio.sfx(def.sfx);
      if (def.ult === 'iaido') ctx.onUltImpact?.('iaido', def, a);
    }

    // Ultimate special impact pulses (Cleave ground slam + Whirlwind triple cyclone waves)
    if (def.slamAt && !a.slamDone && t >= def.slamAt) {
      a.slamDone = true;
      ctx.onUltImpact?.('cleave', def, a);
    }
    if (def.waveTimes && a.waveIdx < def.waveTimes.length && t >= def.waveTimes[a.waveIdx]) {
      a.waveIdx++;
      a.hit.clear();
      ctx.audio.sfx('swishHeavy');
      ctx.onUltImpact?.('whirlwind', def, a);
    }

    // Swept-blade hit test during the active window
    if (def.dmg && t >= def.active[0] && t0 <= def.active[1] && this.state === 'attack') this._sweep(t0, t, ctx);

    // Combo chaining once the swing has followed through
    if (this.queued && t >= (def.cancel ?? def.dur)) {
      const q = this.queued;
      this.queued = null;
      const next = q === 'heavy' ? 'spin' : COMBO[this.combo % COMBO.length];
      if (this._attack(next, ctx) !== false) return;
    }

    if (t >= def.dur) {
      if (a.name === 'sheathe') this.drawn = false;
      this.state = 'idle';
      this.atk = null;
      this.yaw = 0;
    }
  }

  _sweep(t0, t1, ctx) {
    const { P, level } = ctx;
    const a = this.atk;
    const def = a.def;
    const pA = newPose();
    const pB = newPose();
    const s0 = Math.max(t0, def.active[0]);
    const s1 = Math.min(t1, def.active[1]);
    this._poseAt(s0, pA);
    this._poseAt(s1, pB);
    const samples = [0.32, 0.5, 0.68, 0.86, 1.0].map(f => BLADE.guardX + (BLADE.tipX - BLADE.guardX) * f);
    const steps = 4;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const pt = new THREE.Vector3();

    // Walls & props first: the tip and mid-blade sweep as rays; stone/metal stops the swing dead
    if (!a.bounced) {
      for (const along of [BLADE.tipX, BLADE.tipX * 0.62]) {
        this.bladePoint(pA, along, P, p0);
        this.bladePoint(pB, along, P, p1);
        const seg = p1.clone().sub(p0);
        const len = seg.length();
        if (len < 1e-4) continue;
        const hit = ctx.castBlade(p0, seg.divideScalar(len), len);
        if (!hit) continue;
        const res = ctx.hitProp(hit, seg, def);
        if (res === 'bounce') {
          a.bounced = true;
          this._recoil(ctx, hit.point);
          return;
        }
      }
    }

    for (const e of level.enemies) {
      if (e.hp <= 0 || e.executing || a.hit.has(e)) continue;
      const k = (e.ht || 1.8) / 1.8;
      const rad = 0.36 * k;
      const yMax = e.downed ? 0.55 : enemyStanceHeight(e) + 0.08;
      let found = null;
      for (let si = 0; si <= steps && !found; si++) {
        const f = si / steps;
        for (const along of samples) {
          this.bladePoint(pA, along, P, p0);
          this.bladePoint(pB, along, P, p1);
          pt.lerpVectors(p0, p1, f);
          if (pt.y < 0.12 || pt.y > yMax) continue;
          if (Math.hypot(pt.x - e.x, pt.z - e.z) < rad) {
            found = pt.clone();
            // Cut direction: how the blade was travelling at the contact point
            found.dir = p1.clone().sub(p0);
            break;
          }
        }
      }
      if (!found) continue;
      a.hit.add(e);
      const dir = found.dir;
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(e.x - P.x, 0, e.z - P.z);
      dir.normalize();
      ctx.hitEnemy(e, found, dir, def);
      if (!def.multi) break;
    }
  }

  // Blade bounced off stone/iron: snap back along the swing, stagger, then recover to guard
  _recoil(ctx, point) {
    const from = copyPose(newPose(), this.pose);
    const back = copyPose(newPose(), this.pose);
    // Throw the blade back toward where it came from
    back.d.lerp(STANCE_POSE.guard.d, 0.5).normalize();
    back.g.lerp(STANCE_POSE.guard.g, 0.4);
    back.tw *= 0.4;
    this.state = 'recoil';
    this.atk = {
      name: 'recoil',
      def: { dur: 0.55, cancel: 0.45 },
      t: 0,
      from,
      keys: [
        { t: 0, p: from },
        { t: 0.1, p: back },
        { t: 0.55, p: copyPose(newPose(), STANCE_POSE.guard) }
      ],
      hit: new Set()
    };
    this.queued = null;
    this.combo = 0;
    this.comboT = 0;
    ctx.P.rootT = Math.max(ctx.P.rootT || 0, 0.4);
  }
}

// Additive ribbon that follows the blade's edge for the last fraction of a second (HDR 刀光)
export class BladeTrail {
  constructor(scene, maxSamples = 24, life = 0.20) {
    this.scene = scene;
    this.max = maxSamples;
    this.life = life;
    this.samples = [];
    this.sub = 3; // Catmull-Rom sub-steps between samples
    const verts = (maxSamples - 1) * this.sub + 1;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(verts * 2 * 3);
    this.col = new Float32Array(verts * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < verts - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  // base/tip: world points of the blade's root and point; intensity 0..1; rgb: HDR trail color
  push(base, tip, now, intensity, rgb = null) {
    if (intensity > 0) {
      const c = rgb || [1.25, 1.38, 1.62];
      this.samples.push({ b: base.clone(), t: tip.clone(), time: now, k: intensity, r: c[0], g: c[1], bl: c[2] });
      if (this.samples.length > this.max) this.samples.shift();
    }
    while (this.samples.length && now - this.samples[0].time > this.life) this.samples.shift();
    this._build(now);
  }

  clear() {
    this.samples.length = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.clear();
    this.scene?.remove(this.mesh);
    this.geo.dispose();
    this.mesh.material.dispose();
  }

  _build(now) {
    const S = this.samples;
    if (S.length < 2) {
      this.mesh.visible = false;
      return;
    }
    let v = 0;
    const get = (i, key) => S[clamp(i, 0, S.length - 1)][key];
    for (let i = 0; i < S.length - 1; i++) {
      const last = i === S.length - 2;
      const s0 = S[i];
      const s1 = S[i + 1];
      for (let s = 0; s < (last ? this.sub + 1 : this.sub); s++) {
        const u = s / this.sub;
        for (const [key, off] of [['b', 0], ['t', 3]]) {
          for (const ax of ['x', 'y', 'z']) {
            _c[ax] = cr(get(i - 1, key)[ax], get(i, key)[ax], get(i + 1, key)[ax], get(i + 2, key)[ax], u);
          }
          this.pos[v * 6 + off] = _c.x;
          this.pos[v * 6 + off + 1] = _c.y;
          this.pos[v * 6 + off + 2] = _c.z;
        }
        const age = (now - (s0.time + (s1.time - s0.time) * u)) / this.life;
        const k = s0.k + (s1.k - s0.k) * u;
        const fade = clamp(1 - age, 0, 1);
        const a = fade * Math.sqrt(fade) * k;
        const r = s0.r + (s1.r - s0.r) * u;
        const g = s0.g + (s1.g - s0.g) * u;
        const b = s0.bl + (s1.bl - s0.bl) * u;
        // Soft luminous inner root + razor-bright HDR outer cutting edge (triggers bloom!)
        this.col[v * 6] = r * 0.14 * a;
        this.col[v * 6 + 1] = g * 0.14 * a;
        this.col[v * 6 + 2] = b * 0.14 * a;
        this.col[v * 6 + 3] = r * a;
        this.col[v * 6 + 4] = g * a;
        this.col[v * 6 + 5] = b * a;
        v++;
      }
    }
    // Collapse unused tail vertices onto the last one
    const total = this.pos.length / 6;
    for (let i = v; i < total; i++) {
      this.pos.copyWithin(i * 6, (v - 1) * 6, v * 6);
      this.col.fill(0, i * 6, i * 6 + 6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = true;
  }
}
