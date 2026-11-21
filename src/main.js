import * as THREE from 'three';
import {
  HERO_PRESETS,
  enemyStanceHeight,
  LEVELS,
  WEAPONS,
  MW,
  TILE,
  TAU,
  GRAVITY,
  PLAYER_CONTACT_OFFSET,
  GROUP_WORLD,
  GROUP_PROP,
  GROUP_ENEMY,
  GROUP_DEBRIS,
  GROUP_HANGING,
  LAYER_NO_REFLECT
} from './config/constants.js';
import { AudioManager } from './core/AudioManager.js';
import { DialoguePlayer, voiceUrl, spatialVoice } from './core/DialoguePlayer.js';
import { EncounterDialogue, canFinishCloseLine } from './systems/EncounterDialogue.js';
import { InputManager } from './core/InputManager.js';
import { AssetManager } from './core/AssetManager.js';
import { GameRenderer, createFuelPoolMaterial } from './core/Renderer.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { LevelState } from './world/LevelGenerator.js';
import { ArchitectureBuilder } from './world/ArchitectureBuilder.js';
import { PropsBuilder } from './world/PropsBuilder.js';
import { batchStatic, pruneEmptyGroups } from './world/StaticBatcher.js';
import { SpriteBatcher } from './world/SpriteBatcher.js';
import { WeaponFactory, WEAPON_TIPS } from './entities/WeaponFactory.js';
import { CharacterFactory } from './entities/CharacterFactory.js';
import { PlayerController } from './entities/Player.js';
import { EnemyManager } from './entities/EnemyManager.js';
import { findStealthTarget, findCombatFinisher } from './systems/Stealth.js';
import { poseCrouchWalk, posePlayerGait } from './entities/CrouchGait.js';
import { driveTurn } from './systems/Motion.js';
import { HudRenderer } from './ui/HudRenderer.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { DeadEye } from './systems/DeadEye.js';
import { Melee, BladeTrail, ULTIMATES, resolveSwordClip } from './systems/Melee.js';
import { DuelSystem, DOJO_PRESETS, BOSS_ULTIMATES } from './systems/DuelSystem.js';
import { ProgressionSystem, UPGRADE_DEFS, ENEMY_POINT_REWARDS, MAX_UPGRADE_LEVEL } from './systems/ProgressionSystem.js';
import { BLADE, MELEE_WEAPONS } from './entities/BladeModel.js';
import { classifyHit, reactionArmPose, poseReaction, poseLowStance, driveEnemyClips, deathClipFor } from './systems/HitReactions.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEV_MODE = import.meta.env.DEV;

const glCv = document.getElementById('gl');
const hudCv = document.getElementById('hud');
const ui = document.getElementById('ui');
const armoryEl = document.getElementById('armory');
const touchUI = document.getElementById('touch');
const loaderEl = document.getElementById('loader');

const audio = new AudioManager();
const loader = new LoadingScreen(loaderEl, audio);
loader.mount();
const dialogue = new DialoguePlayer();
const encounters = new EncounterDialogue();
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
let propInstancer = null;
let spriteBatcher = null;
let decals = [];
let holes = [];
let exitMesh = null;
let playerMesh = null;
let motionLibrary = null;

let state = 'boot';
let lvl = 0;
let time = 0;
let score = 0;
let levelStartScore = 0;
let levelStartUnlocked = [];
let levelStartLoadout = [];
let kills = 0;
let best = 0;
let maxUnlockedLvl = 0;
try { best = +localStorage.getItem('hsgq_best') || 0; } catch {}
try { maxUnlockedLvl = clamp(parseInt(localStorage.getItem('hsgq_max_lvl'), 10) || 0, 0, LEVELS.length - 1); } catch {}
let selectedStartLvl = maxUnlockedLvl;
let heroPreset = HERO_PRESETS[0];
try {
  const savedId = localStorage.getItem('hsgq_hero');
  heroPreset = HERO_PRESETS.find(preset => preset.id === savedId) || heroPreset;
} catch {}

let banner = 0;
let flowT = 0;
let msg = '';
let msgT = 0;
let radioT = 0;
let dialogueQueue = [];
let closeLine = null;
let activeVoiceSource = null;
let startingLevel = false;
const lastCallout = new Map();
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
let execSession = null;
let hitstopT = 0;
let freezeFrameT = 0;
let killSlowT = 0;
let killSlowDur = 0;
let killSlowScale = 0.36;
let killSlowCd = 0;
let execVfxList = [];
const execFX = { k: 0, flash: 0, dash: 0, freeze: 0, blade: false, stamp: '', impactPos: null };
const deadEye = new DeadEye();
let prevFiring = false;
let prevHeavy = false;
let hitstopShake = 0.24;
const deCtx = {
  P,
  audio,
  isAiming: () => !!(input && (input.mouse.right || input.isTouch)),
  canMark: () => !P.melee && P.hasGun, // with the blade drawn Dead Eye is pure slow motion
  fireAt: target => fireShot(target, true)
};
const melee = new Melee();
const duel = new DuelSystem();
const prog = new ProgressionSystem({ persist: true });
let bladeTrail = null;
let trailClock = 0;
let staminaEmptyCd = 0;
let bossGateVisual = null;
let bossGateCollider = null;
let shrineVisuals = [];
let soulCacheVisuals = [];
let worldPrompt = null;
let activeRespawnPos = null;
let campaignWinT = 0;
function isInActiveCombat() {
  if (!duel.active || duel.mode !== 'campaign') return false;
  return level.enemies.some(e => e.hp > 0 && e.awake && !e.bossDormant);
}

const meleeCtx = {
  P,
  level,
  physics,
  audio,
  get useStamina() { return isInActiveCombat(); },
  get lockTarget() { return duel.active ? duel.lockTarget : null; },
  onStaminaEmpty: () => {
    if (staminaEmptyCd <= 0) {
      staminaEmptyCd = 0.7;
      duel.flashCallout('精力耗尽！稍作喘息或升级【精力】', '#ff9854', 1.0);
      audio.sfx('tick');
    }
  },
  onGuardCounter: () => {
    impactFlash = 0.45;
    impactFlashCol = '#ffe47a';
    pulseImpactLight(P.x, 1.35, P.z, 0xffe478, 34);
    P.addCameraImpact({ fov: 2.8, roll: -0.025, back: 0.10 });
    audio.sfx('parryClang');
    pushHitNum(P.x, 1.85, P.z, '防御反击!', '#ffe478', 1.24);
  },
  castBlade: (o, d, len) =>
    physics.castRay(o.x, o.y, o.z, d.x, d.y, d.z, len, GROUP_WORLD | GROUP_PROP | GROUP_HANGING, physics.playerCollider),
  hitProp: (hit, dir, def) => meleeHitProp(hit, dir, def),
  hitEnemy: (e, pt, dir, def) => meleeHitEnemy(e, pt, dir, def),
  onUltImpact: (ultName, def, atk) => handleUltImpact(ultName, def, atk)
};
// World / animation time scale while slowed: Dead Eye crawls, shootdodge is a little brisker
const slowScale = () => (deadEye.busy ? 0.2 : 0.28);
const _trailA = new THREE.Vector3();
const _trailB = new THREE.Vector3();
let shake = 0;
let hurtFlash = 0;
let recentHitT = 0;
let hurtAng = null;
let muzzle = 0;
let aimHit = false;
let aimDist = 0;
let hitMark = 0;
let killMark = 0;
let headMark = 0;
let impactFlash = 0;
let impactFlashCol = '#ffd860';
let impactLinesT = 0;
let impactLinesCol = '#ffe89c';
let hitNums = [];
let enemyTrails = [];
let bossTelegraphRing = null;
let planted = 0;
let timeLeft = 0;
let overMsg = '';
let lampT = 0;
let fps = 60;
let fpsAccum = 0;
let fpsFrames = 0;
let frameMsAvg = 16.7;
let showPerf = false;
let execKind = 'stealth';
let throwAim = null;

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

function stopCloseLine() {
  if (!closeLine) return;
  dialogue.stop();
  closeLine = null;
  activeVoiceSource = null;
  radioT = 0;
}

function radio(event, dur = 4.2, scripted = false, source = null) {
  const close = event.startsWith('near-');
  if (radioT > 0 && (!closeLine || close)) return false;
  if (!scripted && dialogueQueue.length) return false;
  if (event === 'spot-boss' && !bossConfronted && source === level.boss) return false;
  const now = performance.now();
  if (!scripted) {
    if (now - (lastCallout.get(event) ?? -Infinity) < 12000) return false;
  }
  const cue = scripted ? event : encounters.choose(event, source?.type, source?.voiceActor);
  if (!cue) return false;
  stopCloseLine();
  if (!scripted) lastCallout.set(event, now);
  if (close) closeLine = { event, source };
  else encounters.interrupt(dur);
  const spatial = source && event !== 'near-hero' ? spatialVoice(source, P) : { gain: 1, pan: 0 };
  activeVoiceSource = source && event !== 'near-hero' ? source : null;
  dialogue.start(cue, heroPreset, spatial.gain, spatial.pan);
  radioT = dur;
  return true;
}

function enemyRadio(cue, dur, source) {
  return radio(cue, dur, false, source);
}

function queueDialogue(lines) {
  if (!lines?.length) return;
  stopCloseLine();
  encounters.interrupt(0);
  dialogueQueue.push(...lines);
  if (radioT <= 0) {
    const next = dialogueQueue.shift();
    if (next) radio(next[0], next[1], true);
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
  if (forced && forced !== 'med') return;
  if (!forced && Math.random() > 0.35) return; // Crates only occasionally drop healing supplies — zero free points!
  const col = 0xe8483c;
  const g = new THREE.Group();
  const mm = new THREE.MeshStandardMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 1.15,
    roughness: 0.35
  });
  mm.userData.own = true;

  const box = new THREE.Mesh(gr.G.box, mm);
  box.scale.set(0.42, 0.28, 0.28);
  box.castShadow = true;
  g.add(box);

  const c1 = new THREE.Mesh(gr.G.box, gr.M.glint);
  c1.scale.set(0.44, 0.08, 0.08);
  const c2 = new THREE.Mesh(gr.G.box, gr.M.glint);
  c2.scale.set(0.44, 0.22, 0.04);
  c2.rotation.x = Math.PI / 2;
  g.add(c1, c2);

  const sp = new THREE.Sprite(gr.M.glowSprite);
  sp.scale.set(1.65, 1.65, 1);
  g.add(sp);
  g.position.set(x, 0.65, z);
  worldGroup.add(g);
  pickups.push({ x, z, type: 'med', t: 0, mesh: g, dead: false });
}

function bossWeaponsBefore(lvlIdx) {
  const out = [];
  const lim = clamp(lvlIdx | 0, 0, LEVELS.length);
  for (let i = 0; i < lim; i++) {
    const wIdx = LEVELS[i]?.bossCfg?.dropWeaponIdx;
    if (wIdx !== undefined && !out.includes(wIdx)) out.push(wIdx);
  }
  return out;
}

function weaponUnlockHint(idx) {
  const chapter = LEVELS.find(c => c.bossCfg?.dropWeaponIdx === idx);
  if (chapter) {
    const stage = chapter.name.split(' · ')[0];
    return `击毙${stage}头目「${chapter.bossCfg.name}」掉落缴获`;
  }
  return '通关五关后解锁全军械库';
}

function dropBossWeapon(x, z, weaponIdx, bossName = '头目') {
  const w = WEAPONS[weaponIdx];
  if (!w || !worldGroup || !wf) return;
  const spot = level.nearbyFloor(x, z, 0.45);
  const gx = spot.x;
  const gz = spot.z;

  const grp = new THREE.Group();
  grp.position.set(gx, 0, gz);

  // Floating rotating 3D Boss weapon model centered at its bounding box
  const spinPivot = new THREE.Group();
  spinPivot.position.y = 0.92;
  const gunMesh = wf.createWeaponMesh(w.modelKey);
  gunMesh.geometry.computeBoundingBox();
  const bb = gunMesh.geometry.boundingBox;
  if (bb) {
    const cx = (bb.min.x + bb.max.x) * 0.5;
    const cy = (bb.min.y + bb.max.y) * 0.5;
    const cz = (bb.min.z + bb.max.z) * 0.5;
    gunMesh.position.set(-cx, -cy, -cz);
  }
  const gunWrap = new THREE.Group();
  gunWrap.add(gunMesh);
  gunWrap.scale.setScalar(1.85);
  gunWrap.rotation.z = 0.24;
  spinPivot.add(gunWrap);
  grp.add(spinPivot);

  // Golden ground halo ring
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd258,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  ringMat.userData.own = true;
  const halo = new THREE.Mesh(gr.G.shockRing, ringMat);
  halo.position.y = 0.08;
  halo.scale.setScalar(1.15);
  grp.add(halo);

  // Tall golden sky beacon beam so dropped trophy is unmistakable in rain
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd258,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  beamMat.userData.own = true;
  const beam = new THREE.Mesh(gr.G.beam, beamMat);
  beam.scale.set(0.55, 12, 0.55);
  beam.position.y = 6.0;
  grp.add(beam);

  const glow = new THREE.Sprite(gr.M.glowSprite);
  glow.position.y = 0.95;
  glow.scale.set(2.5, 2.5, 1);
  grp.add(glow);

  worldGroup.add(grp);
  pickups.push({
    x: gx,
    z: gz,
    type: 'bossWeapon',
    weaponIdx,
    weaponName: w.name,
    fullName: w.fullName,
    t: 0,
    mesh: grp,
    spinPivot,
    beam,
    halo,
    dead: false
  });
  say(`★ 击毙头目【${bossName}】！地上掉落了【${w.fullName}】，快去拾取！`);
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
    for (const h of tileMesh[k]) propInstancer.remove(h);
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
      propInstancer.remove(l.instHandle);
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
  ctx.hitImpulse = 11.8;
  for (const e of level.enemies) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < rad + e.r) {
      enemyMgr.hitEnemy(e, dmg * (1 - (d / (rad + e.r)) * 0.6), (e.x - x) / (d || 1), (e.z - z) / (d || 1), 1.0, ctx);
    }
  }
  const dp = Math.hypot(P.x - x, P.z - z);
  if (dp < 24) {
    const blastK = clamp(1 - dp / 24, 0, 1);
    P.addCameraImpact({
      fov: 4.2 * blastK,
      roll: (Math.random() < 0.5 ? -1 : 1) * 0.036 * blastK,
      back: 0.22 * blastK
    });
  }
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
  if (execSession || P.execT > 0 || P.rollT > 0 || P.diveT > 0.47 || P.inv > 0 || state !== 'play' || d <= 0) return;
  // Prevent same-frame shotgun scatter or overlapping crossfire from instantly deleting 100 HP
  if (recentHitT > 0) d *= 0.38;
  recentHitT = 0.16;
  if (P.armor > 0) {
    const a = Math.min(P.armor, d * 0.6);
    P.armor -= a;
    d -= a;
  }
  P.hp -= d;
  // Elden-Ring style brief post-hit grace (0.35s) prevents overlapping swings or true-combos from instantly evaporating the player
  if (duel.active) P.inv = Math.max(P.inv, 0.35);
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
  const bossDead = !level.boss || level.boss.hp <= 0;
  const bossLootLeft = pickups.some(p => p.type === 'bossWeapon' && !p.dead);
  if (cfg.mission === 'boss') return !!(level.boss && level.boss.hp <= 0 && !bossLootLeft);
  if (cfg.mission === 'rescue') return !!(level.hostage && level.hostage.free && bossDead);
  return planted >= 3 && bossDead;
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

function computeThrowParams(isMolotov) {
  const pe = P.pitch - P.recoil - 0.3;
  const cp = Math.cos(pe);
  const c = Math.cos(P.ang);
  const s = Math.sin(P.ang);
  const v = isMolotov ? 14 : 15;
  return {
    ox: P.x + c * 0.5,
    oy: P.y + 1.55 - P.shoulderDrop,
    oz: P.z + s * 0.5,
    vx: c * cp * v,
    vy: -Math.sin(pe) * v,
    vz: s * cp * v
  };
}

function throwNade() {
  if (P.nades <= 0 || P.nadeCd > 0 || P.rollT > 0) return;
  P.nades--;
  P.nadeCd = 0.8;
  const tp = computeThrowParams(false);
  spawnGrenade(tp.ox, tp.oy, tp.oz, tp.vx, tp.vy, tp.vz, false, false);
}

function throwMolo() {
  if (P.molo <= 0 || P.nadeCd > 0 || P.rollT > 0) return;
  P.molo--;
  P.nadeCd = 0.8;
  const tp = computeThrowParams(true);
  spawnGrenade(tp.ox, tp.oy, tp.oz, tp.vx, tp.vy, tp.vz, true, false);
}

function beginThrowAim(kind) {
  if (state !== 'play' || execSession || P.execT > 0 || P.rollT > 0 || P.nadeCd > 0) return;
  if (kind === 'nade' && P.nades <= 0) { say('破片手雷已耗尽'); return; }
  if (kind === 'molo' && P.molo <= 0) { say('燃烧瓶已耗尽'); return; }
  throwAim = { kind, dist: 0, danger: false };
}

function cancelThrowAim() {
  if (!throwAim) return;
  throwAim = null;
  if (gr?.throwArc) gr.throwArc.visible = false;
  if (gr?.throwRing) gr.throwRing.visible = false;
}

function releaseThrowAim(kind) {
  if (!throwAim || throwAim.kind !== kind) return;
  const k = throwAim.kind;
  cancelThrowAim();
  if (k === 'molo') throwMolo();
  else throwNade();
}

function triggerKillSlow(dur = 0.24, scale = 0.36, force = false) {
  if (!force && (killSlowCd > 0 || P.bulletTime || P.diveT > 0 || execSession)) return;
  if (dur > killSlowT || force) {
    killSlowT = dur;
    killSlowDur = dur;
    killSlowScale = scale;
  }
  killSlowCd = 2.4;
}

function shootBullet(x, y, z, dx, dy, dz, speed, dmg, pl, meta = null) {
  bullets.push({
    x, y, z,
    px: x, py: y, pz: z,
    vx: dx * speed,
    vy: dy * speed,
    vz: dz * speed,
    ang: Math.atan2(dz, dx),
    dmg,
    pl,
    push: meta?.push || 3.0,
    weaponId: meta?.weaponId || null,
    scoped: !!meta?.scoped,
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
    const spot = level.nearbyFloor(fx ?? x, fz ?? z, e.r);
    e.x = spot.x;
    e.z = spot.z;
  }
  e.awake = true;
  e.mesh = cf.createPerson(type);
  worldGroup.add(e.mesh);
  e.phys = physics.createEnemyCollider(e, e.x, e.z, e.r, e.ht);
  level.totalEnemies++;
  return e;
}

// Blood thrown along the cut: a fan of droplets + dark mist plus a spatter line on the cobbles
function bloodSpray(x, y, z, dx, dz, n, sp) {
  const a0 = Math.atan2(dz, dx);
  for (let i = 0; i < n && parts.length < 560; i++) {
    const a = a0 + rnd(-0.62, 0.62);
    const s = rnd(0.32, 1.15) * sp;
    const col = i % 3 === 0 ? '#5c0b07' : i % 5 === 0 ? '#c4241a' : '#8f150f';
    parts.push({ x, y, z, vx: Math.cos(a) * s, vy: rnd(-0.22, 0.95) * sp * 0.52, vz: Math.sin(a) * s, life: rnd(0.38, 0.85), col });
  }
  const drops = n >= 22 ? 4 : 3;
  for (let i = 0; i < drops; i++) {
    const r = 0.35 + i * 0.45 + rnd(-0.1, 0.1);
    decal(x + dx * r + rnd(-0.12, 0.12), z + dz * r + rnd(-0.12, 0.12), rnd(0.08, 0.16));
  }
}

function pushHitNum(x, y, z, text, col = '#fff2d0', scale = 1.0) {
  hitNums.push({
    x: x + rnd(-0.18, 0.18),
    y: y + rnd(0.05, 0.22),
    z: z + rnd(-0.18, 0.18),
    vy: 1.55 + scale * 0.45,
    text: String(text),
    col,
    scale,
    t: 0,
    dur: 0.72
  });
  if (hitNums.length > 24) hitNums.shift();
}

function pulseImpactLight(x, y, z, colHex, intensity = 32) {
  if (!gr?.boomLight) return;
  gr.boomLight.color.setHex(colHex);
  gr.boomLight.position.set(x, y, z);
  gr.boomLight.intensity = Math.max(gr.boomLight.intensity, intensity);
}

function spawnShockRing3D(x, y, z, colHex, maxRad = 3.6, dur = 0.36, tiltX = 0, yaw = 0) {
  if (!gr?.G?.shockRing) return;
  const swMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colHex).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const swMesh = new THREE.Mesh(gr.G.shockRing, swMat);
  swMesh.position.set(x, y, z);
  swMesh.rotation.order = 'YXZ';
  swMesh.rotation.y = -yaw;
  swMesh.rotation.x = tiltX;
  gr.scene.add(swMesh);
  shockwaves.push({ mesh: swMesh, t: 0, dur, max: maxRad, dead: false });
}

function spawnImpactBurst3D(x, y, z, yaw, colHex, scale = 1.0, groundRing = false) {
  spawnSlashArc3D(x, y, z, yaw, 0.42, colHex, 1.05 * scale);
  spawnSlashArc3D(x, y, z, yaw, -0.42, 0xfff4d6, 0.78 * scale);
  spawnShockRing3D(x, y, z, colHex, 1.65 * scale, 0.24, Math.PI * 0.5, yaw + Math.PI * 0.5);
  if (groundRing) {
    spawnShockRing3D(x, 0.08, z, colHex, 3.8 * scale, 0.40, 0, 0);
  }
}

function syncProgressionToActors(healFull = false) {
  P.applyProgression(prog, healFull);
  duel.applyProgression(prog);
  score = prog.totalEarned;
}

function awardPoints(amount, x, y, z, label = '') {
  const gain = prog.addPoints(amount);
  if (!gain) return 0;
  score = prog.totalEarned;
  saveBest();
  if (x !== undefined && z !== undefined) {
    pushHitNum(x, (y ?? 1.5) + 0.55, z, `+${gain} 积分${label ? ' · ' + label : ''}`, '#ffe272', gain >= 300 ? 1.65 : 1.18);
  }
  return gain;
}

function buildBossFogGateVisuals() {
  bossGateVisual = null;
  bossGateCollider = null;
  const br = level.bossRoom;
  if (!br || !worldGroup) return;

  const grp = new THREE.Group();
  const gateW = br.gateHalfW * 2;
  const gateH = 4.9;
  const gz = br.gateZ - 0.5;

  // Translucent swirling golden-crimson Boss Fog Curtain (two layered mist planes for rich depth)
  const fogGeo = new THREE.PlaneGeometry(gateW, gateH);
  const fogMatA = new THREE.MeshBasicMaterial({
    color: 0xffb848,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  fogMatA.userData.own = true;
  const planeA = new THREE.Mesh(fogGeo, fogMatA);
  planeA.position.set(br.gateX, gateH * 0.5, gz);
  grp.add(planeA);

  const fogMatB = new THREE.MeshBasicMaterial({
    color: 0xe63826,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  fogMatB.userData.own = true;
  const planeB = new THREE.Mesh(fogGeo.clone(), fogMatB);
  planeB.position.set(br.gateX, gateH * 0.5, gz - 0.28);
  grp.add(planeB);

  // Twin crimson-brass pillar braziers framing the Boss Gate entrance
  for (const side of [-1, 1]) {
    const px = br.gateX + side * (br.gateHalfW - 0.2);
    const pillar = new THREE.Mesh(gr.G.box, gr.M.dark);
    pillar.scale.set(0.42, 1.35, 0.42);
    pillar.position.set(px, 0.68, br.gateZ + 0.55);
    grp.add(pillar);
    const emberMat = new THREE.MeshBasicMaterial({
      color: 0xff4228,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    emberMat.userData.own = true;
    const brazier = new THREE.Mesh(gr.G.sphLo, emberMat);
    brazier.scale.setScalar(0.28);
    brazier.position.set(px, 1.52, br.gateZ + 0.55);
    grp.add(brazier);
    const glow = new THREE.Sprite(gr.M.glowSprite);
    glow.position.set(px, 1.65, br.gateZ + 0.55);
    glow.scale.set(2.4, 2.4, 1);
    grp.add(glow);
  }

  worldGroup.add(grp);
  bossGateVisual = { grp, planeA, planeB, matA: fogMatA, matB: fogMatB };

  // Solid physical Fog Barrier sealing the Boss Room (before entry & during Boss duel!)
  bossGateCollider = physics.addStaticBox(br.gateX, 2.5, gz, br.gateHalfW + 0.15, 2.5, 0.42, 0, { kind: 'wall' }, GROUP_WORLD);
}

function enterBossRoom() {
  const br = level.bossRoom;
  if (!br || br.entered) return;
  br.entered = true;
  br.sealed = true;
  worldPrompt = null;

  // Step hero cleanly through the Crimson Fog Curtain into the enclosed Boss Courtyard!
  P.x = br.gateX;
  P.z = br.entryZ;
  P.y = 0;
  P.vy = 0;
  P.ang = -Math.PI / 2;
  physics.setPlayerPosition(P.x, 0, P.z);

  if (bossGateVisual) {
    bossGateVisual.matA.color.setHex(0xff3022);
    bossGateVisual.matB.color.setHex(0xaa1410);
    bossGateVisual.matA.opacity = 0.62;
    bossGateVisual.matB.opacity = 0.55;
  }

  // Wake the enclosed Boss & lock focus!
  if (level.boss && level.boss.hp > 0) {
    level.boss.bossDormant = false;
    level.boss.awake = true;
    level.boss.sees = true;
    duel.lockTarget = level.boss;
  }
  puff(P.x, 1.2, br.gateZ - 0.5, 36, '#ff6842', 11.0, 0.55);
  spawnShockRing3D(P.x, 0.12, P.z, 0xff3c28, 5.2, 0.50, 0, 0);
  pulseImpactLight(P.x, 1.8, P.z, 0xff4228, 55);
  audio.sfx('perilGong');
  audio.sfx('boom');
  shake = Math.max(shake, 0.42);
  P.addCameraImpact({ fov: 5.0, back: 0.22 });
  duel.flashCallout('雾门封锁！霸王 · 黑 龙 现身！', '#ff5442', 2.4);
  say('已踏入封闭 Boss 死斗场 · 唯有斩杀霸王黑龙方可破雾而出！');
}

function unsealBossRoomOnWin() {
  const br = level.bossRoom;
  if (!br || br.cleared) return;
  br.sealed = false;
  br.cleared = true;
  if (bossGateCollider?.rb) {
    physics.queueRemoveBody(bossGateCollider.rb);
    bossGateCollider = null;
  }
  if (bossGateVisual) {
    spawnShockRing3D(br.gateX, 1.4, br.gateZ - 0.5, 0xffd860, 6.2, 0.65, 0, 0);
    puff(br.gateX, 1.8, br.gateZ - 0.5, 40, '#ffe082', 12.0, 0.65);
    worldGroup?.remove(bossGateVisual.grp);
    disposeHierarchy(bossGateVisual.grp);
    bossGateVisual = null;
  }
}

function buildShrinesAndCachesVisuals() {
  shrineVisuals = [];
  soulCacheVisuals = [];
  if (!worldGroup) return;

  for (const sh of level.shrines || []) {
    const grp = new THREE.Group();
    grp.position.set(sh.x, 0, sh.z);

    const base = new THREE.Mesh(gr.G.box, gr.M.dark);
    base.scale.set(0.68, 0.42, 0.68);
    base.position.y = 0.21;
    grp.add(base);

    const post = new THREE.Mesh(gr.G.cylLo, gr.M.dark);
    post.scale.set(0.14, 1.15, 0.14);
    post.position.y = 0.92;
    grp.add(post);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffd860,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    flameMat.userData.own = true;
    const flame = new THREE.Mesh(gr.G.sphLo, flameMat);
    flame.scale.setScalar(0.24);
    flame.position.y = 1.68;
    grp.add(flame);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffcc52,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    ringMat.userData.own = true;
    const ring = new THREE.Mesh(gr.G.shockRing, ringMat);
    ring.position.y = 0.08;
    ring.scale.setScalar(1.35);
    grp.add(ring);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd258,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    beamMat.userData.own = true;
    const beam = new THREE.Mesh(gr.G.beam, beamMat);
    beam.scale.set(0.32, 9.0, 0.32);
    beam.position.y = 4.5;
    grp.add(beam);

    const glow = new THREE.Sprite(gr.M.glowSprite);
    glow.position.y = 1.65;
    glow.scale.set(2.4, 2.4, 1);
    grp.add(glow);

    worldGroup.add(grp);
    shrineVisuals.push({ sh, grp, flame, ring, beam });
  }

  for (const sc of level.soulCaches || []) {
    const grp = new THREE.Group();
    grp.position.set(sc.x, 0, sc.z);

    const chestMat = new THREE.MeshStandardMaterial({
      color: 0xc89638,
      emissive: 0x624414,
      emissiveIntensity: 0.85,
      metalness: 0.65,
      roughness: 0.32
    });
    chestMat.userData.own = true;
    const chest = new THREE.Mesh(gr.G.box, chestMat);
    chest.scale.set(0.76, 0.46, 0.52);
    chest.position.y = 0.24;
    grp.add(chest);

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x70ecff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    haloMat.userData.own = true;
    const halo = new THREE.Mesh(gr.G.shockRing, haloMat);
    halo.position.y = 0.08;
    halo.scale.setScalar(1.15);
    grp.add(halo);

    const glow = new THREE.Sprite(gr.M.glowSprite);
    glow.position.y = 0.72;
    glow.scale.set(2.0, 2.0, 1);
    grp.add(glow);

    worldGroup.add(grp);
    soulCacheVisuals.push({ sc, grp, halo });
  }
}

function updateWorldInteractions(dt) {
  worldPrompt = null;
  if (!duel.active || duel.mode !== 'campaign') return;

  if (bossGateVisual) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.4);
    const sealed = !!level.bossRoom?.sealed;
    bossGateVisual.matA.opacity = sealed ? 0.54 + pulse * 0.16 : 0.34 + pulse * 0.14;
    bossGateVisual.matB.opacity = sealed ? 0.48 + (1 - pulse) * 0.14 : 0.28 + (1 - pulse) * 0.12;
  }
  for (const sv of shrineVisuals) {
    const p = 0.5 + 0.5 * Math.sin(time * 2.8 + sv.sh.x);
    sv.flame.position.y = 1.65 + p * 0.12;
    sv.ring.scale.setScalar(1.25 + p * 0.22);
    sv.ring.rotation.z = time * 0.7;
  }
  for (const cv of soulCacheVisuals) {
    if (cv.sc.claimed) {
      cv.grp.visible = false;
      continue;
    }
    cv.halo.rotation.z = -time * 1.1;
  }

  // 1. Check optional Soul Cache chest
  for (const sc of level.soulCaches || []) {
    if (!sc.claimed && Math.hypot(sc.x - P.x, sc.z - P.z) < 2.8) {
      worldPrompt = {
        kind: 'cache',
        target: sc,
        text: `[E] 开启${sc.name} (+${sc.points} 积分)`,
        col: '#7cf4ff',
        border: '#64d8ff'
      };
      return;
    }
  }

  // 2. Check Boss Fog Gate entry from outside!
  const br = level.bossRoom;
  if (br && !br.entered && Math.abs(P.x - br.gateX) <= br.gateHalfW + 1.4 && P.z >= br.gateZ - 0.6 && P.z <= br.gateZ + 4.2) {
    worldPrompt = {
      kind: 'fogGate',
      target: br,
      text: '[E] 穿越猩红雾门 · 进入封闭 Boss 死斗场',
      col: '#ff9878',
      border: '#ff4232'
    };
    return;
  }

  // 3. Check nearby Shrine (Site of Grace)
  for (const sh of level.shrines || []) {
    if (Math.hypot(sh.x - P.x, sh.z - P.z) < 3.2) {
      worldPrompt = {
        kind: 'shrine',
        target: sh,
        text: `[E] ${sh.name} · 休整回满 & 积分强化`,
        col: '#ffe282',
        border: '#e5b352'
      };
      return;
    }
  }
}

function interactWorldPrompt() {
  if (!worldPrompt || state !== 'play') return false;
  if (worldPrompt.kind === 'cache') {
    const sc = worldPrompt.target;
    if (sc.claimed) return false;
    sc.claimed = true;
    awardPoints(sc.points, sc.x, 1.0, sc.z, '魂匣');
    puff(sc.x, 0.8, sc.z, 32, '#ffd860', 10.0, 0.55);
    spawnShockRing3D(sc.x, 0.1, sc.z, 0x70ecff, 3.6, 0.42, 0, 0);
    audio.sfx('pick');
    audio.sfx('win');
    duel.flashCallout(`获得 ${sc.name}！+${sc.points} 积分`, '#ffe082', 1.8);
    worldPrompt = null;
    return true;
  }
  if (worldPrompt.kind === 'fogGate') {
    enterBossRoom();
    return true;
  }
  if (worldPrompt.kind === 'shrine') {
    const sh = worldPrompt.target;
    sh.lit = true;
    activeRespawnPos = { x: sh.x, z: sh.z + 1.6, name: sh.name };
    syncProgressionToActors(true);
    puff(sh.x, 1.4, sh.z, 28, '#ffe082', 7.8, 0.52);
    spawnShockRing3D(sh.x, 0.1, sh.z, 0xffd860, 4.2, 0.46, 0, 0);
    audio.sfx('pick');
    say(`已于【${sh.name}】休整：生命/精力/金疮药全部回满！`);
    openArmory();
    return true;
  }
  return false;
}

function drinkHealingFlask() {
  if (state !== 'play' || execSession || P.execT > 0) return false;
  if (P.hp >= P.maxHp) {
    say('生命值已满，无需饮用金疮药');
    return false;
  }
  if ((P.flasks || 0) <= 0) {
    say('金疮药已耗尽！可在赐福灯龛按 [E] 休整补满');
    audio.sfx('tick');
    return false;
  }
  const healed = P.drinkFlask(audio);
  if (healed > 0) {
    puff(P.x, 1.15, P.z, 18, '#6cff9a', 6.4, 0.42);
    spawnShockRing3D(P.x, 0.1, P.z, 0x52eb88, 2.2, 0.34, 0, 0);
    pushHitNum(P.x, 1.9, P.z, `+${healed} 生命`, '#6cff9a', 1.24);
    duel.flashCallout(`饮用金疮药 +${healed}（余 ${P.flasks}/${P.maxFlasks}）`, '#7effa8', 1.2);
    return true;
  }
  return false;
}

function duelCtx() {
  return {
    level,
    player: P,
    melee,
    physics,
    audio,
    postureMult: prog.weaponPostureMult,
    callbacks: {
      hurtPlayer,
      onCampaignBossDefeated: boss => {
        unsealBossRoomOnWin();
        prog.recordBossKill();
        campaignWinT = 1.65;
        duel.flashCallout('霸王黑龙伏诛！+350 战功积分！', '#ffe078', 3.2);
        audio.sfx('win');
      },
      onParry: (e, pos) => {
        puff(pos.x, pos.y, pos.z, 34, '#fff8d4', 12.8, 0.30);
        puff(pos.x, pos.y, pos.z, 18, '#ff9824', 9.2, 0.36);
        spawnImpactBurst3D(pos.x, pos.y, pos.z, P.ang, 0xffe478, 1.25, false);
        pulseImpactLight(pos.x, pos.y, pos.z, 0xffe070, 46);
        impactFlash = 0.72;
        impactFlashCol = '#ffe278';
        impactLinesT = 0.22;
        impactLinesCol = '#ffe896';
        hitstopT = Math.max(hitstopT, 0.092);
        hitstopShake = 0.32;
        P.addCameraImpact({ fov: 3.8, roll: -0.036, back: 0.14 });
        hitMark = 0.20;
        headMark = 0.34;
        pushHitNum(pos.x, pos.y + 0.35, pos.z, '完美弹反!', '#ffe478', 1.32);
      },
      onBlock: (e, pos, guardCounterReady = false) => {
        puff(pos.x, pos.y, pos.z, 20, '#ffe088', 8.8, 0.24);
        puff(pos.x, pos.y, pos.z, 10, '#ff9a32', 6.4, 0.26);
        spawnSlashArc3D(pos.x, pos.y, pos.z, P.ang, 0.35, guardCounterReady ? 0xffe678 : 0xffd878, guardCounterReady ? 1.0 : 0.85);
        pulseImpactLight(pos.x, pos.y, pos.z, guardCounterReady ? 0xffe478 : 0xffd068, guardCounterReady ? 28 : 22);
        hitstopT = Math.max(hitstopT, 0.044);
        hitstopShake = 0.16;
        P.addCameraImpact({ fov: 1.6, roll: 0.018, back: 0.08 });
        pushHitNum(pos.x, pos.y + 0.25, pos.z, guardCounterReady ? '格挡·可防反!' : '格挡', guardCounterReady ? '#ffe278' : '#e6dcc8', guardCounterReady ? 1.04 : 0.92);
      },
      onBladeClash: (e, pos) => {
        puff(pos.x, pos.y, pos.z, 26, '#fff0a4', 10.6, 0.26);
        puff(pos.x, pos.y, pos.z, 14, '#ff9828', 7.6, 0.30);
        spawnImpactBurst3D(pos.x, pos.y, pos.z, P.ang, 0xffd670, 0.92, false);
        pulseImpactLight(pos.x, pos.y, pos.z, 0xffd670, 28);
        hitstopT = Math.max(hitstopT, 0.058);
        hitstopShake = 0.19;
        P.addCameraImpact({ fov: 2.0, roll: 0.022, back: 0.09 });
        hitMark = 0.16;
        pushHitNum(pos.x, pos.y + 0.28, pos.z, '拼刀!', '#ffd872', 1.02);
      },
      onGuardBreak: e => {
        puff(e.x, 1.25, e.z, 40, '#fff098', 12.2, 0.48);
        puff(e.x, 1.2, e.z, 20, '#ff8a28', 8.5, 0.44);
        spawnImpactBurst3D(e.x, 1.28, e.z, P.ang, 0xffd858, 1.55, true);
        pulseImpactLight(e.x, 1.35, e.z, 0xffd860, 54);
        impactFlash = 0.85;
        impactFlashCol = '#ffd860';
        impactLinesT = 0.34;
        impactLinesCol = '#ffe484';
        hitstopT = Math.max(hitstopT, 0.118);
        hitstopShake = 0.40;
        P.addCameraImpact({ fov: 4.6, roll: 0.032, back: 0.20 });
        triggerKillSlow(0.28, 0.34, false);
        pushHitNum(e.x, e.ht * 0.85, e.z, '破 防!', '#ffe468', 1.48);
      },
      onBossPhase2: e => {
        puff(e.x, 1.3, e.z, 44, '#ff5238', 12.5, 0.52);
        puff(e.x, 1.1, e.z, 24, '#ffd068', 9.0, 0.46);
        spawnShockRing3D(e.x, 0.10, e.z, 0xff3624, 6.2, 0.55, 0, 0);
        spawnShockRing3D(e.x, 1.4, e.z, 0xff8a40, 3.2, 0.38, Math.PI * 0.5, e.ang);
        pulseImpactLight(e.x, 1.5, e.z, 0xff3824, 62);
        impactFlash = 0.88;
        impactFlashCol = '#ff3824';
        impactLinesT = 0.40;
        impactLinesCol = '#ff6048';
        shake = Math.max(shake, 0.52);
        P.addCameraImpact({ fov: 5.5, roll: 0.042, back: 0.24 });
        pushHitNum(e.x, e.ht + 0.15, e.z, '霸王狂化!', '#ff4838', 1.5);
      },
      onEnemyEvade: (e, kind) => {
        puff(e.x, 0.16, e.z, 18, '#b8d8ee', 6.8, 0.34);
        spawnShockRing3D(e.x, 0.12, e.z, 0x96dcff, 1.85, 0.28, 0, 0);
        pushHitNum(e.x, e.ht * 0.78, e.z, kind === 'backflip' ? '后空翻避锋!' : '侧跃闪身!', '#96e8ff', 1.12);
      },
      onEnemyEvadeMiss: (e, pt) => {
        puff(pt.x, pt.y, pt.z, 14, '#c4e6ff', 6.0, 0.24);
        pushHitNum(e.x, e.ht * 0.86, e.z, '闪 避!', '#88e8ff', 1.15);
      },
      onBossUltStart: (ultId, e) => {
        const isPeril = !!BOSS_ULTIMATES[ultId]?.peril;
        const col = isPeril ? 0xff3624 : 0xffb840;
        puff(e.x, 1.1, e.z, 26, isPeril ? '#ff4a38' : '#ffd860', 8.5, 0.40);
        spawnShockRing3D(e.x, 0.14, e.z, col, 3.4, 0.44, 0, 0);
        pulseImpactLight(e.x, 1.4, e.z, col, 46);
        shake = Math.max(shake, 0.24);
      },
      onBossHeavySmash: (e, pos) => {
        spawnShockRing3D(pos.x, pos.y, pos.z, 0xff5a30, pos.rad * 1.05, 0.36, 0, 0);
        spawnSlashArc3D(pos.x, 1.05, pos.z, e.ang, 1.48, 0xff4632, 1.75);
        puff(pos.x, 0.25, pos.z, 28, '#ff7a42', 10.5, 0.42);
        pulseImpactLight(pos.x, 0.9, pos.z, 0xff5228, 46);
        shake = Math.max(shake, 0.36);
      },
      onBossUltImpact: (ultId, e, pos) => {
        if (ultId === 'bossLeapSlam') {
          const isAfter = pos.wave === 2;
          spawnShockRing3D(pos.x, 0.08, pos.z, isAfter ? 0xff4028 : 0xffe490, pos.rad * 0.92, 0.42, 0, 0);
          spawnShockRing3D(pos.x, 0.11, pos.z, 0xff3020, pos.rad * 1.18, 0.62, 0, 0);
          if (!isAfter) {
            spawnSlashArc3D(pos.x, 1.35, pos.z, e.ang, 1.50, 0xff4632, 2.55);
            spawnSlashArc3D(pos.x, 1.25, pos.z, e.ang, 1.40, 0xffe488, 1.85);
          }
          puff(pos.x, 0.28, pos.z, isAfter ? 58 : 48, isAfter ? '#ff4428' : '#ff7840', 15.5, 0.58);
          puff(pos.x, 0.36, pos.z, 32, '#8a8278', 9.8, 0.64);
          pulseImpactLight(pos.x, 1.1, pos.z, 0xff3c24, isAfter ? 86 : 78);
          impactFlash = 0.88;
          impactFlashCol = '#ff4028';
          impactLinesT = 0.40;
          impactLinesCol = '#ff9252';
          shake = Math.max(shake, isAfter ? 0.72 : 0.64);
          P.addCameraImpact({ fov: 6.4, roll: 0.050, back: 0.30 });
        } else if (ultId === 'bossWhirlwind') {
          const wv = pos.wave || 1;
          spawnSlashArc3D(pos.x, pos.y, pos.z, e.ang + wv * 1.9, 0.04, 0xff5a2c, 2.45);
          spawnSlashArc3D(pos.x, pos.y + 0.08, pos.z, e.ang + wv * 1.9 + Math.PI, -0.04, 0xffe078, 2.15);
          spawnShockRing3D(pos.x, pos.y - 0.15, pos.z, 0xff8830, pos.rad * 1.08, 0.32, 0, 0);
          puff(pos.x, pos.y, pos.z, 26, '#ffaa48', 10.4, 0.32);
          pulseImpactLight(pos.x, pos.y, pos.z, 0xff8028, 48);
          shake = Math.max(shake, 0.32);
        } else if (ultId === 'bossDashThrust') {
          spawnSlashArc3D(pos.x, pos.y, pos.z, pos.ang, 0.08, 0xff3624, 2.25);
          spawnSlashArc3D(pos.x, pos.y, pos.z, pos.ang, -0.14, 0xffe288, 1.65);
          spawnShockRing3D(pos.x, 0.12, pos.z, 0xff402c, (pos.rad || 3.4) * 1.1, 0.38, 0, 0);
          puff(pos.x, pos.y, pos.z, 36, '#ff6038', 12.2, 0.38);
          pulseImpactLight(pos.x, pos.y, pos.z, 0xff3e28, 60);
          impactFlash = 0.64;
          impactFlashCol = '#ff4430';
          impactLinesT = 0.32;
          impactLinesCol = '#ff8664';
          shake = Math.max(shake, 0.48);
        } else if (ultId === 'bossQuakeNova') {
          const isOuter = pos.wave === 2;
          spawnShockRing3D(pos.x, 0.08, pos.z, 0xffe088, pos.rad * 0.88, 0.44, 0, 0);
          spawnShockRing3D(pos.x, 0.12, pos.z, 0xff281c, pos.rad * 1.12, 0.66, 0, 0);
          spawnSlashArc3D(pos.x, 1.3, pos.z, e.ang, 0.05, 0xff3422, isOuter ? 2.85 : 2.25);
          spawnSlashArc3D(pos.x, 1.3, pos.z, e.ang + Math.PI * 0.5, 0.05, 0xffb840, isOuter ? 2.55 : 1.95);
          puff(pos.x, 0.32, pos.z, isOuter ? 68 : 52, isOuter ? '#ff3824' : '#ff9838', 16.5, 0.62);
          pulseImpactLight(pos.x, 1.2, pos.z, 0xff2e1e, isOuter ? 92 : 76);
          impactFlash = 0.92;
          impactFlashCol = '#ff3020';
          impactLinesT = 0.46;
          impactLinesCol = '#ff7250';
          shake = Math.max(shake, isOuter ? 0.78 : 0.62);
          P.addCameraImpact({ fov: 6.8, roll: isOuter ? -0.052 : 0.052, back: 0.32 });
        }
      }
    }
  };
}

function handleUltImpact(ultName, def, atk) {
  const c = Math.cos(P.ang);
  const s = Math.sin(P.ang);
  const rad = def.aoeRad || 3.2;

  if (ultName === 'iaido') {
    const cx = P.x + c * 2.0;
    const cz = P.z + s * 2.0;
    spawnSlashArc3D(cx, 1.24, cz, P.ang, 0.06, 0x70ecff, 1.85);
    spawnSlashArc3D(cx, 1.18, cz, P.ang, -0.18, 0xfff0b0, 1.45);
    spawnShockRing3D(cx, 1.2, cz, 0x70ecff, 2.8, 0.30, Math.PI * 0.5, P.ang + Math.PI * 0.5);
    pulseImpactLight(cx, 1.3, cz, 0x70ecff, 50);
    puff(cx, 1.18, cz, 30, '#9cf4ff', 10.2, 0.34);
    puff(cx, 1.12, cz, 16, '#fff4cc', 8.0, 0.28);
    impactFlash = 0.58;
    impactFlashCol = '#7ceeff';
    impactLinesT = 0.32;
    impactLinesCol = '#9cf4ff';
    P.addCameraImpact({ fov: 5.0, roll: -0.038, back: 0.20 });
    triggerKillSlow(0.24, 0.36, false);
  } else if (ultName === 'cleave') {
    const sx = P.x + c * 1.5;
    const sz = P.z + s * 1.5;
    // Double concentric molten ground-shatter shockwave rings
    spawnShockRing3D(sx, 0.08, sz, 0xfff0a8, rad * 0.85, 0.34, 0, 0);
    spawnShockRing3D(sx, 0.10, sz, 0xff9e2c, rad * 1.35, 0.48, 0, 0);
    spawnSlashArc3D(sx, 1.15, sz, P.ang, 1.50, 0xffc858, 1.95);
    spawnSlashArc3D(sx, 1.10, sz, P.ang, 1.42, 0xfff4c8, 1.45);
    pulseImpactLight(sx, 1.0, sz, 0xffb840, 64);
    puff(sx, 0.25, sz, 40, '#ffd478', 12.0, 0.50);
    puff(sx, 0.32, sz, 24, '#827c72', 7.8, 0.58);
    audio.sfx('boom');
    impactFlash = 0.78;
    impactFlashCol = '#ffd068';
    impactLinesT = 0.38;
    impactLinesCol = '#ffe290';
    P.addCameraImpact({ fov: 5.8, roll: 0.044, back: 0.26 });
    hitstopT = Math.max(hitstopT, 0.125);
    hitstopShake = 0.48;
  } else if (ultName === 'whirlwind') {
    const wIdx = atk?.waveIdx || 0;
    spawnSlashArc3D(P.x, 1.16, P.z, P.ang + wIdx * 2.1, 0.04, 0xff8c48, 1.92);
    spawnSlashArc3D(P.x, 1.18, P.z, P.ang + wIdx * 2.1 + Math.PI, -0.05, 0xffe488, 1.65);
    spawnShockRing3D(P.x, 1.05, P.z, 0xffaa44, rad * 1.08, 0.28, 0, 0);
    pulseImpactLight(P.x, 1.2, P.z, 0xff9440, 38);
    puff(P.x, 1.05, P.z, 22, '#ffbe68', 8.8, 0.28);
    impactLinesT = Math.max(impactLinesT, 0.22);
    impactLinesCol = '#ffc478';
    P.addCameraImpact({ fov: 2.8, roll: wIdx % 2 ? -0.032 : 0.032, back: 0.12 });
  }

  // Deliver AOE strike to all enemies inside ultimate radius (not already struck in this wave)
  const ox = ultName === 'cleave' ? P.x + c * 1.45 : ultName === 'iaido' ? P.x + c * 1.6 : P.x;
  const oz = ultName === 'cleave' ? P.z + s * 1.45 : ultName === 'iaido' ? P.z + s * 1.6 : P.z;
  for (const e of level.enemies) {
    if (e.hp <= 0 || e.executing || atk?.hit?.has(e)) continue;
    const dx = e.x - ox;
    const dz = e.z - oz;
    const d = Math.hypot(dx, dz);
    if (d > rad + (e.r || 0.56)) continue;
    atk?.hit?.add(e);
    const ndx = d > 0.01 ? dx / d : c;
    const ndz = d > 0.01 ? dz / d : s;
    const pt = new THREE.Vector3(e.x, 1.2, e.z);
    const dir = new THREE.Vector3(ndx, 0, ndz);
    meleeHitEnemy(e, pt, dir, def);
  }
}

function meleeHitEnemy(e, pt, dir, def) {
  if (duel.active && e.duel) {
    const res = duel.resolvePlayerHit(e, def, pt, dir, duelCtx());
    if (res === 'evaded') return;
    if (res === 'blocked') {
      level.moveEnt(e, dir.x * 0.28, dir.z * 0.28);
      return;
    }
  }
  const k = (e.ht || 1.8) / 1.8;
  const head = pt.y > enemyStanceHeight(e) - 0.3 * k;
  const part = classifyHit(e, pt, head);
  const ctx = makeLogicCtx();
  ctx.hitImpulse = def.heavy ? 11.2 : 6.4;
  const brokenBonus = duel.active && e.duel?.state === 'broken';
  const dmgScale = brokenBonus ? 1.35 : 1;
  const progMult = prog.weaponDmgMult * (def.ult ? prog.ultDmgMult : 1);
  const finalDmg = def.dmg * (head ? 1.45 : 1) * dmgScale * progMult;
  enemyMgr.hitEnemy(e, finalDmg, dir.x, dir.z, pt.y, ctx, head, 0, part);
  e.flinch = Math.max(e.flinch || 0, def.heavy ? 1.15 : 0.72);
  if (e.hp > 0) level.moveEnt(e, dir.x * def.knock * 1.22, dir.z * def.knock * 1.22);

  // Layered visceral flesh impact VFX: arterial spray + metallic cut sparks + HDR slash cross + point light pulse
  bloodSpray(pt.x, pt.y, pt.z, dir.x, dir.z, def.heavy ? 38 : 24, def.heavy ? 8.4 : 6.0);
  puff(pt.x, pt.y, pt.z, def.heavy ? 22 : 12, def.ult === 'iaido' ? '#9cf4ff' : '#ffe296', def.heavy ? 10.5 : 7.5, 0.24);
  const cutYaw = Math.atan2(dir.z, dir.x);
  const tilt = def.name === 'chop' || def.ult === 'cleave' ? 1.45 : def.name === 'spin' || def.ult === 'whirlwind' ? 0.06 : melee.combo % 2 ? 0.42 : -0.42;
  const arcHex = def.ult === 'iaido' ? 0x80f0ff : def.guardCounter ? 0xffe670 : def.heavy ? 0xffc864 : prog.weaponAuraHex;
  spawnSlashArc3D(pt.x, pt.y, pt.z, cutYaw, tilt, arcHex, def.guardCounter ? 1.48 : def.heavy ? 1.32 : 0.94);
  if (def.guardCounter || def.heavy || head || brokenBonus) {
    spawnShockRing3D(pt.x, pt.y, pt.z, arcHex, def.guardCounter ? 2.25 : def.heavy ? 1.95 : 1.35, 0.24, Math.PI * 0.5, cutYaw + Math.PI * 0.5);
  }
  pulseImpactLight(pt.x, pt.y, pt.z, arcHex, def.guardCounter ? 42 : def.heavy ? 36 : 18);

  if (duel.active) {
    const numCol = brokenBonus || def.ult || def.guardCounter ? '#ffe268' : head ? '#ff6a4c' : def.heavy ? '#ffc46a' : '#f8f0dc';
    pushHitNum(
      pt.x,
      pt.y + 0.35,
      pt.z,
      `${def.guardCounter ? '防反 ' : ''}-${Math.round(finalDmg)}${def.heavy || head ? '!' : ''}`,
      numCol,
      def.ult ? 1.36 : def.guardCounter ? 1.28 : def.heavy || head ? 1.18 : 0.96
    );
  }

  const blood = playerMesh?.userData.bladeBlood;
  if (blood) blood.value = Math.min(1, blood.value + 0.45);
  audio.sfx(def.heavy ? 'chopHit' : 'slashHit');
  const killed = e.hp <= 0;
  if (killed) audio.sfx(head ? 'killHead' : 'killConfirm');

  const rollSign = def.heavy ? 0.036 : (melee.combo % 2 ? -0.028 : 0.028);
  P.addCameraImpact({
    fov: def.heavy ? (killed ? 4.8 : 3.8) : (killed ? 2.8 : 2.1),
    roll: rollSign,
    back: def.heavy ? 0.18 : 0.08
  });
  hitstopT = Math.max(hitstopT, killed ? (def.heavy ? 0.125 : 0.082) : def.hitstop);
  hitstopShake = killed ? Math.max(def.shake, 0.36) : def.shake;
  hitMark = 0.18;
  if (head || def.heavy) headMark = 0.30;
  if (killed) {
    killMark = 0.46;
    const remAlive = level.enemies.some(o => o.hp > 0 && !o.disarmed);
    if (e.type === 'boss') triggerKillSlow(0.62, 0.26, true);
    else if (!remAlive) triggerKillSlow(0.45, 0.28, true);
    else if (def.heavy || head) triggerKillSlow(0.24, 0.36, false);
  }
  if (!duel.active) {
    for (const o of level.enemies) {
      if (!o.awake && Math.hypot(o.x - P.x, o.z - P.z) < 14) enemyMgr.wake(level, o);
    }
  }
}

// What the blade struck besides men: wood and paper give way, stone and iron stop it dead
function meleeHitProp(hit, dir, def) {
  const meta = hit.meta;
  const kind = meta?.kind;
  const pt = hit.point;
  const n = hit.normal;
  if (kind === 'crate') {
    damageTile(meta.tx, meta.tz, def.heavy ? 999 : 55, dir.x, 0.3, dir.z);
    audio.sfx('woodChop');
    puff(pt.x, pt.y, pt.z, 10, '#a0733f', 4.5, 0.4);
    hitstopT = Math.max(hitstopT, 0.04);
    hitstopShake = 0.1;
    return 'cut';
  }
  if (kind === 'lantern') {
    if (physics.hitLantern(meta.entry, dir.x * 2, 1, dir.z * 2, 1.2)) audio.sfx('glass');
    puff(pt.x, pt.y, pt.z, 10, '#ff6830', 5, 0.4);
    return 'cut';
  }
  if (pt.y < 0.08 && n.y > 0.7) return null; // skimming the cobbles
  const metal = kind === 'barrel' || kind === 'metal';
  if (kind === 'barrel') {
    const rb = hit.collider?.parent();
    if (rb) {
      rb.wakeUp();
      rb.applyImpulseAtPoint({ x: dir.x * 3, y: 0.4, z: dir.z * 3 }, pt, true);
    }
  }
  puff(pt.x, pt.y, pt.z, metal ? 14 : 9, '#ffd27a', 7.5, 0.22);
  if (!metal) puff(pt.x, pt.y, pt.z, 6, '#9a948a', 2.4, 0.5);
  bulletHole(pt.x, pt.y, pt.z, n.x, n.y, n.z);
  audio.sfx(metal ? 'bladeClang' : 'stoneClang');
  hitstopT = Math.max(hitstopT, 0.06);
  hitstopShake = 0.16;
  return 'bounce';
}

let lastMoveTap = { code: '', at: 0 };

function tryDodgeRoll(forcedAxes = null) {
  if (state !== 'play' || execSession || P.execT > 0 || !P.canRoll()) return false;
  const inCombat = isInActiveCombat();
  if (inCombat && P.stamina <= 0.5) {
    meleeCtx.onStaminaEmpty();
    return false;
  }
  if (melee.drawn && melee.busy && !melee.cancelForDodge()) return false;
  if (!P.roll(input, audio, forcedAxes)) return false;
  // Atomic stamina deduction: ONLY consumes stamina AFTER roll genuinely launches (and 0 out of combat like Elden Ring!)
  if (inCombat) P.consumeStamina(11, 0.36);
  puff(P.x, 0.16, P.z, 12, '#a8cee8', 5.6, 0.26);
  if (duel.active) {
    spawnShockRing3D(P.x, 0.08, P.z, 0x8cd8ff, 1.35, 0.22, 0, 0);
    P.addCameraImpact({ roll: (P.rollLocalR || 0) * 0.026, fov: 1.5, back: 0.05 });
  }
  return true;
}

function tryQuickStep() {
  if (state !== 'play' || execSession || deadEye.busy || P.execT > 0 || !P.canQuickStep()) return false;
  const inCombat = isInActiveCombat();
  if (inCombat && P.stamina <= 0.5) {
    meleeCtx.onStaminaEmpty();
    return false;
  }
  if (melee.drawn && melee.busy && !melee.cancelForDodge()) return false;
  P.rootT = 0;
  if (!P.quickStep(input, audio)) return false;
  if (inCombat) P.consumeStamina(8, 0.32);
  puff(P.x, 0.14, P.z, 8, '#a8cee8', 4.4, 0.22);
  return true;
}

function toggleBlade() {
  if (state !== 'play' || execSession || P.execT > 0 || deadEye.volley || P.rollT > 0 || P.stepT > 0) return;
  if (melee.drawn) {
    if (!P.hasGun) {
      say('尚未缴获火器，击毙本关头目可夺取他的武器！');
      return;
    }
    if (!melee.busy) melee.sheathe(meleeCtx);
    return;
  }
  P.cancelReload();
  melee.draw(meleeCtx);
  say('大刀出鞘 · 左键连斩 · 右键回旋斩 · [4] 收刀');
}

// Switching to a gun puts the blade away at once
function sheatheForGun() {
  if (!melee.drawn || !P.hasGun) return;
  melee.reset();
  audio.sfx('bladeSheathe');
}

// Shot out of the hand: the enemy's weapon spins away as a physics prop
function dropEnemyGun(e, dx, dz) {
  const u = e.mesh?.userData;
  if (!u?.gun?.visible) return;
  u.gun.updateWorldMatrix(true, false);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  u.gun.matrixWorld.decompose(p, q, sc);
  const m = new THREE.Mesh(u.gun.geometry, u.gun.material);
  m.scale.copy(sc);
  m.castShadow = true;
  worldGroup.add(m);
  physics.spawnDynamicDebris(
    m, p.x, p.y, p.z, 0.15 * sc.x, 0.045 * sc.y, 0.03 * sc.z,
    dx * 2.6 + rnd(-0.8, 0.8), rnd(2.2, 3.4), dz * 2.6 + rnd(-0.8, 0.8),
    rnd(-9, 9), rnd(-12, 12), rnd(-9, 9), 14
  );
  u.gun.visible = false;
  u.glint.visible = false;
  puff(p.x, p.y, p.z, 8, '#ffd27a', 6.5, 0.2);
  audio.sfx('ricochet');
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
      radio: enemyRadio,
      poseCorpse: (m, dirSign) => cf.poseCorpse(m, dirSign),
      spawnFlyingHat,
      addShake: v => { shake = Math.max(shake, v); },
      shootBullet,
      puff,
      dropAt,
      explode,
      dropGun: dropEnemyGun,
      playDeathClip: (e, part, dx, dz) => cf.playDeathClip(e.mesh, deathClipFor(e, part, dx, dz, e.mesh?.userData.clips)),
      onEnemyKilled: (e, head) => {
        kills++;
        P.focus = Math.min(100, P.focus + (head ? 24 : 14));
        const pts = e.pointsReward || (e.type === 'boss' ? ENEMY_POINT_REWARDS.boss : 25);
        if (duel.mode === 'campaign') {
          awardPoints(pts, e.x, e.ht * 0.85, e.z, e.type === 'boss' ? '霸王讨伐' : '斩敌');
        } else {
          score += pts;
        }
        decal(e.x, e.z, e.r * 1.4, false);
        puff(e.x, 1.1, e.z, 16, '#8e1a14', 7.5, 0.6);
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
    if (o.isInstancedMesh) o.dispose();
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

function buildLevelWorld(lvlIndex, dojoPreset = null, useShrineRespawn = false) {
  if (worldGroup) {
    gr.scene.remove(worldGroup);
    disposeHierarchy(worldGroup);
  }
  cf.clearDying();

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
  closeLine = null;
  activeVoiceSource = null;
  encounters.reset();
  lastCallout.clear();
  dialogue.stop();
  bossConfronted = false;
  execTarget = null;
  execSession = null;
  worldPrompt = null;
  bossGateVisual = null;
  bossGateCollider = null;
  shrineVisuals = [];
  soulCacheVisuals = [];
  campaignWinT = 0;
  staminaEmptyCd = 0;
  cancelThrowAim();
  hitstopT = 0;
  freezeFrameT = 0;
  killSlowT = 0;
  killSlowDur = 0;
  killSlowCd = 0;
  execFX.k = execFX.flash = execFX.dash = execFX.freeze = 0;
  execFX.impactPos = null;
  for (const fx of execVfxList) {
    gr.scene.remove(fx.mesh);
    if (fx.ownMat) fx.mesh.material.dispose();
  }
  execVfxList = [];
  for (const tr of enemyTrails) tr.dispose();
  enemyTrails = [];
  hitNums = [];
  impactFlash = 0;
  impactLinesT = 0;

  physics.reset();

  if (dojoPreset) {
    duel.reset(dojoPreset.id, 'dojo');
    duel.active = true;
    level.generateDojo(dojoPreset);
  } else {
    duel.reset('duelBoss', 'campaign');
    duel.active = true;
    level.generate(0);
  }
  const cfg = level.cfg;
  planted = 0;
  timeLeft = 0;

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
  propInstancer = propRes.instancer;
  steamSprites = propRes.steamSprites || [];
  batchStatic(worldGroup, { exclude: new Set(archRes.reflectHide) });
  spriteBatcher = new SpriteBatcher(worldGroup);
  spriteBatcher.build();
  pruneEmptyGroups(worldGroup);
  worldGroup.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every(m => m?.userData?.noReflect)) o.layers.set(LAYER_NO_REFLECT);
  });

  exitMesh = null;
  if (!dojoPreset) {
    buildBossFogGateVisuals();
    buildShrinesAndCachesVisuals();
  }

  if (bossTelegraphRing) bossTelegraphRing.visible = false;
  if (!bossTelegraphRing && gr?.G?.shockRing) {
    const trMat = new THREE.MeshBasicMaterial({
      color: 0xff3624,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    bossTelegraphRing = new THREE.Mesh(gr.G.shockRing, trMat);
    bossTelegraphRing.visible = false;
    gr.scene.add(bossTelegraphRing);
  }

  // Pure Cold-Weapon Enemies & Bosses (zero firearms!)
  for (const e of level.enemies) {
    e.mesh = cf.createPerson(e.duelStyleKey || e.type, 'knife');
    const sc = e.duelSpec?.scale || e.scale || 1;
    const bulk = sc > 1.2 ? 1.06 : 1;
    e.mesh.scale.set(sc * bulk, sc, sc * bulk);
    const weaponKind = e.duelSpec?.weaponKind || (e.type === 'boss' ? 'guandao' : 'spear');
    const blade = cf.attachBlade(e.mesh, weaponKind);
    if (e.mesh.userData.gun) e.mesh.userData.gun.visible = false;
    if (blade && e.mesh.userData.glint) {
      const meta = e.mesh.userData.bladeMeta || BLADE;
      const gl = e.mesh.userData.glint;
      gl.material = gl.material.clone();
      gl.material.userData.own = true;
      gl.scale.setScalar(0.085);
      gl.position.set(meta.tipX * 0.92, 0.03, 0);
      blade.add(gl);
    }
    duel.initDuelist(e, e.duelSpec || { name: e.type, weaponKind, hp: e.hp, maxPosture: 100 });
    e.duelTrail = new BladeTrail(gr.scene, 18, 0.16);
    enemyTrails.push(e.duelTrail);
    worldGroup.add(e.mesh);
    e.phys = physics.createEnemyCollider(e, e.x, e.z, e.r, e.ht);
  }

  // Player mesh & Rapier capsule controller (100% Pure Cold-Weapon!)
  if (playerMesh) {
    gr.scene.remove(playerMesh);
    disposeHierarchy(playerMesh);
  }
  playerMesh = cf.createPerson('hero', 'pistol', heroPreset.id);
  if (playerMesh.userData.gun) playerMesh.userData.gun.visible = false;
  P.mesh = playerMesh;
  gr.scene.add(playerMesh);

  P.unlockedWeapons = [];
  P.loadout = [];
  P.gun = -1;
  P.nades = 0;
  P.molo = 0;
  const spawnX = !dojoPreset && useShrineRespawn && activeRespawnPos ? activeRespawnPos.x : level.startPos.x;
  const spawnZ = !dojoPreset && useShrineRespawn && activeRespawnPos ? activeRespawnPos.z : level.startPos.z;
  P.resetForLevel(spawnX, spawnZ);
  syncProgressionToActors(true);
  physics.createPlayer(P.x, P.y, P.z);
  physics.warmupStep();

  kills = 0;
  banner = 3.2;
  shake = 0;
  hurtFlash = 0;
  recentHitT = 0;
  flowT = 0;
  lampT = 0;
  radioT = 0;
  lightningT = 6.5;
  lightningFlash = 0;
  P.bulletTime = false;
  P.btK = 0;
  P.diveT = 0;
  deadEye.reset();
  prevFiring = false;
  prevHeavy = false;
  melee.equipInstant();
  P.melee = true;
  if (playerMesh?.userData?.gun) playerMesh.userData.gun.visible = false;
  bladeTrail?.clear();
  hitstopShake = 0.24;
  overMsg = '';
  level.computeFlow(P.x, P.z);
  if (duel.active && duel.mode !== 'campaign') duel.autoLock(level, P);
}

async function startDojo(presetId = 'duel1v1') {
  if (startingLevel) return;
  startingLevel = true;
  try {
    stopHeroSample();
    const preset = DOJO_PRESETS[presetId] || DOJO_PRESETS.duel1v1;
    const needHero = !assets.glb[`hero-${heroPreset.id}`];
    const needTex = assets.levelTexIds(0).some(id => !assets.tex[id]?.diff);
    if (needHero || needTex) {
      await Promise.all([
        needHero ? assets.ensureHeroPreset(heroPreset.id) : Promise.resolve(),
        needTex ? assets.ensureLevelTextures(0) : Promise.resolve()
      ]);
    }
    P.resetAll(false);
    buildLevelWorld(0, preset);
    state = 'play';
    ui.hidden = true;
    armoryEl.hidden = true;
    input.lockPointer();
    audio.startRain();
    audio.setEnvironment('cobble');
    audio.playMusic('noire-crime-time');
    duel.flashCallout(`${preset.label} · 拔刀对决！`, '#ffe082', 2.0);
  } finally {
    startingLevel = false;
  }
}

function unlockLevel(idx) {
  maxUnlockedLvl = 0;
}

async function startLevel(idx = 0, useShrineRespawn = false) {
  if (startingLevel) return;
  startingLevel = true;
  try {
    stopHeroSample();
    const needHero = !assets.glb[`hero-${heroPreset.id}`];
    const needTex = assets.levelTexIds(0).some(id => !assets.tex[id]?.diff);
    if (needHero || needTex) {
      const goBtn = document.getElementById('goBtn');
      if (goBtn) {
        goBtn.disabled = true;
        goBtn.textContent = needHero ? `正在载入${heroPreset.name}造型…` : '正在铺设闸北石库门雨夜长街…';
      }
      await Promise.all([
        needHero ? assets.ensureHeroPreset(heroPreset.id) : Promise.resolve(),
        needTex ? assets.ensureLevelTextures(0) : Promise.resolve()
      ]);
    }
    lvl = 0;
    selectedStartLvl = 0;
    P.resetAll(false);
    buildLevelWorld(0, null, useShrineRespawn);
    state = 'play';
    ui.hidden = true;
    armoryEl.hidden = true;
    input.lockPointer();
    audio.startRain();
    audio.setEnvironment(level.cfg.style);
    audio.playMusic(level.cfg.music);
    duel.flashCallout(
      useShrineRespawn && activeRespawnPos ? `重返【${activeRespawnPos.name}】· 再战石库门！` : '第一关 · 雨夜孤刃 · 杀穿长街！',
      '#ffe082',
      2.2
    );
    say(level.cfg.intro);
  } finally {
    startingLevel = false;
  }
}

function retryLevel() {
  if (startingLevel) return;
  startLevel(0, !!activeRespawnPos);
}

function newGame() {
  if (startingLevel) return;
  activeRespawnPos = null;
  startLevel(0, false);
}

function spawnSlashArc3D(x, y, z, yaw, tiltZ = 0.22, colHex = 0xffbe68, radiusScale = 0.92) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colHex).multiplyScalar(1.75),
    vertexColors: true,
    transparent: true,
    opacity: 0.98,
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

const smooth01 = x => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

function clearExecPath(target) {
  const dx = target.x - P.x, dz = target.z - P.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.01) return true;
  return !physics.castRay(P.x, P.y + 0.75, P.z, dx / distance, 0, dz / distance, distance,
    GROUP_WORLD | GROUP_PROP, physics.playerCollider);
}

function findExecTarget() {
  if (state !== 'play' || execSession || melee.busy || deadEye.busy ||
      input.mouse.down || input.mouse.right || input.touchFire) return null;
  if (duel.active) {
    let best = null;
    let bestD = Infinity;
    for (const e of level.enemies) {
      if (e.hp <= 0 || e.executing || !e.duel || e.duel.state !== 'broken') continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d <= 2.95 && d < bestD && clearExecPath(e)) {
        best = e;
        bestD = d;
      }
    }
    if (best) {
      execKind = 'combat';
      return best;
    }
    return null;
  }
  const stealthTarget = findStealthTarget(level, P, clearExecPath);
  if (stealthTarget) {
    execKind = 'stealth';
    return stealthTarget;
  }
  const combatTarget = findCombatFinisher(level, P, clearExecPath);
  if (combatTarget) {
    execKind = 'combat';
    return combatTarget;
  }
  return null;
}

function tryExecute() {
  if (state !== 'play' || execSession) return;
  const e = findExecTarget();
  if (!e) {
    say(duel.active
      ? '先通过完美弹反、重斩或大招打满对手架势槽使其破防，再按 [E] 一刀绝杀！'
      : '按 C 猫腰或 V 低蹲靠近未警觉敌人背后，或贴近跪地/重伤敌寇按 [E] 处决。');
    return;
  }

  cancelThrowAim();
  P.cancelReload();
  const stealth = execKind === 'stealth';
  const dx = e.x - P.x, dz = e.z - P.z;
  const d = Math.hypot(dx, dz) || 1;
  const yaw = Math.atan2(dz, dx);
  const mx = P.x * 0.46 + e.x * 0.54, mz = P.z * 0.46 + e.z * 0.54;
  const right = physics.castRay(mx, P.y + 1.38, mz, Math.cos(yaw + Math.PI - 0.72), 0, Math.sin(yaw + Math.PI - 0.72), 2.1, GROUP_WORLD, physics.playerCollider);
  const left = physics.castRay(mx, P.y + 1.38, mz, Math.cos(yaw + Math.PI + 0.72), 0, Math.sin(yaw + Math.PI + 0.72), 2.1, GROUP_WORLD, physics.playerCollider);
  const modelKey = P.hasGun ? WEAPONS[P.gun].modelKey : 'pistol';
  const isLongGun = !melee.drawn && P.hasGun && !['pistol', 'browning', 'revolver'].includes(modelKey);
  const standoff = melee.drawn ? 1.22 : stealth ? 0.98 : isLongGun ? 1.48 : 1.26;
  const foeDot = ((P.x - e.x) * Math.cos(e.ang) + (P.z - e.z) * Math.sin(e.ang)) / d;
  const idealEnemyAng = stealth || foeDot < -0.15 ? yaw : Math.atan2(-dz / d, -dx / d);

  e.executing = true;
  e.duck = false;
  P.execT = stealth ? 0.70 : 0.76;
  P.inv = Math.max(P.inv, P.execT + 0.55);
  execTarget = null;
  execFX.dash = 0.25;
  execFX.stealth = stealth;
  if (melee.drawn) melee.playFinisher(meleeCtx);
  execSession = {
    e, stealth, blade: melee.drawn, isLongGun,
    t: 0, dur: P.execT, standoff, remDist: Math.max(0, d - standoff),
    ndx: dx / d, ndz: dz / d, yaw,
    side: !right ? -1 : !left ? 1 : right.dist >= left.dist ? -1 : 1,
    startPlayerAng: P.ang, deltaPlayerAng: Math.atan2(Math.sin(yaw - P.ang), Math.cos(yaw - P.ang)),
    startEnemyAng: e.ang, deltaEnemyAng: clamp(Math.atan2(Math.sin(idealEnemyAng - e.ang), Math.cos(idealEnemyAng - e.ang)), -0.65, 0.65),
    startFlinch: 0, lastEnemyX: e.x, lastEnemyZ: e.z, freezeDrift: 0,
    didSmash: false, didFreeze: false, didKill: false
  };
}

function endExecution() {
  execSession.e.executing = false;
  execSession = null;
  P.execT = 0;
  P.execCam = null;
  freezeFrameT = 0;
  execFX.freeze = 0;
  execFX.impactPos = null;
  if (playerMesh) {
    playerMesh.userData.execPose = null;
    playerMesh.userData.execTwist = 0;
  }
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
  // Once execution starts, commit cleanly through kill; only cancel if target vanished or already died externally.
  if (!s.didKill && (!e || e.hp <= 0 || !level.enemies.includes(e))) {
    endExecution();
    return;
  }
  s.t += dt;
  const t = s.t;
  const smashT = 0.22;
  const killT = s.stealth ? 0.38 : 0.42;

  // Lock player yaw smoothly along execution line for the entire session (zero mouse/edge spin!)
  P.ang = Math.atan2(
    Math.sin(s.startPlayerAng + s.deltaPlayerAng * smooth01(t / 0.16)),
    Math.cos(s.startPlayerAng + s.deltaPlayerAng * smooth01(t / 0.16))
  );

  // Keep the camera and the reserved actor on the same heading through the animation.
  if (e && e.hp > 0) {
    e.ang = s.startEnemyAng + s.deltaEnemyAng * smooth01(t / smashT);
    s.lastEnemyX = e.x;
    s.lastEnemyZ = e.z;
  }

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
  } else {
    s.remDist = 0;
  }

  if (!s.didSmash && t >= smashT) {
    s.didSmash = true;
    audio.sfx(s.blade ? 'swishHeavy' : 'execCrunch');
    hitstopT = 0.038;
    execFX.flash = 0.28;
  }

  if (!s.didFreeze && t >= killT) {
    s.didFreeze = true;
    const hitY = e.downed ? 0.65 : enemyStanceHeight(e) * 0.78;
    const x = (P.x + e.x) * 0.5, z = (P.z + e.z) * 0.5;
    execFX.impactPos = { x, y: hitY, z };
    execFX.blade = s.blade;
    execFX.stealth = s.stealth;
    execFX.stamp = s.blade
      ? (s.stealth ? '刀 光 一 闪' : '斩 首 终 结')
      : s.stealth
        ? '无 声 一 击'
        : '一 枪 绝 杀';
    spawnSlashArc3D(x, hitY, z, s.yaw, -0.16, s.stealth ? 0xd8eeff : 0xffc870, s.stealth ? 0.72 : 0.88);
    if (!s.stealth && !s.blade) {
      const wGun = WEAPONS[P.gun];
      audio.sfx(wGun.snd);
      muzzle = 1.2;
      gr.boomLight.position.set(x, hitY + 0.35, z);
      gr.boomLight.intensity = 12;
      spawnCasing(P.x + s.ndx * 0.4 - s.ndz * 0.14, P.y + 1.38, P.z + s.ndz * 0.4 + s.ndx * 0.14, -s.ndz * 2.4, s.ndx * 2.4);
    } else {
      audio.sfx(s.blade ? 'chopHit' : 'execSlash');
    }
    audio.sfx('execFreeze');
    freezeFrameT = 0.58;
    execFX.freeze = 1;
    execFX.flash = 0.82;
  }

  if (s.didFreeze && !s.didKill && freezeFrameT <= 0) {
    s.didKill = true;
    const ctx = makeLogicCtx();
    ctx.stealthTakedown = s.stealth;
    const bossChunk = Math.round(550 * (0.75 + 0.25 * prog.weaponDmgMult));
    const isDojoBoss = duel.active && e.type === 'boss' && e.hp > bossChunk;
    const dealDmg = isDojoBoss ? bossChunk : e.hp;
    enemyMgr.hitEnemy(e, dealDmg, s.ndx, s.ndz, e.downed ? 0.45 : e.ht * 0.78, ctx, true, s.stealth ? 2.2 : 5.0);
    if (isDojoBoss && e.hp > 0 && e.duel) {
      e.duel.posture = 0;
      e.duel.deathblows = Math.max(1, (e.duel.deathblows || 3) - 1);
      e.duel.state = 'recover';
      e.duel.stateT = 0;
      e.duel.stateDur = 0.65;
      e.react = null;
      const healAmt = Math.round((P.maxHp || 100) * 0.22);
      P.hp = Math.min(P.maxHp || 100, P.hp + healAmt);
      P.restoreStamina?.(40);
      duel.addQi(26);
      duel.reduceCooldowns(2.5);
      spawnImpactBurst3D(e.x, e.ht * 0.7, e.z, s.yaw, 0xff4632, 1.75, true);
      pulseImpactLight(e.x, e.ht * 0.7, e.z, 0xff5232, 60);
      pushHitNum(e.x, e.ht * 0.85, e.z, `-${bossChunk} 忍杀!`, '#ff5840', 1.6);
      impactFlash = 0.85;
      impactFlashCol = '#ff5438';
      impactLinesT = 0.36;
      impactLinesCol = '#ffe082';
      killMark = 0.55;
      audio.sfx('execRelease');
      shake = Math.max(shake, 0.42);
      duel.flashCallout(`忍杀重创！生命+${healAmt} · 刀气+26 · 冷却-2.5s`, '#ffe078', 1.8);
    } else if (e.hp <= 0) {
      const healAmt = Math.round((P.maxHp || 100) * 0.28);
      P.hp = Math.min(P.maxHp || 100, P.hp + healAmt);
      P.restoreStamina?.(50);
      if (duel.active) duel.addQi(32);
      killMark = 0.70;
      headMark = 0.55;
      audio.sfx('execRelease');
      shake = Math.max(shake, 0.24);
      say(`破防一刀绝杀！生命+${healAmt} · 刀气+32`);
    }
  }

  // 100% Continuous Cylindrical Camera Curve (ZERO step jumps on anchor, dist, or FOV!)
  const camIn = smooth01(t / 0.24);
  const camOut = smooth01((s.dur - t) / 0.28);
  const camK = Math.min(camIn, camOut);
  execFX.k = camK;

  const cu = smooth01((t - 0.14) / 0.24);
  const anchorX = P.x * 0.46 + s.lastEnemyX * 0.54;
  const anchorZ = P.z * 0.46 + s.lastEnemyZ * 0.54;

  const baseDist = s.isLongGun ? 1.88 : 1.66;
  const fovKick = s.didKill ? Math.sin(clamp((t - killT) / 0.24, 0, 1) * Math.PI) * 3.2 : 0;

  P.execCam = {
    k: camK,
    mx: anchorX,
    mz: anchorZ,
    yaw: s.yaw,
    side: s.side,
    orbOff: 0.48 + 0.24 * cu,
    dist: baseDist + 0.12 * (1 - cu) + (s.freezeDrift || 0),
    camYOff: 1.30 + 0.12 * cu,
    lookY: 1.32 + 0.10 * cu,
    fov: 43 - 6.5 * cu,
    fovKick,
    roll: -0.026 * s.side * cu
  };

  if (t >= s.dur && freezeFrameT <= 0) endExecution();
}

function renderLoadoutStrip() {
  return (
    `<div class="loadout-strip">` +
    `<span class="loadout-pill"><em>锋刃</em>${prog.weaponTitle} (×${prog.weaponDmgMult.toFixed(2)})</span>` +
    `<span class="loadout-pill"><em>生命</em>${prog.maxHp} HP</span>` +
    `<span class="loadout-pill"><em>精力</em>${prog.maxStamina}</span>` +
    `<span class="loadout-pill"><em>积分</em>${prog.points}</span>` +
    `</div>`
  );
}

function renderArmory() {
  const stats = ['weapon', 'vigor', 'endurance', 'qi'];
  const cardsHtml = stats.map(id => {
    const def = UPGRADE_DEFS[id];
    const lv = prog.levels[id];
    const isMax = lv >= MAX_UPGRADE_LEVEL;
    const cost = prog.costFor(id);
    const canBuy = prog.canAfford(id);
    let pips = '';
    for (let i = 1; i <= MAX_UPGRADE_LEVEL; i++) {
      pips += `<i class="${i <= lv ? 'on' : ''}" style="--accent:${def.accent}"></i>`;
    }
    const curTxt = def.formatCur(prog);
    const nextTxt = isMax ? '已达宗师满阶' : def.formatNext(prog);
    const btnTxt = isMax
      ? '已 达 满 阶'
      : canBuy
        ? `消耗 ${cost} 积分 · 强化至 Lv.${lv + 1}`
        : `需要 ${cost} 积分（差 ${cost - prog.points}）`;
    return (
      `<div class="upg-card${canBuy ? ' can-buy' : ''}">` +
      `<div class="upg-top">` +
      `<div class="upg-title"><span class="upg-badge" style="color:${def.accent}">${def.badge}</span><h3>${def.name}</h3></div>` +
      `<span class="upg-lv">Lv.${lv} / ${MAX_UPGRADE_LEVEL}</span>` +
      `</div>` +
      `<div class="upg-pips">${pips}</div>` +
      `<div class="upg-desc">${def.desc}</div>` +
      `<div class="upg-stat-row"><span>当前：${curTxt}</span><em>→ ${nextTxt}</em></div>` +
      `<button type="button" class="upg-btn" data-upg="${id}"${canBuy ? '' : ' disabled'}>${btnTxt}</button>` +
      `</div>`
    );
  }).join('');

  armoryEl.innerHTML =
    `<div class="armory-panel upg-panel">` +
    `<div class="armory-hdr">` +
    `<div class="armory-title-wrap"><span class="armory-kicker">SHANGHAI 1937 · COLD-STEEL FORGE</span><h2>孤刀锻造 · 赐福强化台</h2>` +
    `<div class="armory-sub">斩杀巡街死士与霸王黑龙赚取<b>战功积分</b>，强化锋刃、血条、精力与刀气修为（阵亡后积分与强化永久保留）</div></div>` +
    `<div class="upg-points"><span>当前战功积分</span><b>${prog.points}</b></div>` +
    `</div>` +
    `<div class="upg-summary">` +
    `<span>当前佩刀：<strong>${prog.weaponTitle}</strong>（伤害 ×${prog.weaponDmgMult.toFixed(2)}）</span>` +
    `<span>体魄：<strong>${prog.maxHp} HP</strong> · 精力：<strong>${prog.maxStamina}</strong> · 金疮药：<strong>×${prog.maxFlasks}</strong></span>` +
    `</div>` +
    `<div class="upg-grid">${cardsHtml}</div>` +
    `<div class="armory-ftr">` +
    `<button type="button" class="link-btn" id="upgResetBtn">重置强化与积分（重新开荒）</button>` +
    `<button type="button" class="go" id="armConfirm">提 刀 返 回 战 斗 [U / Esc]</button>` +
    `</div>` +
    `</div>`;

  armoryEl.querySelectorAll('[data-upg]').forEach(btn => {
    btn.onclick = () => {
      const stat = btn.dataset.upg;
      const res = prog.upgrade(stat);
      if (res.ok) {
        syncProgressionToActors(stat === 'vigor');
        if (stat === 'endurance') P.stamina = P.maxStamina;
        audio.sfx('win');
        say(`★ ${UPGRADE_DEFS[stat].name} 强化至 Lv.${res.level}！`);
        renderArmory();
      } else {
        audio.sfx('tick');
      }
    };
  });

  const resetBtn = document.getElementById('upgResetBtn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      prog.reset();
      activeRespawnPos = null;
      syncProgressionToActors(true);
      audio.sfx('tick');
      say('已重置全部积分与强化等级（Lv.1 开荒模式）');
      renderArmory();
    };
  }
  document.getElementById('armConfirm').onclick = closeArmory;
}

function openArmory() {
  if (state === 'armory') {
    closeArmory();
    return;
  }
  prevArmoryState = state;
  stopHeroSample();
  state = 'armory';
  dialogue.setPaused(true);
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
    if (!melee.drawn) {
      melee.equipInstant();
      P.melee = true;
    }
    state = 'play';
    ui.hidden = true;
    input.lockPointer();
  } else if (target === 'menu') {
    menu();
  } else if (target === 'over') {
    gameOver();
  } else if (target === 'win') {
    levelClear();
  } else if (target === 'pause') {
    state = 'play';
    togglePause();
  } else {
    state = target;
    ui.hidden = false;
  }
}

function heroPicker() {
  const motionBtn = DEV_MODE ? '<button class="motion-open" type="button">动作库</button> ' : '';
  return `<fieldset class="hero-picker" aria-labelledby="hero-label"><legend><span class="hero-heading">
    <span id="hero-label">出场刀客</span><span>${motionBtn}<button class="hero-listen" type="button">试听台词</button></span>
    </span></legend><audio class="hero-sample" preload="none"></audio><div class="hero-options">${HERO_PRESETS.map(preset => {
    return `<label class="hero-option">
      <input type="radio" name="hero-preset" value="${preset.id}" ${preset === heroPreset ? 'checked' : ''}>
      <span class="hero-card">
        <img src="assets/chars/portrait-${preset.id}.webp" alt="" width="1536" height="1024">
        <span class="hero-caption"><small>${preset.role}</small><strong>${preset.name}</strong></span>
        <span class="hero-tick" aria-hidden="true">✓</span>
      </span></label>`;
  }).join('')}</div></fieldset>`;
}

function stopHeroSample() {
  ui.querySelector('.hero-sample')?.pause();
}

function rainControl() {
  const percent = Math.round(audio.rainVolume * 100);
  return `<div class="rain-control"><label for="rain-volume">雨声音量</label>
    <input type="range" id="rain-volume" min="0" max="100" value="${percent}">
    <output for="rain-volume">${percent}%</output></div>`;
}

function panel(html, btn, cb, armBtn = false, footerHtml = '') {
  stopHeroSample();
  dialogue.setPaused(true);
  const secHtml = typeof armBtn === 'string'
    ? armBtn
    : armBtn
      ? `<button class="btn-sec" id="armOpenBtn" type="button">孤刀强化台 · 积分 ${prog.points} [U]</button>`
      : '';
  const rowCls = secHtml ? 'btn-row' : 'btn-row single';
  ui.innerHTML = `<div class="panel">${html}<div class="${rowCls}">${secHtml}<button class="go" id="goBtn" type="button">${btn}</button></div>${footerHtml}</div>`;
  ui.hidden = false;
  input.exitPointerLock();
  const b = document.getElementById('goBtn');
  b.onclick = () => { audio.init(); cb(); };
  const ab = document.getElementById('armOpenBtn');
  if (ab) ab.onclick = () => { audio.init(); openArmory(); };
  const menuBtn = document.getElementById('backMenuBtn');
  if (menuBtn) menuBtn.onclick = () => { audio.init(); buildLevelWorld(0); menu(); };
  ui.querySelectorAll('[data-dojo]').forEach(el => {
    el.onclick = () => { audio.init(); startDojo(el.dataset.dojo); };
  });
  const rf = document.getElementById('restartFirstBtn');
  if (rf) rf.onclick = () => { audio.init(); newGame(); };
  if (DEV_MODE) {
    const motions = ui.querySelector('.motion-open');
    if (motions) motions.onclick = async () => {
      stopHeroSample();
      const [, { MotionLibrary }] = await Promise.all([
        assets.ensureHeroPreset(heroPreset.id),
        import('./ui/MotionLibrary.js')
      ]);
      motionLibrary ??= new MotionLibrary(assets, cf, gr.renderer, disposeHierarchy, onResize);
      motionLibrary.open(heroPreset.id);
    };
  }
  const sample = ui.querySelector('.hero-sample');
  const listen = ui.querySelector('.hero-listen');
  if (sample) {
    const label = (action) => {
      listen.textContent = action === '试听' ? '试听台词' : action;
      listen.setAttribute('aria-label', `${action}${heroPreset.name}的台词`);
    };
    label('试听');
    sample.volume = dialogue.volume;
    sample.onplay = sample.onpause = sample.onended = () => label(sample.paused ? '试听' : '停止试听');
    listen.onclick = () => {
      if (!sample.paused) return sample.pause();
      const url = voiceUrl(heroPreset.id, 'rescue-reply');
      if (sample.error || sample.getAttribute('src') !== url) sample.src = url;
      sample.currentTime = 0;
      sample.play().catch(error => {
        if (error.name !== 'AbortError') label('重新试听');
      });
    };
    ui.querySelectorAll('input[name="hero-preset"]').forEach(inputEl => {
      inputEl.onchange = () => {
        heroPreset = HERO_PRESETS.find(preset => preset.id === inputEl.value);
        sample.pause();
        label('试听');
        try { localStorage.setItem('hsgq_hero', heroPreset.id); } catch {}
        assets.ensureHeroPreset(heroPreset.id);
      };
    });
  }
  const rain = ui.querySelector('#rain-volume');
  if (rain) rain.oninput = () => {
    audio.setRainVolume(rain.valueAsNumber / 100);
    audio.init();
    rain.nextElementSibling.value = `${rain.value}%`;
  };
  b.focus({ preventScroll: true });
  ui.scrollTop = 0;
}

function dojoPickerHtml(activeId = null) {
  const btns = Object.values(DOJO_PRESETS).map(p =>
    `<button type="button" class="level-pill${activeId === p.id ? ' active' : ''}" data-dojo="${p.id}">[${p.key}] ${p.label}</button>`
  ).join('');
  return `<div class="level-picker"><span>快捷演武试刀场：</span>${btns}</div>`;
}

function menu() {
  state = 'menu';
  panel(
    '<div class="sub">SHANGHAI · 1937 · PURE COLD-STEEL SOULS</div><h1>沪上孤刀</h1>' +
    '<div class="deco-rule">◆ 第一关 · 闸北石库门 · 雨夜孤刃 ◆</div>' +
    '<p>纯冷兵器魂系闯关，彻底移除一切热兵器！一路迎战分层递进的<b>巡街杂兵、重装精兵与区域精英</b>，善用<b>格挡防御反击、完美弹反与金疮药拉扯</b>，斩杀敌寇赚取<b>战功积分</b>升级<b>武器、血条、精力、刀气</b>，推至北端<b>猩红雾门</b>挑战封闭 Boss「<b>霸王 · 黑龙</b>」！</p>' +
    renderLoadoutStrip() + heroPicker() + dojoPickerHtml() + rainControl() +
    '<details class="menu-keys" open><summary>纯冷兵器魂系操作指南</summary><div class="key-grid">' +
    '<div class="key-item"><b>左键 三连斩 · 右键 格挡 / 弹反 · 格挡后左键 防御反击</b><span>普通格挡挡住攻击后 0.7 秒内按<b>左键</b>即可触发《法环》式<b>黄金防御反击</b>（高削韧破防）；迎刃瞬按右键触发<b>完美弹反</b>！</span></div>' +
    '<div class="key-item"><b>[1] 居合一闪 · [2] 力劈华山 · [3] 旋风乱舞</b><span>三大冷兵器绝技（耗刀气 35/45/55）：瞬步破防、霸体裂地、360° 旋风连斩。</span></div>' +
    '<div class="key-item"><b>[WASD + 空格/Shift] 八向翻滚 · 双击 A/D 左右滚</b><span>随时打断挥刀向任意方向滚躲红光<b>【危】</b>重击；按 <b>[Q]</b> 饮用金疮药（初始 4 瓶，每瓶回 65% 血）。</span></div>' +
    '<div class="key-item"><b>[U] 积分强化台 · [E] 赐福休整 / 穿越雾门 / 破防绝杀</b><span>在赐福灯龛按 E 补满血药并升级，抵达北端猩红雾门按 E 开启封闭 Boss 战！</span></div>' +
    '</div></details>',
    '踏入第一关 · 雨夜孤刃',
    () => newGame(),
    true
  );
}

function gameOver() {
  state = 'over';
  saveBest();
  if (duel.active && duel.mode === 'dojo') {
    const preset = DOJO_PRESETS[duel.presetId] || DOJO_PRESETS.duel1v1;
    panel(
      `<div class="sub">DOJO DEFEAT · 1937</div><h2>惜 败 演 武 场</h2>` +
      `<div class="deco-rule">◆ ${preset.label} ◆</div>` +
      `<p>胜败乃刀客常事。盯紧对手起手刀光：普通斩击迎刃右键弹反，红光<b>【危】</b>重劈务必翻滚躲避！</p>` +
      `<div class="stats"><div><b>${duel.parryCount}</b>完美弹反</div><div><b>${duel.clashCount}</b>拼刀交锋</div></div>` +
      dojoPickerHtml(duel.presetId) + heroPicker(),
      '再 战 一 场',
      () => startDojo(duel.presetId),
      '<button class="btn-sec" id="backMenuBtn" type="button">返回主菜单</button>'
    );
    return;
  }
  const respawnHint = activeRespawnPos
    ? `已保留全部 <b>${prog.points} 战功积分</b> 与强化等级，将在【<b>${activeRespawnPos.name}</b>】重整旗鼓！`
    : `敌刃致命如艾尔登法环——已保留全部 <b>${prog.points} 战功积分</b> 与强化，建议先打开强化台提升血条、精力或武器再战！`;
  panel(
    `<div class="sub">YOU DIED · 1937 SHANGHAI</div><h2>刀 折 雨 夜</h2>` +
    `<div class="deco-rule">◆ 积分与强化已保留 ◆</div>` +
    `<p>${respawnHint}</p>` +
    `<div class="stats"><div><b>${prog.points}</b>当前积分</div><div><b>${kills}</b>本趟斩敌</div><div><b>${duel.parryCount}</b>完美弹反</div></div>` +
    renderLoadoutStrip() + heroPicker(),
    activeRespawnPos ? `于 ${activeRespawnPos.name} 再战` : '重 返 石 库 门',
    () => retryLevel(),
    true,
    '<button class="link-btn" id="restartFirstBtn" type="button">从南口起点重新推街</button>'
  );
}

function levelClear() {
  audio.sfx('win');
  state = 'win';
  saveBest();
  panel(
    '<div class="sub">BOSS VANQUISHED · CHAPTER I CLEAR</div><h2>霸王黑龙伏诛</h2>' +
    '<div class="deco-rule">◆ 猩 红 雾 散 · 石 库 门 肃 清 ◆</div>' +
    '<p>你以纯粹冷兵器杀穿 370 米石库门雨夜大长街，踏破封闭死斗场手刃 2000 血三红印魁首「<b>霸王 · 黑龙</b>」，斩获 <b>+350 战功积分</b>！可随时强化神兵或继续精进再战。</p>' +
    `<div class="stats"><div><b>${prog.points}</b>当前积分</div><div><b>${kills}/${level.totalEnemies}</b>本趟歼敌</div><div><b>${duel.parryCount}</b>完美弹反</div></div>` +
    renderLoadoutStrip() + heroPicker(),
    '再 战 第 一 关',
    () => newGame(),
    true,
    '<button class="link-btn" id="backMenuBtn" type="button">返回主菜单</button>'
  );
}

function togglePause() {
  if (state === 'armory') {
    closeArmory();
    return;
  }
  if (state === 'play') {
    cancelThrowAim();
    state = 'pause';
    if (duel.active && duel.mode === 'dojo') {
      const preset = DOJO_PRESETS[duel.presetId] || DOJO_PRESETS.duel1v1;
      panel(
        `<div class="sub">DOJO PAUSE</div><h2>演武暂停</h2><p>${preset.label} · ${preset.subtitle}</p>` +
        dojoPickerHtml(duel.presetId) + rainControl() +
        (DEV_MODE ? '<button type="button" class="motion-open">动作库</button>' : ''),
        '继 续 试 刀',
        () => {
          state = 'play';
          ui.hidden = true;
          input.lockPointer();
        },
        '<button class="btn-sec" id="backMenuBtn" type="button">返回主菜单</button>'
      );
      return;
    }
    panel(
      `<div class="sub">CHAPTER I PAUSE</div><h2>孤 刀 暂 停</h2><p>${level.cfg.name}</p>` +
      renderLoadoutStrip() + rainControl() +
      (DEV_MODE ? '<button type="button" class="motion-open">动作库</button>' : ''),
      '继 续 闯 关',
      () => {
        state = 'play';
        ui.hidden = true;
        input.lockPointer();
      },
      true,
      '<button class="link-btn" id="backMenuBtn" type="button">返回主菜单</button>'
    );
  } else if (state === 'pause') {
    state = 'play';
    ui.hidden = true;
    input.lockPointer();
  }
}

// One trigger pull of the current weapon toward `target` ({x, y, z}). exact = Dead Eye shot: no spread
// (shotguns keep a tight pattern) and no yaw kick, so the volley can snap cleanly to the next mark.
function fireShot(target, exact) {
  if (!P.hasGun) return;
  const g = WEAPONS[P.gun];
  P.mags[P.gun]--;
  P.gunHoldT = 2.6;
  P.gunReady = Math.max(P.gunReady, 0.92);
  audio.sfx(g.snd);

  const c = Math.cos(P.ang);
  const s = Math.sin(P.ang);
  const scoped = P.isScoped && !exact;
  const mh = scoped ? gr.camera.position.y - 0.04 : P.y + 1.42 - P.shoulderDrop;
  const ox = scoped ? gr.camera.position.x + c * 0.45 : P.x + c * 0.81 - s * 0.22;
  const oz = scoped ? gr.camera.position.z + s * 0.45 : P.z + s * 0.81 + c * 0.22;

  let dx = target.x - ox;
  let dy = target.y - mh;
  let dz = target.z - oz;
  let dl = Math.hypot(dx, dy, dz);
  if (dl < 1.5) {
    const pe = P.pitch - P.recoil;
    dx = c * Math.cos(pe);
    dy = -Math.sin(pe);
    dz = s * Math.cos(pe);
    dl = 1;
  }

  const spr = exact
    ? (g.pellets > 1 ? g.spread * 0.35 : 0)
    : scoped
      ? g.spread * (P.breathSteady ? 0.15 : 0.45)
      : g.spread * (1 + P.bloom * 1.8) * (P.moving ? 1.4 : 1) * (1 - 0.55 * P.ads) * (P.lowered ? 0.7 : 1) * (P.air && P.diveT <= 0 ? 2.4 : 1);
  const a0 = Math.atan2(dz, dx);
  const e0 = Math.asin(clamp(dy / dl, -1, 1));
  const bulletMeta = { push: g.push || 3.0, weaponId: g.id, scoped: !!g.scoped };
  for (let i = 0; i < g.pellets; i++) {
    const a = a0 + rnd(-spr, spr);
    const el = e0 + rnd(-spr, spr) * 0.7;
    const ce = Math.cos(el);
    shootBullet(ox, mh, oz, Math.cos(a) * ce, Math.sin(el), Math.sin(a) * ce, g.speed * rnd(0.96, 1.04), g.dmg, true, bulletMeta);
  }

  const kk = g.kick * (1 - 0.35 * P.ads) * (P.lowered ? 0.8 : 1);
  const wShake = g.camShake ?? 0.1;
  muzzle = 1;
  shake = Math.max(shake, wShake * (scoped ? 0.65 : 1));
  P.addCameraImpact({
    fov: (g.fovKick ?? 1.0) * (scoped ? 0.55 : 1),
    roll: (Math.random() < 0.5 ? -1 : 1) * wShake * 0.085,
    back: wShake * (scoped ? 0.15 : 0.45)
  });
  P.recoil += kk * 0.65;
  P.pitch = clamp(P.pitch - kk * 0.35, -0.5, 0.75);
  if (!exact) P.ang += rnd(-1, 1) * kk * 0.5;
  P.bloom = Math.min(1.3, P.bloom + g.bloom);

  puff(ox + c * 0.5, mh, oz + s * 0.5, g.pellets > 1 ? 5 : 2, '#9a9892', g.pellets > 1 ? 2.6 : 1.4, 0.5);
  spawnCasing(P.x - s * 0.25, mh, P.z + c * 0.25, -s * 2.4 + rnd(-0.6, 0.6) - c * 0.5, c * 2.4 + rnd(-0.6, 0.6) - s * 0.5);

  enemyMgr.hearShot(level, P, { radio: enemyRadio }, mh);
}

function updatePlay(dt) {
  P.bulletTime = deadEye.busy;
  if (!P.bulletTime && P.diveT <= 0) P.focus = Math.min(100, P.focus + dt * 6.5);
  if (killSlowCd > 0) killSlowCd = Math.max(0, killSlowCd - dt);
  if (killSlowT > 0) killSlowT = Math.max(0, killSlowT - dt);
  const slowActive = P.bulletTime || P.diveT > 0;
  P.btK += ((slowActive ? 1 : 0) - P.btK) * Math.min(1, dt * 12);
  let timeMult = slowActive ? slowScale() : 1;
  if (!slowActive && killSlowT > 0 && killSlowDur > 0) {
    // Smooth ease-out back to 1.0x real time on dramatic finisher/heavy kills
    const k = clamp(killSlowT / killSlowDur, 0, 1);
    timeMult = 1 - (1 - killSlowScale) * (k * k);
  }
  const simDt = dt * timeMult;
  const playerDt = slowActive ? dt * 0.52 : dt * (1 - (1 - timeMult) * 0.45);

  time += simDt;
  if (banner > 0) banner -= dt;
  if (msgT > 0) msgT -= dt;
  if (reloadSpeakCd > 0) reloadSpeakCd -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
  if (hurtFlash > 0) hurtFlash -= dt;
  if (recentHitT > 0) recentHitT = Math.max(0, recentHitT - dt);
  if (hitMark > 0) hitMark -= dt;
  if (killMark > 0) killMark -= dt;
  if (headMark > 0) headMark -= dt;
  if (impactFlash > 0) impactFlash = Math.max(0, impactFlash - dt * 5.2);
  if (impactLinesT > 0) impactLinesT = Math.max(0, impactLinesT - dt);
  if (staminaEmptyCd > 0) staminaEmptyCd = Math.max(0, staminaEmptyCd - dt);
  for (const hn of hitNums) {
    hn.t += dt;
    hn.y += hn.vy * dt;
    hn.vy = Math.max(0.25, hn.vy - 3.6 * dt);
  }
  if (hitNums.length) hitNums = hitNums.filter(hn => hn.t < hn.dur);

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
  if (duel.active && duel.mode === 'campaign') {
    P.updateStamina(playerDt, melee.isGuarding, melee.busy, isInActiveCombat());
    // Keep hero strictly inside the sealed enclosed Boss Room during the Boss duel!
    const br = level.bossRoom;
    if (br?.sealed && P.z > br.z1 - 0.55) {
      P.z = br.z1 - 0.55;
      physics.setPlayerPosition(P.x, P.y, P.z);
    }
  }
  updateExecution(playerDt);
  updateWorldInteractions(dt);
  if (campaignWinT > 0) {
    campaignWinT -= dt;
    if (campaignWinT <= 0 && state === 'play') {
      levelClear();
      return;
    }
  }

  if (!duel.active && !bossConfronted && level.boss && level.boss.hp > 0 && level.boss.awake && level.boss.sees) {
    bossConfronted = true;
    if (lvl === LEVELS.length - 1) {
      queueDialogue([
        ['boss-challenge', 3.4],
        ['boss-reply', 2.8]
      ]);
    } else {
      say(`${level.boss.bossCfg?.title || '强敌头目'} 现身！`);
      enemyRadio('spot-boss', 3.0, level.boss);
    }
  }

  const aim = P.aim3D(gr.camera, physics);
  aimHit = aim.hit;
  aimDist = aim.d;
  let firing = input.mouse.down || input.touchFire;
  deadEye.update(dt, simDt, deCtx, aim);
  P.bulletTime = deadEye.busy;

  // Legacy touch auto-fire applies ONLY to firearms — never hijack cold-weapon manual blade combat!
  if (input.isTouch && !P.melee && !P.lowered && !deadEye.active) {
    if (aim.hit && aim.d < 35) firing = true;
    else {
      let bd = 0.16;
      let bdf = 0;
      for (const e of level.enemies) {
        if (e.hp <= 0 || !e.awake || e.disarmed) continue;
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

  if (!P.hasGun && !melee.drawn) {
    melee.equipInstant();
  }
  const g = P.hasGun ? WEAPONS[P.gun] : null;
  P.melee = melee.drawn || !g;
  if (P.melee) {
    // Blade drawn: no reloads or empty-gun switching
  } else if (P.reloadT > 0) {
    // Shotgun shell-by-shell reload can be interrupted immediately by firing if a shell is chambered!
    if (g.id === 'shotgun' && firing && P.mags[P.gun] > 0 && P.rollT <= 0 && P.stepT <= 0 && P.execT <= 0) {
      P.cancelReload();
    } else {
      P.stepReload(playerDt, audio);
    }
  } else if (P.mags[P.gun] <= 0) {
    if (P.res[P.gun] > 0) {
      P.reload(audio);
      if (reloadSpeakCd <= 0 && level.enemies.some(e => e.hp > 0 && e.awake && Math.hypot(e.x - P.x, e.z - P.z) < 22)) {
        reloadSpeakCd = 16;
        radio('mag-empty', 2.2);
      }
    } else {
      P.nextGun(cf, audio, say);
    }
  }

  if (firing && P.stepT <= 0 && P.rollT <= 0 && P.execT <= 0) {
    P.gunHoldT = Math.max(P.gunHoldT, 2.4);
  }
  // Dead Eye owns the trigger while marks are painted or a volley is running
  const fireEdge = firing && !prevFiring;
  prevFiring = firing;
  const heavyHeld = input.isTouch ? !!input.touchBlock : !!input.mouse.right;
  const heavyEdge = heavyHeld && !prevHeavy;
  prevHeavy = heavyHeld;
  if (throwAim && (heavyEdge || P.rollT > 0 || P.stepT > 0 || P.execT > 0)) {
    cancelThrowAim();
  }
  if (P.melee) {
    if (duel.active) {
      const canAct = P.stepT <= 0 && P.rollT <= 0 && P.execT <= 0 && !execSession && duel.playerBrokenT <= 0;
      melee.setBlock(heavyHeld && canAct, audio);
      if (canAct && fireEdge) melee.press('light', meleeCtx);
    } else if (P.stepT <= 0 && P.rollT <= 0 && P.execT <= 0 && !execSession) {
      if (fireEdge) melee.press('light', meleeCtx);
      if (heavyEdge) melee.press('heavy', meleeCtx);
    }
  } else if (g) {
    if (deadEye.active && fireEdge && deadEye.marks.length) deadEye.trigger(deCtx);
    const deadEyeOwnsTrigger = !!deadEye.volley || (deadEye.active && deadEye.marks.length > 0);
    if (firing && !deadEyeOwnsTrigger && P.cd <= 0 && P.reloadT <= 0 && P.rollT <= 0 && P.stepT <= 0 && P.execT <= 0 && P.mags[P.gun] > 0) {
      P.cd = g.rate;
      fireShot(aim, false);
    }
  }
  if (melee.drawn || melee.busy) melee.update(playerDt, meleeCtx);
  P.melee = melee.drawn || !P.hasGun;

  flowT -= simDt;
  if (flowT <= 0) {
    flowT = 0.3;
    level.computeFlow(P.x, P.z);
  }

  const logicCtx = makeLogicCtx();
  if (duel.active) {
    duel.update(simDt, duelCtx());
  } else {
    enemyMgr.update(simDt, logicCtx);
    if (closeLine && !canFinishCloseLine(closeLine.event, closeLine.source, P)) stopCloseLine();
    encounters.update(dt, level, P, radioT <= 0 && !dialogueQueue.length && !execSession, enemyRadio);
  }

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
            const eTop = enemyStanceHeight(e);
            const head = pt.y > eTop - 0.3 * k;
            const helmet = head && e.type === 'soldier';
            const falloff = (b.scoped || g?.scoped) ? 1 : clamp(1 - (b.dist - 22) / 70, 0.5, 1);
            const mult = (head ? (helmet ? 1.7 : 2.5) : pt.y < 0.85 * k ? 0.7 : 1) * falloff;
            const dirLen = Math.hypot(b.vx, b.vz) || 1;
            const bdx = b.vx / dirLen;
            const bdz = b.vz / dirLen;
            const bPush = b.push || g?.push || 3.0;
            const imp = bPush * 0.036;
            const hitCtx = Object.assign({}, logicCtx, { hitImpulse: bPush * (head ? 1.15 : 1.0) });
            enemyMgr.hitEnemy(e, b.dmg * mult, bdx, bdz, pt.y, hitCtx, head, 0, classifyHit(e, pt, head));
            level.moveEnt(e, bdx * (0.09 + imp), bdz * (0.09 + imp));

            // Material-authentic impact VFX at exact contact point (steel helmet sparks vs arterial exit spray)
            if (helmet) {
              puff(pt.x, pt.y, pt.z, 12, '#fff0b8', 9.2, 0.24);
              puff(pt.x, pt.y, pt.z, 6, '#ff9c38', 6.5, 0.28);
            } else {
              bloodSpray(pt.x, pt.y, pt.z, bdx, bdz, head ? 18 : bPush >= 7 ? 14 : 8, head ? 6.8 : 5.0);
            }

            const killed = e.hp <= 0;
            hitMark = 0.16;
            if (head) headMark = 0.3;
            if (killed) killMark = 0.4;

            // Layered tactile impact & kill-confirmation audio (zero thin UI beep!)
            audio.sfx(helmet ? 'helmetHit' : head ? 'headshot' : 'fleshHit');
            if (killed) {
              audio.sfx(head ? 'killHead' : 'killConfirm');
              const heavyWeapon = b.weaponId === 'sniper' || b.weaponId === 'rifle' || b.weaponId === 'shotgun' || b.weaponId === 'revolver';
              const remAlive = level.enemies.some(o => o.hp > 0 && !o.disarmed);
              if (e.type === 'boss') {
                hitstopT = Math.max(hitstopT, 0.085);
                hitstopShake = 0.32;
                P.addCameraImpact({ fov: 2.8, back: 0.12 });
                triggerKillSlow(0.55, 0.28, true);
              } else if (!remAlive) {
                hitstopT = Math.max(hitstopT, 0.065);
                hitstopShake = 0.24;
                P.addCameraImpact({ fov: 2.0 });
                triggerKillSlow(0.42, 0.30, true);
              } else if ((b.weaponId === 'sniper' || b.weaponId === 'rifle') && head) {
                hitstopT = Math.max(hitstopT, 0.056);
                hitstopShake = 0.20;
                P.addCameraImpact({ fov: 1.8 });
                triggerKillSlow(0.26, 0.36, false);
              } else if (b.weaponId === 'shotgun' && b.dist < 11) {
                hitstopT = Math.max(hitstopT, 0.052);
                hitstopShake = 0.24;
                P.addCameraImpact({ fov: 2.2 });
                triggerKillSlow(0.24, 0.38, false);
              } else if (head || heavyWeapon) {
                hitstopT = Math.max(hitstopT, 0.036);
                hitstopShake = 0.14;
                P.addCameraImpact({ fov: 1.1 });
              }
            } else if (head || bPush >= 8.5) {
              hitstopT = Math.max(hitstopT, 0.024);
              hitstopShake = 0.12;
            }
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
        enemyMgr.wake(level, e);
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
    hostage.spd = 0;
    if (!hostage.free) {
      if (hd < 2.3) {
        hostage.free = true;
        hostage.stuckT = 0;
        score += 300;
        audio.sfx('pick');
        say('联络人已解救，带他去北面出口！');
        queueDialogue([
          ['rescue-contact', 3.4],
          ['rescue-reply', 3.0]
        ]);
      }
    } else if (hd > 2.4) {
      const f =
        hd < 6.4 && level.los(hostage.x, hostage.z, P.x, P.z)
          ? [(P.x - hostage.x) / hd, (P.z - hostage.z) / hd]
          : level.flowDir(hostage) || [(P.x - hostage.x) / hd, (P.z - hostage.z) / hd];
      // Adaptive escort pace: walks gently when close, jogs briskly when catching up
      const targetSpd = clamp((hd - 2.0) * 1.15, 2.2, 6.8);
      const px0 = hostage.x, pz0 = hostage.z;
      level.moveEnt(hostage, f[0] * targetSpd * simDt, f[1] * targetSpd * simDt);
      const moved = Math.hypot(hostage.x - px0, hostage.z - pz0);
      if (moved < 0.01 && simDt > 0) {
        hostage.stuckT = (hostage.stuckT || 0) + simDt;
        // Nudge laterally around crate/curb corners so contact never jams
        const sid = hostage.stuckT > 0.45 ? -1 : 1;
        level.moveEnt(hostage, -f[1] * sid * 2.8 * simDt, f[0] * sid * 2.8 * simDt);
        if (hostage.stuckT > 2.2 && hd > 14) {
          const spot = level.nearbyFloor(P.x - Math.cos(P.ang) * 2.2, P.z - Math.sin(P.ang) * 2.2, hostage.r);
          hostage.x = spot.x;
          hostage.z = spot.z;
          hostage.stuckT = 0;
        }
      } else {
        hostage.stuckT = 0;
      }
      const wantAng = Math.atan2(f[1], f[0]);
      const dAng = Math.atan2(Math.sin(wantAng - hostage.ang), Math.cos(wantAng - hostage.ang));
      hostage.ang = Math.atan2(Math.sin(hostage.ang + clamp(dAng, -simDt * 8, simDt * 8)), Math.cos(hostage.ang + clamp(dAng, -simDt * 8, simDt * 8)));
      hostage.spd = simDt > 0 ? Math.hypot(hostage.x - px0, hostage.z - pz0) / simDt : 0;
      hostage.moving = hostage.spd > 0.2;
    } else {
      // Face player gently when standing beside them
      const wantAng = Math.atan2(P.z - hostage.z, P.x - hostage.x);
      const dAng = Math.atan2(Math.sin(wantAng - hostage.ang), Math.cos(wantAng - hostage.ang));
      hostage.ang = Math.atan2(Math.sin(hostage.ang + clamp(dAng, -simDt * 4, simDt * 4)), Math.cos(hostage.ang + clamp(dAng, -simDt * 4, simDt * 4)));
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
            radio('retreat', 4.2);
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

  // Pure Cold-Weapon Pickups (Healing Supplies ONLY — strictly zero free point orbs!)
  for (const p of pickups) {
    p.t += simDt;
    if (Math.hypot(p.x - P.x, p.z - P.z) < 1.65) {
      if (p.type === 'med') {
        const maxHp = P.maxHp || 100;
        if (P.hp < maxHp) {
          const gain = Math.min(maxHp - P.hp, Math.round(maxHp * 0.35));
          P.hp += gain;
          say(`拾取金疮散 +${Math.round(gain)} 生命`);
          p.dead = true;
          audio.sfx('pick');
        } else if ((P.flasks || 0) < (P.maxFlasks || 3)) {
          P.flasks++;
          say(`金疮药 +1（${P.flasks}/${P.maxFlasks}）`);
          p.dead = true;
          audio.sfx('pick');
        }
      }
    }
    if (p.t > 45) p.dead = true;
    if (p.dead) {
      worldGroup.remove(p.mesh);
      disposeHierarchy(p.mesh);
    }
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
  execTarget = findExecTarget();

  if (
    state === 'play' &&
    !duel.active &&
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
  propInstancer?.sync();

  // Player mesh animation + upper torso Aim IK + Shootdodge airborne dive pose
  if (playerMesh) {
    const rolling = P.rollT > 0;
    const diving = P.diveT > 0;
    const execing = P.execT > 0;
    const walking = P.moving && !P.sprinting && !rolling;
    const groundedGait = !rolling && !diving && !P.air;
    const sneak = groundedGait ? P.sneakK : 0;
    const crouch = groundedGait ? P.crouchK : 0;
    const lowStance = sneak + crouch;
    const pu = playerMesh.userData;

    // C1-Continuous Weapon-Matched Execution Keyframe Curves (ZERO 1-frame snaps, ZERO pivot kicks!)
    if (execSession) {
      const s = execSession;
      const t = s.t;
      const smashT = 0.22;
      const killT = 0.38;
      const pGrab = s.isLongGun ? 'exec_long_coil' : 'exec_grab';
      const pSmash = 'exec_stealth_slash';
      const pAim = pSmash;

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
    } else if (!melee.drawn && P.reloadT > 0 && P.rollT <= 0 && P.diveT <= 0) {
      const rDur = P.reloadDur || WEAPONS[P.gun]?.reload || 1;
      const rProg = clamp(1 - P.reloadT / rDur, 0, 1);
      const rw = smooth01(rProg / 0.16) * smooth01((1 - rProg) / 0.16);
      const rPhase = Math.sin(rProg * Math.PI);
      pu.execPose = { a: 'reload_mag_a', b: 'reload_mag_b', t: rPhase, w: rw * 0.92 };
      pu.execTwist = -0.10 * rw;
    } else {
      pu.execPose = null;
      pu.execTwist = 0;
    }

    const dashingExec = !!(execSession && execSession.t < 0.18 && (execSession.remDist || 0) > 0.22);
    pu.rate = rolling ? 1.6 : diving ? 0.45 : dashingExec ? 1.25 : execing ? 1.0 : P.air ? 0.5 : P.ads > 0.5 ? 1.05 : walking ? 1.06 : 1.12;
    const mode =
      state === 'play' && (P.moving || rolling || P.air || dashingExec) && !diving
        ? rolling || P.sprinting
          ? 'Run'
          : 'Walk'
        : 'RelaxIdle';
    const aimElev = state === 'play' && !rolling && !execSession ? -(P.pitch - P.recoil) * 0.65 : 0;
    const readyW = diving ? 1 : rolling || execSession ? 0 : execing ? 0.5
      : Math.max(P.gunReady, crouch * 0.73 + sneak * 0.30) * (1 - 0.7 * P.stepLean);

    // Blade drawn: no gun aim layers; the arms are IK'd onto the dadao after the body pose (poseBlade)
    const bladeOut = melee.drawn || !P.hasGun;
    if (pu.bladeOut !== bladeOut) {
      pu.bladeOut = bladeOut;
      if (bladeOut) {
        cf.attachBlade(playerMesh);
        pu.gun.visible = false;
        pu.melee = true;
      } else if (P.hasGun) {
        cf.setGun(playerMesh, WEAPONS[P.gun].modelKey);
        pu.gun.visible = true;
        if (pu.blade) pu.blade.visible = false;
        bladeTrail?.clear();
      }
    }
    const lateralRoll = rolling && Math.abs(P.rollLocalR || 0) > Math.abs(P.rollLocalF || 0) * 0.7;
    const backRoll = rolling && !lateralRoll && (P.rollLocalF || 0) < -0.5;
    const meshAng = rolling && !lateralRoll && !backRoll ? Math.atan2(P.rdz, P.rdx) : P.ang + (bladeOut ? melee.yaw : 0);
    const bodyMode = crouch > 0.4 ? 'Idle' : sneak > 0.1 ? 'RelaxIdle' : bladeOut && melee.moving ? 'Walk' : mode;
    const canPivot = state === 'play' && !P.moving && !P.air &&
      !rolling && !diving && !execing && !execSession && !bladeOut && P.reloadT <= 0 && P.stepLean < 0.02;
    // Lowered pivots use planted feet. Only the standing player uses the additive turn clip.
    driveTurn(cf, playerMesh, meshAng, canPivot && !P.lowered && lowStance < 0.04 ? 'standing' : null, dt);
    cf.poseMesh(
      playerMesh, P.x, P.z, meshAng, bodyMode, dt,
      bladeOut ? 0 : aimElev, 0, bladeOut ? 0 : readyW, bladeOut ? 0 : P.ads
    );
    playerMesh.position.y = P.y - Math.min(Math.max(0, P.y), PLAYER_CONTACT_OFFSET) * lowStance;
    if (rolling) {
      const rollProg = clamp(1 - P.rollT / Math.max(0.1, P.rollDur || 0.5), 0, 1);
      const hop = Math.sin(rollProg * Math.PI);
      if (lateralRoll) {
        // True left/right sideways barrel roll while facing the opponent!
        pu.pivot.rotation.x = Math.sign(P.rollLocalR || 1) * rollProg * TAU;
        pu.pivot.rotation.z = 0;
        pu.pivot.position.y = 0.56 + hop * 0.24;
        pu.pivot.scale.setScalar(0.86);
      } else if (backRoll) {
        // Crisp 360° back-roll / back-flip away from danger
        pu.pivot.rotation.x = 0;
        pu.pivot.rotation.z = rollProg * TAU;
        pu.pivot.position.y = 0.62 + hop * 0.40;
        pu.pivot.scale.setScalar(0.88);
      } else {
        pu.pivot.rotation.x = 0;
        pu.pivot.rotation.z = -rollProg * TAU;
        pu.pivot.position.y = 0.55;
        pu.pivot.scale.setScalar(0.82);
      }
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
    const lean = P.stepLean;
    const side = -P.rdx * Math.sin(P.ang) + P.rdz * Math.cos(P.ang);
    posePlayerGait(cf, playerMesh, sneak, crouch, dt, lean * side, bladeOut ? 0 : readyW);
    if (lean > 0 && lowStance < 0.005 && !P.air) poseLowStance(cf, playerMesh, lean * 0.63, lean * side);
    if (bladeOut) {
      const swordKey = melee.atk
        ? resolveSwordClip(pu.clips, melee.atk.name)
        : melee.isGuarding
          ? resolveSwordClip(pu.clips, 'block')
          : null;
      if (swordKey && pu.lastSwordClip !== swordKey) {
        pu.lastSwordClip = swordKey;
        cf.playClip(playerMesh, swordKey, { loop: melee.isGuarding && !melee.atk, fadeIn: 0.07, fadeOut: 0.16, speed: 1.15 });
      } else if (!swordKey && pu.lastSwordClip) {
        pu.lastSwordClip = null;
      }
      cf.poseBlade(playerMesh, melee.pose, !rolling && !diving, dt);
      if (pu.blade.visible && bladeTrail) {
        // HDR 刀光: color-coded per attack (silver combo / gold chop / cyan iaido / molten cleave / crimson whirlwind)
        trailClock += dt;
        const base = pu.blade.localToWorld(_trailA.set(BLADE.guardX + (BLADE.tipX - BLADE.guardX) * 0.28, 0, 0));
        const tip = pu.blade.localToWorld(_trailB.set(BLADE.tipX, 0, 0));
        const speed = pu.trailPrev && dt > 0 ? tip.distanceTo(pu.trailPrev) / dt : 0;
        (pu.trailPrev ||= new THREE.Vector3()).copy(tip);
        const atkName = melee.atk?.name;
        const trailRgb =
          atkName === 'iaido' ? [0.60, 1.78, 2.25]
            : atkName === 'cleave' ? [2.25, 1.25, 0.34]
              : atkName === 'whirlwind' ? [2.15, 0.56, 0.34]
                : atkName === 'chop' || atkName === 'spin' ? [1.90, 1.44, 0.68]
                  : [1.32, 1.46, 1.72];
        const minBoost = atkName && melee.atk?.def?.ult ? 0.58 : 0;
        bladeTrail.push(base, tip, trailClock, Math.max(minBoost, clamp((speed - 2.6) / 6.2, 0, 1)), trailRgb);
      }
      pu.bladeBlood.value = Math.max(0, pu.bladeBlood.value - dt * 0.012); // the rain slowly washes it
    } else if (pu.blade?.visible) {
      pu.blade.visible = false;
    }
    const invBlink = P.inv > 0 && P.execT <= 0 && !execSession && hurtFlash > 0 && Math.floor(time * 20) % 2;
    playerMesh.visible = state === 'menu' || P.scopeK > 0.65 ? false : !invBlink;
  }

  if (level.hostage?.mesh) {
    const hSpd = level.hostage.spd || 0;
    level.hostage.mesh.userData.rate = level.hostage.moving ? clamp(hSpd / 4.2, 0.72, 1.32) : 1.0;
    const hMode = level.hostage.moving ? (hSpd < 3.4 ? 'Walk' : 'Run') : 'RelaxIdle';
    cf.poseMesh(level.hostage.mesh, level.hostage.x, level.hostage.z, level.hostage.ang, hMode, dt, 0, 0, 0, 0);
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
  spriteBatcher?.sync();

  for (const e of level.enemies) {
    const m = e.mesh;
    if (!m || e.hp <= 0) {
      if (e.duelTrail) e.duelTrail.clear();
      continue;
    }
    const far = Math.hypot(e.x - P.x, e.z - P.z) > (P.isScoped ? 140 : 76);
    m.visible = !far;
    if (far) continue;
    const u = m.userData;
    driveEnemyClips(cf, m, e);
    const canPivot = state === 'play' && !e.executing && !e.react && !e.handsUp && !e.defense &&
      !(e.windupT > 0 || e.recoveryT > 0);
    let stance = null;
    if (canPivot && e.downed) stance = 'prone';
    else if (canPivot && !e.moving && !e.backpedal) {
      if (e.duck && e.crouchK > 0.75) stance = 'crouch';
      else if (!e.duck && !(e.crouchK > 0.04)) stance = 'standing';
    }
    driveTurn(cf, m, e.ang, stance, dt);
    e.proneTurning = u.ov?.turn === 'prone' && !u.ov.stopping;
    let execFlinch = e.flinch || 0;
    if (e.executing && execSession && execSession.e === e) {
      const st = execSession.t;
      const stagIn = st >= 0.20 ? smooth01((st - 0.20) / 0.10) : 0;
      const stagSettle = st >= 0.30 ? smooth01((st - 0.30) / 0.12) : 0;
      u.execPose = stagIn > 0 ? { a: 'exec_victim_stagger', b: 'exec_victim_stagger', t: 1, w: stagIn } : null;
      u.execTwist = -0.18 * stagIn * (1 - 0.45 * stagSettle);
      const preDecay = (execSession.startFlinch || 0) * (1 - smooth01(st / 0.20));
      const hitRecoil = 0.52 * stagIn - 0.14 * stagSettle;
      execFlinch = preDecay + hitRecoil;
    } else {
      u.execPose = reactionArmPose(e, time);
      u.execTwist = 0;
    }
    u.rate = e.backpedal ? -0.8 : e.awake ? clamp(e.spd / 5.6, 0.72, 1.25) : e.moving ? 0.72 : 0.95;
    const settled = e.downed || e.react?.kind === 'kneel';
    const lowStance = !e.executing && !e.downed && !e.react && !e.handsUp ? e.crouchK || 0 : 0;
    const eMode =
      e.executing ? 'RelaxIdle' : !e.awake ? (e.moving ? 'Walk' : 'RelaxIdle') : settled || lowStance > 0.4 ? 'Idle' : e.moving || e.backpedal ? (e.spd < 3.1 ? 'Walk' : 'Run') : 'Idle';
    const targetReady = e.duel || e.executing || e.disarmed || e.downed || e.defense ? 0 : e.awake && (e.staggerT || 0) <= 0 ? 1 : 0.08;
    if (e.gunReady === undefined) e.gunReady = targetReady;
    else e.gunReady += (targetReady - e.gunReady) * Math.min(1, dt * (e.executing ? 8.5 : 10.0));
    const targetAds = !e.duel && !e.executing && (e.aimT > 0 || e.burst > 0) ? 1 : e.duel ? 0 : 0.35;
    if (e.adsK === undefined) e.adsK = targetAds;
    else e.adsK += (targetAds - e.adsK) * Math.min(1, dt * 10.0);
    m.position.y = e.duel ? (e.duel.jumpY || 0) : 0;
    if (e.duel) {
      u.gun.visible = false;
      const eSwordKey =
        e.duel.state === 'strike'
          ? resolveSwordClip(u.clips, e.duel.attackKind === 'perilChop' ? 'cleave' : e.duel.attackKind === 'slashB' ? 'slashB' : 'slashA')
          : e.duel.state === 'blockReact'
            ? resolveSwordClip(u.clips, 'blockHit')
            : null;
      if (eSwordKey && u.lastSwordClip !== eSwordKey) {
        u.lastSwordClip = eSwordKey;
        cf.playClip(m, eSwordKey, { loop: false, fadeIn: 0.07, fadeOut: 0.16, speed: 1.1 });
      } else if (!eSwordKey && u.lastSwordClip) {
        u.lastSwordClip = null;
      }
    }
    const renderAng = e.duel ? e.ang + (e.duel.spinYaw || 0) : e.ang;
    cf.poseMesh(m, e.x, e.z, renderAng, eMode, dt, 0, execFlinch, e.duel ? 0 : e.gunReady, e.duel ? 0 : e.adsK);
    if (e.duel) {
      u.pivot.rotation.z = -(e.duel.flipX || 0);
      u.pivot.rotation.x = e.duel.flipZ || 0;
    } else if (u.pivot) {
      u.pivot.rotation.set(0, 0, 0);
    }
    poseReaction(cf, m, e);
    poseCrouchWalk(cf, m, lowStance * (1 - u.lowTurnWeight), dt);
    if (e.duel) {
      cf.poseBlade(m, e.duel.pose, !e.executing || e.duel.state === 'broken', dt);
      if (e.duelTrail && u.blade?.visible) {
        const meta = u.bladeMeta || BLADE;
        const eb = u.blade.localToWorld(_trailA.set(meta.guardX + (meta.tipX - meta.guardX) * 0.22, 0, 0));
        const et = u.blade.localToWorld(_trailB.set(meta.tipX, 0, 0));
        const eSpd = u.trailPrev && dt > 0 ? et.distanceTo(u.trailPrev) / dt : 0;
        (u.trailPrev ||= new THREE.Vector3()).copy(et);
        const isPeril = e.duel.peril || e.duel.attackKind === 'perilChop' || e.duel.attackKind === 'perilThrust';
        const isBossUlt = e.duel.state === 'bossUlt';
        const isBossP2 = e.type === 'boss' && e.duel.phase === 2;
        const eRgb = isPeril ? [2.35, 0.24, 0.16] : isBossUlt ? [2.25, 0.72, 0.24] : isBossP2 ? [2.05, 0.56, 0.24] : [1.75, 1.18, 0.52];
        const swinging = e.duel.state === 'strike' || e.duel.state === 'windup' || isBossUlt || e.duel.state === 'evade';
        e.duelTrail.push(eb, et, trailClock, swinging ? Math.max(isBossUlt ? 0.72 : e.duel.state === 'strike' ? 0.58 : 0.22, clamp((eSpd - 2.2) / 5.8, 0, 1)) : 0, eRgb);
      }
    }
    // Keep enemy materials physically realistic on hit (no arcade red plastic glow — impact sparks, blood & recoil carry the hit!)
    u.mat.emissive.setHex(0);
    if (u.coatMat) u.coatMat.emissive.setHex(0);
    if (e.duel) {
      const showTelegraph = !e.executing && (e.duel.state === 'windup' || e.duel.peril || e.duel.state === 'bossUlt');
      u.glint.visible = showTelegraph;
      if (showTelegraph) {
        const pulse = 0.88 + Math.sin(time * (e.duel.peril ? 28 : 18)) * 0.25;
        u.glint.scale.setScalar((e.duel.peril ? 0.145 : 0.095) * pulse);
        u.glint.material.color.setHex(e.duel.peril ? 0xff2618 : 0xffe99c);
      }
    } else {
      u.glint.visible = !e.executing && !e.disarmed && !e.defense && (e.aimT > 0 || e.burst > 0 || e.callT > 0 || e.ringWindupT > 0);
    }
  }

  // Boss Ultimate ground danger ring telegraph on courtyard cobblestones
  if (bossTelegraphRing) {
    const tel = duel.active
      ? level.enemies.find(e => e.hp > 0 && e.duel?.telegraph?.kind === 'ring')?.duel?.telegraph
      : null;
    if (tel) {
      bossTelegraphRing.visible = true;
      bossTelegraphRing.position.set(tel.x, 0.06, tel.z);
      const pulse = 0.92 + Math.sin(time * 26) * 0.08;
      bossTelegraphRing.scale.setScalar(tel.rad * pulse);
      bossTelegraphRing.material.color.setHex(tel.parryable ? 0xffc848 : 0xff2e20);
      bossTelegraphRing.material.opacity = 0.35 + tel.prog * 0.45;
    } else {
      bossTelegraphRing.visible = false;
    }
  }

  cf.updateDying(dt);

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
    if (fx.rotZVel) fx.mesh.rotation.z += fx.rotZVel * dt;
    const sc = fx.s0 + (fx.s1 - fx.s0) * Math.pow(k, 0.55);
    fx.mesh.scale.setScalar(sc);
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
    if (p.type === 'bossWeapon') {
      if (p.spinPivot) {
        p.spinPivot.rotation.y += dt * 1.9;
        p.spinPivot.position.y = 0.92 + Math.sin(p.t * 3.2) * 0.14;
      }
      if (p.beam) {
        p.beam.rotation.y += dt * 0.8;
        p.beam.material.opacity = 0.28 + Math.sin(time * 4.5) * 0.12;
      }
      if (p.halo) {
        p.halo.scale.setScalar(1.08 + Math.sin(time * 4.5) * 0.14);
      }
    } else {
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.6 + Math.sin(p.t * 3) * 0.12;
    }
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
    const tip = 0.75 + (WEAPON_TIPS[WEAPONS[P.gun]?.modelKey] || 0.34);
    if (playerMesh?.userData.gun?.visible && playerMesh.userData.glint) {
      playerMesh.userData.glint.getWorldPosition(gr.flash.position);
    } else {
      gr.flash.position.set(P.x + c * tip - s * 0.2, P.y + 1.38 - P.shoulderDrop, P.z + s * tip + c * 0.2);
    }
    const { x: muzX, y: muzY, z: muzZ } = gr.flash.position;
    gr.flash.visible = muzzle > 0.45 && state === 'play';
    gr.flash.scale.setScalar(rnd(0.75, 1.18));
    muzzle = Math.max(0, muzzle - dt * 14);
    gr.muzzleLight.intensity = muzzle * 20;
    gr.muzzleLight.position.copy(gr.flash.position);
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

    // 3D Parabolic Throwable Arc Preview & Landing Ring (matches exact Rapier3D gravity & damping)
    if (throwAim && state === 'play' && !execSession && P.rollT <= 0) {
      const isMolo = throwAim.kind === 'molo';
      const tp = computeThrowParams(isMolo);
      const posArr = gr.throwArc.geometry.attributes.position.array;
      const steps = posArr.length / 3;
      const stepDt = 0.045;
      const damp = Math.exp(-0.15 * stepDt);
      let sx = tp.ox, sy = tp.oy, sz = tp.oz;
      let vx = tp.vx, vy = tp.vy, vz = tp.vz;
      let hitX = sx, hitY = 0.05, hitZ = sz;
      let landed = false;
      posArr[0] = sx; posArr[1] = sy; posArr[2] = sz;
      for (let i = 1; i < steps; i++) {
        if (!landed) {
          vy -= GRAVITY * stepDt;
          vx *= damp; vy *= damp; vz *= damp;
          const dx = vx * stepDt, dy = vy * stepDt, dz = vz * stepDt;
          const seg = Math.hypot(dx, dy, dz) || 0.001;
          const h = physics.castRay(sx, sy, sz, dx, dy, dz, seg, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, physics.playerCollider);
          if (h) {
            sx = h.point.x; sy = Math.max(0.05, h.point.y); sz = h.point.z;
            hitX = sx; hitY = sy; hitZ = sz;
            landed = true;
          } else {
            sx += dx; sy += dy; sz += dz;
            if (sy <= 0.05) {
              sy = 0.05;
              hitX = sx; hitY = 0.05; hitZ = sz;
              landed = true;
            } else {
              hitX = sx; hitY = sy; hitZ = sz;
            }
          }
        }
        posArr[i * 3] = sx;
        posArr[i * 3 + 1] = sy;
        posArr[i * 3 + 2] = sz;
      }
      gr.throwArc.geometry.attributes.position.needsUpdate = true;
      const landDist = Math.hypot(hitX - P.x, hitZ - P.z);
      throwAim.dist = landDist;
      throwAim.danger = landDist < (isMolo ? 3.2 : 4.6);
      const arcHex = throwAim.danger ? 0xff4a38 : isMolo ? 0xff9238 : 0xffd678;
      gr.throwArc.material.color.setHex(arcHex);
      gr.throwArc.visible = true;
      gr.throwRing.material.color.setHex(arcHex);
      const ringRadius = isMolo ? 2.6 : 3.6;
      gr.throwRing.scale.setScalar(ringRadius * (0.94 + Math.sin(time * 8) * 0.06));
      gr.throwRing.position.set(hitX, Math.max(0.06, hitY + 0.03), hitZ);
      gr.throwRing.visible = true;
    } else if (gr.throwArc) {
      gr.throwArc.visible = false;
      gr.throwRing.visible = false;
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
  const playingDialogue = state === 'play' && !document.hidden;
  dialogue.setPaused(!playingDialogue);
  if (playingDialogue && radioT > 0) {
    // Speech runs on real time, including during cinematic slow motion.
    if (activeVoiceSource && dialogue.speaking) {
      const sp = spatialVoice(activeVoiceSource, P);
      dialogue.setSpatial(sp.gain, sp.pan);
    }
    if (dialogueQueue.length && dialogue.ended) radioT = Math.min(radioT, 0.22);
    radioT -= Math.min(1, Math.max(0, ts - lastTs) / 1000);
    if (dialogue.speaking) radioT = Math.max(1, radioT);
    if (radioT <= 0) {
      dialogue.stop();
      closeLine = null;
      activeVoiceSource = null;
      const next = dialogueQueue.shift();
      if (next) radio(next[0], next[1], true);
    }
  }
  // Never step backwards: a negative dt grows decaying effects (muzzle light) instead of fading them
  const dt = Math.min(0.033, Math.max(0, (ts - lastTs) / 1000) || 0);
  lastTs = ts;
  if (motionLibrary?.dialog.open) {
    motionLibrary.render(dt);
    requestAnimationFrame(frame);
    return;
  }
  if (state === 'play') gr.updateDynamicResolution(dt);

  fpsAccum += dt;
  fpsFrames++;
  if (dt > 0) frameMsAvg = frameMsAvg * 0.92 + dt * 1000 * 0.08;
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
    if (execSession) execSession.freezeDrift = 0.06 * smooth01(1 - execFX.freeze);
    if (P.execCam) {
      const baseD = execSession?.isLongGun ? 1.88 : 1.66;
      P.execCam.dist = baseD + (execSession?.freezeDrift || 0);
    }
    effDt = 0;
  } else {
    execFX.freeze = 0;
    if (hitstopT > 0 && state === 'play') {
      hitstopT = Math.max(0, hitstopT - dt);
      effDt = dt * 0.025;
      if (!execSession) shake = Math.max(shake, hitstopShake);
      if (hitstopT <= 0) hitstopShake = 0.24;
    }
  }

  if (state === 'play') {
    if (effDt > 0) updatePlay(effDt);
    else if (freezeFrameT <= 0) updateExecution(0);
  } else {
    time += dt;
    physics.step(dt, worldGroup);
  }

  let sceneScale = 1;
  if (state === 'play') {
    if (P.bulletTime || P.diveT > 0) sceneScale = slowScale();
    else if (killSlowT > 0 && killSlowDur > 0) {
      const k = clamp(killSlowT / killSlowDur, 0, 1);
      sceneScale = 1 - (1 - killSlowScale) * (k * k);
    }
  }
  const sceneDt = effDt * sceneScale;
  syncScene(sceneDt);
  gr.grade.uDeadEye.value = deadEye.k;
  gr.render();
  if (touchUI) touchUI.hidden = !input.isTouch || state !== 'play';
  const canInteractTouch = state === 'play' && !!(execTarget || worldPrompt);
  input.updateStealthControls(P.sneak, P.crouch, canInteractTouch);
  if (input.isTouch) {
    const ultList = [ULTIMATES.iaido, ULTIMATES.cleave, ULTIMATES.whirlwind].map(u => {
      const cd = duel.getCooldown ? duel.getCooldown(u.id) : (duel.cooldowns?.[u.id] || 0);
      const onCd = cd > 0.01;
      return {
        cost: u.cost,
        cd,
        onCd,
        ready: !onCd && duel.qi >= u.cost && duel.playerBrokenT <= 0
      };
    });
    const interactLabel = execTarget
      ? '绝杀!'
      : worldPrompt?.kind === 'fogGate'
        ? '雾门'
        : worldPrompt?.kind === 'shrine'
          ? '赐福'
          : '交互';
    input.updateTouchHUD({
      coldMode: duel.active,
      guardCounterReady: melee.guardCounterT > 0,
      flasks: P.flasks,
      maxFlasks: P.maxFlasks,
      lockedOn: !!duel.lockTarget,
      canUpgrade: prog.hasAnyAffordable(),
      interactLabel,
      canInteract: canInteractTouch,
      ults: ultList
    });
  }
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
    subtitle: dialogue.subtitle,
    radioT,
    hurtFlash,
    hurtAng,
    hitMark,
    killMark,
    headMark,
    impactFlash,
    impactFlashCol,
    impactLinesT,
    impactLinesCol,
    hitNums,
    aimHit,
    aimDist,
    execTarget,
    execKind,
    execFX,
    deadEye,
    melee,
    duel,
    prog,
    worldPrompt,
    nades,
    pickups,
    timeLeft,
    planted,
    throwAim,
    perfStats: { show: showPerf, fps, ms: frameMsAvg, resScale: gr.resScale },
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
  if (!motionLibrary?.dialog.open) gr?.resize(w, h, dpr);
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') === 'loader') {
    loader.setProgress(0.68, '正在整备沈孤鸿角色模型与二十九军式大刀…');
    return;
  }

  try {
    gr = new GameRenderer(glCv, assets);
  } catch (e) {
    console.error(e);
    loader.showError('<h2 class="ld-dossier-title">无法启动 3D</h2><p class="ld-dossier-body">这台设备或浏览器没有开启 WebGL，或者 3D 引擎脚本没有加载成功。请换用新版 Chrome、Edge 或 Safari 后刷新页面。</p>');
    return;
  }

  input = new InputManager(hudCv, touchUI, {
    onResize,
    onInteract: () => { audio.init(); dialogue.unlock(); },
    onRequestLock: () => { if (state === 'play') input.lockPointer(); },
    onPause: togglePause,
    onBlur: () => { if (state === 'play') togglePause(); },
    onPointerUnlock: () => { if (state === 'play') togglePause(); },
    onLookDelta: (dx, dy) => {
      if (state === 'play' && !execSession && freezeFrameT <= 0 && P.execT <= 0) {
        P.ang = Math.atan2(Math.sin(P.ang + dx), Math.cos(P.ang + dx));
        P.pitch = clamp(P.pitch + dy, -0.5, 0.75);
      }
    },
    onMiddleClick: () => {
      if (state !== 'play' || execSession) return;
      const t = duel.toggleLock(level, P);
      audio.sfx('tick');
      say(t ? `锁定对手：${t.duel?.name || '刀客'}` : '已解除锁敌');
    },
    onWheel: () => {},
    onKeyDown: code => {
      if (code === 'KeyU' || code === 'KeyB' || code === 'KeyI') {
        audio.init();
        if (state === 'play' || state === 'pause' || state === 'menu' || state === 'over' || state === 'win' || state === 'armory') {
          openArmory();
        }
        return;
      }
      if (state !== 'play' || execSession) return;
      const ultByCode = { Digit1: 'iaido', Digit2: 'cleave', Digit3: 'whirlwind' };
      if (ultByCode[code]) {
        const id = ultByCode[code];
        const spec = ULTIMATES[id];
        if (duel.playerBrokenT > 0) {
          say('架势震溃中，暂无法施展绝技！');
          return;
        }
        const remCd = duel.getCooldown(id);
        if (remCd > 0) {
          say(`冷却中：${spec.name} 还需 ${remCd.toFixed(1)} 秒（完美弹反可减 2.5s 冷却）`);
          audio.sfx('tick');
          return;
        }
        if (!duel.canUseUltimate(id)) {
          say(`刀气不足：${spec.name} 需要 ${spec.cost} 刀气（弹反/拼刀可快速积攒）`);
          audio.sfx('tick');
          return;
        }
        if (P.stepT <= 0 && P.rollT <= 0 && P.execT <= 0 && melee.triggerUltimate(id, meleeCtx)) {
          duel.spendUltimate(id);
        }
        return;
      }
      if (code === 'KeyE') {
        if (execTarget) tryExecute();
        else if (worldPrompt) interactWorldPrompt();
        return;
      }
      if (code === 'KeyQ') {
        drinkHealingFlask();
        return;
      }
      if (code === 'Tab') {
        const t = duel.toggleLock(level, P);
        audio.sfx('tick');
        say(t ? `锁定对手：${t.duel?.name || '刀客'}` : '已解除锁敌');
        return;
      }
      if (duel.mode === 'dojo') {
        if (code === 'F1') { startDojo('duel1v1'); return; }
        if (code === 'F2') { startDojo('duel1v2'); return; }
        if (code === 'F3') { startDojo('duelBoss'); return; }
        if (code === 'F4') { startDojo('duelTrio'); return; }
        if (code === 'KeyR') { startDojo(duel.presetId); return; }
      } else if (code === 'F3') {
        showPerf = !showPerf;
        say(showPerf ? '性能监控：开启 [F3]' : '性能监控：关闭');
        return;
      }
      if (code === 'Space' || code === 'AltLeft' || code === 'AltRight') {
        tryDodgeRoll();
        return;
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (!shiftDownAt) shiftDownAt = performance.now();
        return;
      }
      if (code === 'KeyX') {
        tryQuickStep();
        return;
      }
      // Double-tap A / D / S within 240ms for instant Left Barrel Roll / Right Barrel Roll / Back-Flip!
      if (code === 'KeyA' || code === 'KeyD' || code === 'KeyS') {
        const now = performance.now();
        if (lastMoveTap.code === code && now - lastMoveTap.at < 240) {
          lastMoveTap = { code: '', at: 0 };
          const axes = code === 'KeyA' ? { f: 0, r: -1 } : code === 'KeyD' ? { f: 0, r: 1 } : { f: -1, r: 0 };
          tryDodgeRoll(axes);
          return;
        }
        lastMoveTap = { code, at: now };
        return;
      }
      if (code === 'CapsLock') {
        P.walkDefault = !P.walkDefault;
        say(P.walkDefault ? '步态：默认漫步（按住Shift奔跑）' : '步态：默认奔跑（按住Shift漫步）');
      } else if (code === 'KeyM') {
        const on = audio.toggleMusic();
        say(on ? '音乐：开' : '音乐：关');
      } else if (code === 'KeyH') {
        gr.cycleQuality();
        say(`画质：${gr.getQualityLabel()}`);
      } else if (code === 'KeyC') P.toggleStance('sneak');
      else if (code === 'KeyV') P.toggleStance('crouch');
    },
    onKeyUp: code => {
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        const heldMs = shiftDownAt ? performance.now() - shiftDownAt : 999;
        shiftDownAt = 0;
        // Elden Ring tap-vs-hold: quick tap (< 220ms) rolls; holding Shift sprints cleanly without burning a roll!
        if (state === 'play' && heldMs < 220) tryDodgeRoll();
      }
    }
  });

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeroSample();
    dialogue.setPaused(document.hidden || state !== 'play');
  });
  onResize();

  let physDone = 0;
  let assetFrac = 0;
  const syncLoader = phase => {
    loader.setProgress(0.05 + physDone * 0.12 + assetFrac * 0.77, phase);
  };
  syncLoader('正在唤醒 1937 雨夜物理与冷兵器碰撞引擎…');

  try {
    await Promise.all([
      physics.init().then(() => {
        physDone = 1;
        syncLoader('物理引擎就绪，正在载入石库门长街与人物…');
      }),
      assets.loadAll((p, phase) => {
        assetFrac = p;
        syncLoader(phase);
      }, heroPreset.id, 0)
    ]);

    loader.setProgress(0.95, '正在铸造二十九军大刀与冷兵器库…');
    gr.initAssetPools();
    if (!assets.glb[`hero-${heroPreset.id}`]) {
      heroPreset = HERO_PRESETS.find(preset => assets.glb[`hero-${preset.id}`]) || HERO_PRESETS[0];
    }
    bladeTrail = new BladeTrail(gr.scene);

    wf = new WeaponFactory(gr);
    cf = new CharacterFactory(gr, assets, wf);
    archBuilder = new ArchitectureBuilder(gr, assets);
    propsBuilder = new PropsBuilder(gr, assets);

    loader.setProgress(0.99, '正在构建第一关 · 闸北石库门雨夜死斗场…');
    if (params.get('mode') === 'dojo') {
      await startDojo(params.get('preset') || 'duel1v1');
    } else if (params.get('autostart') === '1') {
      if (DEV_MODE && params.has('qaPoints')) {
        prog.reset();
        prog.addPoints(parseInt(params.get('qaPoints'), 10) || 0);
      }
      await startLevel(0);
      if (DEV_MODE && params.get('spawn') === 'bossGate' && level.bossRoom) {
        P.x = level.bossRoom.gateX;
        P.z = level.bossRoom.gateZ + 2.4;
        P.ang = -Math.PI / 2;
        physics.setPlayerPosition(P.x, 0, P.z);
        updateWorldInteractions(0.016);
      }
    } else {
      buildLevelWorld(0);
      menu();
    }
    const isCoarsePhone = typeof window !== 'undefined' &&
      !!window.matchMedia?.('(pointer: coarse)')?.matches &&
      Math.min(window.innerWidth, window.innerHeight) <= 560;
    if (isCoarsePhone || (DEV_MODE && params.get('qaTouch') === '1')) {
      input.enableTouch();
      if (touchUI) touchUI.hidden = state !== 'play';
    }
    requestAnimationFrame(frame);
    await loader.finish();
  } catch (e) {
    console.error(e);
    loader.showError('<h2 class="ld-dossier-title">资源载入失败</h2><p class="ld-dossier-body">游戏需要通过网页服务器打开才能读取模型、贴图与 WASM 文件。请运行 <b>npm run dev</b> 后在浏览器中访问。</p>');
  }
}

window.__game = {
  get s() {
    return {
      state,
      lvl,
      levelName: level.cfg?.name,
      mode: duel.mode,
      dojo: duel.active,
      dojoPreset: duel.presetId,
      qi: Math.floor(duel.qi),
      cooldowns: { ...duel.cooldowns },
      parryCount: duel.parryCount,
      clashCount: duel.clashCount,
      lockTarget: duel.lockTarget?.duel?.name || null,
      target: (() => {
        const t = duel.lockTarget && duel.lockTarget.hp > 0
          ? duel.lockTarget
          : level.enemies.find(e => e.hp > 0 && !e.bossDormant && e.awake);
        if (!t || !t.duel) return null;
        return {
          name: t.duel.name,
          isBoss: t.type === 'boss',
          hp: Math.round(t.hp),
          max: t.max,
          posture: Math.round(t.duel.posture),
          maxPosture: t.duel.maxPosture,
          state: t.duel.state,
          stateT: +(t.duel.stateT || 0).toFixed(3),
          stateDur: +(t.duel.stateDur || 0).toFixed(3),
          peril: !!t.duel.peril,
          ultKind: t.duel.ultKind || null,
          dist: +Math.hypot(t.x - P.x, t.z - P.z).toFixed(2),
          x: t.x,
          z: t.z
        };
      })(),
      guardCounterT: +(melee.guardCounterT || 0).toFixed(3),
      meleeState: melee.state,
      execReady: !!execTarget,
      enemyWeapons: level.enemies.map(e => e.duel?.weaponKind).filter(Boolean),
      kills,
      total: level.totalEnemies,
      hp: Math.round(P.hp),
      maxHp: P.maxHp,
      stamina: Math.round(P.stamina),
      maxStamina: P.maxStamina,
      flasks: P.flasks,
      maxFlasks: P.maxFlasks,
      points: prog.points,
      prog: prog.snapshot(),
      bossRoom: level.bossRoom ? { ...level.bossRoom } : null,
      worldPrompt: worldPrompt ? { kind: worldPrompt.kind, text: worldPrompt.text } : null,
      shrines: (level.shrines || []).map(sh => ({ id: sh.id, name: sh.name, x: sh.x, z: sh.z, lit: sh.lit })),
      score,
      enemies: level.enemies.length,
      physicsBodies: physics.getBodyCount(),
      x: P.x,
      y: P.y,
      z: P.z,
      ang: P.ang,
      fps,
      hasGun: P.hasGun,
      melee: P.melee,
      mapW: MW,
      mapH: level.MH
    };
  },
  loadLevel() {
    startLevel(0);
    return this.s;
  },
  loadDojo(presetId = 'duel1v1') {
    startDojo(presetId);
    return this.s;
  },
  openUpgrade() {
    openArmory();
    return this.s;
  },
  upgrade(stat) {
    const res = prog.upgrade(stat);
    if (res.ok) syncProgressionToActors(stat === 'vigor');
    return res;
  },
  addPoints(n = 500) {
    awardPoints(n, P.x, 1.5, P.z, '赐福');
    return prog.points;
  },
  enterBossRoom() {
    enterBossRoom();
    return this.s;
  },
  teleportToBossGate() {
    const br = level.bossRoom;
    if (!br) return null;
    P.x = br.gateX;
    P.z = br.gateZ + 2.2;
    P.ang = -Math.PI / 2;
    physics.setPlayerPosition(P.x, 0, P.z);
    updateWorldInteractions(0.016);
    return this.s;
  },
  fireOnce() {
    if (state !== 'play') return;
    input.mouse.down = true;
    setTimeout(() => { input.mouse.down = false; }, 120);
  },
  stageExecTarget() {
    const e = findExecTarget();
    return e ? { type: e.type, execKind: 'stealth' } : null;
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
