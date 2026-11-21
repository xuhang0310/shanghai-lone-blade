import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/entities/Player.js';
import { InputManager } from '../src/core/InputManager.js';
import { EnemyManager } from '../src/entities/EnemyManager.js';
import { LevelState } from '../src/world/LevelGenerator.js';
import { canFinishStealth, findStealthTarget, findCombatFinisher, stepGuardSuspicion } from '../src/systems/Stealth.js';

function encounter() {
  const player = new PlayerController();
  player.resetForLevel(20, 21.25);
  player.ang = 0;
  player.sneak = true;
  player.sneakK = 1;
  const level = new LevelState();
  const guard = level.spawnEnemy('gunman', 21.5, player.z, 1);
  guard.ang = 0;
  const manager = new EnemyManager();
  const ctx = {
    player, level,
    physics: { updateEnemyCollider() {} },
    audio: { playStep() {} },
    callbacks: {}
  };
  return { player, level, guard, manager, ctx };
}

test('an idle guard distinguishes a quiet waist-bent approach behind it from a visible approach in front', () => {
  const { guard, manager, ctx } = encounter();
  for (let frame = 0; frame < 30; frame++) manager.update(1 / 60, ctx);
  assert.equal(guard.awake, false);
  guard.ang = Math.PI;
  manager.update(1 / 60, ctx);
  assert.equal(guard.awake, true);
});

test('a close guard cannot see through a solid barrier', () => {
  const { guard, level, player, manager, ctx } = encounter();
  player.sneak = false;
  guard.ang = Math.PI;
  level.los3 = () => false;
  manager.update(1 / 60, ctx);
  assert.equal(guard.awake, false);
});

test('only a reachable, unaware target behind the prompt can be selected', () => {
  const { player, level, guard } = encounter();
  assert.equal(findStealthTarget(level, player), guard);
  for (const [key, value] of Object.entries({
    awake: true, sees: true, executing: true, disarmed: true, downed: true, hp: 0,
    type: 'boss', ang: Math.PI, inv: 1, stun: 1, staggerT: 1
  })) {
    const saved = guard[key];
    guard[key] = value;
    assert.equal(findStealthTarget(level, player), null, key);
    guard[key] = saved;
  }
  for (const [key, value] of Object.entries({
    sneak: false, air: true, sneakK: 0, rollT: 1, stepT: 1, diveT: 1, reloadT: 1,
    gunHoldT: 1, bulletTime: true, execT: 1, ang: Math.PI, x: 16, y: 1, z: 23
  })) {
    const saved = player[key];
    player[key] = value;
    assert.equal(findStealthTarget(level, player), null, key);
    player[key] = saved;
  }
  assert.equal(findStealthTarget(level, player, () => false), null);
  level.canWalk = () => false;
  assert.equal(findStealthTarget(level, player), null);
});

test('a deep crouch counts as stealth, stays undetected behind a guard, and arms a stealth takedown', () => {
  const { player, level, guard, manager, ctx } = encounter();
  player.sneak = false;
  player.sneakK = 0;
  player.crouch = true;
  player.crouchK = 1;
  assert.equal(player.sneaking, true);
  assert.equal(findStealthTarget(level, player), guard);
  for (let frame = 0; frame < 30; frame++) manager.update(1 / 60, ctx);
  assert.equal(guard.awake, false);
  guard.executing = true;
  assert.equal(canFinishStealth(level, player, guard), true);
});

test('a nearby guard can still notice a player who has only just pressed the sneak key', () => {
  const { player, manager, ctx, guard } = encounter();
  player.sneakK = .1;
  manager.update(1 / 60, ctx);
  assert.equal(guard.awake, true);
});

test('switching from locked mouse look to touch keeps the game active and exposes separate stance buttons', t => {
  const document = new EventTarget(), window = new EventTarget(), canvas = new EventTarget();
  const buttons = new Map(['bSneak', 'bCrouch', 'bExec'].map(id => [id, new EventTarget()]));
  document.getElementById = id => buttons.get(id);
  document.exitPointerLock = () => {
    document.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  Object.assign(globalThis, { document, window });
  t.after(() => { delete globalThis.document; delete globalThis.window; });
  const keys = [];
  let paused = false;
  const input = new InputManager(canvas, { hidden: true }, {
    onKeyDown: key => keys.push(key), onPointerUnlock: () => { paused = true; }
  });
  document.pointerLockElement = canvas;
  document.dispatchEvent(new Event('pointerlockchange'));
  const touch = () => Object.assign(new Event('touchstart', { cancelable: true }), { changedTouches: [] });
  canvas.dispatchEvent(touch());
  assert.equal(document.pointerLockElement, null, 'locked look must release its capture of button taps');
  assert.equal(paused, false);
  for (const id of ['bSneak', 'bCrouch']) buttons.get(id).dispatchEvent(touch());
  assert.deepEqual(keys, ['KeyC', 'KeyV']);
  input.updateStealthControls(false, true, false);
  assert.equal(buttons.get('bCrouch').ariaPressed, 'true');
  assert.equal(buttons.get('bSneak').ariaPressed, 'false');
});

test('the prompt responds to other guards, and a reserved target is checked again', () => {
  const { player, level, guard } = encounter();
  const witness = level.spawnEnemy('soldier', player.x - 6, player.z, 2);
  witness.ang = 0;
  assert.equal(findStealthTarget(level, player), null);
  witness.ang = Math.PI;
  assert.equal(findStealthTarget(level, player), guard);
  guard.executing = true;
  player.execT = .3;
  assert.equal(findStealthTarget(level, player), null);
  assert.ok(canFinishStealth(level, player, guard));
  witness.ang = 0;
  assert.ok(!canFinishStealth(level, player, guard));
  witness.disarmed = true;
  assert.ok(canFinishStealth(level, player, guard));
  guard.awake = true;
  assert.ok(!canFinishStealth(level, player, guard));
  guard.awake = false;
  level.enemies = [witness];
  assert.ok(!canFinishStealth(level, player, guard));
});

test('a resolved stealth defeat cannot grant health, roll a medical pickup or count twice', t => {
  const { guard, player, ctx, manager } = encounter();
  t.mock.method(Math, 'random', () => 0);
  player.hp = 35;
  guard.executing = true;
  let defeats = 0;
  const drops = [];
  ctx.stealthTakedown = true;
  ctx.callbacks = { puff() {}, onEnemyKilled() { defeats++; }, dropAt(x, z, item) { drops.push(item); } };
  const damage = guard.hp;
  manager.hitEnemy(guard, damage, 1, 0, 1, ctx, true, 2.2);
  manager.hitEnemy(guard, damage, 1, 0, 1, ctx, true, 2.2);
  assert.equal(player.hp, 35);
  assert.equal(defeats, 1);
  assert.deepEqual(drops, []);
});

test('distant sneaking builds suspicion gradually and decays back behind cover without waking the squad', () => {
  const { guard, level, player } = encounter();
  guard.x = player.x + 12;
  guard.ang = Math.PI;
  let alerted = false;
  for (let i = 0; i < 15; i++) alerted = stepGuardSuspicion(level, guard, player, 1 / 60);
  assert.equal(alerted, false);
  assert.ok(guard.suspicion > 0.05 && guard.suspicion < 0.9, `suspicion=${guard.suspicion}`);
  // Duck behind solid barrier: suspicion decays cleanly back toward zero
  level.los3 = () => false;
  for (let i = 0; i < 60; i++) stepGuardSuspicion(level, guard, player, 1 / 60);
  assert.equal(guard.suspicion, 0);
  assert.equal(guard.awake, false);
});

test('combat finishers target kneeling, downed, or staggered low-HP enemies in front but skip healthy/disarmed/boss foes', () => {
  const { player, level, guard } = encounter();
  player.sneak = false;
  player.sneakK = 0;
  guard.awake = true;
  guard.ang = Math.PI;
  assert.equal(findCombatFinisher(level, player), null, 'healthy standing enemy is not finishable');

  guard.react = { kind: 'kneel', t: 0.2, dur: 1.5, side: 1 };
  assert.equal(findCombatFinisher(level, player), guard, 'kneeling enemy is finishable');
  guard.react = null;

  guard.downed = true;
  assert.equal(findCombatFinisher(level, player), guard, 'downed crawling enemy is finishable');
  guard.downed = false;

  guard.hp = guard.max * 0.25;
  guard.staggerT = 0.5;
  assert.equal(findCombatFinisher(level, player), guard, 'staggered low-HP enemy is finishable');

  guard.disarmed = true;
  assert.equal(findCombatFinisher(level, player), null, 'disarmed enemy is skipped');
  guard.disarmed = false;

  guard.type = 'boss';
  assert.equal(findCombatFinisher(level, player), null, 'boss cannot be instant-finished');
});

test('unaware guards patrol between assigned waypoints and spotting a fallen comrade corpse triggers alert investigation', () => {
  const { player, level, guard, manager, ctx } = encounter();
  player.x = 5; player.z = 5;
  guard.x = 20; guard.z = 20; guard.ang = 0;
  guard.patrol = [{ x: 20, z: 20 }, { x: 24, z: 20 }];
  guard.patrolIdx = 1;
  guard.patrolWait = 0;
  const startX = guard.x;
  for (let i = 0; i < 60; i++) manager.update(1 / 60, ctx);
  assert.equal(guard.awake, false);
  assert.ok(guard.x > startX + 0.8, `guard should walk toward patrol waypoint (x=${guard.x})`);
  assert.equal(guard.moving, true);

  // Drop a fallen comrade corpse ahead of the patrolling guard
  const announcements = [];
  ctx.callbacks = {
    say: t => announcements.push(t),
    radio: () => true
  };
  level.corpses = [{ x: guard.x + 5, z: guard.z, found: false, t: 1 }];
  manager.update(1 / 60, ctx);
  assert.equal(level.corpses[0].found, true, 'corpse is marked discovered');
  assert.equal(guard.awake, true, 'guard wakes on spotting dead comrade');
  assert.ok(Math.hypot(guard.lastSeen.x - level.corpses[0].x, guard.lastSeen.z - level.corpses[0].z) < 0.01);
  assert.ok(announcements.some(t => t.includes('同伴的尸体')));
});
