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
let inspectGunIdx = 0;
let shiftDownAt = 0;
let bossConfronted = false;
let reloadSpeakCd = 0;
let execTarget = null;
let execKind = 'exec';
let execSession = null;
let hitstopT = 0;
let freezeFrameT = 0;
let execVfxList = [];
const execFX = { k: 0, flash: 0, dash: 0, freeze: 0, stealth: false, stamp: '', impactPos: null };
const _execMuzV = new THREE.Vector3();
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
  execSession = null;
  hitstopT = 0;
  freezeFrameT = 0;
  execFX.k = execFX.flash = execFX.dash = execFX.freeze = 0;
  execFX.impactPos = null;
  for (const fx of execVfxList) {
    gr.scene.remove(fx.mesh);
    if (fx.ownMat) fx.mesh.material.dispose();
  }
  execVfxList = [];

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

function spawnExecShockRing(x, y, z, colHex = 0xffd280, maxScale = 3.6) {
  const swm = new THREE.MeshBasicMaterial({
    color: colHex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const sw = new THREE.Mesh(gr.G.shockRing, swm);
  sw.position.set(x, y, z);
  gr.scene.add(sw);
  shockwaves.push({ t: 0, dur: 0.26, max: maxScale, mesh: sw, dead: false });
}

function spawnSlashArc3D(x, y, z, yaw, tiltZ = 0.22, colHex = 0xffbe68, radiusScale = 0.92) {
  const mat = new THREE.MeshBasicMaterial({
    color: colHex,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const m = new THREE.Mesh(gr.G.slashArc, mat);
  m.position.set(x, y, z);
  m.rotation.order = 'YXZ';
  m.rotation.y = -yaw;
  m.rotation.x = Math.PI * 0.5;
  m.rotation.z = tiltZ;
  m.scale.setScalar(radiusScale);
  gr.scene.add(m);
  execVfxList.push({
    mesh: m,
    ownMat: true,
    kind: 'slash',
    t: 0,
    dur: 0.24,
    s0: radiusScale * 0.86,
    s1: radiusScale * 1.24,
    op0: 0.96,
    rotZVel: -6.5,
    dead: false
  });
}

function spawnExecFinisherVfx3D(muzX, muzY, muzZ, hitX, hitY, hitZ, ndx, ndz, stealth) {
  const aimTarget = new THREE.Vector3(muzX + ndx * 4, muzY + 0.08, muzZ + ndz * 4);

  if (stealth) {
    // Razor-sharp silver-crimson double throat-slash crescent arcs
    spawnSlashArc3D(hitX, hitY, hitZ, Math.atan2(ndz, ndx), 0.16, 0xdff4ff, 0.98);
    spawnSlashArc3D(hitX, hitY - 0.03, hitZ, Math.atan2(ndz, ndx) + 0.3, -0.22, 0xe8281c, 0.84);
  } else {
    // 1. Supersonic Dual-Layer 3D Muzzle Flame Lance (outer amber + inner incandescent core)
    for (const [col, rScale, lenScale, op] of [
      [0xff8c28, 1.05, 0.72, 0.88],
      [0xfff8e2, 0.48, 0.50, 0.98]
    ]) {
      const lm = new THREE.MeshBasicMaterial({
        color: col,
        map: assets.procTex.flame,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const cone = new THREE.Mesh(gr.G.lanceCone, lm);
      cone.position.set(muzX, muzY, muzZ);
      cone.lookAt(aimTarget);
      cone.scale.set(rScale, rScale, lenScale);
      gr.scene.add(cone);
      execVfxList.push({
        mesh: cone,
        ownMat: true,
        kind: 'lance',
        t: 0,
        dur: 0.22,
        s0: rScale,
        s1: rScale * 1.35,
        lenScale,
        op0: op,
        dead: false
      });
    }

    // 2. Two Razor-Thin Vertical 3D Mach Condensation Shockwave Rings perpendicular to bullet path!
    for (const [distOff, sInit, sMax, col, op] of [
      [0.08, 0.19, 0.54, 0xfff0c8, 0.58],
      [0.36, 0.30, 0.86, 0xff7852, 0.44]
    ]) {
      const rm = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const ring = new THREE.Mesh(gr.G.machRing, rm);
      ring.position.set(muzX + ndx * distOff, muzY + 0.01, muzZ + ndz * distOff);
      ring.lookAt(aimTarget);
      ring.scale.setScalar(sInit);
      gr.scene.add(ring);
      execVfxList.push({
        mesh: ring,
        ownMat: true,
        kind: 'mach',
        t: 0,
        dur: 0.28,
        s0: sInit,
        s1: sMax,
        op0: op,
        vx: ndx * 0.9,
        vz: ndz * 0.9,
        dead: false
      });
    }

    // 3. Penetrating High-Velocity Gold Bullet Streak piercing through frame
    const bm = new THREE.MeshBasicMaterial({
      color: 0xfff2c6,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const beam = new THREE.Mesh(gr.G.box, bm);
    beam.position.set(muzX + ndx * 0.58, muzY + 0.02, muzZ + ndz * 0.58);
    beam.rotation.y = -Math.atan2(ndz, ndx);
    beam.scale.set(1.16, 0.012, 0.012);
    gr.scene.add(beam);
    execVfxList.push({
      mesh: beam,
      ownMat: true,
      kind: 'beam',
      t: 0,
      dur: 0.20,
      s0: 1,
      s1: 1,
      op0: 0.95,
      dead: false
    });
  }

  // 4. Volumetric Atomized Arterial Exit-Mist Clouds + Pre-Fanned Pinpoint Micro-Droplets
  for (let i = 0; i < 3; i++) {
    const sm = gr.M.smokeCloud.clone();
    sm.color.setHex(i === 0 ? 0xb51812 : 0x5c0806);
    sm.opacity = 0.72;
    const sp = new THREE.Sprite(sm);
    const off = 0.14 + i * 0.14;
    sp.position.set(hitX + ndx * off + rnd(-0.06, 0.06), hitY + 0.02 + i * 0.04, hitZ + ndz * off + rnd(-0.06, 0.06));
    const sInit = 0.42 + i * 0.14;
    sp.scale.setScalar(sInit);
    gr.scene.add(sp);
    execVfxList.push({
      mesh: sp,
      ownMat: true,
      kind: 'mist',
      t: 0,
      dur: 0.46,
      s0: sInit,
      s1: sInit + 0.85,
      op0: 0.72,
      vx: ndx * (1.2 + i * 0.6),
      vy: 0.35,
      vz: ndz * (1.2 + i * 0.6),
      dead: false
    });
  }

  // Spawn pinpoint micro-droplets already fanned 15-28cm out into 3D space so Freeze-Frame captures a crisp suspended spray!
  for (let i = 0; i < 28; i++) {
    const spreadAng = Math.atan2(ndz, ndx) + rnd(-0.62, 0.62);
    const spd = rnd(4.2, 10.5);
    const vx = Math.cos(spreadAng) * spd;
    const vy = rnd(-0.8, 3.2);
    const vz = Math.sin(spreadAng) * spd;
    const leadT = rnd(0.015, 0.042);
    parts.push({
      x: hitX + vx * leadT,
      y: hitY + vy * leadT,
      z: hitZ + vz * leadT,
      vx,
      vy,
      vz,
      col: i % 5 === 0 ? '#ffdca0' : i % 2 === 0 ? '#c91e16' : '#740a07',
      life: rnd(0.32, 0.58)
    });
  }
}

const smooth01 = x => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

function findExecTarget() {
  let best = null;
  let bestKind = 'exec';
  let bestScore = 1e9;
  const lookX = Math.cos(P.ang);
  const lookZ = Math.sin(P.ang);

  for (const e of level.enemies) {
    if (e.hp <= 0 || e.executing) continue;
    const dx = e.x - P.x;
    const dz = e.z - P.z;
    const d = Math.hypot(dx, dz);
    if (d > 4.6) continue;
    const fwdDot = (dx * lookX + dz * lookZ) / (d || 1);
    if (d > 2.2 && fwdDot < -0.15) continue;
    if (!level.los(P.x, P.z, e.x, e.z)) continue;

    const foeDot = ((P.x - e.x) * Math.cos(e.ang) + (P.z - e.z) * Math.sin(e.ang)) / (d || 1);
    const behind = foeDot < -0.12;
    const vulnerable =
      !e.awake ||
      behind ||
      (e.finisherT || 0) > 0 ||
      (e.staggerT || 0) > 0 ||
      e.stun > 0 ||
      e.type === 'thug' ||
      (e.type === 'boss' ? e.hp <= e.max * 0.22 : e.hp <= e.max * 0.80);

    if (!vulnerable && d > 3.8) continue;
    const candKind = vulnerable ? 'exec' : 'smash';
    const sc = d - fwdDot * 1.5 - (vulnerable ? 4.0 : 0);
    if (sc < bestScore) {
      bestScore = sc;
      best = e;
      bestKind = candKind;
    }
  }
  execKind = bestKind;
  return best;
}

function tryExecute() {
  if (state !== 'play' || P.execT > 0 || P.rollT > 0 || execSession) return;
  const e = findExecTarget();
  if (!e) {
    say('贴近敌寇（4.5米内）按 [E] 猛袭处决 / 重托破防');
    return;
  }

  const dx = e.x - P.x;
  const dz = e.z - P.z;
  const d = Math.hypot(dx, dz) || 1;
  const ndx = dx / d;
  const ndz = dz / d;

  // Heavy Guard-Break Smash against un-staggered full-HP elite enemies -> immediately opens them up for [E] Finisher!
  if (execKind === 'smash') {
    if (d > 1.15) {
      const stepD = Math.min(d - 1.05, 1.6);
      const mv = physics.movePlayer(ndx * stepD, 0, ndz * stepD);
      P.x = mv.x;
      P.z = mv.z;
    }
    P.ang = Math.atan2(ndz, ndx);
    P.execT = 0.36;
    P.inv = 0.58;
    hitstopT = 0.042;
    execFX.flash = 0.38;
    execFX.dash = 0.45;
    shake = Math.max(shake, 0.22);
    audio.sfx('execCrunch');
    audio.playVoiceShout('exec', 0.6);
    spawnSlashArc3D(e.x - ndx * 0.25, P.y + 1.32, e.z - ndz * 0.25, P.ang, 0.24, 0xffc870, 0.82);
    level.moveEnt(e, ndx * 0.85, ndz * 0.85);
    enemyMgr.hitEnemy(e, 26, ndx, ndz, e.ht * 0.78, makeLogicCtx(), false, 0);
    if (e.hp > 0) {
      e.staggerT = 2.6;
      e.finisherT = 6.5;
      e.stun = 1.6;
      e.flinch = 1.4;
    }
    say('重托破防失衡！再按 [E] 贴脸特写绝杀！');
    return;
  }

  // Smooth C1-Continuous Cinema Close-Up + Freeze-Frame Finisher!
  const stealth = !e.awake;
  const wKey = WEAPONS[P.gun]?.modelKey || 'pistol';
  const isLongGun = wKey !== 'pistol' && wKey !== 'browning' && wKey !== 'revolver' && wKey !== 'knife';
  const standoffDist = stealth ? 0.88 : isLongGun ? 1.54 : 1.30;
  const dur = stealth ? 0.70 : 0.78;
  const yaw = Math.atan2(ndz, ndx);

  // Choose wall-free side (+1 or -1) for the Cylindrical Dolly Portrait Close-Up
  const mx0 = (P.x + e.x) * 0.5;
  const mz0 = (P.z + e.z) * 0.5;
  const rPlus = physics.castRay(mx0, P.y + 1.38, mz0, Math.cos(yaw + Math.PI + 1.12), 0, Math.sin(yaw + Math.PI + 1.12), 2.2, GROUP_WORLD, physics.playerCollider);
  const rMinus = physics.castRay(mx0, P.y + 1.38, mz0, Math.cos(yaw + Math.PI - 1.12), 0, Math.sin(yaw + Math.PI - 1.12), 2.2, GROUP_WORLD, physics.playerCollider);
  const side = !rPlus ? 1 : !rMinus ? -1 : rPlus.dist >= rMinus.dist ? 1 : -1;

  e.executing = true;
  P.crouch = false;
  P.ang = yaw;
  P.execT = dur;
  P.inv = dur + 0.85;
  execFX.dash = d > 1.8 ? 0.75 : 0.25;
  execFX.stealth = stealth;
  audio.sfx('execDash');

  execSession = {
    e,
    stealth,
    isLongGun,
    style: stealth ? -1 : (Math.random() * 3) | 0,
    t: 0,
    dur,
    standoff: standoffDist,
    remDist: Math.max(0, d - standoffDist),
    ndx,
    ndz,
    yaw,
    side,
    didSmash: false,
    didFreeze: false,
    didKill: false
  };
}

function updateExecution(dt) {
  if (execFX.flash > 0) execFX.flash = Math.max(0, execFX.flash - dt * 3.8);
  if (execFX.dash > 0) execFX.dash = Math.max(0, execFX.dash - dt * 4.5);

  if (!execSession) {
    execFX.k = Math.max(0, execFX.k - dt * 5.5);
    if (execFX.k <= 0.005) {
      P.execCam = null;
      execFX.impactPos = null;
    }
    return;
  }

  const s = execSession;
  const e = s.e;
  s.t += dt;
  const t = s.t;
  const smashT = 0.22;
  const killT = s.stealth ? 0.38 : 0.42;

  // Act 1: Controlled, Grounded Predator Stride to exact standoff distance
  if (e && e.hp > 0 && t < smashT) {
    const goalX = e.x - s.ndx * s.standoff;
    const goalZ = e.z - s.ndz * s.standoff;
    const remX = goalX - P.x;
    const remZ = goalZ - P.z;
    const remD = Math.hypot(remX, remZ);
    s.remDist = remD;
    if (remD > 0.025) {
      const step = Math.min(remD, (remD / Math.max(0.035, smashT - t + 0.02)) * dt * 1.25);
      const mv = physics.movePlayer((remX / remD) * step, 0, (remZ / remD) * step);
      P.x = mv.x;
      P.z = mv.z;
      if (remD > 0.5 && Math.random() < 0.45) puff(P.x, 0.08, P.z, 2, '#9ec4eb', 2.8, 0.20);
    }
    P.ang = s.yaw;
  } else {
    s.remDist = 0;
  }

  // Act 2: Compact, Weighty Collar-Check / Stock-Smash + 3D Swept Crescent Arc!
  if (!s.didSmash && t >= smashT) {
    s.didSmash = true;
    if (e && e.hp > 0) {
      e.ang = s.stealth ? s.yaw : Math.atan2(-s.ndz, -s.ndx);
      const arcX = P.x * 0.42 + e.x * 0.58;
      const arcZ = P.z * 0.42 + e.z * 0.58;
      if (s.stealth) {
        audio.sfx('execCrunch');
        hitstopT = 0.038;
        execFX.flash = 0.28;
        e.flinch = 0.85;
        spawnSlashArc3D(arcX, P.y + 1.38, arcZ, s.yaw, -0.16, 0xd8eeff, 0.72);
      } else {
        audio.sfx('execCrunch');
        audio.playVoiceShout('exec', 0.5);
        audio.playVoiceShout('grunt', 0.7);
        hitstopT = 0.045;
        execFX.flash = 0.38;
        e.flash = 0.10;
        e.flinch = 1.15;
        level.moveEnt(e, s.ndx * 0.12, s.ndz * 0.12);
        spawnSlashArc3D(arcX, P.y + 1.36, arcZ, s.yaw, 0.20, 0xffb85c, 0.80);
      }
    }
  }

  // Act 3A: LOCK AIM & ENTER 0.58s STYLIZED NOIR FREEZE-FRAME TABLEAU!
  if (!s.didFreeze && t >= killT) {
    s.didFreeze = true;
    if (e && e.hp > 0) {
      const dx = e.x - P.x;
      const dz = e.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      const ndx = dx / d;
      const ndz = dz / d;
      s.ndx = ndx;
      s.ndz = ndz;

      // Force hero into exact weapon-matched executioner pose so barrel-tip world position is millimeter-exact!
      if (playerMesh) {
        const pu = playerMesh.userData;
        const aimPoseKey = s.stealth ? 'exec_stealth_slash' : s.isLongGun ? 'long' : 'exec_aim_pistol';
        pu.execPose = { a: aimPoseKey, b: aimPoseKey, t: 1, w: 1 };
        pu.execTwist = 0.04;
        cf.poseMesh(playerMesh, P.x, P.z, P.ang, 'RelaxIdle', 0.05, 0, 0, 0, 0);
        playerMesh.updateMatrixWorld(true);
        pu.glint.getWorldPosition(_execMuzV);
      } else {
        _execMuzV.set(P.x + ndx * 0.88, P.y + 1.42, P.z + ndz * 0.88);
      }

      const hitY = P.y + 1.42;
      const hitX = e.x - ndx * 0.05;
      const hitZ = e.z - ndz * 0.05;
      execFX.impactPos = { x: (_execMuzV.x + hitX) * 0.5, y: (_execMuzV.y + hitY) * 0.5, z: (_execMuzV.z + hitZ) * 0.5 };
      execFX.stealth = s.stealth;
      execFX.stamp = s.stealth
        ? '无 声 抹 喉'
        : ['一 枪 绝 杀', '雷 霆 伏 诛', '抵 颌 处 刑'][s.style] || '一 枪 绝 杀';

      e.flinch = 1.25;
      e.flash = 0;
      const eu = e.mesh?.userData;
      if (eu?.hatMesh && eu.hatMesh.visible) {
        eu.hatMesh.visible = false;
        spawnFlyingHat(e.type, e.x + ndx * 0.12, (e.ht || 1.75) * 0.96 + 0.12, e.z + ndz * 0.12, ndx, ndz);
      }

      if (s.stealth) {
        audio.sfx('execSlash');
        audio.sfx('execFreeze');
        spawnExecFinisherVfx3D(hitX - ndx * 0.2, hitY, hitZ - ndz * 0.2, hitX, hitY, hitZ, ndx, ndz, true);
        radio('沈孤鸿：「无声放倒……弄堂里没人察觉。」', 3.0);
      } else {
        const wGun = WEAPONS[P.gun];
        audio.sfx(wGun.snd);
        audio.sfx('execFreeze');
        muzzle = 1.3;
        const camSideAng = s.yaw + Math.PI + s.side * 1.14;
        gr.boomLight.position.set(
          execFX.impactPos.x + Math.cos(camSideAng) * 0.78,
          hitY + 0.34,
          execFX.impactPos.z + Math.sin(camSideAng) * 0.78
        );
        gr.boomLight.intensity = 14;
        spawnExecFinisherVfx3D(_execMuzV.x, _execMuzV.y, _execMuzV.z, hitX, hitY, hitZ, ndx, ndz, false);
        spawnCasing(
          _execMuzV.x - ndx * 0.22 - ndz * 0.14,
          _execMuzV.y + 0.08,
          _execMuzV.z - ndz * 0.22 + ndx * 0.14,
          -ndz * 2.6,
          ndx * 2.6
        );
        const lines = [
          '沈孤鸿：「这一枪，替上海滩收你的命！」',
          '沈孤鸿：「下辈子记住，别拿枪指着我的头。」',
          '沈孤鸿：「挡我路者——死！」'
        ];
        radio(lines[s.style % lines.length], 3.0);
      }

      // Engage 580ms Rock-Solid Cinema Freeze-Frame Tableau (zero camera shake!)
      freezeFrameT = 0.58;
      execFX.freeze = 1.0;
      execFX.flash = 0.82;
    }
  }

  // Act 3B: SHATTER FREEZE-FRAME -> Launch Victim Ragdoll Across Wet Cobblestones!
  if (s.didFreeze && !s.didKill && freezeFrameT <= 0) {
    s.didKill = true;
    audio.sfx('execRelease');
    if (!s.stealth) audio.sfx('execFinisher');
    shake = Math.max(shake, s.stealth ? 0.18 : 0.48);

    if (e && e.hp > 0) {
      if (s.stealth) {
        e.awake = true;
        enemyMgr.hitEnemy(e, 9999, s.ndx, s.ndz, e.ht * 0.86, makeLogicCtx(), true, 4.4);
        score += 180;
        killMark = 0.55;
        say('雨夜无声抹喉！生命+22 · 专注+35');
      } else {
        spawnExecShockRing(e.x, 0.10, e.z, 0xffc870, 3.8);
        enemyMgr.hitEnemy(e, 9999, s.ndx, s.ndz, e.ht * 0.90, makeLogicCtx(), true, 14.8);
        for (const o of level.enemies) {
          if (o.hp > 0 && Math.hypot(o.x - P.x, o.z - P.z) < 8.8) {
            o.stun = Math.max(o.stun || 0, 1.25);
            o.flinch = 1.1;
          }
        }
        const wGun = WEAPONS[P.gun];
        P.mags[P.gun] = Math.min(wGun.mag, P.mags[P.gun] + 2);
        score += 160;
        killMark = 0.72;
        headMark = 0.60;
        say('特写绝杀处决！生命+22 · 专注+35 · 弹匣+2');
      }
      P.hp = Math.min(100, P.hp + 22);
      P.focus = Math.min(100, P.focus + 35);
      P.gunHoldT = 3.0;
      P.gunReady = 1;
    }
  }

  // 100% Continuous Cylindrical Camera Curve (ZERO step jumps!)
  const camIn = smooth01(t / 0.24);
  const camOut = smooth01((s.dur - t) / 0.28);
  const camK = Math.min(camIn, camOut);
  execFX.k = camK;

  const cu = smooth01((t - 0.14) / 0.24);
  const anchorX = e && e.hp > 0
    ? P.x * 0.54 + e.x * 0.46
    : P.x + s.ndx * 0.60;
  const anchorZ = e && e.hp > 0
    ? P.z * 0.54 + e.z * 0.46
    : P.z + s.ndz * 0.60;

  const baseDist = s.isLongGun ? 1.88 : 1.66;
  const fovKick = s.didKill ? smooth01(1 - (t - killT) / 0.22) * 5.0 : 0;

  P.execCam = {
    k: camK,
    mx: anchorX,
    mz: anchorZ,
    yaw: s.yaw,
    side: s.side,
    orbOff: 0.76 + 0.38 * cu,
    dist: baseDist + 0.12 * (1 - cu) + 0.10 * (execFX.freeze || 0),
    camYOff: 1.28 + 0.14 * cu,
    lookY: 1.32 + 0.10 * cu,
    fov: 43 - 6.5 * cu,
    fovKick,
    roll: -0.036 * s.side * cu
  };

  if (t >= s.dur && freezeFrameT <= 0) {
    if (e) e.executing = false;
    if (playerMesh) {
      playerMesh.userData.execPose = null;
      playerMesh.userData.execTwist = 0;
    }
    execSession = null;
    P.execCam = null;
    execFX.impactPos = null;
  }
}

function statPct(w) {
  const dmgP = clamp(Math.round(((w.dmg * w.pellets) / 100) * 100), 14, 100);
  const rofP = clamp(Math.round((0.08 / w.rate) * 100), 8, 100);
  const accP = clamp(Math.round((1 - w.spread / 0.085) * 100), 15, 100);
  const magP = clamp(Math.round((w.mag / 50) * 100), 10, 100);
  return { dmgP, rofP, accP, magP };
}

function renderLoadoutStrip() {
  const pills = [0, 1, 2]
    .map(i => {
      const idx = P.loadout[i];
      const w = idx !== undefined ? WEAPONS[idx] : null;
      return w
        ? `<span class="loadout-pill"><em>0${i + 1}</em>${w.name}</span>`
        : `<span class="loadout-pill" style="opacity:.45"><em>0${i + 1}</em>空槽</span>`;
    })
    .join('');
  return `<div class="loadout-strip"><span>当前随身枪套：</span>${pills}</div>`;
}

function toggleGunEquip(idx) {
  const curSlot = P.loadout.indexOf(idx);
  if (curSlot !== -1) {
    if (P.loadout.length <= 1) {
      say('至少需保留一把随身火器');
      return;
    }
    P.loadout.splice(curSlot, 1);
    if (P.slot >= P.loadout.length) P.slot = P.loadout.length - 1;
    armorySlot = Math.min(armorySlot, P.loadout.length);
  } else if (P.loadout.length < 3) {
    if (armorySlot < P.loadout.length) {
      P.loadout[armorySlot] = idx;
      P.slot = armorySlot;
    } else {
      P.loadout.push(idx);
      P.slot = P.loadout.length - 1;
      armorySlot = P.slot;
    }
  } else {
    const rep = clamp(armorySlot, 0, 2);
    P.loadout[rep] = idx;
    P.slot = rep;
  }
  P.gun = P.loadout[P.slot];
  inspectGunIdx = idx;
  if (playerMesh) cf.setGun(playerMesh, WEAPONS[P.gun].modelKey);
  audio.sfx('tick');
  renderArmory();
}

function buildStageInnerHtml(idx) {
  const fw = WEAPONS[idx] || WEAPONS[0];
  const eqSlot = P.loadout.indexOf(idx);
  const isEq = eqSlot !== -1;
  const { dmgP, rofP, accP, magP } = statPct(fw);
  const cutout = wf?.cutoutUrls?.[fw.modelKey] || wf?.previews?.[fw.modelKey] || '';
  const resStr = P.res[idx] === Infinity ? '无限配给' : `${P.res[idx]} 发`;
  const targetSlotNum = P.loadout.length < 3 && armorySlot >= P.loadout.length ? P.loadout.length + 1 : clamp(armorySlot, 0, 2) + 1;

  return (
    `<div class="stage-top">` +
    `<div class="stage-name"><h3>${fw.fullName}</h3><span>${fw.caliber} · 弹匣 ${fw.mag} 发</span></div>` +
    `<span class="stage-pill">${isEq ? `已携 · 0${eqSlot + 1} 号枪套` : '军械库待命'}</span>` +
    `</div>` +
    `<div class="stage-render-wrap">${cutout ? `<img class="stage-render" src="${cutout}" alt="${fw.fullName}">` : ''}</div>` +
    `<div class="stage-desc">${fw.desc}</div>` +
    `<div class="stage-stats">` +
    `<div class="st-row"><span>威力</span><div class="stat-bar"><i style="width:${dmgP}%"></i></div><strong>${dmgP}</strong></div>` +
    `<div class="st-row"><span>射速</span><div class="stat-bar"><i style="width:${rofP}%"></i></div><strong>${rofP}</strong></div>` +
    `<div class="st-row"><span>精准</span><div class="stat-bar"><i style="width:${accP}%"></i></div><strong>${accP}</strong></div>` +
    `<div class="st-row"><span>弹容</span><div class="stat-bar"><i style="width:${magP}%"></i></div><strong>${fw.mag}</strong></div>` +
    `</div>` +
    `<div class="stage-actions">` +
    `<span class="stage-ammo">当前弹药：<b>${P.mags[idx]}</b> / ${resStr}</span>` +
    `<button type="button" class="stage-act-btn${isEq ? ' unequip' : ''}" id="stageEquipBtn" data-gun="${idx}">` +
    `${isEq ? `从 0${eqSlot + 1} 枪套卸下` : `装入 0${targetSlotNum} 号枪套`}` +
    `</button>` +
    `</div>`
  );
}

function renderArmory() {
  inspectGunIdx = clamp(inspectGunIdx ?? P.gun ?? 0, 0, WEAPONS.length - 1);
  const slotRoles = ['主战位', '副战位', '机动位'];

  const slotHtml = [0, 1, 2]
    .map(i => {
      const wIdx = P.loadout[i];
      const w = wIdx !== undefined ? WEAPONS[wIdx] : null;
      const isActive = i === armorySlot;
      const resStr = w ? (P.res[wIdx] === Infinity ? '∞' : P.res[wIdx]) : '';
      const thumb = w ? wf?.cutoutUrls?.[w.modelKey] || '' : '';
      return (
        `<div class="slot-card${isActive ? ' active-slot' : ''}" data-slot="${i}" role="button" tabindex="0">` +
        `<div class="slot-num">0${i + 1}<small>${slotRoles[i]}</small></div>` +
        `<div class="slot-thumb-wrap">${thumb ? `<img class="slot-thumb" src="${thumb}" alt="${w.name}">` : `<span style="font-size:11px;color:#667085">空枪套</span>`}</div>` +
        `<div class="slot-info"><b>${w ? w.fullName : '空置枪套槽'}</b><span>${w ? `${w.caliber} · 弹药 ${P.mags[wIdx]}/${resStr}` : '点击下方任意火器装入此槽'}</span></div>` +
        (w && P.loadout.length > 1
          ? `<button type="button" class="slot-rm" data-rm-gun="${wIdx}" title="卸下此枪">卸下</button>`
          : `<span style="font-size:10px;color:var(--lantern)">${isActive ? '替换位' : ''}</span>`) +
        `</div>`
      );
    })
    .join('');

  const gunHtml = WEAPONS.map((w, idx) => {
    const sIdx = P.loadout.indexOf(idx);
    const eq = sIdx !== -1;
    const isInsp = idx === inspectGunIdx;
    const prev = wf?.previews?.[w.modelKey] || '';
    return (
      `<button type="button" class="gun-card${eq ? ' equipped' : ''}${isInsp ? ' inspecting' : ''}" data-gun="${idx}">` +
      `<div class="gun-top"><b>${w.fullName}</b>${eq ? `<span class="gun-badge">0${sIdx + 1} 号位</span>` : ''}</div>` +
      (prev ? `<img class="gun-prev" src="${prev}" alt="${w.fullName}">` : '') +
      `<div class="gun-meta"><span>${w.caliber}</span><em>弹匣 ${w.mag} 发</em></div>` +
      `</button>`
    );
  }).join('');

  armoryEl.innerHTML =
    `<div class="armory-panel">` +
    `<div class="armory-hdr">` +
    `<div class="armory-title-wrap"><span class="armory-kicker">SHANGHAI 1937 · TACTICAL ARMORY</span><h2>民国制式军械装备箱</h2>` +
    `<div class="armory-sub">悬停检视枪械工艺参数 · 点击火器装入或卸下（随身最多携带 <b>3 把</b> 火器）</div></div>` +
    `<button type="button" class="btn-sec" id="armCloseTop">返回行动 [B / Esc]</button></div>` +
    `<div class="armory-hero">` +
    `<div class="gun-stage" id="gunStageBox">${buildStageInnerHtml(inspectGunIdx)}</div>` +
    `<div class="holster-col">` +
    `<div class="holster-lbl">随身三格战术枪套 <span>已携 ${P.loadout.length} / 3 把 · 点击槽位指定替换目标</span></div>` +
    `${slotHtml}</div>` +
    `</div>` +
    `<div class="arsenal-hdr">八款 1930 年代经典实感火器库 <span>点击直接装配 / 替换至右侧选中枪套</span></div>` +
    `<div class="gun-grid">${gunHtml}</div>` +
    `<div class="armory-ftr"><span class="armory-tip">提示：战斗中可随时按 [1][2][3] 或 [Q] 切换火器，按 [B] 重新调配军械箱</span>` +
    `<button type="button" class="go" id="armConfirm">携此三把火器投入战斗</button></div>` +
    `</div>`;

  const bindStageBtn = () => {
    const sb = document.getElementById('stageEquipBtn');
    if (sb) sb.onclick = () => toggleGunEquip(+sb.dataset.gun);
  };
  bindStageBtn();

  armoryEl.querySelectorAll('.slot-card').forEach(card => {
    card.onclick = ev => {
      if (ev.target.closest('.slot-rm')) return;
      const s = +card.dataset.slot;
      armorySlot = s;
      if (P.loadout[s] !== undefined) {
        P.slot = s;
        P.gun = P.loadout[s];
        inspectGunIdx = P.gun;
        if (playerMesh) cf.setGun(playerMesh, WEAPONS[P.gun].modelKey);
      }
      audio.sfx('tick');
      renderArmory();
    };
  });

  armoryEl.querySelectorAll('.slot-rm').forEach(rmBtn => {
    rmBtn.onclick = ev => {
      ev.stopPropagation();
      toggleGunEquip(+rmBtn.dataset.rmGun);
    };
  });

  armoryEl.querySelectorAll('.gun-card').forEach(btn => {
    btn.onmouseenter = () => {
      const idx = +btn.dataset.gun;
      if (inspectGunIdx === idx) return;
      inspectGunIdx = idx;
      armoryEl.querySelectorAll('.gun-card').forEach(c => c.classList.toggle('inspecting', +c.dataset.gun === idx));
      const stageBox = document.getElementById('gunStageBox');
      if (stageBox) {
        stageBox.innerHTML = buildStageInnerHtml(idx);
        bindStageBtn();
      }
    };
    btn.onclick = () => toggleGunEquip(+btn.dataset.gun);
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
  inspectGunIdx = P.gun || 0;
  armorySlot = P.slot || 0;
  ui.hidden = true;
  armoryEl.hidden = false;
  input.mouse.down = input.mouse.right = false;
  input.exitPointerLock();
  renderArmory();
}

function closeArmory() {
  if (state !== 'armory') return;
  armoryEl.hidden = true;
  const target = prevArmoryState || 'menu';
  if (target === 'play') {
    state = 'play';
    ui.hidden = true;
    input.lockPointer();
  } else if (target === 'menu') {
    menu();
  } else if (target === 'pause') {
    state = 'play';
    togglePause();
  } else {
    state = target;
    ui.hidden = false;
  }
}

function panel(html, btn, cb, armBtn = false) {
  const rowCls = armBtn ? 'btn-row' : 'btn-row single';
  const sec = armBtn ? '<button class="btn-sec" id="armOpenBtn" type="button">军械装备箱 · 选配三把火器</button>' : '';
  ui.innerHTML = `<div class="panel">${html}<div class="${rowCls}">${sec}<button class="go" id="goBtn" type="button">${btn}</button></div></div>`;
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
    '<div class="sub">SHANGHAI · 1937 · RAIN NOIR</div><h1>沪上孤枪</h1>' +
    '<div class="deco-rule">◆ 孤 胆 夜 袭 · 十 里 洋 场 ◆</div>' +
    '<p>黑龙帮盘踞闸北与十六铺，雨夜秘密卸运军火。<b>从八款民国制式火器中精挑三把入套，穿街过巷，手刃帮主“黑龙”。</b></p>' +
    renderLoadoutStrip() +
    '<div class="key-grid">' +
    '<div class="key-item"><b>WASD 漫步 · 按住Shift 奔跑</b><span>从容巡街漫步 · 长按Shift疾跑 · 点按Shift/Alt翻滚</span></div>' +
    '<div class="key-item"><b>[Z] 收放持枪 · 右键越肩瞄准</b><span>轻松垂手持枪 / 常驻持枪戒备 · 左键即时举枪射击</span></div>' +
    '<div class="key-item"><b>[1][2][3] / Q · [B] 军械箱</b><span>三格装备栏秒切火器 · 打开八枪预览军械箱</span></div>' +
    '<div class="key-item"><b>[E] 处决 · [G] 手雷 · [F] 燃烧瓶</b><span>悄声暗杀/近身处决 · 破片爆破 · 烈焰封路</span></div>' +
    '<div class="key-item"><b>[Tab] 专注 · 右键+Shift</b><span>开启 0.28x 子弹时间 · 飞身鱼跃慢镜射击</span></div>' +
    '<div class="key-item"><b>[C] 蹲伏 · [R] 换弹 · [H] 画质</b><span>潜行低姿 · 战术换弹 · 三档电影级画质切换</span></div>' +
    '</div>' +
    (best ? `<p>最高战功纪录 <b>${best}</b></p>` : '') +
    '<p class="credit">Three.js r187 PBR 渲染管线 + Rapier3D 刚体物理引擎 · 实录火器声学卷积混响</p>',
    '踏 入 雨 夜',
    newGame,
    true
  );
}

function gameOver() {
  state = 'over';
  saveBest();
  panel(
    `<div class="sub">MISSION FAILED</div><h2>${overMsg ? '行动受挫' : '血染十里洋场'}</h2>` +
    `<div class="deco-rule">◆ 1937 ◆</div>` +
    `<p>${overMsg || `你倒在了${level.cfg.name.split('· ')[1]}的冷雨中。外滩的夜色依旧深沉。`}</p>` +
    `<div class="stats"><div><b>${score}</b>本局战功</div><div><b>${best}</b>最高纪录</div></div>`,
    '重 返 街 头',
    newGame,
    true
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
      '<div class="sub">FINALE · SHANGHAI DAWN</div><h2>黑龙伏诛</h2>' +
      '<div class="deco-rule">◆ 尘 埃 落 定 ◆</div>' +
      '<p>总栈的大火映红了黄浦江面。黎明破晓时，十六铺再无黑龙帮的旗号。</p>' +
      `<div class="stats"><div><b>${score}</b>最终战功</div><div><b>${best}</b>传奇纪录</div></div>`,
      '再 战 江 湖',
      newGame,
      true
    );
    return;
  }
  state = 'clear';
  panel(
    `<div class="sub">SECTOR CLEARED</div><h2>${level.cfg.name.split('· ')[1]} 已肃清</h2>` +
    `<p>歼敌 <b>${kills} / ${level.totalEnemies}</b>　战功嘉奖 <b>+${bonus}</b></p>` +
    renderLoadoutStrip() +
    `<p>${LEVELS[lvl + 1].intro}</p>`,
    '奔 赴 下 一 战 区',
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
      `<div class="sub">TACTICAL PAUSE</div><h2>行动暂停</h2><p>${level.cfg.name}</p>` + renderLoadoutStrip(),
      '继 续 作 战',
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
  updateExecution(playerDt);
  execTarget = execSession ? null : findExecTarget();

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

  if (firing && P.rollT <= 0 && P.execT <= 0) {
    P.gunHoldT = Math.max(P.gunHoldT, 2.4);
  }
  if (firing && P.cd <= 0 && P.reloadT <= 0 && P.rollT <= 0 && P.execT <= 0 && P.mags[P.gun] > 0) {
    P.cd = g.rate;
    P.mags[P.gun]--;
    P.gunHoldT = 2.6;
    P.gunReady = Math.max(P.gunReady, 0.92);
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
    const walking = P.moving && !P.sprinting && !rolling;
    const pu = playerMesh.userData;

    // C1-Continuous Weapon-Matched Execution Keyframe Curves (ZERO 1-frame snaps, ZERO pivot kicks!)
    if (execSession) {
      const s = execSession;
      const t = s.t;
      const smashT = 0.22;
      const killT = s.stealth ? 0.38 : 0.42;
      const pGrab = s.isLongGun ? 'exec_long_coil' : 'exec_grab';
      const pSmash = s.stealth ? 'exec_stealth_slash' : s.isLongGun ? 'exec_long_bash' : 'exec_whip';
      const pAim = s.stealth ? 'exec_stealth_slash' : s.isLongGun ? 'long' : 'exec_aim_pistol';

      if (t < 0.12) {
        const k1 = smooth01(t / 0.12);
        pu.execPose = { a: pGrab, b: pGrab, t: 0, w: k1 };
        pu.execTwist = 0.15 * k1;
      } else if (t < smashT) {
        const k2 = smooth01((t - 0.12) / (smashT - 0.12));
        pu.execPose = { a: pGrab, b: pSmash, t: k2, w: 1 };
        pu.execTwist = 0.15 + (-0.18 - 0.15) * k2;
      } else if (t < killT) {
        const k3 = smooth01((t - smashT) / (killT - smashT));
        pu.execPose = { a: pSmash, b: pAim, t: k3, w: 1 };
        pu.execTwist = -0.18 + (0.04 - -0.18) * k3;
      } else {
        const k4 = smooth01((t - (killT + 0.06)) / Math.max(0.12, s.dur - killT - 0.06));
        pu.execPose = { a: pAim, b: pAim, t: 1, w: 1 - k4 };
        pu.execTwist = 0.04 * (1 - k4);
      }
    } else if (execing) {
      // Smooth Guard-Break Smash curve
      const prog = 1 - P.execT / 0.36;
      const wCurve = Math.sin(clamp(prog, 0, 1) * Math.PI);
      const sCurve = smooth01(prog / 0.48);
      pu.execPose = { a: 'exec_grab', b: 'exec_whip', t: sCurve, w: wCurve };
      pu.execTwist = (0.14 - 0.30 * sCurve) * wCurve;
    } else {
      pu.execPose = null;
      pu.execTwist = 0;
    }

    const dashingExec = !!(execSession && execSession.t < 0.18 && (execSession.remDist || 0) > 0.22);
    pu.rate = rolling ? 1.6 : diving ? 0.45 : dashingExec ? 1.25 : execing ? 1.0 : P.air ? 0.5 : P.ads > 0.5 ? 1.05 : walking ? 1.06 : 1.12;
    pu.strike = 0;
    const mode =
      state === 'play' && (P.moving || rolling || P.air || dashingExec) && !diving
        ? rolling || P.sprinting
          ? 'Run'
          : 'Walk'
        : 'RelaxIdle';
    const aimElev = state === 'play' && !rolling && !execSession ? -(P.pitch - P.recoil) * 0.65 : 0;
    const readyW = diving ? 1 : rolling || execSession ? 0 : execing ? 0.5 : P.gunReady;

    cf.poseMesh(playerMesh, P.x, P.z, rolling ? Math.atan2(P.rdz, P.rdx) : P.ang, mode, dt, aimElev, 0, readyW, P.ads);
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
    } else {
      pu.pivot.rotation.x = 0;
      pu.pivot.rotation.z = 0;
      pu.pivot.position.y = 0.9;
      pu.pivot.scale.setScalar(1);
    }
    playerMesh.scale.y = 1 - 0.3 * P.crouchK;
    const invBlink = P.inv > 0 && P.execT <= 0 && !execSession && hurtFlash > 0 && Math.floor(time * 20) % 2;
    playerMesh.visible = state === 'menu' ? false : !invBlink;
  }

  if (level.hostage?.mesh) {
    level.hostage.mesh.userData.rate = 1.05;
    cf.poseMesh(level.hostage.mesh, level.hostage.x, level.hostage.z, level.hostage.ang, level.hostage.moving ? 'Run' : 'RelaxIdle', dt, 0, 0, 0, 0);
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
    if (e.executing && execSession && execSession.e === e) {
      const st = execSession.t;
      const smT = 0.22;
      const stagW = st >= smT ? smooth01((st - smT) / 0.10) : 0;
      u.execPose = stagW > 0 ? { a: 'exec_victim_stagger', b: 'exec_victim_stagger', t: 1, w: stagW } : null;
      u.execTwist = st >= smT ? -0.24 * stagW * Math.exp(-Math.max(0, st - smT) * 3.5) : 0;
    } else {
      u.execPose = null;
      u.execTwist = 0;
    }
    u.rate = e.awake ? clamp(e.spd / 5.6, 0.72, 1.25) : 0.95;
    u.strike = u.melee ? clamp((e.cd - 0.45) / 0.3, 0, 1) : 0;
    const eMode = e.executing || !e.awake ? 'RelaxIdle' : e.moving ? (e.spd < 3.1 ? 'Walk' : 'Run') : 'Idle';
    const eReady = e.executing ? 0 : e.awake && (e.staggerT || 0) <= 0 ? 1 : 0.08;
    const eAds = e.aimT > 0 || e.burst > 0 ? 1 : 0.35;
    cf.poseMesh(m, e.x, e.z, e.ang, eMode, dt, 0, e.executing ? Math.min(0.65, e.flinch || 0) : (e.flinch || 0), eReady, eAds);
    u.mat.emissive.setHex(e.flash > 0 ? 0xaa3020 : 0);
    if (u.coatMat) u.coatMat.emissive.setHex(e.flash > 0 ? 0x551810 : 0);
    u.glint.visible = !e.executing && (e.aimT > 0 || e.burst > 0 || e.callT > 0);
    u.dk += ((e.duck && !e.executing ? 1 : 0) - u.dk) * Math.min(1, dt * 11);
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

  for (let i = 0; i < execVfxList.length; i++) {
    const fx = execVfxList[i];
    fx.t += dt;
    const k = clamp(fx.t / fx.dur, 0, 1);
    if (fx.vx) fx.mesh.position.x += fx.vx * dt;
    if (fx.vy) fx.mesh.position.y += fx.vy * dt;
    if (fx.vz) fx.mesh.position.z += fx.vz * dt;
    if (fx.rotZVel) fx.mesh.rotation.z += fx.rotZVel * dt;
    const sc = fx.s0 + (fx.s1 - fx.s0) * Math.pow(k, 0.55);
    if (fx.kind === 'lance') {
      fx.mesh.scale.set(sc, sc, fx.lenScale * (1 + 0.35 * k));
    } else if (fx.kind !== 'beam') {
      fx.mesh.scale.setScalar(sc);
    }
    fx.mesh.material.opacity = Math.max(0, fx.op0 * (1 - k * k));
    if (k >= 1) {
      gr.scene.remove(fx.mesh);
      if (fx.ownMat) fx.mesh.material.dispose();
      fx.dead = true;
    }
  }
  execVfxList = execVfxList.filter(fx => !fx.dead);

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

  // High-contrast AAA moonlit night calibration (crystal-clear street visibility without wet mirror glare)
  const lf = lightningFlash;
  const pulse = lf > 0 ? (lf > 0.65 ? Math.sin(((lf - 0.65) / 0.35) * Math.PI) : lf < 0.5 ? Math.sin((lf / 0.5) * Math.PI) * 0.65 : 0.15) : 0;
  gr.sun.intensity = 2.4 + pulse * 4.2;
  gr.hemi.intensity = 1.42 + pulse * 0.9;
  gr.sun.position.set(P.x + 24, 46, P.z + 16);
  gr.sun.target.position.set(P.x, 0, P.z);
  gr.moon.position.set(gr.camera.position.x + 110, 95, gr.camera.position.z - 230);
  gr.playerFill.position.set(P.x, P.y + 3.6, P.z);

  lampT -= dt;
  if (lampT <= 0) {
    lampT = 0.35;
    const near = level.lamps
      .slice()
      .sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z - 3.7) - Math.hypot(b.x - P.x, b.z - P.z - 3.7));
    if (near[0]) {
      gr.heroSpot.position.set(near[0].lx, near[0].ly - 0.15, near[0].lz);
      gr.heroSpot.target.position.set(near[0].lx, 0, near[0].lz);
      gr.heroSpot.intensity = 22;
    } else {
      gr.heroSpot.intensity = 0;
    }
    for (let i = 0; i < gr.lampLights.length; i++) {
      const l = near[i];
      if (l) {
        gr.lampLights[i].position.set(l.lx, l.ly - 0.25, l.lz);
        gr.lampLights[i].intensity = i === 0 ? 4.5 : 15;
      } else {
        gr.lampLights[i].intensity = 0;
      }
    }
  }

  {
    const c = Math.cos(P.ang);
    const s = Math.sin(P.ang);
    const tip = 0.75 + (WEAPON_TIPS[WEAPONS[P.gun].modelKey] || 0.34);
    const muzX = P.x + c * tip - s * 0.2;
    const muzY = P.y + 1.38 - 0.42 * (P.crouchK || 0);
    const muzZ = P.z + s * tip + c * 0.2;
    gr.flash.visible = muzzle > 0.45 && state === 'play';
    gr.flash.position.set(muzX, muzY, muzZ);
    gr.flash.scale.setScalar(rnd(0.75, 1.18));
    muzzle = Math.max(0, muzzle - dt * 14);
    gr.muzzleLight.intensity = muzzle * 20;
    gr.muzzleLight.position.set(P.x + c * 1.25, P.y + 1.5, P.z + s * 1.25);
    gr.boomLight.intensity = Math.max(0, gr.boomLight.intensity - dt * 380);

    // Surgical Right-Click ADS 3D ballistic sightline
    if (state === 'play' && P.ads > 0.2 && P.rollT <= 0 && P.execT <= 0 && P.reloadT <= 0) {
      const aimPt = P.aim3D(gr.camera, physics);
      const posArr = gr.aimLine.geometry.attributes.position.array;
      posArr[0] = muzX;
      posArr[1] = muzY;
      posArr[2] = muzZ;
      posArr[3] = aimPt.x;
      posArr[4] = aimPt.y;
      posArr[5] = aimPt.z;
      gr.aimLine.geometry.attributes.position.needsUpdate = true;
      gr.aimLine.material.color.setHex(aimPt.hit ? 0xff4e3e : 0xffda88);
      gr.aimLine.material.opacity = 0.34 * P.ads;
      gr.aimLine.visible = true;
    } else {
      gr.aimLine.visible = false;
    }
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

  let effDt = dt;
  if (freezeFrameT > 0 && state === 'play') {
    freezeFrameT = Math.max(0, freezeFrameT - dt);
    execFX.freeze = clamp(freezeFrameT / 0.58, 0, 1);
    execFX.flash = Math.max(0, execFX.flash - dt * 3.4);
    if (P.execCam) {
      const baseD = execSession?.isLongGun ? 1.88 : 1.66;
      P.execCam.dist = baseD + 0.09 * execFX.freeze;
    }
    effDt = 0;
  } else {
    execFX.freeze = 0;
    if (hitstopT > 0 && state === 'play') {
      hitstopT = Math.max(0, hitstopT - dt);
      effDt = dt * 0.025;
      if (!execSession) shake = Math.max(shake, 0.24);
    }
  }

  if (state === 'play') {
    if (effDt > 0) updatePlay(effDt);
    else if (freezeFrameT <= 0) updateExecution(0);
  } else {
    time += dt;
    physics.step(dt, worldGroup);
  }

  const sceneDt = state === 'play' && (P.bulletTime || P.diveT > 0) ? effDt * 0.28 : effDt;
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
    kills,
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
    execKind,
    execFX,
    nades,
    pickups,
    timeLeft,
    planted,
    bloomEnabled: gr.bloomEnabled,
    qualityLabel: gr.getQualityLabel(),
    exitOpen: exitOpen(),
    hudIcons: wf?.hudIcons
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
      else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if ((P.bulletTime || input.mouse.right) && P.focus >= 16) {
          shiftDownAt = 0;
          P.roll(input, audio);
        } else {
          shiftDownAt = performance.now();
        }
      } else if (code === 'AltLeft' || code === 'AltRight' || code === 'KeyX') {
        P.roll(input, audio);
      } else if (code === 'KeyZ') {
        P.combatStance = !P.combatStance;
        if (!P.combatStance) P.gunHoldT = 0;
        audio.sfx('tick');
        say(P.combatStance ? '姿态：常驻举枪戒备 [Z]' : '姿态：轻松自然持枪 [Z]');
      } else if (code === 'CapsLock') {
        P.walkDefault = !P.walkDefault;
        say(P.walkDefault ? '步态：默认漫步（按住Shift奔跑）' : '步态：默认奔跑（按住Shift漫步）');
      } else if (code === 'KeyG') throwNade();
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
    },
    onKeyUp: code => {
      if ((code === 'ShiftLeft' || code === 'ShiftRight') && state === 'play') {
        if (shiftDownAt > 0 && performance.now() - shiftDownAt < 210) {
          P.roll(input, audio);
        }
        shiftDownAt = 0;
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
      if (params.get('stageExec') === '1') window.__game.stageExecTarget();
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
  },
  stageExecTarget() {
    const shooter = level.enemies.find(o => o.hp > 0 && o.type !== 'thug');
    if (shooter) {
      shooter.x = P.x + Math.cos(P.ang) * 13.5 + 1.2;
      shooter.z = P.z + Math.sin(P.ang) * 13.5;
      shooter.ang = P.ang + Math.PI;
      shooter.awake = true;
      shooter.sees = true;
      shooter.cover = null;
      shooter.cd = 0.05;
      physics.updateEnemyCollider(shooter, shooter.x, shooter.z, shooter.ht);
    }
    const e = level.enemies.find(o => o.hp > 0 && o !== shooter);
    if (!e) return null;
    e.x = P.x + Math.cos(P.ang) * 3.4 - 0.35;
    e.z = P.z + Math.sin(P.ang) * 3.4;
    e.ang = P.ang + Math.PI;
    e.awake = true;
    e.finisherT = 8.0;
    physics.updateEnemyCollider(e, e.x, e.z, e.ht);
    execTarget = findExecTarget();
    return { type: e.type, execKind };
  },
  triggerExec() {
    tryExecute();
    return { active: !!execSession, kills };
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
