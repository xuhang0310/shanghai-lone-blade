import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LevelState } from '../src/world/LevelGenerator.js';
import { Melee, ULTIMATES, resolveSwordClip } from '../src/systems/Melee.js';
import { DuelSystem, DOJO_PRESETS, BOSS_ULTIMATES } from '../src/systems/DuelSystem.js';
import { ProgressionSystem, ENEMY_POINT_REWARDS } from '../src/systems/ProgressionSystem.js';
import { MELEE_WEAPONS, buildColdWeaponGeometry } from '../src/entities/BladeModel.js';
import { PlayerController } from '../src/entities/Player.js';
import { HudRenderer } from '../src/ui/HudRenderer.js';
import { InputManager } from '../src/core/InputManager.js';
import { TILE, MW, LEVELS } from '../src/config/constants.js';

function makeAudioStub() {
  const played = [];
  return {
    played,
    sfx(name) {
      played.push(name);
    }
  };
}

function makeMockPlayer(x = 0, z = 0, ang = -Math.PI / 2) {
  return {
    x,
    y: 0,
    z,
    ang,
    hp: 100,
    inv: 0,
    rollT: 0,
    stepT: 0,
    execT: 0,
    rootT: 0,
    melee: true,
    hasGun: false,
    moveBy(dx, dz) {
      this.x += dx;
      this.z += dz;
    }
  };
}

test('LevelState.generateDojo builds compact courtyard for all 3 presets', () => {
  for (const [id, preset] of Object.entries(DOJO_PRESETS)) {
    const lvl = new LevelState();
    lvl.generateDojo(preset);
    assert.equal(lvl.MH, 18, `${id}: dojo courtyard MH should be 18 tiles`);
    assert.equal(lvl.cfg.mission, 'dojo', `${id}: level cfg mission should be dojo`);
    assert.equal(lvl.enemies.length, preset.enemies.length, `${id}: enemy count matches preset`);
    for (const e of lvl.enemies) {
      assert.ok(e.duelSpec, `${id}: enemy carries duelSpec`);
      const tx = Math.floor(e.x / TILE);
      const tz = Math.floor(e.z / TILE);
      assert.equal(lvl.T(tx, tz), 0, `${id}: enemy spawns on walkable courtyard floor`);
    }
  }
  const bossLvl = new LevelState();
  bossLvl.generateDojo(DOJO_PRESETS.duelBoss);
  assert.equal(bossLvl.enemies[0].duelSpec.scale, 1.64, 'Dojo Boss uses towering 1.64 scale');
  assert.equal(bossLvl.enemies[0].hp, 2000, 'Dojo Boss has massive 2000 HP pool');
  assert.equal(bossLvl.enemies[0].duelSpec.deathblows, 3, 'Dojo Boss carries 3 Deathblow seals');
});

test('Melee.setBlock opens 0.24s parry window and resolves Mixamo Great Sword clips cleanly', () => {
  const melee = new Melee();
  const audio = makeAudioStub();
  melee.equipInstant();
  assert.equal(melee.drawn, true);
  assert.equal(melee.isGuarding, false);

  melee.setBlock(true, audio);
  assert.equal(melee.isGuarding, true);
  assert.ok(melee.parryWindowT >= 0.23 && melee.parryWindowT <= 0.25, 'fresh block opens 0.24s perfect parry window');

  // Empty clip table returns null cleanly
  assert.equal(resolveSwordClip({}, 'slashA'), null);
  assert.equal(resolveSwordClip(null, 'cleave'), null);

  // Installed Mixamo sword clips map automatically to corresponding combat actions
  const mockClips = {
    SwordSlash1: { name: 'SwordSlash1' },
    SwordSlash2: { name: 'SwordSlash2' },
    SwordHeavy: { name: 'SwordHeavy' },
    SwordJumpAttack: { name: 'SwordJumpAttack' },
    SwordSpin: { name: 'SwordSpin' },
    SwordBlock: { name: 'SwordBlock' }
  };
  assert.equal(resolveSwordClip(mockClips, 'slashA'), 'SwordSlash1');
  assert.equal(resolveSwordClip(mockClips, 'slashB'), 'SwordSlash2');
  assert.equal(resolveSwordClip(mockClips, 'chop'), 'SwordHeavy');
  assert.equal(resolveSwordClip(mockClips, 'cleave'), 'SwordJumpAttack');
  assert.equal(resolveSwordClip(mockClips, 'whirlwind'), 'SwordSpin');
  assert.equal(resolveSwordClip(mockClips, 'block'), 'SwordBlock');
});

test('DuelSystem Perfect Parry deals zero HP dmg to player, staggers enemy & grants +28 Qi', () => {
  const duel = new DuelSystem();
  duel.reset('duel1v1');
  duel.active = true;
  duel.qi = 30;

  const melee = new Melee();
  melee.equipInstant();
  const audio = makeAudioStub();
  melee.setBlock(true, audio);

  const P = makeMockPlayer(0, 0, -Math.PI / 2);
  const e = { x: 0, z: -1.6, ang: Math.PI / 2, hp: 190, scale: 1.05 };
  duel.initDuelist(e, DOJO_PRESETS.duel1v1.enemies[0]);
  e.duel.attackKind = 'slashA';

  let hurtCalls = 0;
  let parryCalls = 0;
  duel._resolveEnemyStrike(e, {
    player: P,
    melee,
    audio,
    callbacks: {
      hurtPlayer: () => { hurtCalls++; },
      onParry: () => { parryCalls++; }
    }
  });

  assert.equal(hurtCalls, 0, 'perfect parry prevents HP damage');
  assert.equal(parryCalls, 1, 'onParry callback fires');
  assert.equal(duel.parryCount, 1);
  assert.equal(duel.qi, 58, 'perfect parry grants +28 Blade Qi');
  assert.equal(e.duel.posture, 48, 'perfect parry inflicts 48 enemy posture damage');
  assert.equal(e.duel.state, 'stagger', 'parried enemy is staggered');
  assert.ok(audio.played.includes('parryClang'));
});

test('DuelSystem standard Block absorbs HP at posture cost while red perilChop requires dodge', () => {
  const duel = new DuelSystem();
  duel.reset('duel1v1');
  duel.active = true;
  duel.qi = 20;

  const melee = new Melee();
  melee.equipInstant();
  const audio = makeAudioStub();
  melee.setBlock(true, audio);
  melee.parryWindowT = 0; // Holding guard past perfect parry window

  const P = makeMockPlayer(0, 0, -Math.PI / 2);
  const e = { x: 0, z: -1.6, ang: Math.PI / 2, hp: 190, scale: 1.05 };
  duel.initDuelist(e, DOJO_PRESETS.duel1v1.enemies[0]);

  let dmgTaken = 0;
  let blockCalls = 0;
  const ctx = {
    player: P,
    melee,
    audio,
    callbacks: {
      hurtPlayer: dmg => { dmgTaken += dmg; },
      onBlock: () => { blockCalls++; }
    }
  };

  // Normal slash is blocked cleanly
  e.duel.attackKind = 'slashA';
  duel._resolveEnemyStrike(e, ctx);
  assert.equal(dmgTaken, 0);
  assert.equal(blockCalls, 1);
  assert.equal(duel.playerPosture, 16);
  assert.ok(melee.guardCounterT >= 0.70, 'standard block opens Elden Ring Guard Counter window');

  // Crimson unblockable perilChop pierces standard guard
  e.duel.attackKind = 'perilChop';
  duel._resolveEnemyStrike(e, ctx);
  assert.equal(dmgTaken, 30, 'perilChop pierces guard for 30 HP damage');

  // Dodging perilChop via quick-step / roll takes 0 damage and awards +10 Qi
  const qiBeforeDodge = duel.qi;
  P.stepT = 0.2;
  duel._resolveEnemyStrike(e, ctx);
  assert.equal(dmgTaken, 30, 'dodge prevents perilChop damage');
  assert.equal(duel.qi, qiBeforeDodge + 10, 'clean dodge grants +10 Blade Qi');
});

test('DuelSystem Posture Break triggers broken state and Ultimates spend exact Qi with hyperArmor/unblockable', () => {
  const duel = new DuelSystem();
  duel.reset('duel1v1');
  duel.active = true;

  const melee = new Melee();
  melee.equipInstant();
  const audio = makeAudioStub();
  const P = makeMockPlayer(0, 0, -Math.PI / 2);

  // Test guard break via posture saturation
  const e = { x: 0, z: -1.6, ang: Math.PI / 2, hp: 420, scale: 1.05 };
  duel.initDuelist(e, DOJO_PRESETS.duel1v1.enemies[0]);
  e.duel.posture = e.duel.maxPosture - 15;
  let broke = false;
  const res = duel.resolvePlayerHit(
    e,
    { dmg: 40, postureDmg: 35, heavy: true, unblockable: true, ult: true },
    { x: 0, y: 1.2, z: -1.6 },
    { x: 0, z: -1 },
    { audio, callbacks: { onGuardBreak: () => { broke = true; } } }
  );
  assert.equal(res, 'broken');
  assert.equal(broke, true);
  assert.equal(e.duel.state, 'broken');
  assert.equal(e.react?.kind, 'kneel');

  // Test all 3 Ultimates: iaido (35 / 10s CD), cleave (45 / 14s CD), whirlwind (55 / 18s CD)
  const meleeCtx = { P, audio, level: { enemies: [e], los: () => true }, physics: { castRay: () => null }, onHit: () => {}, onUltImpact: () => {} };

  duel.qi = 100;
  assert.equal(ULTIMATES.iaido.cost, 35);
  assert.equal(ULTIMATES.iaido.cd, 10);
  assert.equal(melee.triggerUltimate('iaido', meleeCtx), true);
  assert.equal(duel.spendUltimate('iaido'), true);
  assert.equal(duel.qi, 65);
  assert.equal(duel.getCooldown('iaido'), 10);
  assert.equal(duel.canUseUltimate('iaido'), false, 'cannot spam iaido while on 10s cooldown even with enough Qi');
  assert.equal(melee.atk.def.unblockable, true);

  // Cannot re-trigger another ultimate while already mid-ultimate
  assert.equal(melee.triggerUltimate('cleave', meleeCtx), false);

  melee.equipInstant();
  duel.qi = 100;
  assert.equal(melee.triggerUltimate('cleave', meleeCtx), true);
  assert.equal(duel.spendUltimate('cleave'), true);
  assert.equal(duel.qi, 55);
  assert.equal(duel.getCooldown('cleave'), 14);
  assert.equal(melee.hyperArmor, true);
  assert.equal(melee.atk.def.unblockable, true);

  melee.equipInstant();
  assert.equal(melee.triggerUltimate('whirlwind', meleeCtx), true);
  assert.equal(duel.spendUltimate('whirlwind'), true);
  assert.equal(duel.qi, 0);
  assert.equal(duel.getCooldown('whirlwind'), 18);
  assert.equal(melee.hyperArmor, true);
  assert.equal(duel.canUseUltimate('iaido'), false, 'cannot trigger ultimate without sufficient Qi');

  // Perfect Parry shaves 2.5s off all active cooldowns
  duel.reduceCooldowns(2.5);
  assert.equal(duel.getCooldown('iaido'), 7.5);
  assert.equal(duel.getCooldown('cleave'), 11.5);
  assert.equal(duel.getCooldown('whirlwind'), 15.5);
});

test('Dojo Boss survives 3 full Ultimates and triggers Phase 2 Awakening shockwave at 55% HP', () => {
  const lvl = new LevelState();
  lvl.generateDojo(DOJO_PRESETS.duelBoss);
  const duel = new DuelSystem();
  duel.reset('duelBoss');
  duel.active = true;
  const boss = lvl.enemies[0];
  duel.initDuelist(boss, boss.duelSpec);
  assert.equal(boss.hp, 2000);
  // Simulate 3 full ultimates (78 + 105 + 126 = 309) -> boss stays well above 80% HP
  boss.hp -= 309;
  assert.ok(boss.hp > 1650, 'Boss should comfortably survive 3 full ultimates');
  assert.equal(boss.duel.phase, 1);

  // Drop Boss to <= 55% HP (1080/2000) and step DuelSystem -> triggers Phase 2 Awakening + 6.5m shockwave!
  boss.hp = 1080;
  let phase2Fired = false;
  let shockwaveDmg = 0;
  const P = makeMockPlayer(boss.x, boss.z + 4.5, -Math.PI / 2);
  duel.update(0.1, {
    level: lvl,
    player: P,
    audio: makeAudioStub(),
    callbacks: {
      onBossPhase2: () => { phase2Fired = true; },
      hurtPlayer: dmg => { shockwaveDmg += dmg; }
    }
  });
  assert.equal(phase2Fired, true, 'onBossPhase2 callback fires at <= 55% HP');
  assert.equal(boss.duel.phase, 2, 'Boss enters Phase 2');
  assert.equal(shockwaveDmg, 24, 'Phase 2 Awakening unleashes 6.5m 24-dmg crimson shockwave');
});

test('HudRenderer.draw renders Dojo HUD with cooldown curtains, impact VFX & hitNums cleanly', () => {
  const prevWin = globalThis.window;
  globalThis.window = { innerWidth: 1280, innerHeight: 720 };
  try {
    const texts = [];
    const grad = { addColorStop() {} };
    const ctx = {
      setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, clip() {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, stroke() {}, fill() {},
      fillRect() {}, strokeRect() {}, strokeText() {},
      createRadialGradient() { return grad; },
      createLinearGradient() { return grad; },
      fillText(t) { texts.push(String(t)); }
    };
    const hud = new HudRenderer({ getContext: () => ctx });
    const lvl = new LevelState();
    lvl.generateDojo(DOJO_PRESETS.duelBoss);
    const duel = new DuelSystem();
    duel.reset('duelBoss');
    duel.active = true;
    duel.initDuelist(lvl.enemies[0], lvl.enemies[0].duelSpec);
    duel.lockTarget = lvl.enemies[0];
    duel.cooldowns.iaido = 7.4;
    const melee = new Melee();
    melee.equipInstant();
    const cam = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 100);
    cam.position.set(lvl.startPos.x, 2.2, lvl.startPos.z + 3.5);
    cam.lookAt(lvl.enemies[0].x, 1.5, lvl.enemies[0].z);
    cam.updateMatrixWorld();

    hud.draw({
      state: 'play',
      time: 1.2,
      player: { hp: 100, armor: 0, btK: 0, scopeK: 0, ang: -Math.PI / 2 },
      level: lvl,
      camera: cam,
      input: { isTouch: false, locked: false },
      banner: 0,
      msg: '',
      msgT: 0,
      hurtFlash: 0,
      hurtAng: null,
      hitMark: 0.14,
      killMark: 0,
      headMark: 0.2,
      impactFlash: 0.65,
      impactFlashCol: '#ffe278',
      impactLinesT: 0.25,
      impactLinesCol: '#ffe89c',
      hitNums: [{ x: lvl.enemies[0].x, y: 1.6, z: lvl.enemies[0].z, text: '-105!', col: '#ffe268', scale: 1.3, t: 0.1, dur: 0.7 }],
      execTarget: null,
      execFX: { k: 0 },
      melee,
      duel,
      perfStats: { show: false, fps: 60, ms: 16.6 }
    });

    assert.ok(texts.some(t => t.includes('刀 气')), 'draws Blade Qi meter');
    assert.ok(texts.some(t => t.includes('霸王') && t.includes('青龙偃月重关刀')), 'draws Boss duelist nameplate with Guandao badge');
    assert.ok(texts.some(t => t.includes('2000')), 'draws thick 2000 HP readout');
    assert.ok(texts.some(t => t.includes('冷却 7.4s')), 'draws active cooldown timer on skill card');
    assert.ok(texts.some(t => t.includes('-105!')), 'draws floating 3D-projected hit number');
    assert.ok(texts.some(t => t.includes('瞬步·居合一闪')), 'draws Ultimate 1 card');
    assert.ok(texts.some(t => t.includes('破军·力劈华山')), 'draws Ultimate 2 card');
    assert.ok(texts.some(t => t.includes('孤鸿·旋风乱舞')), 'draws Ultimate 3 card');
  } finally {
    globalThis.window = prevWin;
  }
});

test('All 5 procedural 3D cold weapons build valid geometries and zero Dojo enemies copy the hero Dadao', () => {
  for (const kind of ['dadao', 'spear', 'axe', 'mace', 'guandao']) {
    assert.ok(MELEE_WEAPONS[kind], `${kind}: weapon metadata exists`);
    const geo = buildColdWeaponGeometry(kind);
    assert.ok(geo.attributes.position.count > 60, `${kind}: geometry has valid mesh vertices`);
    assert.ok(geo.groups.length >= 3, `${kind}: geometry has material groups`);
    geo.dispose();
  }
  const usedWeapons = new Set();
  for (const [id, preset] of Object.entries(DOJO_PRESETS)) {
    for (const spec of preset.enemies) {
      assert.ok(spec.weaponKind, `${id}: enemy declares weaponKind`);
      assert.notEqual(spec.weaponKind, 'dadao', `${id}: enemy ${spec.name} should not copy protagonist Dadao`);
      usedWeapons.add(spec.weaponKind);
    }
  }
  for (const w of ['spear', 'axe', 'mace', 'guandao']) {
    assert.ok(usedWeapons.has(w), `Dojo presets include enemy weapon diversity: ${w}`);
  }
});

test('Boss holds Poise against light slashes, performs airborne evade, and executes all 4 massive-AOE Boss Ultimates', () => {
  const lvl = new LevelState();
  lvl.generateDojo(DOJO_PRESETS.duelBoss);
  const duel = new DuelSystem();
  duel.reset('duelBoss');
  duel.active = true;
  const boss = lvl.enemies[0];
  duel.initDuelist(boss, boss.duelSpec);
  const P = makeMockPlayer(lvl.startPos.x, lvl.startPos.z, -Math.PI / 2);
  const audio = makeAudioStub();

  // 0. Boss Poise: light slash during windup does NOT interrupt or stagger the Boss
  boss.duel.state = 'windup';
  boss.duel.evadeCd = 5;
  boss.duel.hitStreak = 0;
  const poiseRes = duel.resolvePlayerHit(
    boss,
    { dmg: 38, postureDmg: 22 },
    { x: boss.x, y: 1.5, z: boss.z },
    { x: 0, z: -1 },
    { player: P, audio, callbacks: {} }
  );
  assert.equal(poiseRes, 'hit');
  assert.equal(boss.duel.state, 'windup', 'Boss Poise ignores light-slash stagger during windup');

  // 1. Acrobatic backflip evade: airborne jumpY > 1.0, full backflip flipX, and invulnerable frames evade attacks
  boss.duel.state = 'circle';
  boss.duel.evadeCd = 0;
  let evadeCalled = false;
  assert.equal(duel.triggerEnemyEvade(boss, P, { audio, callbacks: { onEnemyEvade: () => { evadeCalled = true; } } }, 'backflip'), true);
  assert.equal(evadeCalled, true);
  assert.equal(boss.duel.state, 'evade');
  duel.update(0.25, { level: lvl, player: P, audio, callbacks: {} });
  assert.ok(boss.duel.jumpY > 1.0, 'backflip leaps high into the air');
  assert.ok(boss.duel.flipX < -1.5, 'backflip rotates backward somersault');
  const hitRes = duel.resolvePlayerHit(
    boss,
    { dmg: 40, postureDmg: 20 },
    { x: boss.x, y: 1.5, z: boss.z },
    { x: 0, z: -1 },
    { player: P, audio, callbacks: {} }
  );
  assert.equal(hitRes, 'evaded', 'airborne evade i-frames dodge player slash cleanly');

  // 2. Boss Ultimate 1: bossLeapSlam in Phase 2 soars up >3.2m and delivers 6.8m initial slam + 8.4m seismic aftershock
  boss.duel.phase = 2;
  boss.duel.state = 'circle';
  const slamRadii = [];
  let maxJump = 0;
  assert.equal(duel.startBossUltimate(boss, P, { audio, callbacks: {} }, 'bossLeapSlam'), true);
  for (let i = 0; i < 40; i++) {
    duel.update(0.05, {
      level: lvl,
      player: P,
      audio,
      callbacks: { onBossUltImpact: (id, _e, info) => { if (id === 'bossLeapSlam') slamRadii.push(info.rad); } }
    });
    maxJump = Math.max(maxJump, boss.duel.jumpY);
  }
  assert.ok(maxJump > 3.2, `bossLeapSlam reaches soaring height (>3.2m), got ${maxJump.toFixed(2)}m`);
  assert.deepEqual(slamRadii, [6.8, 8.4], 'bossLeapSlam P2 delivers 6.8m meteor slam + 8.4m seismic aftershock');

  // 3. Boss Ultimate 2: bossWhirlwind spins 4 parryable 4.85m cyclone waves
  boss.duel.state = 'circle';
  let whirlWaves = 0;
  assert.equal(duel.startBossUltimate(boss, P, { audio, callbacks: {} }, 'bossWhirlwind'), true);
  assert.equal(BOSS_ULTIMATES.bossWhirlwind.rad, 4.85);
  for (let i = 0; i < 45; i++) {
    duel.update(0.05, {
      level: lvl,
      player: P,
      audio,
      callbacks: { onBossUltImpact: id => { if (id === 'bossWhirlwind') whirlWaves++; } }
    });
  }
  assert.equal(whirlWaves, 4, 'bossWhirlwind fires all 4 cyclone spin waves');

  // 4. Boss Ultimate 3: bossDashThrust rockets forward with 2 trailing peril bursts
  boss.duel.state = 'circle';
  let thrustImpacts = 0;
  assert.equal(duel.startBossUltimate(boss, P, { audio, callbacks: {} }, 'bossDashThrust'), true);
  assert.equal(BOSS_ULTIMATES.bossDashThrust.peril, true);
  for (let i = 0; i < 32; i++) {
    duel.update(0.05, {
      level: lvl,
      player: P,
      audio,
      callbacks: { onBossUltImpact: id => { if (id === 'bossDashThrust') thrustImpacts++; } }
    });
  }
  assert.equal(thrustImpacts, 2, 'bossDashThrust fires 2 lightning thrust crimson bursts');

  // 5. Boss Ultimate 4 (NEW): bossQuakeNova detonates 5.4m inner blast + 8.6m arena-wide outer shockwave!
  boss.duel.state = 'circle';
  const quakeRadii = [];
  assert.equal(duel.startBossUltimate(boss, P, { audio, callbacks: {} }, 'bossQuakeNova'), true);
  assert.equal(BOSS_ULTIMATES.bossQuakeNova.peril, true);
  for (let i = 0; i < 45; i++) {
    duel.update(0.05, {
      level: lvl,
      player: P,
      audio,
      callbacks: { onBossUltImpact: (id, _e, info) => { if (id === 'bossQuakeNova') quakeRadii.push(info.rad); } }
    });
  }
  assert.deepEqual(quakeRadii, [5.4, 8.6], 'bossQuakeNova detonates 5.4m inner blast + 8.6m colossal outer quake');
});

test('Melee non-damage animations (finisher, draw, sheathe, recoil) update cleanly without TypeError', () => {
  const melee = new Melee();
  const audio = makeAudioStub();
  const P = makeMockPlayer(0, 0, 0);
  const ctx = {
    P,
    audio,
    level: { enemies: [] },
    physics: { movePlayer: (dx, dy, dz) => ({ x: P.x + dx, y: P.y + dy, z: P.z + dz }) }
  };

  // Draw -> full duration
  melee.draw(ctx);
  for (let i = 0; i < 30; i++) melee.update(0.02, ctx);
  assert.equal(melee.state, 'idle');
  assert.equal(melee.drawn, true);

  // [E] Finisher (guard-break deathblow) -> full duration
  melee.playFinisher(ctx);
  assert.equal(melee.atk?.name, 'finisher');
  for (let i = 0; i < 50; i++) melee.update(0.02, ctx);
  assert.equal(melee.state, 'idle');

  // Blade recoil bounce -> full duration
  melee._recoil(ctx, { x: 1, y: 1, z: 0 });
  for (let i = 0; i < 35; i++) melee.update(0.02, ctx);
  assert.equal(melee.state, 'idle');

  // Sheathe -> full duration
  melee.sheathe(ctx);
  for (let i = 0; i < 30; i++) melee.update(0.02, ctx);
  assert.equal(melee.state, 'idle');
  assert.equal(melee.drawn, false);
});

test('PlayerController executes snappy Left, Right & Back rolls even while blocking and cancels melee swings cleanly', () => {
  const audio = makeAudioStub();
  const makeInput = (f, r, rightHeld = false) => ({
    keys: {},
    mouse: { x: 0, y: 0, down: false, right: rightHeld, moved: false },
    sticks: { move: null, look: null },
    isTouch: false,
    locked: false,
    getMoveAxes: () => ({ f, r })
  });

  // 1. Left Roll (A) while holding Right-Click Block (must roll LEFT, never hijack into gun dive!)
  const p = new PlayerController();
  p.resetAll(false);
  p.resetForLevel(10, 10); // facing North (ang = -PI/2 -> left is -X, right is +X, back is +Z)
  assert.equal(p.melee, true);
  assert.equal(p.roll(makeInput(0, -1, true), audio), true, 'left roll succeeds while blocking');
  assert.equal(p.diveT, 0, 'cold-weapon roll never triggers gun slow-mo dive');
  assert.equal(p.rollLocalR, -1);
  assert.ok(p.rdx < -0.95 && Math.abs(p.rdz) < 0.05, 'left roll moves strictly west (-X)');

  // Step through full left roll and confirm distance & quick melee cooldown
  const phys = { movePlayer: (dx, dy, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz, grounded: true }) };
  for (let i = 0; i < 30; i++) p.updateMovement(1 / 60, makeInput(0, 0), phys, audio);
  assert.ok(p.x < 7.0, `left roll travels >3m west (x=${p.x.toFixed(2)})`);
  assert.equal(p.rollT, 0);

  // 2. Right Roll (D) via forcedAxes (double-tap D!)
  p.resetForLevel(10, 10);
  assert.equal(p.roll(makeInput(0, 0), audio, { f: 0, r: 1 }), true, 'right roll succeeds via double-tap D');
  assert.equal(p.rollLocalR, 1);
  assert.ok(p.rdx > 0.95 && Math.abs(p.rdz) < 0.05, 'right roll moves strictly east (+X)');

  // 3. Neutral melee dodge defaults to crisp back-flip (+Z)
  p.resetForLevel(10, 10);
  assert.equal(p.roll(makeInput(0, 0), audio), true);
  assert.equal(p.rollLocalF, -1);
  assert.ok(p.rdz > 0.95, 'neutral melee roll evades backward (+Z)');

  // 4. Attack-cancel into dodge roll mid-combo
  const melee = new Melee();
  melee.equipInstant();
  const mCtx = { P: p, audio, level: { enemies: [] }, physics: phys };
  melee.press('light', mCtx);
  assert.equal(melee.busy, true);
  assert.equal(melee.cancelForDodge(), true, 'cancels light swing cleanly for instant dodge');
  assert.equal(melee.state, 'idle');
  assert.equal(melee.busy, false);
});

test('ProgressionSystem earns points strictly from kills/Boss with balanced non-trivial upgrade costs', () => {
  const prog = new ProgressionSystem({ persist: false });
  assert.equal(prog.points, 0);
  assert.equal(prog.maxHp, 100);
  assert.equal(prog.maxStamina, 100);
  assert.equal(prog.weaponDmgMult, 1.0);
  assert.equal(prog.canAfford('weapon'), false);

  // Strict kill-only economy: no parry/deathblow/free-chest point entries
  assert.equal(ENEMY_POINT_REWARDS.parry, undefined);
  assert.equal(ENEMY_POINT_REWARDS.deathblow, undefined);
  assert.equal(ENEMY_POINT_REWARDS.soulCache, undefined);
  assert.equal(ENEMY_POINT_REWARDS.spear, 25);
  assert.equal(ENEMY_POINT_REWARDS.boss, 350);

  // Killing 1 regular spearman (+25 pts) does NOT afford Lv.2 (120 pts)
  prog.addPoints(ENEMY_POINT_REWARDS.spear);
  assert.equal(prog.points, 25);
  assert.equal(prog.costFor('weapon'), 120);
  assert.equal(prog.canAfford('weapon'), false);

  // Killing 5 regular enemies (125 pts) earns the first upgrade cleanly (120 pts -> Lv.2, 5 left)
  prog.addPoints(ENEMY_POINT_REWARDS.spear * 4);
  assert.equal(prog.points, 125);
  assert.equal(prog.canAfford('weapon'), true);
  const r1 = prog.upgrade('weapon');
  assert.equal(r1.ok, true);
  assert.equal(r1.level, 2);
  assert.equal(prog.points, 5);
  assert.ok(Math.abs(prog.weaponDmgMult - 1.14) < 1e-6);

  // Boss reward (+350 pts -> 355 total) funds Vigor Lv.2 (120) + Lv.3 (180) = 300 spent, leaving 55 pts
  prog.addPoints(ENEMY_POINT_REWARDS.boss);
  assert.equal(prog.points, 355);
  assert.equal(prog.upgrade('vigor').ok, true);
  assert.equal(prog.upgrade('vigor').ok, true);
  assert.equal(prog.maxHp, 160, 'Vigor Lv.3 grants 160 Max HP');
  assert.equal(prog.points, 55);

  // Add enough for Endurance Lv.3 (300) + Qi Lv.2 (120) and verify scaling & steep max-out curve
  prog.addPoints(420);
  assert.equal(prog.upgrade('endurance').ok, true);
  assert.equal(prog.upgrade('endurance').ok, true);
  assert.equal(prog.maxStamina, 140, 'Endurance Lv.3 grants 140 Max Stamina');
  assert.ok(prog.staminaRegen > 34);
  assert.equal(prog.upgrade('qi').ok, true);
  assert.ok(prog.ultDmgMult >= 1.11 && prog.ultCdReduce >= 0.4);

  // Maxing a single stat Lv.1 -> Lv.10 takes > 9000 points (impossible to easily max in 1 clear)
  const fresh = new ProgressionSystem({ persist: false });
  let totalToMaxOne = 0;
  for (let lv = 1; lv < 10; lv++) {
    const c = fresh.costFor('weapon');
    totalToMaxOne += c;
    fresh.addPoints(c);
    assert.equal(fresh.upgrade('weapon').ok, true);
  }
  assert.ok(totalToMaxOne > 9000, `Maxing 1 stat requires substantial grind (${totalToMaxOne} pts)`);

  // Sync to PlayerController & DuelSystem
  const p = new PlayerController();
  const duel = new DuelSystem();
  p.applyProgression(prog, true);
  duel.applyProgression(prog);
  assert.equal(p.hp, 160);
  assert.equal(p.maxHp, 160);
  assert.equal(p.stamina, 140);
  assert.equal(p.maxStamina, 140);
  assert.ok(duel.getMaxCooldown('iaido') < 10, 'Qi upgrade reduces Ultimate cooldown');
});

test('Chapter 1 Cold-Weapon District is enlarged (370m), has an airtight Enclosed Boss Room, 3 Shrines & kill-only points', () => {
  assert.equal(LEVELS.length, 1);
  const lvl = new LevelState();
  lvl.generate(0);
  assert.equal(lvl.cfg.coldOnly, true);
  assert.equal(lvl.MH, 148, 'Chapter 1 district enlarged to 148 tiles (370m)');
  assert.ok(lvl.bossRoom, 'Chapter 1 builds enclosed Boss Room');
  assert.equal(lvl.shrines.length, 3, 'Chapter 1 places South, Mid-Plaza & Boss-Door Shrines');
  assert.equal(lvl.soulCaches.length, 0, 'Zero free point chests — points come strictly from kills');
  assert.equal(lvl.enemies.length, 19, '18 street enemies + 1 Boss');

  // Verify ALL 4 perimeter sides of the enlarged Boss Room (interior x=14..34, z=2..15) are solid masonry EXCEPT Fog Gate x=23..25, z=16..17!
  for (let tx = 13; tx <= 35; tx++) {
    assert.equal(lvl.T(tx, 1), 1, `North Boss wall solid at (${tx},1)`);
  }
  for (let tz = 2; tz <= 15; tz++) {
    assert.equal(lvl.T(13, tz), 1, `West Boss wall solid at (13,${tz})`);
    assert.equal(lvl.T(35, tz), 1, `East Boss wall solid at (35,${tz})`);
  }
  for (let tx = 13; tx <= 35; tx++) {
    const isGate = tx >= 23 && tx <= 25;
    assert.equal(lvl.T(tx, 16), isGate ? 0 : 1, `South Boss partition at (${tx},16)`);
    assert.equal(lvl.T(tx, 17), isGate ? 0 : 1, `South Boss partition at (${tx},17)`);
  }

  // Every enemy uses diverse cold weapons (no hero dadao copy) and awards tight balanced kill points
  let streetPointsSum = 0;
  for (const e of lvl.enemies) {
    assert.ok(e.duelSpec?.weaponKind && e.duelSpec.weaponKind !== 'dadao');
    if (e.type === 'boss') {
      assert.equal(e.pointsReward, 350, 'Boss awards +350 points');
    } else {
      assert.ok(e.pointsReward >= 25 && e.pointsReward <= 65, `${e.duelSpec.name} tight reward=${e.pointsReward}`);
      streetPointsSum += e.pointsReward;
    }
  }
  assert.ok(streetPointsSum >= 550 && streetPointsSum <= 750, `Full 18-mob clear rewards balanced ${streetPointsSum} pts`);
  assert.equal(lvl.boss.bossDormant, true, 'Boss stays dormant inside Boss Room before Fog Gate entry');
});

test('Elden-Ring 4-tier combat stratification: fair hits-to-kill, readable windups, poise hierarchy & pack spacing', () => {
  const lvl = new LevelState();
  lvl.generate(0);
  const duel = new DuelSystem();
  duel.reset('duelBoss', 'campaign');
  duel.active = true;
  for (const e of lvl.enemies) duel.initDuelist(e, e.duelSpec);

  const P = new PlayerController();
  P.resetForLevel(lvl.startPos.x, lvl.startPos.z);
  const audio = makeAudioStub();

  // At spawn, distant Zone 6 guards & dormant Boss stay asleep!
  duel.update(0.1, { level: lvl, player: P, audio, callbacks: {} });
  assert.equal(lvl.boss.awake, false, 'Dormant Boss stays asleep behind Fog Gate');
  const gateKeeper = lvl.enemies.find(e => e.group === 9);
  assert.equal(gateKeeper.awake, false, 'Distant Zone 6 gatekeepers wait calmly until hero pushes north');

  // Tier 1 Grunt: takes 5-6 normal hits to kill Lv.1 100 HP hero (NEVER 2-shots!) & peril leaves hero alive to Flask!
  const grunt = lvl.enemies.find(e => e.group === 1);
  assert.equal(grunt.duel.poiseTier, 1);
  assert.equal(grunt.duel.evadeChance, 0, 'Basic T1 grunts never spam acrobatic backflips');
  grunt.awake = true;
  grunt.ang = Math.PI / 2;
  P.x = grunt.x;
  P.z = grunt.z + 2.0;

  let normalDmg = 0;
  grunt.duel.attackKind = 'slashA';
  duel._resolveEnemyStrike(grunt, {
    level: lvl, player: P, melee: null, audio,
    callbacks: { hurtPlayer: d => { normalDmg += d; P.hp -= d; } }
  });
  assert.ok(normalDmg >= 15 && normalDmg <= 22, `T1 grunt normal swing deals fair ~17-20 dmg (5-6 hits to kill), got ${normalDmg}`);
  assert.ok(P.hp >= 78, `Lv.1 hero survives T1 grunt hit with plenty of HP (${P.hp} left)`);

  // T1 grunt peril thrust hurts (~38-44 dmg) without 1-shotting full-HP hero
  P.hp = 100;
  let gruntPerilDmg = 0;
  grunt.duel.attackKind = 'perilThrust';
  duel._resolveEnemyStrike(grunt, {
    level: lvl, player: P, melee: null, audio,
    callbacks: { hurtPlayer: d => { gruntPerilDmg += d; P.hp -= d; } }
  });
  assert.ok(gruntPerilDmg >= 35 && gruntPerilDmg <= 48, `T1 grunt peril thrust=${gruntPerilDmg}`);
  assert.ok(P.hp >= 52, `Lv.1 hero survives T1 grunt peril hit to heal (${P.hp} HP left)`);

  // T1 grunt has ZERO hyper-armor: light slash interrupts its windup cleanly!
  grunt.duel.state = 'windup';
  grunt.duel.stateT = 0.2;
  duel.resolvePlayerHit(grunt, { dmg: 38, postureDmg: 22, heavy: false }, { x: grunt.x, y: 1.2, z: grunt.z }, { x: 0, z: -1 }, { player: P, audio, callbacks: {} });
  assert.equal(grunt.duel.state, 'stagger', 'Light slash reliably interrupts Tier 1 grunt windup');

  // Tier 3 Elite (Boss Gatekeeper): hits hard (~32 normal / ~74-78 peril -> leaves Lv.1 hero critical to heal!) & holds knight poise vs light slash
  const elite = lvl.enemies.find(e => e.duel.tier === 'elite');
  assert.equal(elite.duel.poiseTier, 3);
  P.hp = 100;
  elite.awake = true;
  elite.ang = Math.PI / 2;
  P.x = elite.x;
  P.z = elite.z + 2.0;
  let elitePerilDmg = 0;
  elite.duel.attackKind = 'perilChop';
  duel._resolveEnemyStrike(elite, {
    level: lvl, player: P, melee: null, audio,
    callbacks: { hurtPlayer: d => { elitePerilDmg += d; P.hp -= d; } }
  });
  assert.ok(elitePerilDmg >= 68 && elitePerilDmg <= 82, `T3 elite peril hits like Elden Ring Knight (${elitePerilDmg})`);
  assert.ok(P.hp >= 18 && P.hp <= 34, `Lv.1 hero survives T3 elite peril at critical HP (${P.hp}) for Flask loop`);

  // Readable Elden Ring peril windup duration (>= 0.72s)
  duel._beginEnemyAttack(elite, 'perilChop', true, audio);
  assert.ok(elite.duel.stateDur >= 0.72, `Peril telegraph windup is clearly readable (${elite.duel.stateDur.toFixed(2)}s)`);

  // Pack breathing room: finishing a non-boss strike sets groupAtkCd >= 0.55s
  grunt.duel.state = 'strike';
  grunt.duel.stateT = 0.24;
  grunt.duel.stateDur = 0.25;
  grunt.duel.didHit = true;
  grunt.duel.comboLeft = 0;
  duel.groupAtkCd = 0;
  duel.update(0.05, { level: lvl, player: P, audio, callbacks: {} });
  assert.ok(duel.groupAtkCd >= 0.55, `Pack breathing room cooldown armed (${duel.groupAtkCd.toFixed(2)}s)`);
});

test('Elden-Ring Guard Counter, Stamina comfort, Perfect Parry & 4-charge Flask recovery loop', () => {
  const P = new PlayerController();
  P.resetForLevel(10, 10);
  const melee = new Melee();
  melee.equipInstant();
  const audio = makeAudioStub();
  const phys = { movePlayer: (dx, dy, dz) => ({ x: P.x + dx, y: 0, z: P.z + dz, grounded: true }) };
  const mCtx = { P, audio, level: { enemies: [] }, physics: phys, useStamina: true };

  assert.equal(P.stamina, 100);
  assert.equal(P.staminaRegen, 45, 'Authentic Elden Ring ~45/s stamina regen rate');
  assert.equal(P.flasks, 4, 'Starts with 4 Healing Flasks');
  melee.press('light', mCtx);
  assert.equal(P.stamina, 91, 'light swing consumes comfortable 9 Stamina');

  // Out-of-combat sprinting consumes ZERO stamina (signature Elden Ring open-world rule!)
  P.sprinting = true;
  P.moving = true;
  P.stamina = 100;
  for (let i = 0; i < 40; i++) P.updateStamina(0.05, false, false, false);
  assert.equal(P.stamina, 100, 'Out-of-combat sprinting consumes ZERO stamina');

  // In-combat sprinting consumes gentle 11/s, and empty -> full refills cleanly in ~2.5s!
  for (let i = 0; i < 20; i++) P.updateStamina(0.05, false, false, true);
  assert.ok(P.stamina >= 88 && P.stamina <= 90, `In-combat 1s sprint drains gentle ~11 Stamina (${P.stamina})`);
  P.sprinting = false;
  P.stamina = 0;
  P.staminaDelay = 0.36;
  for (let i = 0; i < 55; i++) P.updateStamina(0.05, false, false, true);
  assert.equal(P.stamina, 100, 'Full 0->100 stamina bar refills cleanly within ~2.75s');

  // Elden Ring "even 1 green pixel lets you roll/act" rule: 2 Stamina still allows an 11-cost emergency roll!
  P.stamina = 2;
  assert.equal(P.consumeStamina(11, 0.36), true, 'Emergency roll succeeds even with only 2 Stamina left');
  assert.equal(P.stamina, 0);
  assert.equal(P.consumeStamina(11, 0.36), false, 'Refuses only when stamina bar is genuinely empty (0)');

  // Standard Guard Block (after parryWindowT expires) consumes 10 Stamina and opens 0.72s Guard Counter window!
  P.stamina = 100;
  const duel = new DuelSystem();
  duel.reset('duel1v1', 'campaign');
  duel.active = true;
  const foe = { x: 10, z: 8.2, ang: Math.PI / 2, hp: 320, max: 320, scale: 1 };
  duel.initDuelist(foe, { name: '重装精兵', weaponKind: 'axe', tier: 'elite', poiseTier: 3, hp: 320, maxPosture: 120, normalDmg: 30, perilDmg: 70 });
  melee.state = 'idle';
  melee.setBlock(true, audio);
  melee.parryWindowT = 0; // force standard guard block instead of perfect parry
  duel._resolveEnemyStrike(foe, { player: P, melee, audio, callbacks: {} });
  assert.equal(P.stamina, 90, 'Standard guard block consumes comfortable 10 Stamina');
  assert.ok(melee.guardCounterT >= 0.70, `Standard block opens Guard Counter window (${melee.guardCounterT}s)`);

  // Pressing attack during Guard Counter window fires golden guardCounter!
  let gcFired = false;
  melee.press('light', { ...mCtx, onGuardCounter: () => { gcFired = true; } });
  assert.equal(gcFired, true, 'Guard Counter fires cleanly on attack input after block');
  assert.equal(melee.atk.name, 'guardCounter');
  assert.equal(melee.atk.def.guardCounter, true);
  assert.equal(melee.atk.def.postureDmg, 58);

  // Guard Counter bypasses enemy block, deals massive posture damage & breaks T3 elite poise!
  foe.duel.blocking = true;
  foe.duel.state = 'windup';
  const gcRes = duel.resolvePlayerHit(foe, melee.atk.def, { x: foe.x, y: 1.2, z: foe.z }, { x: 0, z: -1 }, { player: P, audio, callbacks: {} });
  assert.equal(gcRes, 'hit');
  assert.equal(foe.duel.state, 'stagger', 'Guard Counter breaks Tier 3 elite poise!');
  assert.ok(foe.duel.posture >= 60, `Guard Counter delivers huge posture shatter (${foe.duel.posture})`);

  // Perfect Parry restores +20 Stamina!
  P.stamina = 40;
  melee.state = 'idle';
  melee.blocking = false;
  melee.setBlock(true, audio);
  duel._resolveEnemyStrike(foe, { player: P, melee, audio, callbacks: {} });
  assert.equal(P.stamina, 60, 'Perfect Parry restores +20 Stamina');

  // Healing Flask restores 65 HP cleanly and consumes 1 of 4 charges
  P.hp = 25;
  const healed = P.drinkFlask(audio);
  assert.equal(healed, 65, `drinkFlask heals 65% Max HP (+${healed})`);
  assert.equal(P.hp, 90);
  assert.equal(P.flasks, 3);
});

test('Mobile Touch HUD renders compact zero-overlap layout and wires Block/Parry, 3 Ultimates & Guard Counter', t => {
  const prevWin = globalThis.window;
  const prevDoc = globalThis.document;
  const document = new EventTarget();
  const window = Object.assign(new EventTarget(), { innerWidth: 844, innerHeight: 390 });
  const canvas = new EventTarget();

  const mkBtn = () => {
    const classes = new Set();
    const sub = { textContent: '' };
    return Object.assign(new EventTarget(), {
      disabled: false,
      textContent: '',
      ariaPressed: 'false',
      classList: {
        toggle: (k, v) => (v ? classes.add(k) : classes.delete(k)),
        has: k => classes.has(k)
      },
      querySelector: () => sub,
      blur: () => {}
    });
  };
  const ids = ['bSneak', 'bCrouch', 'bExec', 'bFire', 'bBlock', 'bNade', 'bJump', 'bArmory', 'bUlt1', 'bUlt2', 'bUlt3', 'bRoll', 'bPause', 'bGun'];
  const btns = new Map(ids.map(id => [id, mkBtn()]));
  document.getElementById = id => btns.get(id) || null;
  Object.assign(globalThis, { document, window });
  t.after(() => {
    globalThis.window = prevWin;
    globalThis.document = prevDoc;
  });

  const keys = [];
  const touchUI = { hidden: true, classList: { toggle: () => {} } };
  const input = new InputManager(canvas, touchUI, { onKeyDown: code => keys.push(code) });
  input.enableTouch();
  assert.equal(input.isTouch, true);

  // Touch Block/Parry button toggles input.touchBlock cleanly
  const touchEvt = type => Object.assign(new Event(type, { cancelable: true }), { changedTouches: [] });
  btns.get('bBlock').dispatchEvent(touchEvt('touchstart'));
  assert.equal(input.touchBlock, true, 'Pressing mobile Block button engages guard/parry');
  btns.get('bBlock').dispatchEvent(touchEvt('touchend'));
  assert.equal(input.touchBlock, false, 'Releasing mobile Block button lowers guard');

  // All 3 mobile Ultimate buttons trigger Digit1 / Digit2 / Digit3!
  btns.get('bUlt1').dispatchEvent(touchEvt('touchstart'));
  btns.get('bUlt2').dispatchEvent(touchEvt('touchstart'));
  btns.get('bUlt3').dispatchEvent(touchEvt('touchstart'));
  assert.deepEqual(keys, ['Digit1', 'Digit2', 'Digit3']);

  // updateTouchHUD dynamically reflects Guard Counter, Flask count, Fog Gate prompt & Ult cooldowns
  input.updateTouchHUD({
    coldMode: true,
    guardCounterReady: true,
    flasks: 3,
    maxFlasks: 4,
    lockedOn: true,
    canUpgrade: true,
    interactLabel: '雾门',
    canInteract: true,
    ults: [
      { cost: 35, cd: 3.2, onCd: true, ready: false },
      { cost: 45, cd: 0, onCd: false, ready: true },
      { cost: 55, cd: 0, onCd: false, ready: false }
    ]
  });
  assert.equal(btns.get('bFire').textContent, '防反!');
  assert.equal(btns.get('bFire').classList.has('gc-ready'), true);
  assert.equal(btns.get('bNade').textContent, '药×3');
  assert.equal(btns.get('bExec').textContent, '雾门');
  assert.equal(btns.get('bExec').disabled, false);
  assert.equal(btns.get('bArmory').classList.has('can-up'), true);
  assert.equal(btns.get('bUlt1').querySelector('small').textContent, '4s');
  assert.equal(btns.get('bUlt2').classList.has('is-ready'), true);

  // Compact Mobile Canvas HUD renders cleanly at 844x390 and suppresses overlapping Desktop bottom cards
  const texts = [];
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx = {
    setTransform: noop, clearRect: noop, save: noop, restore: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, fill: noop, stroke: noop, clip: noop, fillRect: noop,
    strokeText: noop, translate: noop, scale: noop, rotate: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    measureText: str => ({ width: String(str).length * 8 }),
    fillText(str) { texts.push(String(str)); }
  };
  const hud = new HudRenderer({ getContext: () => ctx });
  const lvl = new LevelState();
  lvl.generate(0);
  const duel = new DuelSystem();
  duel.reset('duelBoss', 'campaign');
  duel.active = true;
  for (const e of lvl.enemies) duel.initDuelist(e, e.duelSpec);
  const melee = new Melee();
  melee.equipInstant();
  const cam = new THREE.PerspectiveCamera(60, 844 / 390, 0.1, 100);
  cam.position.set(lvl.startPos.x, 2.2, lvl.startPos.z + 3.5);
  cam.lookAt(lvl.startPos.x, 1.5, lvl.startPos.z - 5);
  cam.updateMatrixWorld();

  hud.draw({
    state: 'play',
    time: 1.0,
    player: { hp: 82, maxHp: 100, stamina: 100, maxStamina: 100, flasks: 4, maxFlasks: 4, armor: 0, btK: 0, scopeK: 0, ang: -Math.PI / 2 },
    level: lvl,
    camera: cam,
    input,
    prog: new ProgressionSystem({ persist: false }),
    kills: 3,
    banner: 0,
    msg: '',
    msgT: 0,
    hurtFlash: 0,
    hurtAng: null,
    hitMark: 0,
    killMark: 0,
    headMark: 0,
    impactFlash: 0,
    impactLinesT: 0,
    hitNums: [],
    execTarget: null,
    execFX: { k: 0 },
    melee,
    duel,
    perfStats: { show: false, fps: 60, ms: 16.6 }
  });

  assert.ok(texts.some(s => s.includes('82/100')), 'draws compact mobile HP bar');
  assert.ok(texts.some(s => s.includes('积分')), 'draws compact mobile Points pill');
  assert.equal(texts.some(s => s.includes('左键 连斩')), false, 'suppresses desktop bottom-left weapon plaque on touch');
  assert.equal(texts.some(s => s.includes('瞬步·居合一闪')), false, 'suppresses desktop bottom-right canvas skill cards on touch');
});
