import test from 'node:test';
import assert from 'node:assert/strict';
import { LevelState } from '../src/world/LevelGenerator.js';
import { EnemyManager } from '../src/entities/EnemyManager.js';
import { PlayerController } from '../src/entities/Player.js';
import { TILE, MW, WEAPONS, LEVELS } from '../src/config/constants.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { DeadEye } from '../src/systems/DeadEye.js';

const audio = { sfx() {}, playStep() {}, playEnemyShot() {}, playVoiceShout() {} };
const axes = (f, r) => ({ getMoveAxes: () => ({ f, r }), keys: {}, sticks: {}, mouse: {}, locked: true });

function encounter(type, distance) {
  const level = new LevelState();
  const player = new PlayerController();
  player.resetForLevel(21.25, 21.25);
  player.ang = 0;
  level.computeFlow(player.x, player.z);
  const enemy = level.spawnEnemy(type, player.x + distance, player.z, 1);
  enemy.awake = true;
  enemy.cd = 0;
  const events = [];
  const manager = new EnemyManager();
  const ctx = {
    level, player, audio,
    physics: { updateEnemyCollider() {} },
    callbacks: {
      radio: cue => events.push(cue),
      hurtPlayer: () => events.push('contact'),
      shootBullet: () => events.push('shot'),
      puff() {}, say() {}, addShake() {}, spawnLive() {}
    }
  };
  function advance(seconds) {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) manager.update(1 / 60, ctx);
  }
  return { level, player, enemy, manager, ctx, events, advance };
}

test('a disarmed gunman stays out of combat after the surrender timer expires', () => {
  const { enemy, player, manager, ctx, events, advance } = encounter('gunman', 1);
  manager.hitEnemy(enemy, 3, 1, 0, 1.2, ctx, false, 0, 'armR');
  advance(8.5);
  player.x = enemy.x - 1;
  advance(1.5);
  assert.equal(enemy.disarmed, true);
  assert.ok(!enemy.melee);
  assert.ok(enemy.handsUp);
  assert.ok(!events.some(cue => ['charge', 'struggle', 'contact', 'shot'].includes(cue)));
});

test('a raised gun makes a cautious blade carrier give ground while a brave one keeps guard', () => {
  const { enemy, player, events, advance } = encounter('thug', 10);
  player.unlockWeapon(0, true);
  enemy.brave = false;
  player.ads = 1;
  const start = enemy.x;
  advance(1.6);
  assert.ok(enemy.x >= start && Math.hypot(enemy.x - player.x, enemy.z - player.z) > 10.5);
  assert.ok(!events.includes('charge'));

  const brave = encounter('thug', 10);
  brave.player.unlockWeapon(0, true);
  brave.enemy.brave = true;
  brave.player.ads = 1;
  brave.advance(.5);
  assert.ok(brave.enemy.guarding);
  assert.ok(!brave.enemy.duck && !brave.enemy.moving);
});

test('close contact gives time to step away and cannot reach through a wall', () => {
  const a = encounter('thug', 1.1);
  a.player.melee = true;
  a.advance(.20);
  assert.ok(!a.events.includes('contact'));
  assert.ok(a.enemy.windupT > 0);
  a.player.x -= 5;
  a.advance(.65);
  assert.ok(!a.events.includes('contact'));

  const b = encounter('thug', 1.1);
  b.player.melee = true;
  b.advance(.19);
  b.level.los3 = () => false;
  b.level.los = () => false;
  b.advance(.8);
  assert.ok(!b.events.includes('contact'));

  const c = encounter('thug', 1.1);
  c.enemy.brave = false;
  c.advance(.15);
  c.player.gunHoldT = .8;
  c.manager.hearShot(c.level, c.player, c.ctx.callbacks);
  c.advance(.7);
  assert.equal(c.events.filter(x => x === 'contact').length, 1);
});

test('healthy armed roles finish their current action during sustained nearby gunfire', () => {
  for (const type of ['gunman', 'soldier', 'gunner', 'officer', 'boss']) {
    const { level, enemy, player, ctx, manager, events, advance } = encounter(type, 9);
    enemy.brave = false;
    enemy.sees = true;
    enemy.ang = Math.PI;
    enemy.aimT = .18;
    for (let i = 0; i < 10; i++) {
      manager.hearShot(level, player, ctx.callbacks);
      advance(.1);
      assert.equal(enemy.duck, false, type);
    }
    assert.ok(events.includes('shot'), type);
  }
});

test('NPC aim follows the player avatar height through standing, sneaking, crouching and rolling', t => {
  t.mock.method(Math, 'random', () => .5);
  const heights = [];
  for (const pose of [{}, { sneak: true, sneakK: 1 }, { crouch: true, crouchK: 1 }, { rollT: .3 }]) {
    const { enemy, player, ctx, advance } = encounter('gunman', 10);
    Object.assign(player, pose);
    player.y = .4;
    enemy.ang = Math.PI;
    enemy.aimT = .01;
    ctx.callbacks.shootBullet = (x, y, z, vx, vy) => {
      heights.push(y + (player.x - x) * vy / vx - player.y);
    };
    advance(.05);
  }
  const [standing, sneaking, crouching, rolling] = heights;
  assert.ok(Math.abs(standing - 1.15) < .01);
  assert.ok(sneaking < standing && sneaking > crouching);
  assert.ok(Math.abs(crouching - .7) < .01 && Math.abs(rolling - .7) < .01);
});

test('a wounded guard can finish seeking shelter and rejoin the encounter while shots continue', () => {
  const { level, enemy, player, ctx, manager, events, advance } = encounter('soldier', 10);
  enemy.hp = enemy.max * .4;
  enemy.sees = true;
  enemy.ang = Math.PI;
  let withdrawals = 0;
  for (let i = 0; i < 90; i++) {
    player.ang = Math.atan2(enemy.z - player.z, enemy.x - player.x);
    const wasSheltering = !!enemy.defense;
    manager.hearShot(level, player, ctx.callbacks);
    if (!wasSheltering && enemy.defense) withdrawals++;
    advance(.15);
  }
  assert.equal(withdrawals, 1);
  assert.ok(!enemy.duck && !enemy.defense);
  assert.ok(events.includes('shot'));

  advance(4);
  player.ang = Math.atan2(enemy.z - player.z, enemy.x - player.x);
  manager.hearShot(level, player, ctx.callbacks);
  assert.ok(enemy.defense);
});

test('guards behind a wall turn toward the last sound and identify the player only on sight', () => {
  for (const type of ['soldier', 'boss']) {
    const { level, enemy, player, ctx, manager, advance } = encounter(type, 10);
    enemy.awake = false;
    enemy.ang = 0;
    const start = [enemy.x, enemy.z];
    const wall = 8 * MW + 10;
    level.grid[wall] = 1;
    level.tileH[wall] = 4;
    const speech = [];
    ctx.callbacks.radio = (cue, duration, speaker) => speech.push({ cue, speaker });
    manager.hearShot(level, player, ctx.callbacks);
    player.z += 1;
    advance(1);
    assert.deepEqual(speech.map(line => line.cue), ['heard-shot'], type);
    assert.equal(speech[0].speaker, enemy, type);
    assert.ok(enemy.awake && !enemy.sees && !enemy.lastSeen, type);
    assert.deepEqual([enemy.x, enemy.z], start, type);
    assert.ok(Math.cos(enemy.ang) < -.9999, type);

    advance(8);
    enemy.ang = Math.PI * .8;
    advance(.25);
    assert.equal(enemy.ang, Math.PI * .8, type);
    level.grid[wall] = level.tileH[wall] = 0;
    advance(.25);
    assert.ok(enemy.sees, type);
    assert.equal(speech[1]?.cue, 'spot-' + type);
    assert.equal(speech[1]?.speaker, enemy);
  }
});

test('a rejected hearing line leaves the voice channel available when a listener spots the player', () => {
  const { level, enemy, player, ctx, manager, advance } = encounter('soldier', 10);
  enemy.awake = false;
  enemy.ang = Math.PI;
  const cues = [];
  ctx.callbacks.radio = cue => {
    cues.push(cue);
    if (cue === 'heard-shot') return false;
  };
  manager.hearShot(level, player, ctx.callbacks);
  advance(.1);
  assert.deepEqual(cues, ['heard-shot', 'spot-soldier']);
  assert.ok(level.calloutCd > 0);
});

test('a mixed group shares one hearing line while its members react independently', () => {
  const { level, enemy, player, ctx, manager, advance } = encounter('thug', 12);
  enemy.awake = false;
  enemy.brave = false;
  const nearby = level.spawnEnemy('officer', player.x + 5, player.z, enemy.group);
  nearby.ang = 0;
  const listeners = [];
  ctx.callbacks.radio = (cue, duration, speaker) => {
    if (cue === 'heard-shot') listeners.push(speaker);
    return false;
  };
  manager.hearShot(level, player, ctx.callbacks);
  advance(.05);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0], nearby);
  assert.ok(enemy.awake && enemy.duck);
  assert.ok(nearby.awake && !nearby.duck && !nearby.sees);
});

test('a guard keeps an occupied post when a nearby ally goes down', t => {
  t.mock.method(Math, 'random', () => 0);
  const { level, enemy, player, ctx, manager, advance } = encounter('soldier', 9);
  const post = { x: enemy.x, z: enemy.z };
  enemy.cover = enemy.post = post;
  enemy.hp = enemy.max * .4;
  const mate = level.spawnEnemy('thug', enemy.x, enemy.z + 2, 1);
  ctx.callbacks.onEnemyKilled = ctx.callbacks.dropAt = () => {};
  let witness = null;
  ctx.callbacks.radio = (cue, duration, speaker) => {
    if (cue === 'ally-down') witness = speaker;
    return false;
  };
  manager.hitEnemy(mate, mate.hp, 1, 0, 1, ctx);
  assert.equal(witness, enemy);
  assert.ok(!(level.calloutCd > 0));
  manager.hearShot(level, player, ctx.callbacks);
  advance(.7);
  assert.equal(enemy.defense, null);
  assert.deepEqual({ x: enemy.x, z: enemy.z }, post);
});

test('a guard at its post can stand and act again after its cooldown elapses', () => {
  const { level, enemy, player, ctx, manager, events, advance } = encounter('soldier', 12);
  enemy.cover = enemy.post = { x: enemy.x, z: enemy.z };
  enemy.cd = .7;
  enemy.peekT = .2;
  enemy.ang = Math.PI;
  manager.hearShot(level, player, ctx.callbacks);
  advance(.35);
  assert.ok(enemy.duck);
  advance(7);
  assert.ok(events.filter(event => event === 'shot').length >= 2);
  assert.deepEqual({ x: enemy.x, z: enemy.z }, enemy.post);
});

test('a guard whose post overlooks a wall settles between peeks', () => {
  const { level, enemy, player, ctx, manager, events, advance } = encounter('soldier', 10);
  enemy.cover = enemy.post = { x: enemy.x, z: enemy.z };
  enemy.ang = Math.PI;
  enemy.peekT = .15;
  const wall = 8 * MW + 10;
  level.grid[wall] = 1;
  level.tileH[wall] = 4;
  manager.hearShot(level, player, ctx.callbacks);
  advance(.8);
  assert.ok(!enemy.sees && enemy.duck && !events.includes('shot'));
});

test('the boss summons reinforcements with a single line from his own voice', () => {
  const { enemy, ctx, advance } = encounter('boss', 10);
  enemy.p2 = true;
  enemy.hp = enemy.max * .2;
  const speech = [];
  const spawns = [];
  ctx.callbacks.radio = (cue, duration, speaker) => speech.push({ cue, speaker });
  ctx.callbacks.spawnLive = type => spawns.push(type);
  advance(.5);
  assert.deepEqual(spawns, ['thug', 'thug']);
  assert.deepEqual(speech.filter(line => line.cue === 'boss-summon').map(line => line.speaker), [enemy]);
});

test('a guard that has lost sight does not follow an unseen moving player', () => {
  for (const type of ['thug', 'gunman']) {
    const { enemy, level, player, advance } = encounter(type, 12);
    advance(.25);
    level.los3 = () => false;
    level.los = () => false;
    player.z += 12;
    advance(3);
    const stopped = [enemy.x, enemy.z];
    player.z += 4;
    advance(1);
    assert.ok(Math.hypot(enemy.x - stopped[0], enemy.z - stopped[1]) < .05, type);
  }
});

test('retreat uses connected floor and can turn a corner in each map', () => {
  for (let index = 0; index < LEVELS.length; index++) {
    const level = new LevelState();
    level.generate(index);
    // A fixed L-shaped passage isolates route selection from the random streets.
    level.props = [];
    level.indexStreetProps();
    level.grid.fill(1);
    level.tileH.fill(4);
    for (const [x, z] of [[3, 5], [4, 5], [5, 5], [6, 5], [6, 6], [6, 7]]) {
      level.grid[z * MW + x] = 0;
      level.tileH[z * MW + x] = 0;
    }
    const enemy = { x: 5.5 * TILE, z: 5.5 * TILE, r: .56 };
    const route = level.shelterRoute(enemy, 3.5 * TILE, 5.5 * TILE);
    assert.ok(route.length >= 2);
    assert.ok(route.at(-1).z > enemy.z);
    let last = enemy;
    for (const point of route) {
      assert.ok(!level.boxHit(point.x, point.z, enemy.r));
      assert.ok(Math.hypot(point.x - last.x, point.z - last.z) <= TILE + .01);
      last = point;
    }
  }
});

test('vehicles and sandbags occupy the same space for sight, movement and physics', () => {
  const level = new LevelState();
  level.props = [
    { kind: 'tram', x: 16.25, z: 16.25, rotY: Math.PI / 2 },
    { kind: 'sandbag', x: 36.25, z: 16.25, rotY: 0 }
  ];
  level.indexStreetProps();
  assert.equal(level.streetBoxes.length, 2);
  assert.ok(level.boxHit(19.7, 16.25, .5));
  assert.ok(!level.boxHit(16.25, 18.5, .5));
  assert.equal(level.los3(16.25, 1.6, 12, 16.25, 1.6, 21), false);
  assert.equal(level.los3(36.25, .68, 14, 36.25, .68, 19), false);
  assert.equal(level.los3(36.25, 1.6, 14, 36.25, 1.6, 19), true);
  level.computeFlow(16.25, 10);
  assert.ok(level.flow[6 * MW + 6] < 0);
});

test('objectives and occupied spawn spots stay on accessible floor in generated streets', t => {
  let seed = 1;
  t.mock.method(Math, 'random', () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  });
  const level = new LevelState();
  for (let sample = 1; sample <= 6; sample++) {
    for (let index = 0; index < LEVELS.length; index++) {
      seed = sample;
      level.generate(index);
      level.computeFlow(level.startPos.x, level.startPos.z);
      assert.ok(level.boss && level.boss.scale >= 1.55 && level.boss.ht >= 2.75, `level ${index} spawns a towering boss`);
      const objectives = [level.exitPos, level.boss, ...(level.shrines || []), ...(level.soulCaches || [])].filter(Boolean);
      for (const point of objectives) {
        const cell = Math.floor(point.z / TILE) * MW + Math.floor(point.x / TILE);
        assert.ok(level.flow[cell] >= 0 && !level.boxHit(point.x, point.z, .5), `objective in map ${index}, seed ${sample}, cell ${cell}`);
      }
      for (const e of level.enemies) {
        assert.ok(!level.boxHit(e.x, e.z, e.r), `${e.type} spawn in map ${index}, seed ${sample}`);
      }
    }
  }
});

test('a marker stays on the same part of the body when a crouching character stands', () => {
  const sight = new DeadEye();
  const enemy = { x: 8, z: 12, ang: 0, ht: 1.8, duck: true, crouchK: 1 };
  sight._addMark(enemy, { x: 8, z: 12, y: 1.1 }, { audio });
  const [mark] = sight.marks;
  assert.ok(mark.head);
  assert.ok(Math.abs(sight.markPos(mark).y - 1.1) < .005);
  enemy.duck = false;
  enemy.crouchK = 0;
  assert.ok(sight.markPos(mark).y > 1.5);
});

test('ducking lowers the top of the physical capsule and standing restores it', async () => {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.reset();
  const e = { ht: 1.8, ang: 0 };
  e.phys = physics.createEnemyCollider(e, 7, 8, .56, e.ht);
  for (const height of [1.8, 1.2, 1.8]) {
    physics.updateEnemyCollider(e, 7, 8, height);
    const bodyHeight = 2 * (e.phys.col.radius() + e.phys.col.halfHeight());
    assert.ok(Math.abs(bodyHeight - height) < .015);
  }
  physics.world.free();
});

test('grounded sidestep and backstep use collision movement and share a cooldown', () => {
  for (const [f, r] of [[0, 1], [0, -1], [-1, 0], [0, 0]]) {
    const p = new PlayerController();
    p.ang = 0;
    const control = axes(f, r);
    const physics = { movePlayer: (dx, dy, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz, grounded: true }) };
    assert.ok(p.quickStep(control, audio));
    assert.ok(!p.quickStep(control, audio));
    for (let i = 0; i < 27; i++) p.updateMovement(1 / 60, axes(0, 0), physics, audio);
    assert.equal(p.stepT, 0);
    const distance = Math.hypot(p.x, p.z);
    assert.ok(distance > 1 && distance < 2.5);
    if (r) assert.equal(Math.sign(p.z), r);
    else assert.ok(p.x < 0);
    assert.equal(p.inv, 0);
    assert.equal(p.ang, 0);
    p.resetForLevel(3, 4);
    p.air = true;
    assert.ok(!p.quickStep(control, audio));
  }
});

test('a grounded step stops against another standing character', async () => {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.reset();
  physics.addGroundPlane(24, 24);
  const player = new PlayerController();
  player.resetForLevel(10, 10);
  player.ang = 0;
  physics.createPlayer(10, 0, 10);
  physics.createEnemyCollider({}, 11.7, 10, .56, 1.8);
  physics.warmupStep();
  assert.ok(player.quickStep(axes(1, 0), audio));
  for (let frame = 0; frame < 30; frame++) {
    player.updateMovement(1 / 60, axes(0, 0), physics, audio);
    physics.step(1 / 60);
  }
  assert.ok(player.x > 10.2 && player.x < 10.85, `ended at ${player.x}`);
  assert.equal(player.stepT, 0);
  physics.world.free();
});

test('a crouching player walks under a low beam and can stand when clear', async () => {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.reset();
  physics.addGroundPlane(26, 24);
  physics.addStaticBox(12, 1.66, 10, 1.1, .28, 1.7);
  const player = new PlayerController();
  player.resetForLevel(9.5, 10);
  player.ang = 0;
  physics.createPlayer(player.x, 0, player.z);
  physics.warmupStep();
  function advance(frames, forward = 0) {
    for (let i = 0; i < frames; i++) {
      player.updateMovement(1 / 60, axes(forward, 0), physics, audio);
      physics.step(1 / 60);
    }
  }
  const height = () => 2 * (physics.playerCollider.radius() + physics.playerCollider.halfHeight());
  player.crouch = true;
  advance(30);
  assert.ok(height() < 1.22);
  advance(85, 1);
  assert.ok(player.x > 11.4 && player.x < 13.1);
  assert.ok(Math.abs(player.y) < .08);
  player.crouch = false;
  advance(30);
  assert.ok(player.crouch && height() < 1.39);
  advance(100, 1);
  player.crouch = false;
  advance(45);
  assert.ok(height() > 1.71);
  assert.ok(Math.abs(player.y) < .08);
  physics.world.free();
});

test('waist-bent sneaking stays grounded, stops at a low beam, and cannot replace a deep crouch under it', async () => {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.reset();
  physics.addGroundPlane(30, 24);
  physics.addStaticBox(12, 1.47, 10, 1.1, .28, 1.7);
  const p = new PlayerController();
  p.resetForLevel(9, 10);
  p.ang = 0;
  physics.createPlayer(p.x, 0, p.z);
  physics.warmupStep();
  const control = axes(0, 0);
  const walk = axes(1, 0);
  walk.keys.ShiftLeft = true;
  function advance(frames, input) {
    for (let i = 0; i < frames; i++) {
      p.updateMovement(1 / 60, input, physics, audio);
      physics.step(1 / 60);
    }
  }
  p.sneak = true;
  advance(45, control);
  assert.ok(physics.playerHeight > 1.42 && physics.playerHeight < 1.74, String(physics.playerHeight));
  assert.ok(Math.abs(p.currentHeight() - physics.playerHeight) < .005);
  advance(100, walk);
  assert.ok(!p.air && !p.sprinting && p.sneaking);
  assert.ok(p.x > 10.2 && p.x < 10.9, 'the upright legs cannot enter the low passage');
  p.toggleStance('crouch');
  advance(45, control);
  advance(55, walk);
  assert.ok(p.x > 11.4 && p.x < 12.8);
  p.toggleStance('sneak');
  advance(1, control);
  assert.ok(!p.sneak && p.crouch && p.sneakK < .01, 'a blocked switch must not start raising the model');
  advance(45, control);
  assert.ok(p.crouch && p.sneaking && physics.playerHeight < 1.22);
  p.jump(audio, 'play', physics);
  assert.ok(!p.air && p.crouch, 'jump must not stand the mesh up through the beam');
  advance(120, walk);
  p.toggleStance('sneak');
  advance(45, control);
  assert.ok(p.sneaking && !p.crouch && p.currentHeight() > 1.42);
  p.toggleStance('sneak');
  advance(45, control);
  assert.ok(!p.sneak && p.currentHeight() > 1.74);
  physics.world.free();
});

test('waist-bent sneaking supports brisk-walking with Shift while staying hunched', () => {
  const p = new PlayerController();
  p.resetForLevel(10, 10);
  p.ang = 0;
  p.sneak = true;
  p.sneakK = 1;
  const flatPhysics = {
    movePlayer: (dx, dy, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz, grounded: true }),
    canSetPlayerHeight: () => true,
    setPlayerHeight: () => true
  };
  const slowInput = axes(1, 0);
  const startSlow = p.x;
  for (let i = 0; i < 60; i++) p.updateMovement(1 / 60, slowInput, flatPhysics, audio);
  const slowDist = p.x - startSlow;
  assert.equal(p.briskLow, false);

  const fastInput = axes(1, 0);
  fastInput.keys.ShiftLeft = true;
  const startFast = p.x;
  for (let i = 0; i < 60; i++) p.updateMovement(1 / 60, fastInput, flatPhysics, audio);
  const fastDist = p.x - startFast;
  assert.equal(p.briskLow, true);
  assert.equal(p.sprinting, false);
  assert.equal(p.sneaking, true);
  assert.ok(fastDist > slowDist * 1.7 && fastDist > 3.3, `slow=${slowDist.toFixed(2)}, fast=${fastDist.toFixed(2)}`);
});

test('hit enemies stay upright and never crouch-walk while retreating or fleeing', () => {
  for (const type of ['gunman', 'thug', 'soldier']) {
    const { enemy, manager, ctx } = encounter(type, 10);
    enemy.brave = false;
    enemy.sees = true;
    enemy.ang = Math.PI;
    // Non-lethal body hit (~45% HP remaining): must NOT immediately squat-walk away
    const dmg = Math.round(enemy.max * 0.45);
    manager.hitEnemy(enemy, dmg, 1, 0, 1.2, ctx, false, 0, 'torso');
    let crouchWalkFrames = 0;
    for (let f = 0; f < 180; f++) {
      manager.update(1 / 60, ctx);
      if (enemy.moving && enemy.duck) crouchWalkFrames++;
    }
    assert.equal(crouchWalkFrames, 0, `${type} crouch-walked after moderate hit`);
  }

  // Even a critically wounded enemy hustling to shelter runs upright (duck === false while moving)
  const crit = encounter('soldier', 10);
  crit.enemy.brave = false;
  crit.enemy.sees = true;
  crit.enemy.ang = Math.PI;
  crit.enemy.hp = Math.ceil(crit.enemy.max * 0.25);
  crit.manager.hitEnemy(crit.enemy, 1, 1, 0, 1.2, crit.ctx, false, 0, 'torso');
  let critCrouchWalk = 0;
  for (let f = 0; f < 240; f++) {
    crit.manager.update(1 / 60, crit.ctx);
    if (crit.enemy.moving && crit.enemy.duck) critCrouchWalk++;
  }
  assert.equal(critCrouchWalk, 0, 'critically wounded enemy must run upright to cover, not crouch-walk');
});

test('shotgun loads shell-by-shell and rolling cancels an incomplete reload cleanly', () => {
  const p = new PlayerController();
  p.unlockWeapon(5, true); // Winchester M1897 shotgun (mag 6)
  p.resetForLevel(10, 10);
  p.mags[5] = 2;
  p.res[5] = 10;
  p.reload(audio);
  assert.ok(p.reloadT > 0 && p.reloadT < 0.5, 'shotgun starts single-shell cycle');
  // Advance 0.42s -> inserts 1 shell (2 -> 3) and chains next shell
  for (let i = 0; i < 26; i++) p.stepReload(1 / 60, audio);
  assert.equal(p.mags[5], 3);
  assert.equal(p.res[5], 9);
  assert.ok(p.reloadT > 0, 'chains next shell until full');
  // Rolling immediately cancels the remaining reload
  p.roll(axes(1, 0), audio);
  assert.equal(p.reloadT, 0);
  assert.equal(p.reloadDur, 0);
});

test('boss holds fire during first-sight grace and telegraphs shotgun scatter before firing moderated pellets', () => {
  const { level, enemy, player, ctx, manager, advance } = encounter('boss', 14);
  enemy.awake = false;
  enemy.ang = Math.PI;
  const shots = [];
  const notices = [];
  ctx.callbacks.shootBullet = (_x, _y, _z, _dx, _dy, _dz, _sp, dmg) => shots.push(dmg);
  ctx.callbacks.say = text => notices.push(text);
  ctx.callbacks.addShake = () => {};

  // Waking the boss gives an opening grace beat so the player isn't deleted before spotting him
  manager.wake(level, enemy);
  advance(0.8);
  assert.equal(shots.length, 0, 'boss should not insta-fire within the first 0.8s of waking');

  // Scatter timer does not pre-charge behind walls
  enemy.ringT = 1.0;
  enemy.seeT = 0;
  level.los3 = () => false;
  advance(2.0);
  assert.ok(enemy.ringT >= 0.99, `scatter timer must not drain out of sight (ringT=${enemy.ringT})`);

  // Once in sight, scatter telegraphs first before firing 6 moderated pellets (4 dmg each)
  level.los3 = () => true;
  enemy.sees = true;
  enemy.ringT = 0.05;
  enemy.cd = 5;
  enemy.burst = 0;
  shots.length = 0;
  advance(0.2);
  assert.ok(enemy.ringWindupT > 0, 'scatter enters visible telegraph windup first');
  assert.equal(shots.length, 0, 'no instant scatter bullets during telegraph');
  assert.ok(notices.some(t => t.includes('霰弹齐射')));

  advance(0.85);
  assert.equal(shots.length, 6, 'moderated 6-pellet scatter');
  assert.ok(shots.every(dmg => dmg === 4), `each pellet deals 4 dmg (got ${shots})`);
});

test('boss flanks around cover, drops static post, resists body stunlock, and flushes corner-campers with grenades', () => {
  const { level, enemy, player, ctx, manager, advance } = encounter('boss', 12);
  enemy.p2 = true;
  enemy.post = { x: enemy.x, z: enemy.z };
  enemy.cover = enemy.post;
  enemy.nadeCd = 0;
  enemy.sees = false;
  enemy.seeT = 99;
  const nades = [];
  const notices = [];
  ctx.callbacks.spawnGrenade = (x, y, z, vx, vy, vz) => nades.push({ x, y, z, vx, vy, vz });
  ctx.callbacks.say = text => notices.push(text);
  ctx.callbacks.puff = () => {};

  // Player corner-peeks and hits boss twice while boss has no center LOS
  level.los3 = () => false;
  manager.hitEnemy(enemy, 15, 1, 0, 1.3, ctx, false, 0, 'torso');
  assert.equal(enemy.post, null, 'boss abandons static Phase-2 cover when corner-pecked');
  assert.ok(enemy.lastSeen, 'boss registers shooter position');
  // Second body shot inside poise cooldown does not stunlock boss
  manager.hitEnemy(enemy, 15, 1, 0, 1.3, ctx, false, 0, 'torso');
  assert.ok(enemy.staggerT <= 0.23, `poise resists body stunlock (staggerT=${enemy.staggerT})`);

  // Boss actively flanks toward lastSeen and lobs a cover-flushing grenade even with !sees
  const startX = enemy.x;
  const startZ = enemy.z;
  advance(0.5);
  assert.ok(Math.hypot(enemy.x - startX, enemy.z - startZ) > 0.6, 'boss actively flanks instead of freezing');
  assert.equal(nades.length, 1, 'boss throws a flushing grenade at hidden corner-camper');
  assert.ok(notices.some(t => t.includes('手雷')));
});

test('single cold-weapon Chapter 1 builds enclosed Boss Room, zero firearm drops, and blade-only hero', () => {
  assert.equal(LEVELS.length, 1, 'campaign keeps only Chapter 1');
  assert.equal(LEVELS[0].coldOnly, true, 'Chapter 1 is pure cold-weapon mode');
  const level = new LevelState();
  level.generate(0);
  assert.ok(MW >= 48 && level.MH >= 148);
  assert.ok(level.boss && level.boss.scale >= 1.65, 'Chapter 1 spawns towering cold-weapon Boss');
  assert.equal(level.boss.bossDormant, true, 'Boss waits dormant inside enclosed Boss Room');
  assert.ok(level.bossRoom && level.bossRoom.gateX > 0 && level.bossRoom.gateZ > 0, 'defines enclosed Boss Room and Fog Gate');
  assert.equal(level.boss.bossCfg?.dropWeaponIdx, undefined, 'zero firearm drops');

  // Fresh start begins pure blade-only with zero firearms
  const p = new PlayerController();
  p.resetForLevel(10, 10);
  assert.equal(p.hasGun, false, 'starts without firearms');
  assert.equal(p.melee, true, 'starts with blade drawn');
  assert.equal(p.loadout.length, 0, 'empty initial holster');
  assert.equal(p.unlockedWeapons.length, 0, 'no firearms unlocked at start');
  p.reload(audio); // safely no-op when blade-only
  assert.equal(p.reloadT, 0);
});

test('tactical cold-weapon encounter density, camera impact decay, and heavy corpse knockback impulse', () => {
  const level = new LevelState();
  level.generate(0);
  assert.ok(level.totalEnemies >= 16 && level.totalEnemies <= 24, `Chapter 1 enlarged encounter count=${level.totalEnemies}`);

  const p = new PlayerController();
  p.resetForLevel(10, 10);
  p.addCameraImpact({ fov: 3.4, roll: 0.03, back: 0.14 });
  assert.ok(p.fovKick > 3 && p.camRoll > 0.025 && p.camBack > 0.12);
  const physicsStub = { movePlayer: (dx, dy, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz, grounded: true }) };
  for (let f = 0; f < 60; f++) p.updateMovement(1 / 60, axes(0, 0), physicsStub, audio);
  assert.equal(p.fovKick, 0, 'camera FOV kick decays cleanly back to rest');
  assert.equal(p.camRoll, 0, 'camera roll decays cleanly back to rest');
  assert.equal(p.camBack, 0, 'camera back-kick decays cleanly back to rest');

  const { enemy, ctx, manager } = encounter('gunman', 6);
  let corpseSlide = 0;
  enemy.mesh = {
    position: { y: 0 },
    userData: {
      glint: { visible: true },
      gun: { visible: true },
      mat: { emissive: { setHex() {} } },
      pivot: { rotation: { z: 0 }, position: { set() {} } }
    }
  };
  ctx.physics.spawnCorpseBody = (_m, _x, _z, _a, _ds, _px, _pz, _sc, slide) => { corpseSlide = slide; };
  ctx.callbacks.onEnemyKilled = () => {};
  ctx.callbacks.dropAt = () => {};
  ctx.hitImpulse = 10.2;
  manager.hitEnemy(enemy, 999, 1, 0, 1.2, ctx, false, 0, 'torso');
  assert.ok(corpseSlide >= 10, `heavy hitImpulse launches corpse cleanly (slide=${corpseSlide})`);
});
