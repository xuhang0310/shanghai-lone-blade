import * as THREE from 'three';
import { ULTIMATES } from './Melee.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export const BOSS_ULTIMATES = {
  bossLeapSlam:   { id: 'bossLeapSlam',   name: '黑龙跃空裂地斩', peril: true,  dmg: 68, rad: 6.8, afterRad: 8.4, dur: 1.88 },
  bossWhirlwind:  { id: 'bossWhirlwind',  name: '霸王回马旋风扫', peril: false, dmg: 22, rad: 4.85, dur: 2.15 },
  bossDashThrust: { id: 'bossDashThrust', name: '惊雷突刺一闪',   peril: true,  dmg: 62, rad: 3.4, dur: 1.48 },
  bossQuakeNova:  { id: 'bossQuakeNova',  name: '霸王震岳八荒裂', peril: true,  dmg: 66, rad: 5.4, outerRad: 8.6, dur: 2.05 }
};

export const DOJO_PRESETS = {
  duel1v1: {
    id: 'duel1v1',
    key: 'F1',
    label: '1v1 · 铁枪校尉',
    subtitle: '梨花红缨长枪单挑 · 长兵突刺与灵动闪跃',
    enemies: [
      {
        type: 'gunman',
        name: '黑龙堂铁枪校尉',
        weaponKind: 'spear',
        hp: 420,
        maxPosture: 135,
        deathblows: 1,
        scale: 1.05,
        styleKey: 'boss1',
        aggro: 1.08,
        blockChance: 0.56,
        evadeChance: 0.30
      }
    ]
  },
  duel1v2: {
    id: 'duel1v2',
    key: 'F2',
    label: '1v2 · 枪斧合击',
    subtitle: '红缨长枪 + 宣花巨斧双兵协同 · 练切锁、弹反与清场',
    enemies: [
      {
        type: 'thug',
        name: '疾风红缨枪手',
        weaponKind: 'spear',
        hp: 300,
        maxPosture: 110,
        deathblows: 1,
        scale: 1.02,
        styleKey: 'gunman',
        aggro: 0.96,
        blockChance: 0.46,
        evadeChance: 0.28,
        offsetX: -3.4
      },
      {
        type: 'gunman',
        name: '玄铁开山斧汉',
        weaponKind: 'axe',
        hp: 360,
        maxPosture: 130,
        deathblows: 1,
        scale: 1.12,
        styleKey: 'boss2',
        aggro: 0.88,
        blockChance: 0.52,
        evadeChance: 0.14,
        offsetX: 3.4
      }
    ]
  },
  duelBoss: {
    id: 'duelBoss',
    key: 'F3',
    label: '1v1 · 霸王黑龙',
    subtitle: '2000厚血三印宗师 · 霸体韧性 + 翻腾反击 + 四大超大范围绝技',
    enemies: [
      {
        type: 'boss',
        name: '霸王 · 黑 龙',
        weaponKind: 'guandao',
        hp: 2000,
        maxPosture: 280,
        deathblows: 3,
        scale: 1.64,
        styleKey: 'boss',
        aggro: 1.34,
        blockChance: 0.72,
        evadeChance: 0.52
      }
    ]
  },
  duelTrio: {
    id: 'duelTrio',
    key: 'F4',
    label: '1v3 · 枪斧棒混战',
    subtitle: '长枪 / 巨斧 / 狼牙棒三兵齐出 · 体验兵器克制与群战手感',
    enemies: [
      {
        type: 'thug',
        name: '梨花枪客',
        weaponKind: 'spear',
        hp: 260,
        maxPosture: 100,
        deathblows: 1,
        scale: 1.02,
        styleKey: 'gunman',
        aggro: 0.92,
        blockChance: 0.44,
        evadeChance: 0.28,
        offsetX: -4.2
      },
      {
        type: 'gunman',
        name: '宣花斧汉',
        weaponKind: 'axe',
        hp: 310,
        maxPosture: 120,
        deathblows: 1,
        scale: 1.10,
        styleKey: 'boss1',
        aggro: 0.88,
        blockChance: 0.48,
        evadeChance: 0.14,
        offsetX: 0
      },
      {
        type: 'gunman',
        name: '狼牙棒魁',
        weaponKind: 'mace',
        hp: 320,
        maxPosture: 125,
        deathblows: 1,
        scale: 1.12,
        styleKey: 'boss2',
        aggro: 0.86,
        blockChance: 0.50,
        evadeChance: 0.16,
        offsetX: 4.2
      }
    ]
  }
};

// Reusable 3D cold-weapon keyframes for enemy duelists (character space: +x forward, +y up, +z right)
const DUEL_POSES = {
  guard:        { g: [0.34, 1.14, 0.08],  d: [0.55, 0.78, -0.12],  tw: 0.12,  ln: 0.05,  l: 1.0 },
  guardSpear:   { g: [0.36, 1.04, 0.16],  d: [0.92, 0.26, -0.26],  tw: -0.28, ln: 0.10,  l: 1.0 },
  guardPolearm: { g: [0.34, 1.08, 0.20],  d: [0.76, 0.56, -0.32],  tw: -0.22, ln: 0.08,  l: 1.0 },
  guardHeavy:   { g: [0.28, 1.24, 0.22],  d: [0.38, 0.88, -0.26],  tw: -0.18, ln: 0.04,  l: 1.0 },
  block:        { g: [0.38, 1.32, -0.15], d: [0.16, 0.70, 0.69],   tw: 0.28,  ln: 0.08,  l: 1.0 },
  windupA:      { g: [-0.02, 1.66, 0.36], d: [-0.42, 0.72, 0.55],  tw: -0.52, ln: -0.06, l: 0.90 },
  strikeA:      { g: [0.46, 0.92, -0.26], d: [0.68, -0.52, -0.52], tw: 0.52,  ln: 0.22,  l: 0.95 },
  windupB:      { g: [0.22, 1.22, -0.34], d: [-0.48, 0.18, -0.86], tw: 0.52,  ln: 0.06,  l: 1.0 },
  strikeB:      { g: [0.34, 1.22, 0.38],  d: [0.32, 0.12, 0.94],   tw: -0.52, ln: 0.10,  l: 0.90 },
  windupThrust: { g: [-0.08, 1.02, 0.24], d: [0.96, 0.12, -0.22],  tw: -0.46, ln: 0.14,  l: 1.0 },
  strikeThrust: { g: [0.66, 1.12, 0.04],  d: [0.99, 0.04, -0.04],  tw: 0.34,  ln: 0.28,  l: 1.0 },
  windupPeril:  { g: [-0.08, 1.94, 0.04], d: [-0.66, 0.75, 0.0],   tw: -0.16, ln: -0.22, l: 1.0 },
  strikePeril:  { g: [0.64, 0.78, 0.02],  d: [0.76, -0.65, 0.0],   tw: 0.08,  ln: 0.38,  l: 1.0 },
  evadeCoil:    { g: [0.24, 0.94, 0.28],  d: [-0.24, 0.65, 0.72],  tw: -0.36, ln: 0.26,  l: 1.0 },
  leapCoil:     { g: [-0.08, 0.88, 0.22], d: [-0.68, 0.64, 0.34],  tw: -0.32, ln: 0.36,  l: 1.0 },
  leapAir:      { g: [-0.12, 1.98, 0.02], d: [-0.52, 0.85, 0.0],   tw: -0.10, ln: -0.26, l: 1.0 },
  leapSlam:     { g: [0.68, 0.66, 0.02],  d: [0.84, -0.54, 0.0],   tw: 0.12,  ln: 0.44,  l: 1.0 },
  quakePlant:   { g: [0.32, 1.28, 0.02],  d: [0.10, -0.99, 0.0],   tw: 0.0,   ln: 0.24,  l: 1.0 },
  bossSpin:     { g: [0.54, 1.08, 0.14],  d: [0.95, 0.04, -0.28],  tw: 0.22,  ln: 0.20,  l: 1.0 },
  stagger:      { g: [0.16, 0.98, 0.46],  d: [-0.28, -0.42, 0.86], tw: -0.58, ln: -0.18, l: 0.2 },
  broken:       { g: [0.12, 0.82, 0.44],  d: [-0.20, -0.72, 0.66], tw: -0.42, ln: 0.32,  l: 0.1 }
};

function guardPoseFor(weaponKind) {
  if (weaponKind === 'spear') return 'guardSpear';
  if (weaponKind === 'guandao') return 'guardPolearm';
  if (weaponKind === 'axe' || weaponKind === 'mace') return 'guardHeavy';
  return 'guard';
}

function makeDuelPose(weaponKind = 'spear') {
  const src = DUEL_POSES[guardPoseFor(weaponKind)] || DUEL_POSES.guard;
  return {
    g: new THREE.Vector3(...src.g),
    d: new THREE.Vector3(...src.d).normalize(),
    e: new THREE.Vector3(0.7, -0.7, 0).normalize(),
    tw: src.tw,
    ln: src.ln,
    l: src.l,
    yaw: 0
  };
}

function lerpDuelPose(pose, targetKey, alpha) {
  const src = DUEL_POSES[targetKey] || DUEL_POSES.guard;
  pose.g.x += (src.g[0] - pose.g.x) * alpha;
  pose.g.y += (src.g[1] - pose.g.y) * alpha;
  pose.g.z += (src.g[2] - pose.g.z) * alpha;
  pose.d.x += (src.d[0] - pose.d.x) * alpha;
  pose.d.y += (src.d[1] - pose.d.y) * alpha;
  pose.d.z += (src.d[2] - pose.d.z) * alpha;
  pose.d.normalize();
  pose.e.set(1, -0.7, 0).addScaledVector(pose.d, -pose.d.x + 0.7 * pose.d.y).normalize();
  pose.tw += (src.tw - pose.tw) * alpha;
  pose.ln += (src.ln - pose.ln) * alpha;
  pose.l += (src.l - pose.l) * alpha;
}

export class DuelSystem {
  constructor() {
    this.reset();
  }

  reset(presetId = 'duel1v1', mode = 'dojo') {
    this.active = false;
    this.mode = mode === 'campaign' ? 'campaign' : 'dojo';
    this.presetId = DOJO_PRESETS[presetId] ? presetId : 'duel1v1';
    this.qi = mode === 'campaign' ? 50 : 100;
    this.maxQi = 100;
    this.qiGainMult = 1;
    this.ultCdReduce = 0;
    this.playerPosture = 0;
    this.maxPlayerPosture = 100;
    this.playerPostureDelay = 0;
    this.playerBrokenT = 0;
    this.lockTarget = null;
    this.parryCount = 0;
    this.clashCount = 0;
    this.comboHits = 0;
    this.comboT = 0;
    this.callout = '';
    this.calloutCol = '#ffd860';
    this.calloutT = 0;
    this.victoryT = 0;
    this.announcedWin = false;
    this.bossVictoryFired = false;
    this.groupAtkCd = 0;
    this.cooldowns = { iaido: 0, cleave: 0, whirlwind: 0 };
  }

  applyProgression(prog) {
    if (!prog) return;
    this.maxPlayerPosture = prog.maxPosture || 100;
    this.qiGainMult = prog.qiGainMult || 1;
    this.ultCdReduce = prog.ultCdReduce || 0;
  }

  initDuelist(e, spec) {
    e.hp = spec.hp;
    e.max = spec.hp;
    e.awake = this.mode !== 'campaign';
    e.melee = true;
    const weaponKind = spec.weaponKind || (spec.type === 'boss' ? 'guandao' : 'spear');
    e.duel = {
      name: spec.name,
      weaponKind,
      tier: spec.tier || (spec.type === 'boss' ? 'boss' : 'heavy'),
      poiseTier: spec.poiseTier ?? (spec.type === 'boss' ? 4 : 2),
      posture: 0,
      maxPosture: spec.maxPosture || 100,
      postureDelay: 0,
      displayHp: spec.hp,
      phase: 1,
      deathblows: spec.deathblows || 1,
      aggro: spec.aggro || 1,
      aggroRange: spec.aggroRange || 12.0,
      blockChance: spec.blockChance ?? 0.5,
      evadeChance: spec.evadeChance ?? (spec.type === 'boss' ? 0.42 : 0.20),
      normalDmg: spec.normalDmg || 0,
      perilDmg: spec.perilDmg || 0,
      ultDmgMult: spec.ultDmgMult || 1,
      state: 'circle', // circle | windup | strike | recover | blockReact | stagger | broken | evade | bossUlt
      stateT: 0,
      stateDur: 0.9,
      attackKind: 'slashA', // slashA | slashB | thrustA | perilChop | perilThrust
      comboLeft: 0,
      didHit: false,
      peril: false,
      blocking: false,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      strafeT: rnd(1.0, 2.1),
      atkCd: rnd(0.85, 1.45),
      // Acrobatic mobility (jump / back-flip / side-vault)
      evadeCd: spec.type === 'boss' ? 1.2 : 2.4,
      evadeDirX: 0,
      evadeDirZ: 0,
      evadeKind: 'backflip', // backflip | sideflip
      evadeSide: 1,
      hitStreak: 0,
      hitStreakT: 0,
      invulnT: 0,
      jumpY: 0,
      flipX: 0,
      flipZ: 0,
      spinYaw: 0,
      // Boss signature ultimates
      bossUltCd: spec.type === 'boss' ? 3.2 : 999,
      ultKind: null,
      ultTargetX: e.x,
      ultTargetZ: e.z,
      ultStartX: e.x,
      ultStartZ: e.z,
      ultWavesHit: 0,
      lastUltIdx: -1,
      telegraph: null, // { kind: 'ring' | 'line', x, z, rad, ang, len, prog }
      pose: makeDuelPose(weaponKind)
    };
  }

  flashCallout(text, col = '#ffd860', dur = 1.25) {
    this.callout = text;
    this.calloutCol = col;
    this.calloutT = dur;
  }

  addQi(amount) {
    const scaled = amount > 0 ? amount * (this.qiGainMult || 1) : amount;
    this.qi = clamp(this.qi + scaled, 0, this.maxQi);
  }

  getCooldown(id) {
    return this.cooldowns?.[id] || 0;
  }

  getMaxCooldown(id) {
    const u = ULTIMATES[id];
    const base = u?.cd || 12;
    return Math.max(5, base - (this.ultCdReduce || 0));
  }

  reduceCooldowns(sec) {
    if (!this.cooldowns || sec <= 0) return false;
    let reduced = false;
    for (const k in this.cooldowns) {
      if (this.cooldowns[k] > 0) {
        this.cooldowns[k] = Math.max(0, this.cooldowns[k] - sec);
        reduced = true;
      }
    }
    return reduced;
  }

  canUseUltimate(id) {
    const u = ULTIMATES[id];
    return !!(u && this.qi >= u.cost && this.playerBrokenT <= 0 && this.getCooldown(id) <= 0);
  }

  spendUltimate(id) {
    const u = ULTIMATES[id];
    if (!u || this.qi < u.cost || this.playerBrokenT > 0 || this.getCooldown(id) > 0) return false;
    this.qi = Math.max(0, this.qi - u.cost);
    this.cooldowns[id] = this.getMaxCooldown(id);
    this.flashCallout(`${u.name}！`, '#ffe082', 1.4);
    return true;
  }

  _lockCandidates(level, P) {
    return level.enemies.filter(e => {
      if (e.hp <= 0 || e.bossDormant) return false;
      if (this.mode === 'campaign') {
        const d = Math.hypot(e.x - P.x, e.z - P.z);
        if (!e.awake && d > 18) return false;
        if (d > 24) return false;
      }
      return true;
    });
  }

  autoLock(level, P) {
    const cands = this._lockCandidates(level, P);
    if (this.lockTarget && cands.includes(this.lockTarget)) {
      return this.lockTarget;
    }
    let best = null;
    let bestD = Infinity;
    for (const e of cands) {
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.lockTarget = best;
    return best;
  }

  toggleLock(level, P) {
    const alive = this._lockCandidates(level, P);
    if (!alive.length) {
      this.lockTarget = null;
      return null;
    }
    if (!this.lockTarget || !alive.includes(this.lockTarget)) {
      return this.autoLock(level, P);
    }
    if (alive.length > 1) {
      const idx = alive.indexOf(this.lockTarget);
      this.lockTarget = alive[(idx + 1) % alive.length];
      return this.lockTarget;
    }
    this.lockTarget = null;
    return null;
  }

  // Trigger an acrobatic jump-flip evade (backflip or sideflip vault)
  triggerEnemyEvade(e, P, ctx, forcedKind = null) {
    const d = e.duel;
    if (!d || e.hp <= 0 || d.state === 'broken' || d.state === 'evade' || d.state === 'bossUlt') return false;
    const dx = e.x - P.x;
    const dz = e.z - P.z;
    const dist = Math.hypot(dx, dz) || 1;
    const awayX = dx / dist;
    const awayZ = dz / dist;
    const side = Math.random() < 0.5 ? 1 : -1;
    const kind = forcedKind || (dist < 2.6 || Math.random() < 0.52 ? 'backflip' : 'sideflip');

    d.state = 'evade';
    d.stateT = 0;
    d.stateDur = e.type === 'boss' ? 0.58 : 0.50;
    d.evadeKind = kind;
    d.evadeSide = side;
    d.evadeCd = e.type === 'boss' ? (d.phase === 2 ? 2.0 : 2.7) : 4.4;
    d.invulnT = d.stateDur * 0.74;
    d.peril = false;
    d.blocking = false;
    d.hitStreak = 0;
    d.telegraph = null;
    d.spinYaw = 0;
    if (kind === 'backflip') {
      d.evadeDirX = awayX;
      d.evadeDirZ = awayZ;
    } else {
      // Sideways aerial vault flanking around the player
      const tx = -awayZ * side;
      const tz = awayX * side;
      d.evadeDirX = tx * 0.92 + awayX * 0.35;
      d.evadeDirZ = tz * 0.92 + awayZ * 0.35;
      const l = Math.hypot(d.evadeDirX, d.evadeDirZ) || 1;
      d.evadeDirX /= l;
      d.evadeDirZ /= l;
    }
    ctx.audio?.sfx?.('roll');
    ctx.callbacks?.onEnemyEvade?.(e, kind);
    return true;
  }

  // Launch one of the Boss's 4 signature cold-weapon Ultimates (with huge telegraphed AOE)!
  startBossUltimate(e, P, ctx, forcedUlt = null) {
    const d = e.duel;
    if (!d || e.hp <= 0 || d.state === 'broken') return false;
    const order = d.phase === 2
      ? ['bossLeapSlam', 'bossWhirlwind', 'bossDashThrust', 'bossQuakeNova']
      : ['bossLeapSlam', 'bossWhirlwind', 'bossDashThrust', 'bossQuakeNova'];
    let ultId = forcedUlt;
    if (!ultId || !BOSS_ULTIMATES[ultId]) {
      const dist = Math.hypot(P.x - e.x, P.z - e.z);
      if (d.phase === 2 && dist < 5.6 && d.lastUltIdx !== 3 && Math.random() < 0.42) {
        ultId = 'bossQuakeNova';
      } else if (dist > 5.0 && d.lastUltIdx !== 0) {
        ultId = Math.random() < 0.62 ? 'bossLeapSlam' : 'bossDashThrust';
      } else if (dist < 4.2 && d.lastUltIdx !== 1) {
        ultId = Math.random() < 0.56 ? 'bossWhirlwind' : 'bossQuakeNova';
      } else {
        const nextIdx = (d.lastUltIdx + 1 + (Math.random() < 0.5 ? 0 : 1)) % order.length;
        ultId = order[nextIdx];
      }
    }
    d.lastUltIdx = order.indexOf(ultId);
    const spec = BOSS_ULTIMATES[ultId];
    d.state = 'bossUlt';
    d.ultKind = ultId;
    d.stateT = 0;
    d.stateDur = spec.dur;
    d.didHit = false;
    d.ultWavesHit = 0;
    d.peril = spec.peril;
    d.blocking = false;
    d.jumpY = 0;
    d.flipX = 0;
    d.flipZ = 0;
    d.spinYaw = 0;
    d.ultStartX = e.x;
    d.ultStartZ = e.z;
    d.ultTargetX = P.x;
    d.ultTargetZ = P.z;
    d.bossUltCd = d.phase === 2 ? rnd(3.6, 4.9) : rnd(5.2, 6.8);
    d.telegraph = null;

    if (spec.peril) ctx.audio?.sfx?.('perilGong');
    else ctx.audio?.sfx?.('ultIaido');
    this.flashCallout(`霸王绝技 · ${spec.name}！`, spec.peril ? '#ff4432' : '#ffd860', 1.75);
    ctx.callbacks?.onBossUltStart?.(ultId, e);
    return true;
  }

  // Called when player's blade hits a Dojo duelist; returns 'evaded' | 'blocked' | 'hit' | 'broken'
  resolvePlayerHit(e, def, pt, dir, ctx) {
    const d = e.duel;
    if (!d || e.hp <= 0) return 'hit';
    const { player: P, audio, callbacks } = ctx;

    // Wake campaign enemy & nearby pack if struck first
    if (!e.awake && !e.bossDormant) {
      e.awake = true;
      e.sees = true;
      if (ctx.level?.enemies) {
        for (const ally of ctx.level.enemies) {
          if (ally.hp > 0 && !ally.bossDormant && ally.group === e.group) {
            ally.awake = true;
            ally.sees = true;
          }
        }
      }
    }

    // 1. Mid-air flip / acrobatic evade invulnerability frames!
    if (d.state === 'evade' && d.invulnT > 0) {
      audio?.sfx?.('swish');
      callbacks?.onEnemyEvadeMiss?.(e, pt);
      return 'evaded';
    }

    // 2. Reactive evade chance on player heavy chop / ultimate while enemy is poised in circle stance
    // (Guard Counters reliably catch enemies and Tier 1 grunts never acrobatically flip!)
    if (
      P &&
      (def.heavy || def.ult) &&
      !def.guardCounter &&
      d.poiseTier >= 2 &&
      d.evadeChance > 0 &&
      d.state === 'circle' &&
      d.evadeCd <= 0 &&
      Math.random() < d.evadeChance * (def.ult ? 0.65 : 0.85)
    ) {
      this.triggerEnemyEvade(e, P, ctx);
      callbacks?.onEnemyEvadeMiss?.(e, pt);
      return 'evaded';
    }

    const facingPlayer = -(dir.x * Math.cos(e.ang) + dir.z * Math.sin(e.ang)) > -0.25;
    const canEnemyBlock =
      !def.unblockable &&
      !def.heavy &&
      !def.guardCounter &&
      facingPlayer &&
      (d.state === 'circle' || d.state === 'blockReact') &&
      (d.blocking || Math.random() < d.blockChance);

    if (canEnemyBlock) {
      d.blocking = true;
      d.state = 'blockReact';
      d.stateT = 0;
      d.stateDur = 0.34;
      d.postureDelay = 2.6;
      const pDmg = (def.postureDmg || 22) * (ctx.postureMult || 1);
      d.posture = Math.min(d.maxPosture, d.posture + pDmg);
      this.addQi(8);
      this.clashCount++;
      this.comboT = 2.4;

      if (d.posture >= d.maxPosture) {
        this._breakEnemyPosture(e, ctx);
        return 'broken';
      }
      audio?.sfx?.('bladeClang');
      callbacks?.onBladeClash?.(e, pt, false);
      return 'blocked';
    }

    // Clean flesh hit (or guard-shattering Guard Counter / Heavy / Ultimate!)
    const postureMult = (d.state === 'broken' ? 0 : (def.guardCounter ? 1.15 : def.unblockable ? 1.25 : 1.0)) * (ctx.postureMult || 1);
    const pDmg = (def.postureDmg || (def.heavy ? 40 : 20)) * postureMult;
    d.postureDelay = 2.8;
    d.posture = Math.min(d.maxPosture, d.posture + pDmg);
    d.blocking = false;
    if (d.state !== 'bossUlt') d.peril = false;
    this.addQi(def.ult ? 0 : def.guardCounter ? 18 : def.heavy ? 16 : 12);
    this.comboHits++;
    this.comboT = 3.0;
    d.hitStreak++;
    d.hitStreakT = 2.4;

    if (d.state !== 'broken' && d.posture >= d.maxPosture && e.hp > def.dmg) {
      this._breakEnemyPosture(e, ctx);
      return 'broken';
    }

    if (def.guardCounter) {
      this.flashCallout('防御反击！重创敌方架势', '#ffe27a', 1.1);
    }

    // Agile elites & Boss back-flip out of sustained player combos (Tier 1 grunts & low-evade foes never spam flips!)
    const streakLimit = e.type === 'boss' ? 2 : 3;
    if (
      P &&
      d.poiseTier >= 3 &&
      d.evadeChance > 0.12 &&
      d.state !== 'broken' &&
      d.state !== 'bossUlt' &&
      d.evadeCd <= 0 &&
      d.hitStreak >= streakLimit &&
      e.hp > def.dmg &&
      Math.random() < Math.min(0.82, d.evadeChance + 0.30)
    ) {
      this.triggerEnemyEvade(e, P, ctx, 'backflip');
      return 'hit';
    }

    // Elden-Ring Poise Hierarchy:
    // T1 Grunts (poiseTier 1): ZERO hyper-armor — light slashes reliably interrupt them!
    // T2 Heavies (poiseTier 2): Hold poise during active strike against 1st light hit, staggered by heavy/GC/2nd hit.
    // T3 Elites & T4 Boss (poiseTier >= 3): Hold knight/boss poise during windup/strike against light slashes; staggered by GC/Unblockable/Ult/Parry!
    const poiseBreaks = !!(def.guardCounter || def.unblockable || def.ult);
    let holdsPoise = false;
    if (!poiseBreaks) {
      if (d.poiseTier >= 3) {
        holdsPoise = d.state === 'windup' || d.state === 'strike';
      } else if (d.poiseTier === 2) {
        holdsPoise = d.state === 'strike' && !def.heavy && d.hitStreak < 2;
      }
    }
    if (d.state !== 'broken' && d.state !== 'bossUlt' && !holdsPoise) {
      d.state = 'stagger';
      d.stateT = 0;
      d.stateDur = e.type === 'boss'
        ? (def.guardCounter || def.unblockable ? 0.48 : 0.24)
        : (def.guardCounter || def.heavy || def.unblockable ? 0.58 : d.poiseTier === 1 ? 0.38 : 0.30);
    }
    return 'hit';
  }

  _breakEnemyPosture(e, ctx) {
    const d = e.duel;
    if (!d) return;
    d.posture = d.maxPosture;
    d.state = 'broken';
    d.stateT = 0;
    d.stateDur = 2.8;
    d.peril = false;
    d.blocking = false;
    d.jumpY = 0;
    d.flipX = 0;
    d.flipZ = 0;
    d.spinYaw = 0;
    d.telegraph = null;
    e.staggerT = 2.8;
    e.react = { kind: 'kneel', t: 0, dur: 2.8, side: 1 };
    this.addQi(20);
    this.flashCallout('破 防！按 [E] 一刀绝杀', '#ffd860', 2.0);
    ctx.audio?.sfx?.('guardBreak');
    ctx.callbacks?.onGuardBreak?.(e);
  }

  // Handle an enemy's active melee strike or Boss ultimate wave connecting with the player
  _resolveEnemyStrike(e, ctx, opts = null) {
    const { player: P, melee, audio, callbacks } = ctx;
    const d = e.duel;
    const ox = opts?.ox ?? e.x;
    const oz = opts?.oz ?? e.z;
    const dist = Math.hypot(P.x - ox, P.z - oz);
    const isBoss = e.type === 'boss';
    const weaponReachBoost = d.weaponKind === 'guandao' ? 1.15 : d.weaponKind === 'spear' ? 0.65 : d.weaponKind === 'axe' || d.weaponKind === 'mace' ? 0.32 : 0;
    const reach = opts?.rad ?? (((d.attackKind === 'perilChop' || d.attackKind === 'perilThrust') ? 2.65 : 2.25) + weaponReachBoost) * (0.78 + 0.22 * (e.scale || 1));
    if (dist > reach) return false;
    if (!opts?.aoe) {
      const toPx = (P.x - e.x) / (dist || 1);
      const toPz = (P.z - e.z) / (dist || 1);
      const dot = toPx * Math.cos(e.ang) + toPz * Math.sin(e.ang);
      // Boss's colossal Guandao sweeps a devastating 180° arc!
      if (dot < (isBoss ? -0.15 : 0.22)) return false;
    }

    const unblockable = opts?.unblockable ?? (d.attackKind === 'perilChop' || d.attackKind === 'perilThrust');

    // Invulnerable dodge / quick-step / finisher!
    if (P.rollT > 0 || P.stepT > 0 || P.execT > 0 || P.inv > 0) {
      const qiGain = opts?.isUlt ? 20 : 10;
      this.addQi(qiGain);
      this.flashCallout(`身法闪避！+${qiGain} 刀气`, '#88e8ff', 0.95);
      return false;
    }

    const clashPos = {
      x: (P.x + e.x) * 0.5,
      y: 1.25,
      z: (P.z + e.z) * 0.5
    };

    // 1. PERFECT PARRY (Sekiro-style crisp deflect!)
    if (!unblockable && melee && melee.parryWindowT > 0 && this.playerBrokenT <= 0) {
      melee.parryWindowT = 0;
      melee.triggerParryPulse();
      this.parryCount++;
      this.clashCount++;
      this.addQi(28);
      P.restoreStamina?.(20);
      const cutCd = this.reduceCooldowns(2.5);
      d.postureDelay = isBoss ? 2.6 : 3.2;
      d.posture = Math.min(d.maxPosture, d.posture + 48);
      d.peril = false;
      d.blocking = false;
      d.comboLeft = 0;
      audio?.sfx?.('parryClang');
      callbacks?.onParry?.(e, clashPos);
      if (d.posture >= d.maxPosture) {
        this._breakEnemyPosture(e, ctx);
      } else if (d.state === 'bossUlt') {
        // Boss whirlwind continues spinning unless posture breaks — just like Sekiro Floating Passage!
        this.flashCallout(cutCd ? '连续弹反！大招冷却 -2.5s' : '连环弹反！', '#ffe27a', 1.1);
      } else {
        d.state = 'stagger';
        d.stateT = 0;
        d.stateDur = isBoss ? 0.95 : 1.25;
        e.staggerT = d.stateDur;
        this.flashCallout(cutCd ? '完美弹反！大招冷却 -2.5s' : '完美弹反！', '#ffe27a', 1.25);
      }
      return false;
    }

    // 2. STANDARD GUARD BLOCK (Elden Ring Guard Counter enabled!)
    if (!unblockable && melee && melee.isGuarding && this.playerBrokenT <= 0) {
      this.clashCount++;
      this.addQi(12);
      this.playerPostureDelay = 2.4;
      const blockStam = opts?.isUlt ? 15 : 10;
      const stamOk = P.consumeStamina ? P.consumeStamina(blockStam, 0.36) : true;
      const blockPos = opts?.isUlt ? 28 : isBoss ? 24 : d.poiseTier >= 3 ? 20 : 16;
      this.playerPosture = Math.min(this.maxPlayerPosture, this.playerPosture + blockPos);
      d.postureDelay = 2.4;
      d.posture = Math.min(d.maxPosture, d.posture + 12);
      audio?.sfx?.('bladeClang');
      if (!stamOk || this.playerPosture >= this.maxPlayerPosture) {
        this.playerPosture = 0;
        this.playerBrokenT = 0.85;
        melee.setBlock(false);
        audio?.sfx?.('guardBreak');
        callbacks?.onBlock?.(e, clashPos, false);
        this.flashCallout(!stamOk ? '精力耗尽 · 架势震溃！' : '架势被震溃！', '#ff6b57', 1.1);
      } else {
        melee.openGuardCounter?.(0.72);
        callbacks?.onBlock?.(e, clashPos, true);
        this.flashCallout('格挡！按 [左键] 防御反击', '#ffe28a', 0.88);
      }
      return false;
    }

    // 3. CLEAN HIT ON PLAYER (Elden-Ring lethal regular mobs & Boss! Reduced during Ultimate Hyper-Armor)
    let rawDmg;
    if (opts?.dmg !== undefined) {
      rawDmg = Math.round(opts.dmg * (d.ultDmgMult || 1));
    } else if (unblockable && d.perilDmg > 0) {
      rawDmg = d.perilDmg;
    } else if (!unblockable && d.normalDmg > 0) {
      rawDmg = Math.round(d.normalDmg * (d.attackKind === 'slashB' ? 1.12 : 1.0));
    } else {
      rawDmg = isBoss
        ? (unblockable ? 38 : d.attackKind === 'slashB' ? 25 : 22)
        : (unblockable ? 30 : d.attackKind === 'slashB' ? 18 : 16);
    }
    const hyper = !!melee?.hyperArmor;
    const finalDmg = hyper ? Math.round(rawDmg * 0.45) : rawDmg;
    this.comboHits = 0;
    callbacks?.hurtPlayer?.(finalDmg, ox, oz);
    audio?.sfx?.('slashHit');
    if (unblockable && !hyper) {
      this.flashCallout('危招破防！按 空格/Shift 或双击A/D 翻滚闪避', '#ff5442', 1.3);
    }
    return true;
  }

  update(dt, ctx) {
    if (!this.active) return;
    const { level, player: P, melee, audio, callbacks } = ctx;

    if (this.calloutT > 0) this.calloutT = Math.max(0, this.calloutT - dt);
    if (this.comboT > 0) {
      this.comboT = Math.max(0, this.comboT - dt);
      if (this.comboT <= 0) this.comboHits = 0;
    }
    if (this.playerBrokenT > 0) this.playerBrokenT = Math.max(0, this.playerBrokenT - dt);
    if (this.groupAtkCd > 0) this.groupAtkCd = Math.max(0, this.groupAtkCd - dt);
    if (this.playerPostureDelay > 0) this.playerPostureDelay = Math.max(0, this.playerPostureDelay - dt);
    else if (this.playerPosture > 0) this.playerPosture = Math.max(0, this.playerPosture - dt * 24);
    if (this.cooldowns) {
      for (const k in this.cooldowns) {
        if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      }
    }

    // Subtle passive Qi focus gain (main Qi earned from real parries, clashes & dodges)
    this.addQi(dt * 0.75);

    // Maintain valid Lock-On target & smooth face-tracking
    if (this.lockTarget) {
      const deadOrFar =
        this.lockTarget.hp <= 0 ||
        this.lockTarget.bossDormant ||
        (this.mode === 'campaign' && Math.hypot(this.lockTarget.x - P.x, this.lockTarget.z - P.z) > 25);
      if (deadOrFar) {
        this.lockTarget = null;
        if (this.mode !== 'campaign') this.autoLock(level, P);
      }
    }
    if (this.lockTarget && P.execT <= 0 && P.rollT <= 0) {
      const want = Math.atan2(this.lockTarget.z - P.z, this.lockTarget.x - P.x);
      const diff = Math.atan2(Math.sin(want - P.ang), Math.cos(want - P.ang));
      P.ang = Math.atan2(Math.sin(P.ang + clamp(diff, -dt * 9.5, dt * 9.5)), Math.cos(P.ang + clamp(diff, -dt * 9.5, dt * 9.5)));
    }

    const alive = level.enemies.filter(e => e.hp > 0);
    if (this.mode === 'campaign') {
      if (level.boss && level.boss.hp <= 0 && !this.bossVictoryFired) {
        this.bossVictoryFired = true;
        callbacks?.onCampaignBossDefeated?.(level.boss);
      }
    } else if (!alive.length) {
      this.victoryT += dt;
      if (!this.announcedWin) {
        this.announcedWin = true;
        this.flashCallout('演武完胜！按 [R] 再战 · [F1-F4] 切换对手', '#ffd860', 6.0);
        audio?.sfx?.('win');
      }
      return;
    }

    // Only allow one attacker in active windup/strike/ult at a time in multi-foe fights so parrying stays fair & readable!
    const someoneAttacking = alive.some(e => e.awake && e.duel && (e.duel.state === 'windup' || e.duel.state === 'strike' || e.duel.state === 'bossUlt'));

    for (const e of alive) {
      const d = e.duel;
      if (!d) continue;
      e.duck = false;
      e.flash = Math.max(0, (e.flash || 0) - dt);
      e.flinch = Math.max(0, (e.flinch || 0) - dt * 5);
      e.staggerT = Math.max(0, (e.staggerT || 0) - dt);

      // Enclosed Boss stays dormant & calm behind the Fog Gate until the hero traverses the mist!
      if (e.bossDormant) {
        e.awake = false;
        e.sees = false;
        e.moving = false;
        e.spd = 0;
        d.jumpY = 0;
        d.flipX = 0;
        d.flipZ = 0;
        d.spinYaw = 0;
        d.telegraph = null;
        lerpDuelPose(d.pose, guardPoseFor(d.weaponKind), Math.min(1, dt * 8));
        continue;
      }

      const dx = P.x - e.x;
      const dz = P.z - e.z;
      const dist = Math.hypot(dx, dz) || 0.01;

      if (this.mode === 'campaign') {
        if (!e.awake) {
          const sameZoneAsBoss = level.bossRoom?.entered && e.type !== 'boss';
          const canSee = !sameZoneAsBoss && dist <= (d.aggroRange || 13.5) && (!level.los || level.los(e.x, e.z, P.x, P.z));
          if (canSee) {
            e.awake = true;
            e.sees = true;
            for (const ally of alive) {
              if (!ally.bossDormant && ally.group === e.group) {
                ally.awake = true;
                ally.sees = true;
              }
            }
          } else {
            e.moving = false;
            e.spd = 0;
            lerpDuelPose(d.pose, guardPoseFor(d.weaponKind), Math.min(1, dt * 6));
            continue;
          }
        } else if (e.type !== 'boss' && level.bossRoom?.entered) {
          // Street mobs stay outside once the hero enters the sealed Boss Room
          e.moving = false;
          e.spd = 0;
          continue;
        }
      } else {
        e.awake = true;
        e.sees = true;
      }

      if (d.evadeCd > 0) d.evadeCd = Math.max(0, d.evadeCd - dt);
      if (d.invulnT > 0) d.invulnT = Math.max(0, d.invulnT - dt);
      if (d.bossUltCd > 0) d.bossUltCd = Math.max(0, d.bossUltCd - dt);
      if (d.hitStreakT > 0) {
        d.hitStreakT = Math.max(0, d.hitStreakT - dt);
        if (d.hitStreakT <= 0) d.hitStreak = 0;
      }

      // Smooth delayed HP drain trail (Souls / Sekiro bar feel)
      if (d.displayHp === undefined || d.displayHp < e.hp) d.displayHp = e.hp;
      else if (d.displayHp > e.hp) d.displayHp = Math.max(e.hp, d.displayHp - Math.max(e.max * 0.22, (d.displayHp - e.hp) * 2.6) * dt);

      // Boss Phase 2 Awakening below 55% HP (with 6.5m crimson awakening shockwave!)
      if (e.type === 'boss' && d.phase === 1 && e.hp <= e.max * 0.55) {
        d.phase = 2;
        d.aggro = Math.max(d.aggro, 1.56);
        d.blockChance = Math.max(d.blockChance, 0.78);
        d.posture = Math.max(0, d.posture - d.maxPosture * 0.40);
        d.atkCd = Math.min(d.atkCd, 0.25);
        d.bossUltCd = Math.min(d.bossUltCd, 0.9);
        audio?.sfx?.('perilGong');
        audio?.sfx?.('boom');
        this.flashCallout('霸王黑龙狂化！震退八荒！', '#ff4432', 2.2);
        callbacks?.onBossPhase2?.(e);
        this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: 6.5, dmg: 24, unblockable: true, aoe: true, isUlt: true });
      }

      if (e.executing) {
        e.moving = false;
        e.spd = 0;
        d.jumpY = 0;
        d.flipX = 0;
        d.flipZ = 0;
        d.spinYaw = 0;
        d.telegraph = null;
        lerpDuelPose(d.pose, 'broken', Math.min(1, dt * 12));
        continue;
      }

      if (d.postureDelay > 0) d.postureDelay = Math.max(0, d.postureDelay - dt);
      else if (d.state !== 'broken' && d.posture > 0) {
        const pRegen = e.type === 'boss' ? (d.phase === 2 ? 24 : 18) : 14;
        d.posture = Math.max(0, d.posture - dt * pRegen);
      }

      const toP = Math.atan2(dz, dx);
      d.stateT += dt;
      d.atkCd = Math.max(0, d.atkCd - dt);

      const turnTowardPlayer = rate => {
        const diff = Math.atan2(Math.sin(toP - e.ang), Math.cos(toP - e.ang));
        e.ang = Math.atan2(Math.sin(e.ang + clamp(diff, -dt * rate, dt * rate)), Math.cos(e.ang + clamp(diff, -dt * rate, dt * rate)));
      };

      const stepMove = (mx, mz, speed) => {
        const x0 = e.x;
        const z0 = e.z;
        level.moveEnt(e, mx * speed * dt, mz * speed * dt);
        for (const other of alive) {
          if (other === e || other.bossDormant) continue;
          const sx = e.x - other.x;
          const sz = e.z - other.z;
          const sd = Math.hypot(sx, sz);
          if (sd > 0.01 && sd < 1.35) {
            level.moveEnt(e, (sx / sd) * 2.2 * dt, (sz / sd) * 2.2 * dt);
          }
        }
        // Keep Boss strictly enclosed inside Boss Room & prevent street mobs from crossing the Fog Gate!
        const br = level.bossRoom;
        if (br) {
          if (e.type === 'boss') {
            e.x = clamp(e.x, br.x0 + e.r + 0.15, br.x1 - e.r - 0.15);
            e.z = clamp(e.z, br.z0 + e.r + 0.15, br.z1 - e.r - 0.15);
          } else if (!br.cleared && e.z < br.gateZ + 1.0) {
            e.z = br.gateZ + 1.0;
          }
        }
        e.spd = dt > 0 ? Math.hypot(e.x - x0, e.z - z0) / dt : 0;
        e.moving = e.spd > 0.18;
        if (ctx.physics?.updateEnemyCollider) ctx.physics.updateEnemyCollider(e, e.x, e.z, e.ht);
      };

      // Reset airborne/flip transforms when outside evade & bossUlt
      if (d.state !== 'evade' && d.state !== 'bossUlt') {
        d.jumpY = 0;
        d.flipX = 0;
        d.flipZ = 0;
        d.spinYaw = 0;
        d.telegraph = null;
      }

      // === STATE: BROKEN (Posture shattered -> ready for [E] Deathblow) ===
      if (d.state === 'broken') {
        e.moving = false;
        e.spd = 0;
        lerpDuelPose(d.pose, 'broken', Math.min(1, dt * 10));
        if (d.stateT >= d.stateDur) {
          d.posture = d.maxPosture * 0.35;
          d.state = 'circle';
          d.stateT = 0;
          e.react = null;
        }
        continue;
      }

      // === STATE: EVADE (Acrobatic Jump + 360° Back-Flip / Side-Vault!) ===
      if (d.state === 'evade') {
        const p = clamp(d.stateT / d.stateDur, 0, 1);
        const arc = Math.sin(p * Math.PI);
        const peakH = d.evadeKind === 'backflip' ? (e.type === 'boss' ? 1.72 : 1.28) : (e.type === 'boss' ? 1.42 : 1.05);
        d.jumpY = arc * peakH;
        if (d.evadeKind === 'backflip') {
          d.flipX = -TAU * p; // Crisp airborne 360° back-somersault
          d.flipZ = 0;
        } else {
          d.flipX = 0;
          d.flipZ = d.evadeSide * TAU * p; // Agile lateral vault flip
        }
        const vaultSpd = d.evadeKind === 'backflip' ? (e.type === 'boss' ? 7.6 : 6.4) : (e.type === 'boss' ? 7.2 : 6.0);
        stepMove(d.evadeDirX, d.evadeDirZ, vaultSpd * (0.45 + 0.75 * arc));
        turnTowardPlayer(10.0);
        lerpDuelPose(d.pose, 'evadeCoil', Math.min(1, dt * 16));
        if (d.stateT >= d.stateDur) {
          d.jumpY = 0;
          d.flipX = 0;
          d.flipZ = 0;
          d.invulnT = 0;
          // Boss aggressively chains an evade straight into a Boss Ultimate or high-speed counter!
          if (e.type === 'boss' && d.bossUltCd <= 2.2 && !someoneAttacking && Math.random() < 0.78) {
            this.startBossUltimate(e, P, ctx);
          } else if (dist < 4.8 && !someoneAttacking && Math.random() < (e.type === 'boss' ? 0.72 : 0.55)) {
            const counterKind = d.weaponKind === 'spear' ? 'thrustA' : 'slashB';
            this._beginEnemyAttack(e, counterKind, false, audio);
          } else {
            d.state = 'circle';
            d.stateT = 0;
          }
        }
        continue;
      }

      // === STATE: BOSS SIGNATURE ULTIMATES ===
      if (d.state === 'bossUlt') {
        this._stepBossUltimate(e, P, dt, dx, dz, dist, turnTowardPlayer, stepMove, ctx);
        continue;
      }

      // === STATE: STAGGER / BLOCK REACT ===
      if (d.state === 'stagger' || d.state === 'blockReact') {
        e.moving = false;
        e.spd = 0;
        turnTowardPlayer(3.5);
        lerpDuelPose(d.pose, d.state === 'blockReact' ? 'block' : 'stagger', Math.min(1, dt * 15));
        if (d.stateT >= d.stateDur) {
          d.blocking = false;
          const riposteChance = e.type === 'boss' ? 0.72 : 0.48;
          if (d.state === 'blockReact' && dist < (e.type === 'boss' ? 4.4 : 3.4) && !someoneAttacking && Math.random() < riposteChance) {
            const counterKind = d.weaponKind === 'spear' ? 'thrustA' : 'slashB';
            this._beginEnemyAttack(e, counterKind, false, audio);
          } else {
            d.state = 'circle';
            d.stateT = 0;
          }
        }
        continue;
      }

      // === STATE: WINDUP ===
      if (d.state === 'windup') {
        turnTowardPlayer(7.5);
        const poseKey =
          d.attackKind === 'perilChop' ? 'windupPeril'
            : d.attackKind === 'thrustA' || d.attackKind === 'perilThrust' ? 'windupThrust'
              : d.attackKind === 'slashB' ? 'windupB'
                : 'windupA';
        lerpDuelPose(d.pose, poseKey, Math.min(1, dt * 12));
        const wantStop = d.weaponKind === 'spear' || d.weaponKind === 'guandao' ? 2.25 : 1.75;
        if (dist > wantStop) stepMove(dx / dist, dz / dist, 3.0);
        else { e.moving = false; e.spd = 0; }
        if (d.stateT >= d.stateDur) {
          d.state = 'strike';
          d.stateT = 0;
          d.stateDur = 0.25;
          d.didHit = false;
          audio?.sfx?.(d.peril || d.weaponKind === 'axe' || d.weaponKind === 'guandao' ? 'swishHeavy' : 'swish');
        }
        continue;
      }

      // === STATE: STRIKE ===
      if (d.state === 'strike') {
        const poseKey =
          d.attackKind === 'perilChop' ? 'strikePeril'
            : d.attackKind === 'thrustA' || d.attackKind === 'perilThrust' ? 'strikeThrust'
              : d.attackKind === 'slashB' ? 'strikeB'
                : 'strikeA';
        lerpDuelPose(d.pose, poseKey, Math.min(1, dt * 24));
        const lungeSpd = (d.attackKind === 'thrustA' || d.attackKind === 'perilThrust') ? 7.4 : e.type === 'boss' ? 6.2 : 5.2;
        if (d.stateT < 0.13 && dist > 1.35) stepMove(Math.cos(e.ang), Math.sin(e.ang), lungeSpd);
        else { e.moving = false; e.spd = 0; }
        if (!d.didHit && d.stateT >= 0.06) {
          d.didHit = true;
          if (e.type === 'boss' && d.attackKind === 'perilChop') {
            const sx = e.x + Math.cos(e.ang) * 1.4;
            const sz = e.z + Math.sin(e.ang) * 1.4;
            callbacks?.onBossHeavySmash?.(e, { x: sx, y: 0.12, z: sz, rad: 4.1 });
            this._resolveEnemyStrike(e, ctx, { ox: sx, oz: sz, rad: 4.1, dmg: d.perilDmg || 62, unblockable: true, aoe: true });
          } else {
            this._resolveEnemyStrike(e, ctx);
          }
        }
        if (d.stateT >= d.stateDur) {
          d.peril = false;
          if (d.comboLeft > 0 && dist < (e.type === 'boss' ? 4.8 : 3.8) && d.state !== 'stagger' && d.state !== 'broken') {
            d.comboLeft--;
            // Boss occasionally caps a combo with a sudden crimson peril chop!
            if (e.type === 'boss' && d.comboLeft === 0 && Math.random() < (d.phase === 2 ? 0.52 : 0.30)) {
              this._beginEnemyAttack(e, 'perilChop', true, audio);
            } else {
              const nextMove = d.weaponKind === 'spear'
                ? (d.attackKind === 'thrustA' ? 'slashB' : 'thrustA')
                : (d.attackKind === 'slashA' ? 'slashB' : 'slashA');
              this._beginEnemyAttack(e, nextMove, false, audio);
            }
          } else {
            d.state = 'recover';
            d.stateT = 0;
            const isPerilMove = d.attackKind === 'perilChop' || d.attackKind === 'perilThrust';
            d.stateDur = e.type === 'boss'
              ? (isPerilMove ? 0.72 : 0.42)
              : (isPerilMove ? 0.88 : d.poiseTier >= 3 ? 0.56 : 0.64);
            d.atkCd = rnd(e.type === 'boss' ? 0.62 : 0.92, e.type === 'boss' ? 1.10 : 1.56) / d.aggro;
            // Elden-Ring pack breathing room: when one non-boss mob finishes swinging, packmates hold briefly so player can dodge or drink Flask!
            if (e.type !== 'boss') {
              this.groupAtkCd = Math.max(this.groupAtkCd, rnd(0.58, 0.92));
            }
          }
        }
        continue;
      }

      // === STATE: RECOVER ===
      if (d.state === 'recover') {
        e.moving = false;
        e.spd = 0;
        turnTowardPlayer(4.0);
        lerpDuelPose(d.pose, guardPoseFor(d.weaponKind), Math.min(1, dt * 8));
        if (d.stateT >= d.stateDur) {
          d.state = 'circle';
          d.stateT = 0;
        }
        continue;
      }

      // === DEFAULT STATE: CIRCLE (footwork + reactive leap-evade + Boss Ultimates!) ===
      turnTowardPlayer(8.0);
      d.strafeT -= dt;
      if (d.strafeT <= 0) {
        d.strafeT = rnd(0.95, 2.0);
        d.strafeDir = -d.strafeDir;
        d.blocking = Math.random() < d.blockChance;
      }
      lerpDuelPose(d.pose, d.blocking ? 'block' : guardPoseFor(d.weaponKind), Math.min(1, dt * 9));

      // Proactive agile jump/flip when player triggers an Ultimate or Heavy right in front!
      if (
        melee?.state === 'attack' &&
        melee.atk?.def?.heavy &&
        melee.atk.t < 0.24 &&
        dist < 4.8 &&
        d.evadeCd <= 0 &&
        Math.random() < d.evadeChance * dt * 6.0
      ) {
        this.triggerEnemyEvade(e, P, ctx);
        continue;
      }

      const basePref = d.weaponKind === 'guandao' ? 3.45 : d.weaponKind === 'spear' ? 3.05 : 2.55;
      const prefDist = basePref * (0.88 + 0.12 * (e.scale || 1));
      const nx = dx / dist;
      const nz = dz / dist;
      const hasSight = !level.los || level.los(e.x, e.z, P.x, P.z);
      if (dist > 4.6 && !hasSight && level.flowDir) {
        const fd = level.flowDir(e);
        if (fd) stepMove(fd[0], fd[1], e.type === 'boss' ? 5.6 : 4.8);
        else stepMove(nx, nz, e.type === 'boss' ? 5.2 : 4.5);
      } else {
        const rx = -nz * d.strafeDir;
        const rz = nx * d.strafeDir;
        let mvX = rx * 0.78;
        let mvZ = rz * 0.78;
        if (dist > prefDist + 0.65) {
          mvX += nx * 0.98;
          mvZ += nz * 0.98;
        } else if (dist < prefDist - 0.55) {
          mvX -= nx * 0.68;
          mvZ -= nz * 0.68;
        }
        const ml = Math.hypot(mvX, mvZ) || 1;
        const walkSpd = dist > 5.2 ? (e.type === 'boss' ? 5.6 : 4.8) : (e.type === 'boss' ? 3.1 : 2.55);
        stepMove(mvX / ml, mvZ / ml, walkSpd);
      }

      // Boss unleashes Signature Ultimates when cooldown is ready!
      if (e.type === 'boss' && d.bossUltCd <= 0 && dist < 10.5 && !someoneAttacking) {
        this.startBossUltimate(e, P, ctx);
        continue;
      }

      // Commit to a weapon-specific melee attack when in range (respecting group breathing room!)
      const engageRad = d.weaponKind === 'guandao' ? 4.8 : d.weaponKind === 'spear' ? 3.9 : 3.4;
      const groupReady = e.type === 'boss' || this.groupAtkCd <= 0;
      if (dist < engageRad && d.atkCd <= 0 && !someoneAttacking && groupReady) {
        const roll = Math.random();
        const perilProb = d.poiseTier === 1 ? 0.22 : 0.28;
        if (roll < perilProb) {
          d.comboLeft = 0;
          const perilKind = d.weaponKind === 'spear' ? 'perilThrust' : 'perilChop';
          this._beginEnemyAttack(e, perilKind, true, audio);
        } else {
          d.comboLeft = e.type === 'boss'
            ? (d.phase === 2 ? 3 : 2)
            : d.poiseTier === 1
              ? (roll < 0.62 ? 1 : 0)
              : (roll < 0.74 ? 1 : 0);
          const firstKind = d.weaponKind === 'spear' ? 'thrustA' : 'slashA';
          this._beginEnemyAttack(e, firstKind, false, audio);
        }
      }
    }
  }

  _stepBossUltimate(e, P, dt, dx, dz, dist, turnTowardPlayer, stepMove, ctx) {
    const d = e.duel;
    const t = d.stateT;
    const { audio, callbacks } = ctx;
    const spec = BOSS_ULTIMATES[d.ultKind];

    if (d.ultKind === 'bossLeapSlam') {
      // 0..0.32s crouch coil -> 0.32..0.94s soaring airborne somersault -> 0.94s 6.8m meteor slam -> Phase 2 1.36s 8.4m seismic aftershock!
      if (t < 0.32) {
        turnTowardPlayer(10.0);
        d.ultTargetX = P.x;
        d.ultTargetZ = P.z;
        d.ultStartX = e.x;
        d.ultStartZ = e.z;
        d.jumpY = 0;
        d.flipX = 0;
        d.telegraph = { kind: 'ring', x: d.ultTargetX, z: d.ultTargetZ, rad: spec.rad, prog: t / 0.94 };
        lerpDuelPose(d.pose, 'leapCoil', Math.min(1, dt * 16));
      } else if (t < 0.94) {
        const u = clamp((t - 0.32) / 0.62, 0, 1);
        if (u < 0.62) {
          d.ultTargetX += (P.x - d.ultTargetX) * Math.min(1, dt * 6.0);
          d.ultTargetZ += (P.z - d.ultTargetZ) * Math.min(1, dt * 6.0);
        }
        const tx = d.ultTargetX - e.x;
        const tz = d.ultTargetZ - e.z;
        const td = Math.hypot(tx, tz);
        if (td > 0.15) {
          const spd = Math.min(15.0, td / Math.max(0.08, 0.94 - t));
          stepMove(tx / td, tz / td, spd);
        }
        turnTowardPlayer(8.0);
        d.jumpY = Math.sin(u * Math.PI) * 3.9;
        d.flipX = u * TAU;
        d.telegraph = { kind: 'ring', x: d.ultTargetX, z: d.ultTargetZ, rad: spec.rad, prog: clamp(t / 0.94, 0, 1) };
        lerpDuelPose(d.pose, u < 0.72 ? 'leapAir' : 'leapSlam', Math.min(1, dt * 18));
      } else {
        d.jumpY = 0;
        d.flipX = 0;
        e.moving = false;
        e.spd = 0;
        lerpDuelPose(d.pose, 'leapSlam', Math.min(1, dt * 20));
        if (!d.didHit) {
          d.didHit = true;
          d.ultWavesHit = 1;
          d.peril = d.phase === 2;
          audio?.sfx?.('ultCleave');
          audio?.sfx?.('boom');
          callbacks?.onBossUltImpact?.('bossLeapSlam', e, { x: e.x, y: 0.15, z: e.z, rad: spec.rad, wave: 1 });
          this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.rad, dmg: spec.dmg, unblockable: true, aoe: true, isUlt: true });
        }
        // Phase 2 seismic aftershock wave!
        if (d.phase === 2 && d.ultWavesHit === 1) {
          d.telegraph = { kind: 'ring', x: e.x, z: e.z, rad: spec.afterRad, prog: clamp((t - 0.94) / 0.42, 0, 1) };
          if (t >= 1.36) {
            d.ultWavesHit = 2;
            d.peril = false;
            d.telegraph = null;
            audio?.sfx?.('boom');
            callbacks?.onBossUltImpact?.('bossLeapSlam', e, { x: e.x, y: 0.15, z: e.z, rad: spec.afterRad, wave: 2 });
            this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.afterRad, dmg: Math.round(spec.dmg * 0.8), unblockable: true, aoe: true, isUlt: true });
          }
        } else {
          d.telegraph = null;
        }
      }
    } else if (d.ultKind === 'bossWhirlwind') {
      // 0..0.44s low wide windup -> 0.44..1.66s 4 rapid 360° advancing 4.85m cyclone spins (ALL 4 parryable!) -> recovery
      const waveTimes = [0.52, 0.82, 1.12, 1.42];
      if (t < 0.44) {
        turnTowardPlayer(9.5);
        d.spinYaw = 0;
        d.telegraph = { kind: 'ring', x: e.x, z: e.z, rad: spec.rad, prog: t / 0.44, parryable: true };
        lerpDuelPose(d.pose, 'windupB', Math.min(1, dt * 14));
      } else if (t < 1.66) {
        const u = clamp((t - 0.44) / 1.22, 0, 1);
        d.spinYaw = -u * 4 * TAU;
        d.telegraph = null;
        if (dist > 1.7) stepMove(dx / dist, dz / dist, 5.2);
        else { e.moving = false; e.spd = 0; }
        lerpDuelPose(d.pose, 'bossSpin', Math.min(1, dt * 20));
        if (d.ultWavesHit < waveTimes.length && t >= waveTimes[d.ultWavesHit]) {
          d.ultWavesHit++;
          audio?.sfx?.('swishHeavy');
          callbacks?.onBossUltImpact?.('bossWhirlwind', e, { x: e.x, y: 1.25, z: e.z, rad: spec.rad, wave: d.ultWavesHit });
          this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.rad, dmg: spec.dmg, unblockable: false, aoe: true, isUlt: true });
        }
      } else {
        d.spinYaw = 0;
        e.moving = false;
        e.spd = 0;
        lerpDuelPose(d.pose, guardPoseFor(d.weaponKind), Math.min(1, dt * 10));
      }
    } else if (d.ultKind === 'bossDashThrust') {
      // 0..0.52s red-peril crouch aim -> 0.52..0.90s blazing 8.5m lightning thrust + 2 trailing crimson explosions!
      if (t < 0.52) {
        turnTowardPlayer(11.0);
        d.telegraph = { kind: 'ring', x: e.x + Math.cos(e.ang) * 4.0, z: e.z + Math.sin(e.ang) * 4.0, rad: spec.rad, prog: t / 0.52 };
        lerpDuelPose(d.pose, 'windupThrust', Math.min(1, dt * 16));
      } else if (t < 0.90) {
        d.telegraph = null;
        stepMove(Math.cos(e.ang), Math.sin(e.ang), 22.5);
        lerpDuelPose(d.pose, 'strikeThrust', Math.min(1, dt * 28));
        if (!d.didHit && t >= 0.56) {
          const hitDist = Math.hypot(P.x - e.x, P.z - e.z);
          if (hitDist <= spec.rad + 0.65) {
            d.didHit = true;
            this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.rad + 0.65, dmg: spec.dmg, unblockable: true, aoe: true, isUlt: true });
          }
        }
        const burstTimes = [0.56, 0.74];
        if (d.ultWavesHit < burstTimes.length && t >= burstTimes[d.ultWavesHit]) {
          d.ultWavesHit++;
          audio?.sfx?.(d.ultWavesHit === 1 ? 'ultIaido' : 'boom');
          callbacks?.onBossUltImpact?.('bossDashThrust', e, { x: e.x, y: 1.25, z: e.z, ang: e.ang, rad: spec.rad, wave: d.ultWavesHit });
          if (d.ultWavesHit === 2 && !d.didHit) {
            this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.rad + 0.4, dmg: Math.round(spec.dmg * 0.85), unblockable: true, aoe: true, isUlt: true });
          }
        }
      } else {
        d.peril = false;
        e.moving = false;
        e.spd = 0;
        lerpDuelPose(d.pose, 'strikeThrust', Math.min(1, dt * 8));
      }
    } else if (d.ultKind === 'bossQuakeNova') {
      // NEW Arena AOE: 0..0.82s plant Guandao + 8.6m pulsing warning -> 0.84s 5.4m inner blast -> 1.26s 8.6m colossal outer ring!
      e.moving = false;
      e.spd = 0;
      if (t < 0.82) {
        turnTowardPlayer(6.0);
        d.telegraph = { kind: 'ring', x: e.x, z: e.z, rad: spec.outerRad, prog: t / 0.82 };
        lerpDuelPose(d.pose, t < 0.42 ? 'windupPeril' : 'quakePlant', Math.min(1, dt * 15));
      } else if (t < 1.32) {
        lerpDuelPose(d.pose, 'quakePlant', Math.min(1, dt * 20));
        if (d.ultWavesHit === 0) {
          d.ultWavesHit = 1;
          audio?.sfx?.('ultCleave');
          audio?.sfx?.('boom');
          callbacks?.onBossUltImpact?.('bossQuakeNova', e, { x: e.x, y: 0.14, z: e.z, rad: spec.rad, wave: 1 });
          this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.rad, dmg: spec.dmg, unblockable: true, aoe: true, isUlt: true });
        }
        d.telegraph = { kind: 'ring', x: e.x, z: e.z, rad: spec.outerRad, prog: clamp((t - 0.82) / 0.44, 0, 1) };
        if (d.ultWavesHit === 1 && t >= 1.24) {
          d.ultWavesHit = 2;
          d.peril = false;
          d.telegraph = null;
          audio?.sfx?.('boom');
          callbacks?.onBossUltImpact?.('bossQuakeNova', e, { x: e.x, y: 0.14, z: e.z, rad: spec.outerRad, wave: 2 });
          this._resolveEnemyStrike(e, ctx, { ox: e.x, oz: e.z, rad: spec.outerRad, dmg: Math.round(spec.dmg * 0.85), unblockable: true, aoe: true, isUlt: true });
        }
      } else {
        d.peril = false;
        d.telegraph = null;
        lerpDuelPose(d.pose, guardPoseFor(d.weaponKind), Math.min(1, dt * 9));
      }
    }

    if (d.stateT >= d.stateDur) {
      d.jumpY = 0;
      d.flipX = 0;
      d.flipZ = 0;
      d.spinYaw = 0;
      d.peril = false;
      d.telegraph = null;
      d.ultKind = null;
      d.state = 'circle';
      d.stateT = 0;
      d.atkCd = rnd(0.85, 1.35) / d.aggro;
    }
  }

  _beginEnemyAttack(e, kind, peril, audio) {
    const d = e.duel;
    d.state = 'windup';
    d.attackKind = kind;
    d.stateT = 0;
    const heavyWeaponSlow = (d.weaponKind === 'axe' || d.weaponKind === 'mace') ? 1.12 : d.weaponKind === 'spear' ? 0.94 : 1.0;
    // Elden-Ring readable timing: heavy/peril blows telegraph clearly (0.76~0.98s) with clear punishable recovery!
    const baseWindup = peril ? 0.90 : kind === 'slashB' ? 0.46 : 0.54;
    d.stateDur = (baseWindup * heavyWeaponSlow) / Math.max(0.88, Math.min(1.24, d.aggro));
    d.didHit = false;
    d.peril = !!peril;
    d.blocking = false;
    if (peril) audio?.sfx?.('perilGong');
  }
}
