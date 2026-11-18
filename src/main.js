import * as THREE from 'three';
import {
  LEVELS,
  WEAPONS,
  MW,
  TILE,
  TAU,
  GROUP_WORLD,
  GROUP_PROP,
  GROUP_ENEMY,
  GROUP_DEBRIS,
  GROUP_HANGING
} from './config/constants.js';
import { AudioManager } from './core/AudioManager.js';
import { InputManager } from './core/InputManager.js';
import { AssetManager } from './core/AssetManager.js';
import { GameRenderer, createFuelPoolMaterial } from './core/Renderer.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { LevelState } from './world/LevelGenerator.js';
import { ArchitectureBuilder } from './world/ArchitectureBuilder.js';
import { PropsBuilder } from './world/PropsBuilder.js';
import { WeaponFactory, WEAPON_TIPS } from './entities/WeaponFactory.js';
import { CharacterFactory } from './entities/CharacterFactory.js';
import { PlayerController } from './entities/Player.js';
import { EnemyManager } from './entities/EnemyManager.js';
import { HudRenderer } from './ui/HudRenderer.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const glCv = document.getElementById('gl');
const hudCv = document.getElementById('hud');
const ui = document.getElementById('ui');
const armoryEl = document.getElementById('armory');
const touchUI = document.getElementById('touch');

const audio = new AudioManager();
const assets = new AssetManager();
const physics = new PhysicsWorld();
const level = new LevelState();
const P = new PlayerController();
const enemyMgr = new EnemyManager();
const hud = new HudRenderer(hudCv);

let gr = null;
let wf = null;
let cf = null;
let archBuilder = null;
let propsBuilder = null;
let input = null;

let worldGroup = null;
let tileMesh = {};
let tileColliders = {};
let barrelsByTile = {};
let decals = [];
let holes = [];
let exitMesh = null;
let playerMesh = null;

let state = 'boot';
let lvl = 0;
let time = 0;
let score = 0;
let kills = 0;
let best = 0;
try { best = +localStorage.getItem('hsgq_best') || 0; } catch {}

let banner = 0;
let flowT = 0;
let msg = '';
let msgT = 0;
let radioMsg = '';
let radioT = 0;
let dialogueQueue = [];
let lightningT = 6.5;
let lightningFlash = 0;
let steamSprites = [];
let blastClouds = [];
let shockwaves = [];
let prevArmoryState = 'menu';
let armorySlot = 0;
let bossConfronted = false;
let reloadSpeakCd = 0;
let execTarget = null;
let shake = 0;
let hurtFlash = 0;
let hurtAng = null;
let muzzle = 0;
let aimHit = false;
let hitMark = 0;
let killMark = 0;
let headMark = 0;
let planted = 0;
let timeLeft = 0;
let overMsg = '';
let lampT = 0;
let fps = 60;
let fpsAccum = 0;
let fpsFrames = 0;

let bullets = [];
let pickups = [];
let parts = [];
let rings = [];
let fires = [];
let nades = [];
const casePool = [];
let caseI = 0;
const colCache = {};

function getCol(c) {
  return colCache[c] || (colCache[c] = new THREE.Color(c));
}

function say(t) {
  msg = t;
  msgT = 2.1;
}

function radio(t, dur = 4.2) {
  radioMsg = t;
  radioT = dur;
}

function queueDialogue(lines) {
  if (!lines?.length) return;
  dialogueQueue.push(...lines);
  if (radioT <= 0) {
    const next = dialogueQueue.shift();
    if (next) radio(next[0], next[1]);
  }
}

function saveBest() {
  if (score > best) {
    best = score;
    try { localStorage.setItem('hsgq_best', best); } catch {}
  }
}

function puff(x, y, z, n, col, sp, life) {
  for (let i = 0; i < n && parts.length < 560; i++) {
    const a = rnd(0, TAU);
    const s = rnd(0.2, 1) * sp;
    parts.push({
      x,
      y,
      z,
      vx: Math.cos(a) * s,
      vy: rnd(-0.2, 1) * sp,
      vz: Math.sin(a) * s,
      life: life * rnd(0.5, 1),
      col
    });
  }
}

function decal(x, z, r, scorch = false) {
  if (!worldGroup) return;
  const m = new THREE.Mesh(gr.G.circ, scorch ? gr.M.scorch : gr.M.blood);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = rnd(0, TAU);
  m.scale.set(r, r * rnd(0.6, 1), 1);
  m.position.set(x, 0.02 + (decals.length % 20) * 0.0015, z);
  worldGroup.add(m);
  decals.push(m);
  if (decals.length > 90) worldGroup.remove(decals.shift());
}

function bulletHole(px, py, pz, nx, ny, nz) {
  if (!worldGroup) return;
  const m = new THREE.Mesh(gr.G.circ, gr.M.scorch);
  m.scale.setScalar(rnd(0.032, 0.055));
  m.position.set(px + nx * 0.015, py + ny * 0.015, pz + nz * 0.015);
  m.lookAt(px + nx * 2, py + ny * 2, pz + nz * 2);
  worldGroup.add(m);
  holes.push(m);
  if (holes.length > 80) worldGroup.remove(holes.shift());
}

function dropAt(x, z, forced) {
  const r = Math.random();
  let t = forced;
  if (!t) t = r < 0.26 ? 'med' : r < 0.5 ? 'smg' : r < 0.66 ? 'shell' : r < 0.78 ? 'nade' : r < 0.9 ? 'molo' : 'armor';
  const col = { med: 0xf0f0f0, smg: 0x5a8a3a, shell: 0xc0392b, nade: 0x3c4a2c, rifle: 0x8a5a2a, molo: 0xff7a20, armor: 0x3a6ac0 }[t];
  const g = new THREE.Group();
  const mm = new THREE.MeshStandardMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 0.9,
    roughness: 0.45
  });
  mm.userData.own = true;

  if (t === 'nade' || t === 'molo') {
    const s = new THREE.Mesh(gr.G.sphLo, mm);
    s.scale.setScalar(0.2);
    g.add(s);
  } else {
    const box = new THREE.Mesh(gr.G.box, mm);
    box.scale.set(0.5, 0.3, 0.34);
    box.castShadow = true;
    g.add(box);
  }

  if (t === 'med') {
    const c1 = new THREE.Mesh(gr.G.box, gr.M.glint);
    c1.scale.set(0.52, 0.1, 0.1);
    const c2 = new THREE.Mesh(gr.G.box, gr.M.glint);
    c2.scale.set(0.52, 0.26, 0.04);
    c2.rotation.x = Math.PI / 2;
    g.add(c1, c2);
  }

  const sp = new THREE.Sprite(gr.M.glowSprite);
  sp.scale.set(1.6, 1.6, 1);
  g.add(sp);
  g.position.set(x, 0.6, z);
  worldGroup.add(g);
  pickups.push({ x, z, type: t, t: 0, mesh: g, dead: false });
}

function damageTile(tx, tz, dmg, dirX = 0, dirY = 0.5, dirZ = 0) {
  const k = tz * MW + tx;
  const g = level.grid[k];
  if (g !== 2 && g !== 3) return;
  level.tileHp[k] -= dmg;
  if (level.tileHp[k] > 0) return;

  level.grid[k] = 0;
  level.tileH[k] = 0;
  const wx = (tx + 0.5) * TILE;
  const wz = (tz + 0.5) * TILE;

  if (tileMesh[k]) {
    worldGroup.remove(tileMesh[k]);
    delete tileMesh[k];
  }
  if (tileColliders[k]) {
    physics.queueRemoveBody(tileColliders[k]);
    delete tileColliders[k];
  }

  if (g === 2) {
    puff(wx, 0.9, wz, 22, '#a0733f', 7.5, 0.7);
    audio.sfx('crate');
    propsBuilder.spawnCrateFracture(worldGroup, physics, wx, wz, dirX, dirY, dirZ, !level.lowTiles.has(k));
    if (Math.random() < 0.45) dropAt(wx, wz);
  } else {
    let bx = wx;
    let bz = wz;
    const links = barrelsByTile[k] || [];
    if (links.length && links[0].body) {
      const p = links[0].body.translation();
      bx = p.x;
      bz = p.z;
    }
    for (const l of links) {
      physics.removeDynamicLink(l, worldGroup);
    }
    delete barrelsByTile[k];
    explode(bx, bz, 6.6, 85);
  }
}

function explode(x, z, rad, dmg, foe = false) {
  audio.sfx('boom');
  shake = Math.max(shake, 0.9);
  puff(x, 0.7, z, 42, '#ffd670', 16.5, 0.65);
  puff(x, 1.1, z, 26, '#ff6820', 11.0, 0.75);
  decal(x, z, rad * 0.55, true);

  // Layer 1: Ground expanding shockwave ring
  const swm = new THREE.MeshBasicMaterial({
    color: 0xffc878,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const sw = new THREE.Mesh(gr.G.shockRing, swm);
  sw.position.set(x, 0.08, z);
  gr.scene.add(sw);
  shockwaves.push({ t: 0, dur: 0.34, max: rad * 1.45, mesh: sw, dead: false });

  // Layer 2: Volumetric fireball -> dark billowing smoke sprites
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rnd(-0.3, 0.3);
    const spR = i < 2 ? rnd(0, 0.4) : rnd(0.5, rad * 0.38);
    const mat = gr.M.smokeCloud.clone();
    mat.color.setHex(0xfff0b8);
    mat.opacity = 0.95;
    const sp = new THREE.Sprite(mat);
    const sx = x + Math.cos(a) * spR;
    const sz = z + Math.sin(a) * spR;
    const sy = 0.45 + rnd(0, 0.6);
    sp.position.set(sx, sy, sz);
    const baseScale = i < 2 ? 1.5 : 1.1;
    sp.scale.setScalar(baseScale);
    gr.scene.add(sp);
    blastClouds.push({
      mesh: sp,
      t: -i * 0.02,
      dur: rnd(1.05, 1.45),
      vx: Math.cos(a) * rnd(0.5, 2.1),
      vy: rnd(2.2, 3.6),
      vz: Math.sin(a) * rnd(0.5, 2.1),
      s0: baseScale,
      s1: rnd(3.4, 4.9),
      dead: false
    });
  }

  // Layer 3: Physical spinning charred shrapnel chunks
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(gr.G.box, gr.M.dark);
    const hx = rnd(0.12, 0.22);
    const hy = rnd(0.05, 0.1);
    const hz = rnd(0.14, 0.24);
    m.scale.set(hx * 2, hy * 2, hz * 2);
    m.castShadow = true;
    worldGroup.add(m);
    const a = rnd(0, TAU);
    const spd = rnd(4.5, 10.5);
    physics.spawnDynamicDebris(
      m,
      x + Math.cos(a) * 0.4,
      0.7 + rnd(0, 0.5),
      z + Math.sin(a) * 0.4,
      hx,
      hy,
      hz,
      Math.cos(a) * spd,
      rnd(4.5, 9.0),
      Math.sin(a) * spd,
      rnd(-12, 12),
      rnd(-12, 12),
      rnd(-12, 12),
      5.5
    );
  }

  gr.boomLight.position.set(x, 2.2, z);
  gr.boomLight.intensity = 65;

  physics.applyExplosionImpulse(x, 0.5, z, rad * 1.35, 16.0);

  const ctx = makeLogicCtx();
  for (const e of level.enemies) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < rad + e.r) {
      enemyMgr.hitEnemy(e, dmg * (1 - (d / (rad + e.r)) * 0.6), (e.x - x) / (d || 1), (e.z - z) / (d || 1), 1.0, ctx);
    }
  }
  const dp = Math.hypot(P.x - x, P.z - z);
  if (dp < rad) {
    hurtPlayer(dmg * (foe ? 0.8 : 0.45) * (1 - (dp / rad) * 0.6), x, z);
  }

  const t0 = Math.floor((x - rad) / TILE);
  const t1 = Math.floor((x + rad) / TILE);
  const u0 = Math.floor((z - rad) / TILE);
  const u1 = Math.floor((z + rad) / TILE);
  for (let tz = u0; tz <= u1; tz++) {
    for (let tx = t0; tx <= t1; tx++) {
      if (level.T(tx, tz) > 1 && Math.hypot((tx + 0.5) * TILE - x, (tz + 0.5) * TILE - z) < rad) {
        damageTile(tx, tz, dmg, (tx + 0.5) * TILE - x, 0.8, (tz + 0.5) * TILE - z);
      }
    }
  }
}

function ignite(x, z) {
  audio.sfx('molotov');
  decal(x, z, 2.9, true);
  puff(x, 0.4, z, 24, '#ff9a30', 9.5, 0.5);

  const grp = new THREE.Group();
  grp.position.set(x, 0, z);

  // Layer 1: Burning rippling liquid gasoline slick
  const poolMat = createFuelPoolMaterial(gr.timeUniform);
  poolMat.userData.own = true;
  const poolMesh = new THREE.Mesh(gr.G.circ, poolMat);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.scale.setScalar(2.65);
  poolMesh.position.y = 0.035;
  grp.add(poolMesh);

  // Layer 2: 12 Animated volumetric flame tongues across the burning patch
  const tongues = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + rnd(-0.2, 0.2);
    const rad = i < 3 ? rnd(0, 0.55) : rnd(0.65, 2.1);
    const fm = gr.M.fireTongue.clone();
    fm.userData.own = true;
    const sp = new THREE.Sprite(fm);
    const bx = Math.cos(ang) * rad;
    const bz = Math.sin(ang) * rad;
    const h0 = i < 3 ? rnd(1.7, 2.35) : rnd(1.0, 1.75);
    const w0 = h0 * rnd(0.55, 0.72);
    sp.position.set(bx, h0 * 0.44, bz);
    sp.scale.set(w0, h0, 1);
    grp.add(sp);
    tongues.push({ sp, bx, bz, w0, h0, ph: rnd(0, TAU) });
  }

  worldGroup.add(grp);
  fires.push({ x, z, t: 0, pt: 0, st: 0, group: grp, poolMat, tongues });
}

function hurtPlayer(d, sx, sz) {
  if (P.rollT > 0 || P.diveT > 0.47 || P.inv > 0 || state !== 'play' || d <= 0) return;
  if (P.armor > 0) {
    const a = Math.min(P.armor, d * 0.6);
    P.armor -= a;
    d -= a;
  }
  P.hp -= d;
  hurtFlash = 0.5;
  hurtAng = sx === undefined ? null : Math.atan2(sz - P.z, sx - P.x);
  shake = Math.max(shake, 0.45);
  audio.sfx('hurt');
  if (P.hp <= 0) {
    P.hp = 0;
    gameOver();
  }
}

function exitOpen() {
  const cfg = level.cfg;
  if (cfg.mission === 'boss') return !!(level.boss && level.boss.hp <= 0);
  if (cfg.mission === 'rescue') return !!(level.hostage && level.hostage.free);
  return planted >= 3;
}

function spawnGrenade(x, y, z, vx, vy, vz, isMolotov, foe = false) {
  const mesh = isMolotov
    ? new THREE.Mesh(gr.G.cylLo, gr.M.molo)
    : gr.nadePool.find(m => !m.visible) || new THREE.Mesh(gr.G.sphLo, gr.M.nade);

  if (isMolotov) {
    mesh.scale.set(0.06, 0.16, 0.06);
    mesh.castShadow = true;
    worldGroup.add(mesh);
  } else {
    mesh.scale.setScalar(0.11);
    mesh.visible = true;
  }
  const entry = physics.spawnProjectile(mesh, x, y, z, vx, vy, vz, isMolotov, { t: 0, foe, bounceCd: 0 });
  nades.push(entry);
  return entry;
}

function throwNade() {
  if (P.nades <= 0 || P.nadeCd > 0 || P.rollT > 0) return;
  P.nades--;
  P.nadeCd = 0.8;
  const pe = P.pitch - P.recoil - 0.3;
  const cp = Math.cos(pe);
  const c = Math.cos(P.ang);
  const s = Math.sin(P.ang);
  const v = 15;
  spawnGrenade(P.x + c * 0.5, P.y + (P.crouch ? 1.1 : 1.55), P.z + s * 0.5, c * cp * v, -Math.sin(pe) * v, s * cp * v, false, false);
}

function throwMolo() {
  if (P.molo <= 0 || P.nadeCd > 0 || P.rollT > 0) return;
  P.molo--;
  P.nadeCd = 0.8;
  const pe = P.pitch - P.recoil - 0.3;
  const cp = Math.cos(pe);
  const c = Math.cos(P.ang);
  const s = Math.sin(P.ang);
  const v = 14;
  spawnGrenade(P.x + c * 0.5, P.y + 1.55, P.z + s * 0.5, c * cp * v, -Math.sin(pe) * v, s * cp * v, true, false);
}

function shootBullet(x, y, z, dx, dy, dz, speed, dmg, pl) {
  bullets.push({
    x, y, z,
    px: x, py: y, pz: z,
    vx: dx * speed,
    vy: dy * speed,
    vz: dz * speed,
    ang: Math.atan2(dz, dx),
    dmg,
    pl,
    life: 2.5,
    dist: 0,
    near: false
  });
}

function spawnCasing(x, y, z, vx, vz) {
  const m = casePool[caseI++ % casePool.length];
  m.visible = true;
  m.userData = { x, y, z, vx, vz, vy: rnd(1.5, 2.8), t: 0, b: 0 };
}

function spawnFlyingHat(kind, x, y, z, dx, dz) {
  const hat = cf.createStandaloneHatMesh(kind);
  if (!hat) return;
  worldGroup.add(hat);
  physics.spawnDynamicDebris(
    hat,
    x,
    y,
    z,
    0.13,
    0.06,
    0.14,
    (dx || 0) * 3.8 + rnd(-1.4, 1.4),
    rnd(2.8, 4.4),
    (dz || 0) * 3.8 + rnd(-1.4, 1.4),
    rnd(-9, 9),
    rnd(-7, 7),
    rnd(-9, 9),
    8.0
  );
}

function spawnLive(type, x, z, fx, fz) {
  const e = level.spawnEnemy(type, x, z, 99);
  if (level.boxHit(e.x, e.z, e.r)) {
    e.x = fx;
    e.z = fz;
  }
  e.awake = true;
  e.mesh = cf.createPerson(type);
  worldGroup.add(e.mesh);
  e.phys = physics.createEnemyCollider(e, e.x, e.z, e.r, e.ht);
  level.totalEnemies++;
  return e;
}

function makeLogicCtx() {
  return {
    level,
    player: P,
    physics,
    audio,
    callbacks: {
      hurtPlayer,
      spawnGrenade,
      spawnLive,
      say,
      radio,
      poseCorpse: (m, dirSign) => cf.poseCorpse(m, dirSign),
      spawnFlyingHat,
      addShake: v => { shake = Math.max(shake, v); },
      shootBullet,
      puff,
      dropAt,
      explode,
      onEnemyKilled: (e, head) => {
        kills++;
        P.focus = Math.min(100, P.focus + (head ? 24 : 14));
        score += (e.type === 'boss' ? 2000 : e.type === 'officer' ? 300 : e.type === 'gunner' ? 200 : e.type === 'soldier' ? 150 : e.type === 'gunman' ? 100 : 50);
        decal(e.x, e.z, e.r * 1.4, false);
        puff(e.x, 1.1, e.z, 14, '#8e1a14', 7.5, 0.6);
      }
    }
  };
}

function disposeHierarchy(root) {
  if (!root) return;
  root.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton && !o.skeleton._disposed) {
      o.skeleton._disposed = true;
      o.skeleton.dispose();
    }
    if (!o.isSprite && o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m?.userData?.own) {
          if (m.userData.ownMap && m.map) m.map.dispose();
          m.dispose();
        }
      }
    }
  });
}

function buildLevelWorld(lvlIndex) {
  if (worldGroup) {
    gr.scene.remove(worldGroup);
    disposeHierarchy(worldGroup);
  }

  for (const r of rings) {
    gr.scene.remove(r.mesh);
    r.mesh.material.dispose();
  }
  rings = [];
  for (const b of blastClouds) {
    gr.scene.remove(b.mesh);
    b.mesh.material.dispose();
  }
  blastClouds = [];
  for (const sw of shockwaves) {
    gr.scene.remove(sw.mesh);
    sw.mesh.material.dispose();
  }
  shockwaves = [];
  for (const m of casePool) m.visible = false;
  for (const m of gr.nadePool) m.visible = false;

  bullets = [];
  nades = [];
  pickups = [];
  parts = [];
  fires = [];
  decals = [];
  holes = [];
  dialogueQueue = [];
  bossConfronted = false;
  execTarget = null;

  physics.reset();
  physics.onProjectileContact = (entry, other) => {
    if (entry.isMolotov && !entry.dead) {
      entry.dead = true;
      entry.mesh.visible = false;
      const p = entry.body.translation();
      ignite(p.x, p.z);
    } else if (!entry.isMolotov && entry.data.bounceCd <= 0) {
      const lv = entry.body.linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 1.4) {
        entry.data.bounceCd = 0.14;
        audio.sfx('tink');
      }
    }
  };

  level.generate(lvlIndex);
  const cfg = level.cfg;
  planted = 0;
  timeLeft = cfg.mission === 'demo' ? (cfg.demoTime || 300) : 0;

  worldGroup = new THREE.Group();
  gr.scene.add(worldGroup);
  gr.scene.background = new THREE.Color(cfg.sky);
  gr.scene.fog = new THREE.FogExp2(cfg.sky, cfg.fogDensity);

  const archRes = archBuilder.build(level, worldGroup, physics);
  gr.setReflectHideObjects(archRes.reflectHide);
  const propRes = propsBuilder.build(level, worldGroup, physics);
  tileMesh = propRes.tileMesh;
  tileColliders = propRes.tileColliders;
  barrelsByTile = propRes.barrelsByTile;
  steamSprites = propRes.steamSprites || [];

  // Exit beacon
  exitMesh = null;
  if (!cfg.boss) {
    const em = new THREE.MeshBasicMaterial({
      color: 0xb3261e,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    em.userData.own = true;
    exitMesh = new THREE.Mesh(gr.G.beam, em);
    exitMesh.scale.set(1.6, 14, 1.6);
    exitMesh.position.set(level.exitPos.x, 7, level.exitPos.z);
    worldGroup.add(exitMesh);
  }

  // Characters & physics colliders
  for (const e of level.enemies) {
    e.mesh = cf.createPerson(e.type);
    worldGroup.add(e.mesh);
    e.phys = physics.createEnemyCollider(e, e.x, e.z, e.r, e.ht);
  }

  if (level.hostage) {
    level.hostage.mesh = cf.createPerson('hostage');
    level.hostage.mesh.userData.gun.visible = false;
    worldGroup.add(level.hostage.mesh);
  }

  for (const c of level.charges) {
    const m = assets.glb.crate.clone();
    m.scale.setScalar(1.5);
    m.position.set(c.x, 0, c.z);
    m.rotation.y = rnd(0, TAU);
    worldGroup.add(m);

    const bm = new THREE.MeshBasicMaterial({
      color: 0x40ff80,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    bm.userData.own = true;
    c.mesh = new THREE.Mesh(gr.G.beam, bm);
    c.mesh.scale.set(0.7, 9, 0.7);
    c.mesh.position.set(c.x, 4.5, c.z);
    worldGroup.add(c.mesh);
  }

  // Player mesh & Rapier capsule controller
  if (playerMesh) {
    gr.scene.remove(playerMesh);
    disposeHierarchy(playerMesh);
  }
  playerMesh = cf.createPerson('hero', WEAPONS[P.gun].modelKey);
  P.mesh = playerMesh;
  gr.scene.add(playerMesh);

  P.resetForLevel(level.startPos.x, level.startPos.z);
  physics.createPlayer(P.x, P.y, P.z);
  physics.warmupStep();

  kills = 0;
  banner = 3.2;
  shake = 0;
  hurtFlash = 0;
  flowT = 0;
  lampT = 0;
  radioT = 0;
  lightningT = 6.5;
  lightningFlash = 0;
  P.bulletTime = false;
  P.btK = 0;
  P.diveT = 0;
  overMsg = '';
  level.computeFlow(P.x, P.z);
}

function startLevel(idx) {
  lvl = idx;
  buildLevelWorld(idx);
  state = 'play';
  ui.hidden = true;
  armoryEl.hidden = true;
  input.lockPointer();
  audio.startRain();
  audio.setEnvironment(level.cfg.style);
  audio.playMusic(level.cfg.music);
  const reply =
    idx === 0
      ? '沈孤鸿：「下雨天最适合办事……黑龙帮，今晚算总账。」'
      : idx === 1
        ? '沈孤鸿：「江面风大，巡逻的枪声盖得住——行动。」'
        : '沈孤鸿：「黑龙，十年恩怨，就在这间货栈做个了断。」';
  if (level.cfg.intro) queueDialogue([[level.cfg.intro, 4.4], [reply, 3.6]]);
}

function newGame() {
  score = 0;
  P.resetAll(true);
  startLevel(0);
}

function findExecTarget() {
  let best = null;
  let bd = 2.75;
  for (const e of level.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - P.x, e.z - P.z);
    if (d > bd) continue;
    if (!level.los(P.x, P.z, e.x, e.z)) continue;
    const dirDot = ((P.x - e.x) * Math.cos(e.ang) + (P.z - e.z) * Math.sin(e.ang)) / (d || 1);
    const behind = dirDot < -0.15;
    const vulnerable =
      !e.awake ||
      behind ||
      e.stun > 0 ||
      e.type === 'thug' ||
      (e.type === 'boss' ? e.hp <= e.max * 0.18 : e.hp <= e.max * 0.65);
    if (vulnerable) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function tryExecute() {
  if (state !== 'play' || P.execT > 0 || P.rollT > 0) return;
  const e = findExecTarget();
  if (!e) {
    say('靠近背后、虚弱或硬直中的敌人按 [E] 处决');
    return;
  }
  const dx = e.x - P.x;
  const dz = e.z - P.z;
  const d = Math.hypot(dx, dz) || 1;
  const ndx = dx / d;
  const ndz = dz / d;
  const stealth = !e.awake;

  // Collision-safe lunge close to target
  if (d > 1.05) {
    const moveDist = Math.min(d - 0.95, 1.4);
    physics.movePlayer(ndx * moveDist, 0, ndz * moveDist);
    const pos = physics.playerBody?.translation();
    if (pos) {
      P.x = pos.x;
      P.z = pos.z;
    }
  }

  P.ang = Math.atan2(ndz, ndx);
  P.execT = 0.58;
  P.inv = 0.78;
  P.focus = Math.min(100, P.focus + 25);
  P.hp = Math.min(100, P.hp + 12);
  shake = Math.max(shake, stealth ? 0.14 : 0.34);

  audio.playVoiceShout('exec', 1.2);
  audio.sfx(stealth ? 'stealthExec' : 'combatExec');

  if (stealth) e.awake = true; // Mark awake locally so hitEnemy won't alert nearby squadmates
  const ctx = makeLogicCtx();
  enemyMgr.hitEnemy(e, 999, ndx, ndz, e.ht * 0.92, ctx, !stealth);
  score += stealth ? 150 : 120;
  killMark = 0.45;
  say(stealth ? '悄声暗杀！专注+25 · 生命+12' : '近身处决！专注+25 · 生命+12');
  if (stealth) {
    radio('沈孤鸿：「无声放倒一个……别惊动弄堂里的其他人。」', 2.8);
  } else if (Math.random() < 0.6) {
    radio('沈孤鸿：「下辈子记住，别拿枪指着我的头。」', 2.6);
  }
}

function statPct(w) {
  const dmgP = clamp(Math.round(((w.dmg * w.pellets) / 100) * 100), 14, 100);
  const rofP = clamp(Math.round((0.08 / w.rate) * 100), 8, 100);
  const accP = clamp(Math.round((1 - w.spread / 0.085) * 100), 15, 100);
  const magP = clamp(Math.round((w.mag / 50) * 100), 10, 100);
  return { dmgP, rofP, accP, magP };
}

function renderArmory() {
  const slotHtml = [0, 1, 2]
    .map(i => {
      const wIdx = P.loadout[i];
      const w = wIdx !== undefined ? WEAPONS[wIdx] : null;
      const isActive = i === armorySlot;
      const resStr = w ? (P.res[wIdx] === Infinity ? '∞' : P.res[wIdx]) : '';
      return (
        `<button type="button" class="slot-card${isActive ? ' active-slot' : ''}" data-slot="${i}">` +
        `<span class="slot-num">0${i + 1}</span>` +
        `<div class="slot-info"><b>${w ? w.name : '空槽位'}</b><span>${w ? `${P.mags[wIdx]}/${resStr} · 点击选定替换位` : '点击下方枪械放入此位'}</span></div>` +
        `</button>`
      );
    })
    .join('');

  const gunHtml = WEAPONS.map((w, idx) => {
    const sIdx = P.loadout.indexOf(idx);
    const eq = sIdx !== -1;
    const { dmgP, rofP, accP, magP } = statPct(w);
    const prev = wf?.previews?.[w.modelKey] || '';
    const resStr = P.res[idx] === Infinity ? '无限' : P.res[idx];
    return (
      `<button type="button" class="gun-card${eq ? ' equipped' : ''}" data-gun="${idx}">` +
      `<div class="gun-top"><b>${w.fullName}</b>${eq ? `<span class="gun-badge">槽位 0${sIdx + 1}</span>` : ''}</div>` +
      (prev ? `<img class="gun-prev" src="${prev}" alt="${w.fullName}">` : '') +
      `<div class="gun-cal">${w.caliber} · 备弹 ${resStr}</div>` +
      `<div class="gun-desc">${w.desc}</div>` +
      `<div class="stat-grid">` +
      `<span>威力</span><div class="stat-bar"><i style="width:${dmgP}%"></i></div>` +
      `<span>射速</span><div class="stat-bar"><i style="width:${rofP}%"></i></div>` +
      `<span>精准</span><div class="stat-bar"><i style="width:${accP}%"></i></div>` +
      `<span>弹容</span><div class="stat-bar"><i style="width:${magP}%"></i></div>` +
      `</div></button>`
    );
  }).join('');

  armoryEl.innerHTML =
    `<div class="armory-panel">` +
    `<div class="armory-hdr"><div><h2>上海军械装备箱</h2><div class="armory-sub">从八款民国制式火器中任选 <b>最多 3 把</b> 随身携带（点击已装备可卸下，点击未装备填入或替换当前选中槽位）</div></div>` +
    `<button type="button" class="btn-sec" id="armCloseTop">确认出战 [Esc/B]</button></div>` +
    `<div class="slot-bar">${slotHtml}</div>` +
    `<div class="gun-grid">${gunHtml}</div>` +
    `<div class="armory-ftr"><button type="button" class="go" id="armConfirm">携带所选三把火器出发</button></div>` +
    `</div>`;

  armoryEl.querySelectorAll('.slot-card').forEach(btn => {
    btn.onclick = () => {
      armorySlot = +btn.dataset.slot;
      audio.sfx('tick');
      renderArmory();
    };
  });

  armoryEl.querySelectorAll('.gun-card').forEach(btn => {
    btn.onclick = () => {
      const idx = +btn.dataset.gun;
      const curSlot = P.loadout.indexOf(idx);
      if (curSlot !== -1) {
        if (P.loadout.length <= 1) {
          say('至少需保留一把随身火器');
          return;
        }
        P.loadout.splice(curSlot, 1);
        if (P.slot >= P.loadout.length) P.slot = P.loadout.length - 1;
        armorySlot = Math.min(armorySlot, P.loadout.length - 1);
      } else if (P.loadout.length < 3) {
        P.loadout.push(idx);
        P.slot = P.loadout.length - 1;
        armorySlot = P.slot;
      } else {
        const rep = clamp(armorySlot, 0, 2);
        P.loadout[rep] = idx;
        P.slot = rep;
      }
      P.gun = P.loadout[P.slot];
      if (playerMesh) cf.setGun(playerMesh, WEAPONS[P.gun].modelKey);
      audio.sfx('tick');
      renderArmory();
    };
  });

  document.getElementById('armCloseTop').onclick = closeArmory;
  document.getElementById('armConfirm').onclick = closeArmory;
}

function openArmory() {
  if (state === 'armory') {
    closeArmory();
    return;
  }
  prevArmoryState = state;
  state = 'armory';
  ui.hidden = true;
  armoryEl.hidden = false;
  input.mouse.down = input.mouse.right = false;
  input.exitPointerLock();
  renderArmory();
}

function closeArmory() {
  if (state !== 'armory') return;
  armoryEl.hidden = true;
  state = prevArmoryState || 'menu';
  if (state === 'play') {
    ui.hidden = true;
    input.lockPointer();
  } else {
    ui.hidden = false;
  }
}

function panel(html, btn, cb, armBtn = false) {
  const sec = armBtn ? '<button class="btn-sec" id="armOpenBtn" type="button">军械装备箱（选枪预览 · 最多3把）</button>' : '';
  ui.innerHTML = `<div class="panel">${html}${sec}<button class="go" id="goBtn" type="button">${btn}</button></div>`;
  ui.hidden = false;
  input.exitPointerLock();
  const b = document.getElementById('goBtn');
  b.onclick = () => { audio.init(); cb(); };
  const ab = document.getElementById('armOpenBtn');
  if (ab) ab.onclick = () => { audio.init(); openArmory(); };
  b.focus();
}

function menu() {
  state = 'menu';
  panel(
    '<div class="sub">Shanghai · 1937</div><h1>沪上孤枪</h1>' +
    '<p>黑龙帮盘踞闸北，码头夜夜卸下军火。<b>八款民国火器任选三把，一人穿巷过街，了结帮主“黑龙”。</b></p>' +
    '<div class="keys"><span>WASD · C · 空格</span><span>移动（含实感脚步声）· 蹲伏潜行 · 跳跃</span><span>鼠标左 / 右键</span><span>精准开火 · 长按右键肩射精准瞄准</span><span>E · G · F</span><span>近身处决/背后暗杀 · 手雷 · 燃烧瓶</span>' +
    '<span>1 2 3 / Q · B</span><span>切换三把随身火器 · 打开八枪军械装备栏</span><span>Tab / V · 右键+Shift</span><span>子弹时间（0.28x 慢镜）· 飞身鱼跃慢镜射击</span><span>R · P · M · H</span><span>换弹 · 暂停 · 暗黑风潮氛围声 · 画质切换</span>' +
    '<span>触屏</span><span>左半屏移动，右半屏滑动转向，点击军械/处决按钮操作</span></div>' +
    (best ? `<p>最高分 <b>${best}</b></p>` : '') +
    '<p class="credit">引擎：Three.js r187 + Rapier3D WASM 物理引擎<br>模型与贴图：Poly Haven、OpenGameArt（CC0）　枪声：The Free Firearm Sound Library + WebAudio 物理混响</p>',
    '开 始',
    newGame,
    true
  );
}

function gameOver() {
  state = 'over';
  saveBest();
  panel(
    `<h2>${overMsg ? '任务失败' : '壮烈牺牲'}</h2><p>${overMsg || `你倒在了${level.cfg.name.split('· ')[1]}。上海的夜还很长。`}</p>` +
    `<div class="stats"><div><b>${score}</b>得分</div><div><b>${best}</b>最高分</div></div>`,
    '再来一次',
    newGame
  );
}

function levelClear() {
  audio.sfx('win');
  for (const c of level.charges) explode(c.x, c.z, 5.6, 0);
  const bonus = 500 + Math.round(P.hp) * 5;
  score += bonus;
  if (lvl >= LEVELS.length - 1) {
    state = 'win';
    saveBest();
    panel(
      '<div class="sub">The End</div><h2>黑龙伏诛</h2><p>货仓的火烧了一夜。天亮时，码头上再没有黑龙帮的旗。</p>' +
      `<div class="stats"><div><b>${score}</b>总分</div><div><b>${best}</b>最高分</div></div>`,
      '重新开始',
      newGame
    );
    return;
  }
  state = 'clear';
  panel(
    `<h2>${level.cfg.name.split('· ')[1]} 已肃清</h2><p>歼敌 <b>${kills} / ${level.totalEnemies}</b>　过关奖励 <b>+${bonus}</b></p><p>${LEVELS[lvl + 1].intro}</p>`,
    '下一关',
    () => {
      lvl++;
      P.hp = Math.min(100, P.hp + 35);
      P.nades = Math.max(P.nades, 2);
      startLevel(lvl);
    },
    true
  );
}

function togglePause() {
  if (state === 'armory') {
    closeArmory();
    return;
  }
  if (state === 'play') {
    state = 'pause';
    panel(
      `<h2>暂停</h2><p>${level.cfg.name}</p>`,
      '继续',
      () => {
        state = 'play';
        ui.hidden = true;
        input.lockPointer();
      },
      true
    );
  } else if (state === 'pause') {
    state = 'play';
    ui.hidden = true;
    input.lockPointer();
  }
}

function updatePlay(dt) {
  if (P.bulletTime) {
    P.focus = Math.max(0, P.focus - dt * 22);
    if (P.focus <= 0) {
      P.bulletTime = false;
      audio.sfx('slowoff');
    }
  } else if (P.diveT <= 0) {
    P.focus = Math.min(100, P.focus + dt * 6.5);
  }
  const slowActive = P.bulletTime || P.diveT > 0;
  P.btK += ((slowActive ? 1 : 0) - P.btK) * Math.min(1, dt * 12);
  const simDt = slowActive ? dt * 0.28 : dt;
  const playerDt = slowActive ? dt * 0.52 : dt;

  time += simDt;
  if (banner > 0) banner -= dt;
  if (msgT > 0) msgT -= dt;
  if (reloadSpeakCd > 0) reloadSpeakCd -= dt;
  if (radioT > 0) {
    radioT -= dt;
    if (radioT <= 0 && dialogueQueue.length) {
      const next = dialogueQueue.shift();
      radio(next[0], next[1]);
    }
  }
  if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
  if (hurtFlash > 0) hurtFlash -= dt;
  if (hitMark > 0) hitMark -= dt;
  if (killMark > 0) killMark -= dt;
  if (headMark > 0) headMark -= dt;

  lightningT -= simDt;
  if (lightningT <= 0) {
    lightningT = rnd(11, 22);
    lightningFlash = 1.0;
    const delayMs = rnd(280, 680);
    setTimeout(() => {
      if (state === 'play' || state === 'menu') {
        audio.sfx('thunder');
        shake = Math.max(shake, 0.14);
      }
    }, delayMs);
  }
  if (lightningFlash > 0) lightningFlash = Math.max(0, lightningFlash - dt * 2.2);

  P.updateMovement(playerDt, input, physics, audio, (x, y, z) => {
    puff(x, y + 0.08, z, 8, '#8f8a80', 3.5, 0.4);
  }, level.cfg.style);
  execTarget = findExecTarget();

  if (!bossConfronted && level.boss && level.boss.hp > 0 && level.boss.awake) {
    bossConfronted = true;
    queueDialogue([
      ['黑龙：「沈孤鸿！坏我十桩买卖，今夜把命留在这儿！」', 3.4],
      ['沈孤鸿：「废话留着去黄泉说吧。」', 2.8]
    ]);
  }

  const aim = P.aim3D(gr.camera, physics);
  aimHit = aim.hit;
  let firing = input.mouse.down || input.touchFire;

  if (input.isTouch) {
    if (aim.hit && aim.d < 35) firing = true;
    else {
      let bd = 0.16;
      let bdf = 0;
      for (const e of level.enemies) {
        if (e.hp <= 0 || !e.awake) continue;
        const d = Math.hypot(e.x - P.x, e.z - P.z);
        if (d > 30) continue;
        const df = ((Math.atan2(e.z - P.z, e.x - P.x) - P.ang + Math.PI * 3) % TAU) - Math.PI;
        if (Math.abs(df) < bd && level.los(P.x, P.z, e.x, e.z)) {
          bd = Math.abs(df);
          bdf = df;
        }
      }
      P.ang += clamp(bdf, -playerDt * 1.2, playerDt * 1.2);
    }
  }

  const g = WEAPONS[P.gun];
  if (P.reloadT > 0) {
    P.reloadT -= playerDt;
    if (P.reloadT <= 0) {
      const need = g.mag - P.mags[P.gun];
      const take = Math.min(need, P.res[P.gun]);
      P.mags[P.gun] += take;
      P.res[P.gun] -= take;
    }
  } else if (P.mags[P.gun] <= 0) {
    if (P.res[P.gun] > 0) {
      P.reload(audio);
      if (reloadSpeakCd <= 0 && level.enemies.some(e => e.hp > 0 && e.awake && Math.hypot(e.x - P.x, e.z - P.z) < 22)) {
        reloadSpeakCd = 16;
        radio('沈孤鸿：「弹匣见底……掩护换弹！」', 2.2);
      }
    } else {
      P.nextGun(cf, audio, say);
    }
  }

  if (firing && P.cd <= 0 && P.reloadT <= 0 && P.rollT <= 0 && P.execT <= 0 && P.mags[P.gun] > 0) {
    P.cd = g.rate;
    P.mags[P.gun]--;
    audio.sfx(g.snd);

    const c = Math.cos(P.ang);
    const s = Math.sin(P.ang);
    const mh = P.y + (P.crouch ? 1.0 : 1.42);
    const ox = P.x + c * 0.81 - s * 0.22;
    const oz = P.z + s * 0.81 + c * 0.22;

    let dx = aim.x - ox;
    let dy = aim.y - mh;
    let dz = aim.z - oz;
    let dl = Math.hypot(dx, dy, dz);
    if (dl < 1.5) {
      const pe = P.pitch - P.recoil;
      dx = c * Math.cos(pe);
      dy = -Math.sin(pe);
      dz = s * Math.cos(pe);
      dl = 1;
    }

    const spr = g.spread * (1 + P.bloom * 1.8) * (P.moving ? 1.4 : 1) * (1 - 0.55 * P.ads) * (P.crouch ? 0.7 : 1) * (P.air && P.diveT <= 0 ? 2.4 : 1);
    const a0 = Math.atan2(dz, dx);
    const e0 = Math.asin(clamp(dy / dl, -1, 1));
    for (let i = 0; i < g.pellets; i++) {
      const a = a0 + rnd(-spr, spr);
      const el = e0 + rnd(-spr, spr) * 0.7;
      const ce = Math.cos(el);
      shootBullet(ox, mh, oz, Math.cos(a) * ce, Math.sin(el), Math.sin(a) * ce, g.speed * rnd(0.96, 1.04), g.dmg, true);
    }

    const kk = g.kick * (1 - 0.35 * P.ads) * (P.crouch ? 0.8 : 1);
    muzzle = 1;
    shake = Math.max(shake, P.gun === 2 ? 0.22 : 0.05);
    P.recoil += kk * 0.65;
    P.pitch = clamp(P.pitch - kk * 0.35, -0.5, 0.75);
    P.ang += rnd(-1, 1) * kk * 0.5;
    P.bloom = Math.min(1.3, P.bloom + g.bloom);

    puff(ox + c * 0.5, mh, oz + s * 0.5, 2, '#8a8a8a', 1.4, 0.5);
    spawnCasing(P.x - s * 0.25, mh, P.z + c * 0.25, -s * 2.4 + rnd(-0.6, 0.6) - c * 0.5, c * 2.4 + rnd(-0.6, 0.6) - s * 0.5);

    for (const e of level.enemies) {
      if (!e.awake && Math.hypot(e.x - P.x, e.z - P.z) < 24) enemyMgr.wake(level, e, { radio });
    }
  }

  flowT -= simDt;
  if (flowT <= 0) {
    flowT = 0.3;
    level.computeFlow(P.x, P.z);
  }

  const logicCtx = makeLogicCtx();
  enemyMgr.update(simDt, logicCtx);

  // Advance 3D bullets with Rapier raycast collision
  for (const b of bullets) {
    b.life -= simDt;
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    const sp = Math.hypot(b.vx, b.vz);
    const stepLen = Math.hypot(sp, b.vy) * simDt;
    const subSteps = Math.max(1, Math.ceil(stepLen / 0.4));
    const ds = simDt / subSteps;

    for (let i = 0; i < subSteps && b.life > 0; i++) {
      const nextVy = b.vy - 9.8 * ds;
      const dx = b.vx * ds;
      const dy = nextVy * ds;
      const dz = b.vz * ds;
      const segLen = Math.hypot(dx, dy, dz) || 0.001;

      const hit = physics.castRay(
        b.x,
        b.y,
        b.z,
        dx,
        dy,
        dz,
        segLen,
        GROUP_WORLD | GROUP_PROP | GROUP_ENEMY | GROUP_HANGING | (b.pl ? GROUP_DEBRIS : 0),
        b.pl ? physics.playerCollider : null
      );

      if (hit) {
        const pt = hit.point;
        const n = hit.normal;
        const meta = hit.meta;

        if (meta?.kind === 'enemy' && b.pl) {
          const e = meta.enemy;
          if (e && e.hp > 0) {
            const k = e.ht / 1.8;
            const eTop = e.duck ? e.ht * 0.52 : e.ht;
            const head = pt.y > eTop - 0.3 * k;
            const mult = (head ? (e.type === 'soldier' ? 1.7 : 2.5) : pt.y < 0.85 * k ? 0.7 : 1) * clamp(1 - (b.dist - 22) / 70, 0.5, 1);
            const dirLen = Math.hypot(b.vx, b.vz) || 1;
            const imp = (g?.push || 3.0) * 0.032;
            enemyMgr.hitEnemy(e, b.dmg * mult, b.vx / dirLen, b.vz / dirLen, pt.y, logicCtx, head);
            level.moveEnt(e, (b.vx / dirLen) * (0.08 + imp), (b.vz / dirLen) * (0.08 + imp));
            hitMark = 0.16;
            if (head) headMark = 0.3;
            if (e.hp <= 0) killMark = 0.4;
            audio.sfx(head && e.type === 'soldier' ? 'ping' : 'tick');
            b.life = 0;
            break;
          }
        } else if (meta?.kind === 'corpse' && b.pl) {
          const pushScale = (g?.push || 3.0) / 3.0;
          meta.body.wakeUp();
          meta.body.applyImpulseAtPoint({ x: (dx / segLen) * 2.8 * pushScale, y: 0.45 * pushScale, z: (dz / segLen) * 2.8 * pushScale }, pt, true);
          puff(pt.x, pt.y, pt.z, 4, '#8e1a14', 3.8, 0.35);
          b.life = 0;
          break;
        } else if (meta?.kind === 'lantern') {
          const broken = physics.hitLantern(meta.entry, dx * 20, 1.5, dz * 20, 2.2);
          puff(pt.x, pt.y, pt.z, 12, '#ff6830', 6.5, 0.45);
          if (broken) audio.sfx('glass');
          b.life = 0;
          break;
        } else if (meta?.kind === 'metal') {
          puff(pt.x, pt.y, pt.z, 9, '#ffe296', 8.5, 0.22);
          audio.sfx('ricochet');
          bulletHole(pt.x, pt.y, pt.z, n.x, n.y, n.z);
          b.life = 0;
          break;
        } else if (meta?.kind === 'barrel') {
          const rb = hit.collider.parent();
          if (rb) {
            const pushScale = (g?.push || 3.0) / 3.0;
            rb.wakeUp();
            rb.applyImpulseAtPoint({ x: (dx / segLen) * 4.5 * pushScale, y: 0.6 * pushScale, z: (dz / segLen) * 4.5 * pushScale }, pt, true);
          }
          puff(pt.x, pt.y, pt.z, 7, '#ffd27a', 7.2, 0.2);
          audio.sfx('ricochet');
          damageTile(meta.tx, meta.tz, b.dmg, dx / segLen, dy / segLen, dz / segLen);
          b.life = 0;
          break;
        } else if (meta?.kind === 'crate') {
          puff(pt.x, pt.y, pt.z, 6, '#c9a060', 6, 0.25);
          damageTile(meta.tx, meta.tz, b.dmg, dx / segLen, dy / segLen, dz / segLen);
          b.life = 0;
          break;
        } else {
          // Ground wet splash or stone/brick wall impact
          if (pt.y < 0.05) {
            puff(pt.x, 0.06, pt.z, 5, '#9ec4eb', 3.6, 0.42);
            if (Math.random() < 0.45) puff(pt.x, 0.08, pt.z, 2, '#ffd27a', 5.5, 0.14);
            decal(pt.x, pt.z, 0.07, true);
          } else {
            puff(pt.x, pt.y, pt.z, 5, '#ffd27a', 7.0, 0.16);
            puff(pt.x, pt.y, pt.z, 3, '#9a9a9a', 2.6, 0.55);
            bulletHole(pt.x, pt.y, pt.z, n.x, n.y, n.z);
          }
          b.life = 0;
          break;
        }
      }

      b.vy = nextVy;
      b.x += dx;
      b.y += dy;
      b.z += dz;
      b.dist += segLen;

      if (!b.pl) {
        const dd = Math.hypot(P.x - b.x, P.z - b.z);
        const ph = P.y + P.currentHeight();
        if (dd < 0.36 && b.y < ph && b.y > P.y && P.rollT <= 0) {
          hurtPlayer(b.dmg * (b.y > ph - 0.28 ? 1.6 : 1), b.x - b.vx, b.z - b.vz);
          b.life = 0;
          break;
        } else if (!b.near && dd < 1.5 && Math.abs(b.y - P.y - 1.3) < 1.3) {
          b.near = true;
          audio.sfx('whiz');
          shake = Math.max(shake, 0.1);
        }
      }
      if (b.y <= 0) {
        b.life = 0;
        break;
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  // Grenade timers & molotov updates
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    if (n.dead) {
      nades.splice(i, 1);
      continue;
    }
    n.data.t += simDt;
    if (n.data.bounceCd > 0) n.data.bounceCd -= simDt;
    if (!n.isMolotov && n.data.t >= 2.2) {
      n.dead = true;
      n.mesh.visible = false;
      const p = n.body.translation();
      explode(p.x, p.z, 7.2, 110, n.data.foe);
      nades.splice(i, 1);
    }
  }

  // Burning ground (animated fuel slick + 3D volumetric flame tongues + rising dark smoke)
  for (const f of fires) {
    f.t += simDt;
    f.pt -= simDt;
    f.st = (f.st || 0) - simDt;
    if (f.st <= 0 && parts.length < 520) {
      f.st = 0.08;
      puff(f.x + rnd(-1.7, 1.7), rnd(0.9, 1.8), f.z + rnd(-1.7, 1.7), 2, Math.random() < 0.35 ? '#ffb050' : '#202228', 1.6, 0.85);
    }
    const fadeK = clamp((7 - f.t) / 1.2, 0, 1);
    if (f.poolMat) f.poolMat.uniforms.uFade.value = fadeK;
    for (const e of level.enemies) {
      if (e.hp > 0 && Math.hypot(e.x - f.x, e.z - f.z) < 2.75) {
        e.flash = 0.05;
        enemyMgr.wake(level, e, logicCtx);
        if (e.hp > 26 * simDt) e.hp -= 26 * simDt;
        else enemyMgr.hitEnemy(e, 99, 0, -1, 1.0, logicCtx);
      }
    }
    if (f.pt <= 0 && P.y < 1 && Math.hypot(P.x - f.x, P.z - f.z) < 2.6) {
      f.pt = 0.4;
      hurtPlayer(6, f.x, f.z);
    }
    if (f.t >= 7 && f.group) {
      worldGroup.remove(f.group);
      disposeHierarchy(f.group);
      f.group = null;
    }
  }
  fires = fires.filter(f => f.t < 7);

  // Missions
  const hostage = level.hostage;
  if (hostage) {
    const hd = Math.hypot(hostage.x - P.x, hostage.z - P.z) || 0.01;
    hostage.moving = false;
    if (!hostage.free) {
      if (hd < 2.3) {
        hostage.free = true;
        score += 300;
        audio.sfx('pick');
        say('联络人已解救，带他去北面出口！');
        queueDialogue([
          ['地下联络人：「多谢了，兄弟！这条弄堂出口就在北面，我们走！」', 3.4],
          ['沈孤鸿：「跟紧我脚步，别露在路灯下。」', 3.0]
        ]);
      }
    } else if (hd > 2.9) {
      const f =
        hd < 5.6 && level.los(hostage.x, hostage.z, P.x, P.z)
          ? [(P.x - hostage.x) / hd, (P.z - hostage.z) / hd]
          : level.flowDir(hostage) || [(P.x - hostage.x) / hd, (P.z - hostage.z) / hd];
      level.moveEnt(hostage, f[0] * 7.5 * simDt, f[1] * 7.5 * simDt);
      hostage.ang = Math.atan2(f[1], f[0]);
      hostage.moving = true;
    }
  }

  if (level.cfg.mission === 'demo' && planted < 3) {
    timeLeft -= simDt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      overMsg = '时间到了，军火已经运出码头。';
      gameOver();
      return;
    }
    for (const c of level.charges) {
      if (c.done) continue;
      if (Math.hypot(c.x - P.x, c.z - P.z) < 2.6) {
        c.k += simDt / 2.2;
        if (c.k >= 1) {
          c.done = true;
          planted++;
          score += 250;
          audio.sfx('pick');
          say(planted < 3 ? `炸药已安放 ${planted} / 3` : '全部安放完毕，撤到北面出口！');
          if (planted >= 3) {
            radio('沈孤鸿：「三处雷管全已就位，引信快烧到底了——撤出码头！」', 4.2);
          }
        }
      } else {
        c.k = Math.max(0, c.k - simDt);
      }
    }
  }

  // Shell casings
  for (const m of casePool) {
    if (!m.visible) continue;
    const u = m.userData;
    u.t += simDt;
    if (u.t > 7) {
      m.visible = false;
      continue;
    }
    if (u.b < 3) {
      u.vy -= 9.8 * simDt;
      u.x += u.vx * simDt;
      u.y += u.vy * simDt;
      u.z += u.vz * simDt;
      m.rotation.x += simDt * 15;
      m.rotation.z += simDt * 9;
      if (u.y < 0.014) {
        u.y = 0.014;
        u.b++;
        if (u.b === 1) audio.sfx('tink');
        u.vy = -u.vy * 0.35;
        u.vx *= 0.5;
        u.vz *= 0.5;
        if (u.b === 3) m.rotation.set(Math.PI / 2, 0, rnd(0, TAU));
      }
    }
    m.position.set(u.x, u.y, u.z);
  }

  // Pickups
  for (const p of pickups) {
    p.t += simDt;
    if (Math.hypot(p.x - P.x, p.z - P.z) < 1.55) {
      const tp = p.type;
      if (tp === 'med') {
        if (P.hp >= 100) continue;
        P.hp = Math.min(100, P.hp + 35);
        say('急救包 +35');
      } else if (tp === 'armor') {
        if (P.armor >= 100) continue;
        P.armor = Math.min(100, P.armor + 50);
        say('防弹衣 +50');
      } else if (tp === 'smg') {
        P.res[3] += 32;
        P.res[4] += 50;
        say('冲锋枪弹药 +32 / +50');
      } else if (tp === 'shell') {
        P.res[5] += 10;
        say('霰弹 +10');
      } else if (tp === 'rifle') {
        P.res[2] += 12;
        P.res[6] += 8;
        P.res[7] += 20;
        say('步枪/轻机枪/左轮弹药补充');
      } else if (tp === 'molo') {
        P.molo++;
        say('燃烧瓶 +1（按 F 投掷）');
      } else {
        P.nades++;
        say('手雷 +1');
      }
      p.dead = true;
      audio.sfx('pick');
      score += 10;
    }
    if (p.t > 45) p.dead = true;
    if (p.dead) worldGroup.remove(p.mesh);
  }
  pickups = pickups.filter(p => !p.dead);

  // Particles
  for (const p of parts) {
    p.life -= simDt;
    p.x += p.vx * simDt;
    p.y += p.vy * simDt;
    p.z += p.vz * simDt;
    p.vy -= 18 * simDt;
    if (p.y < 0.04) {
      p.y = 0.04;
      p.vx = p.vy = p.vz = 0;
    }
  }
  parts = parts.filter(p => p.life > 0);

  // Step Rapier physics world
  physics.step(simDt, worldGroup);

  if (
    state === 'play' &&
    exitOpen() &&
    (level.cfg.boss ||
      (Math.hypot(P.x - level.exitPos.x, P.z - level.exitPos.z) < 2.2 &&
        (!hostage || Math.hypot(hostage.x - P.x, hostage.z - P.z) < 9.4)))
  ) {
    levelClear();
  }
}

function syncScene(dt) {
  gr.timeUniform.value = time;

  // Player mesh animation + upper torso Aim IK + Shootdodge airborne dive pose
  if (playerMesh) {
    const rolling = P.rollT > 0;
    const diving = P.diveT > 0;
    const execing = P.execT > 0;
    const pu = playerMesh.userData;
    pu.rate = rolling ? 1.6 : diving ? 0.45 : execing ? 2.2 : P.air ? 0.5 : P.ads > 0.5 ? 1.5 : 1.12;
    pu.strike = execing ? Math.sin((P.execT / 0.58) * Math.PI) : 0;
    const mode = state === 'play' && (P.moving || rolling || P.air) && !diving ? (P.ads > 0.5 && !rolling ? 'Walk' : 'Run') : 'Idle';
    const aimElev = state === 'play' && !rolling ? -(P.pitch - P.recoil) * 0.65 : 0;

    cf.poseMesh(playerMesh, P.x, P.z, rolling ? Math.atan2(P.rdz, P.rdx) : P.ang, mode, dt, aimElev, 0);
    playerMesh.position.y = P.y;
    if (rolling) {
      pu.pivot.rotation.x = 0;
      pu.pivot.rotation.z = -(1 - P.rollT / 0.5) * TAU;
      pu.pivot.position.y = 0.55;
      pu.pivot.scale.setScalar(0.8);
    } else if (diving) {
      const diveEase = Math.sin(Math.min(1, P.diveT / 0.82) * Math.PI);
      const ca = Math.cos(P.ang);
      const sa = Math.sin(P.ang);
      const localFwd = P.rdx * ca + P.rdz * sa;
      const localRight = -P.rdx * sa + P.rdz * ca;
      pu.pivot.rotation.x = localRight * 0.95 * diveEase;
      pu.pivot.rotation.z = -localFwd * 0.95 * diveEase;
      pu.pivot.position.y = 0.9 + diveEase * 0.34;
      pu.pivot.scale.setScalar(1);
    } else if (execing) {
      const lungeEase = Math.sin((P.execT / 0.58) * Math.PI);
      pu.pivot.rotation.x = 0;
      pu.pivot.rotation.z = -0.34 * lungeEase;
      pu.pivot.position.y = 0.9;
      pu.pivot.scale.setScalar(1);
    } else {
      pu.pivot.rotation.x = 0;
      pu.pivot.rotation.z = 0;
      pu.pivot.position.y = 0.9;
      pu.pivot.scale.setScalar(1);
    }
    playerMesh.scale.y = 1 - 0.3 * P.crouchK;
    playerMesh.visible = state === 'menu' ? false : !(P.inv > 0 && Math.floor(time * 20) % 2);
  }

  if (level.hostage?.mesh) {
    level.hostage.mesh.userData.rate = 1.1;
    cf.poseMesh(level.hostage.mesh, level.hostage.x, level.hostage.z, level.hostage.ang, level.hostage.moving ? 'Run' : 'Idle', dt);
  }

  for (const c of level.charges) {
    if (c.mesh) {
      c.mesh.material.color.setHex(c.done ? 0xff5030 : 0x40ff80);
      c.mesh.material.opacity = c.done ? 0.18 : 0.25 + Math.sin(time * 4) * 0.08;
    }
  }

  {
    const f = fires[fires.length - 1];
    gr.fireLight.intensity = f ? 16 + Math.sin(time * 28) * 4 : 0;
    if (f) gr.fireLight.position.set(f.x, 1.1, f.z);
  }

  for (const f of fires) {
    const fadeK = clamp((7 - f.t) / 1.2, 0, 1);
    for (const tg of f.tongues || []) {
      const pulseY = 0.72 + Math.sin(time * 17 + tg.ph) * 0.28;
      const swayX = Math.sin(time * 11 + tg.ph) * 0.14;
      const hCur = tg.h0 * pulseY * (0.4 + 0.6 * fadeK);
      tg.sp.scale.set(tg.w0 * (0.85 + 0.15 * Math.cos(time * 14 + tg.ph)), hCur, 1);
      tg.sp.position.set(tg.bx + swayX, hCur * 0.44, tg.bz);
      tg.sp.material.opacity = fadeK * (0.72 + 0.2 * Math.sin(time * 21 + tg.ph));
    }
  }

  for (const s of steamSprites) {
    const u = s.userData;
    s.position.x = u.baseX + Math.sin(time * 0.65 + u.ph) * 0.45;
    s.position.y = u.baseY + Math.sin(time * 0.9 + u.ph) * 0.12;
  }

  for (const e of level.enemies) {
    const m = e.mesh;
    if (!m || e.hp <= 0) continue;
    const far = Math.hypot(e.x - P.x, e.z - P.z) > 68;
    m.visible = !far;
    if (far) continue;
    const u = m.userData;
    u.rate = clamp(e.spd / 5.6, 0.6, 1.25);
    u.strike = u.melee ? clamp((e.cd - 0.45) / 0.3, 0, 1) : 0;
    cf.poseMesh(m, e.x, e.z, e.ang, e.awake && e.moving ? (e.spd < 2.8 ? 'Walk' : 'Run') : 'Idle', dt, 0, e.flinch || 0);
    u.mat.emissive.setHex(e.flash > 0 ? 0xaa3020 : 0);
    if (u.coatMat) u.coatMat.emissive.setHex(e.flash > 0 ? 0x551810 : 0);
    u.glint.visible = e.aimT > 0 || e.burst > 0 || e.callT > 0;
    u.dk += ((e.duck ? 1 : 0) - u.dk) * Math.min(1, dt * 9);
    m.scale.y = m.scale.x * (1 - 0.4 * u.dk);
  }

  // Bullet tracers
  for (let i = 0; i < gr.bulletPool.length; i++) {
    const m = gr.bulletPool[i];
    const b = bullets[i];
    if (!b) { m.visible = false; continue; }
    m.visible = true;
    m.material = b.pl ? gr.M.pBullet : gr.M.eBullet;
    const L = Math.min(8.5, Math.max(0.55, Math.hypot(b.x - b.px, b.z - b.pz) * (1 + (P.btK || 0) * 1.4)));
    m.position.set((b.x + b.px) * 0.5, (b.y + b.py) * 0.5, (b.z + b.pz) * 0.5);
    m.rotation.set(0, -b.ang, Math.atan2(b.vy, Math.hypot(b.vx, b.vz)));
    m.scale.set(L, b.pl ? 0.018 : 0.03, b.pl ? 0.018 : 0.03);
  }

  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / 0.4;
    r.mesh.scale.setScalar(0.5 + r.max * 0.78 * Math.min(1, k));
    r.mesh.material.opacity = Math.max(0, 0.65 * (1 - k));
    if (k >= 1) {
      gr.scene.remove(r.mesh);
      r.mesh.material.dispose();
      r.dead = true;
    }
  }
  rings = rings.filter(r => !r.dead);

  for (let i = 0; i < shockwaves.length; i++) {
    const sw = shockwaves[i];
    sw.t += dt;
    const k = clamp(sw.t / sw.dur, 0, 1);
    const s = 0.6 + sw.max * k;
    sw.mesh.scale.setScalar(s);
    sw.mesh.material.opacity = Math.max(0, 0.72 * (1 - k) * (1 - k));
    if (k >= 1) {
      gr.scene.remove(sw.mesh);
      sw.mesh.material.dispose();
      sw.dead = true;
    }
  }
  shockwaves = shockwaves.filter(sw => !sw.dead);

  for (let i = 0; i < blastClouds.length; i++) {
    const bc = blastClouds[i];
    bc.t += dt;
    if (bc.t < 0) continue;
    const k = clamp(bc.t / bc.dur, 0, 1);
    bc.mesh.position.x += bc.vx * dt * (1 - k * 0.55);
    bc.mesh.position.y += bc.vy * dt * (1 - k * 0.45);
    bc.mesh.position.z += bc.vz * dt * (1 - k * 0.55);
    const sc = bc.s0 + (bc.s1 - bc.s0) * Math.pow(k, 0.55);
    bc.mesh.scale.setScalar(sc);
    const col = bc.mesh.material.color;
    if (k < 0.18) {
      col.setHex(0xfff0b8).lerp(getCol('#ff5a14'), k / 0.18);
    } else if (k < 0.45) {
      col.setHex(0xff5a14).lerp(getCol('#68180c'), (k - 0.18) / 0.27);
    } else {
      col.setHex(0x68180c).lerp(getCol('#1c1e24'), Math.min(1, (k - 0.45) / 0.35));
    }
    bc.mesh.material.opacity = k < 0.7 ? 0.92 - k * 0.28 : Math.max(0, 0.72 * ((1 - k) / 0.3));
    if (k >= 1) {
      gr.scene.remove(bc.mesh);
      bc.mesh.material.dispose();
      bc.dead = true;
    }
  }
  blastClouds = blastClouds.filter(bc => !bc.dead);

  for (const p of pickups) {
    p.mesh.rotation.y += dt * 2;
    p.mesh.position.y = 0.6 + Math.sin(p.t * 3) * 0.12;
  }

  if (exitMesh) {
    const op = exitOpen();
    exitMesh.material.color.setHex(op ? 0xffc050 : 0xb3261e);
    exitMesh.material.opacity = op ? 0.42 + Math.sin(time * 5) * 0.15 : 0.25;
    exitMesh.rotation.y += dt;
  }

  // Particles buffer update
  const pa = gr.partGeo.attributes.position.array;
  const ca = gr.partGeo.attributes.color.array;
  const n = pa.length / 3;
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    if (!p) {
      pa[i * 3 + 1] = -50;
      continue;
    }
    pa[i * 3] = p.x;
    pa[i * 3 + 1] = p.y;
    pa[i * 3 + 2] = p.z;
    const c = getCol(p.col);
    ca[i * 3] = c.r;
    ca[i * 3 + 1] = c.g;
    ca[i * 3 + 2] = c.b;
  }
  gr.partGeo.attributes.position.needsUpdate = true;
  gr.partGeo.attributes.color.needsUpdate = true;

  P.updateCamera(gr.camera, gr.baseFov, state, time, muzzle, shake, physics);

  // Lights & thunderstorm double-pulse lightning (restrained Film-Noir exposure)
  const lf = lightningFlash;
  const pulse = lf > 0 ? (lf > 0.65 ? Math.sin(((lf - 0.65) / 0.35) * Math.PI) : lf < 0.5 ? Math.sin((lf / 0.5) * Math.PI) * 0.65 : 0.15) : 0;
  gr.sun.intensity = 1.35 + pulse * 3.6;
  gr.hemi.intensity = 0.58 + pulse * 0.75;
  gr.sun.position.set(P.x + 24, 46, P.z + 16);
  gr.sun.target.position.set(P.x, 0, P.z);
  gr.moon.position.set(gr.camera.position.x + 110, 95, gr.camera.position.z - 230);

  lampT -= dt;
  if (lampT <= 0) {
    lampT = 0.35;
    const near = level.lamps
      .slice()
      .sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z - 3.7) - Math.hypot(b.x - P.x, b.z - P.z - 3.7));
    if (near[0]) {
      gr.heroSpot.position.set(near[0].lx, near[0].ly - 0.15, near[0].lz);
      gr.heroSpot.target.position.set(near[0].lx, 0, near[0].lz);
      gr.heroSpot.intensity = 13;
    } else {
      gr.heroSpot.intensity = 0;
    }
    for (let i = 0; i < gr.lampLights.length; i++) {
      const l = near[i];
      if (l) {
        gr.lampLights[i].position.set(l.lx, l.ly - 0.25, l.lz);
        gr.lampLights[i].intensity = i === 0 ? 2.5 : 9.5;
      } else {
        gr.lampLights[i].intensity = 0;
      }
    }
  }

  {
    const c = Math.cos(P.ang);
    const s = Math.sin(P.ang);
    const tip = 0.75 + (WEAPON_TIPS[WEAPONS[P.gun].modelKey] || 0.34);
    gr.flash.visible = muzzle > 0.45 && state === 'play';
    gr.flash.position.set(P.x + c * tip - s * 0.2, P.y + 1.4, P.z + s * tip + c * 0.2);
    gr.flash.scale.setScalar(rnd(0.75, 1.18));
    muzzle = Math.max(0, muzzle - dt * 14);
    gr.muzzleLight.intensity = muzzle * 20;
    gr.muzzleLight.position.set(P.x + c * 1.25, P.y + 1.5, P.z + s * 1.25);
    gr.boomLight.intensity = Math.max(0, gr.boomLight.intensity - dt * 380);
  }

  // Rain follows camera
  for (let i = 0; i < gr.rainPos.length; i += 6) {
    gr.rainPos[i + 1] -= 25 * dt;
    gr.rainPos[i + 4] -= 25 * dt;
    if (gr.rainPos[i + 4] < 0) {
      const y = rnd(14, 19);
      gr.rainPos[i + 1] = y;
      gr.rainPos[i + 4] = y - 0.78;
    }
  }
  gr.rain.geometry.attributes.position.needsUpdate = true;
  gr.rain.position.set(gr.camera.position.x, 0, gr.camera.position.z);
}

let lastTs = 0;
function frame(ts) {
  const dt = Math.min(0.033, (ts - lastTs) / 1000 || 0);
  lastTs = ts;

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  if (state === 'play') updatePlay(dt);
  else {
    time += dt;
    physics.step(dt, worldGroup);
  }

  const sceneDt = state === 'play' && (P.bulletTime || P.diveT > 0) ? dt * 0.28 : dt;
  syncScene(sceneDt);
  gr.render();
  hud.draw({
    state,
    time,
    player: P,
    level,
    camera: gr.camera,
    input,
    score,
    banner,
    msg,
    msgT,
    radioMsg,
    radioT,
    hurtFlash,
    hurtAng,
    hitMark,
    killMark,
    headMark,
    aimHit,
    execTarget,
    nades,
    pickups,
    timeLeft,
    planted,
    bloomEnabled: gr.bloomEnabled,
    qualityLabel: gr.getQualityLabel(),
    exitOpen: exitOpen()
  });
  requestAnimationFrame(frame);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, input?.isTouch ? 1.5 : 2);
  hud.resize(w, h, dpr);
  gr?.resize(w, h, dpr);
}

async function boot() {
  try {
    gr = new GameRenderer(glCv, assets);
  } catch (e) {
    console.error(e);
    ui.innerHTML = '<div class="panel"><h2>无法启动 3D</h2><p>这台设备或浏览器没有开启 WebGL，或者 3D 引擎脚本没有加载成功。请换用新版 Chrome、Edge 或 Safari 后刷新页面。</p></div>';
    return;
  }

  input = new InputManager(hudCv, touchUI, {
    onResize,
    onInteract: () => audio.init(),
    onRequestLock: () => { if (state === 'play') input.lockPointer(); },
    onPause: togglePause,
    onBlur: () => { if (state === 'play') togglePause(); },
    onPointerUnlock: () => { if (state === 'play') togglePause(); },
    onLookDelta: (dx, dy) => {
      if (state === 'play') {
        P.ang += dx;
        P.pitch = clamp(P.pitch + dy, -0.5, 0.75);
      }
    },
    onMiddleClick: () => { if (state === 'play') throwNade(); },
    onWheel: () => { if (state === 'play') P.nextGun(cf, audio, say); },
    onKeyDown: code => {
      if (code === 'KeyB' || code === 'KeyI') {
        audio.init();
        if (state === 'play' || state === 'pause' || state === 'menu' || state === 'clear' || state === 'armory') {
          openArmory();
        }
        return;
      }
      if (state !== 'play') return;
      if (code === 'Digit1') P.switchSlot(0, cf, audio, say);
      else if (code === 'Digit2') P.switchSlot(1, cf, audio, say);
      else if (code === 'Digit3') P.switchSlot(2, cf, audio, say);
      else if (code === 'KeyQ') P.nextGun(cf, audio, say);
      else if (code === 'KeyE') tryExecute();
      else if (code === 'KeyR') {
        P.reload(audio);
        if (reloadSpeakCd <= 0 && P.reloadT > 0 && level.enemies.some(e => e.hp > 0 && e.awake && Math.hypot(e.x - P.x, e.z - P.z) < 22)) {
          reloadSpeakCd = 16;
          radio('沈孤鸿：「换弹压哨……别露头！」', 2.0);
        }
      } else if (code === 'Space') P.jump(audio, state);
      else if (code === 'ShiftLeft' || code === 'ShiftRight') P.roll(input, audio);
      else if (code === 'KeyG') throwNade();
      else if (code === 'KeyF') throwMolo();
      else if (code === 'KeyM') {
        const on = audio.toggleMusic();
        say(on ? '音乐：开' : '音乐：关');
      } else if (code === 'KeyH') {
        gr.cycleQuality();
        say(`画质：${gr.getQualityLabel()}`);
      } else if (code === 'Tab' || code === 'KeyV') {
        if (!P.bulletTime && P.focus >= 15) {
          P.bulletTime = true;
          audio.sfx('slowon');
        } else if (P.bulletTime) {
          P.bulletTime = false;
          audio.sfx('slowoff');
        }
      } else if (code === 'KeyC' || code === 'ControlLeft') {
        P.crouch = !P.crouch;
      }
    }
  });

  window.addEventListener('resize', onResize);
  onResize();

  ui.innerHTML = '<div class="panel"><div class="sub">Shanghai · 1937</div><h1>沪上孤枪</h1><p>正在初始化 Rapier3D 物理引擎、模型与贴图……</p><button class="go" id="ldBtn" type="button" disabled>载入中 0%</button></div>';
  const lb = document.getElementById('ldBtn');

  try {
    await Promise.all([
      physics.init(),
      assets.loadAll(p => {
        if (lb) lb.textContent = `载入中 ${Math.round(p * 100)}%`;
      })
    ]);

    gr.initAssetPools();

    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(gr.G.cylLo, gr.M.brass);
      m.scale.set(0.011, 0.03, 0.011);
      m.visible = false;
      gr.scene.add(m);
      casePool.push(m);
    }

    wf = new WeaponFactory(gr);
    wf.generatePreviews(WEAPONS);
    cf = new CharacterFactory(gr, assets, wf);
    archBuilder = new ArchitectureBuilder(gr, assets);
    propsBuilder = new PropsBuilder(gr, assets);

    const params = new URLSearchParams(window.location.search);
    const reqLvl = params.has('level') ? clamp(parseInt(params.get('level'), 10) || 0, 0, LEVELS.length - 1) : 0;
    if (params.get('autostart') === '1') {
      startLevel(reqLvl);
    } else {
      buildLevelWorld(reqLvl);
      menu();
    }
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    ui.innerHTML = '<div class="panel"><h2>资源载入失败</h2><p>游戏需要通过网页服务器打开才能读取模型、贴图与 WASM 文件。请运行 <b>npm run dev</b> 后在浏览器中访问。</p></div>';
  }
}

window.__game = {
  get s() {
    return {
      state,
      lvl,
      levelName: level.cfg?.name,
      kills,
      total: level.totalEnemies,
      hp: P.hp,
      score,
      enemies: level.enemies.length,
      physicsBodies: physics.getBodyCount(),
      x: P.x,
      y: P.y,
      z: P.z,
      ang: P.ang,
      fps,
      bulletTime: P.bulletTime || P.diveT > 0,
      dive: P.diveT > 0,
      focus: Math.round(P.focus),
      corpses: physics.dynamicLinks.filter(l => l.fade).length,
      bloom: gr?.bloomEnabled ?? false
    };
  },
  loadLevel(idx) {
    const i = clamp(idx | 0, 0, LEVELS.length - 1);
    startLevel(i);
    return this.s;
  },
  fireOnce() {
    if (state !== 'play') return;
    input.mouse.down = true;
    setTimeout(() => { input.mouse.down = false; }, 120);
  }
};

if (document.fonts && document.fonts.load) {
  Promise.race([
    document.fonts.load('52px "Ma Shan Zheng"', '茶楼当铺大戏院百货酒家药房米行旅社照相馆钟表绸缎庄洋烟纸店老虎灶百乐门四行栈'),
    new Promise(r => setTimeout(r, 1500))
  ]).then(boot, boot);
} else {
  boot();
}
