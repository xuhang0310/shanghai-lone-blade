import {
  ENEMY_TYPES, CHAR_STYLES, MW, TILE, MELEE_WINDUP, MELEE_RECOVERY,
  PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, enemyStanceHeight
} from '../config/constants.js';
import { stepGuardSuspicion } from '../systems/Stealth.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class EnemyManager {
  constructor() {}

  wake(level, e) {
    if (e.awake) return;
    e.awake = true;
    e.suspicion = 0;
    if (e.type === 'boss') {
      e.cd = Math.max(e.cd || 0, 1.25);
      e.ringT = Math.max(e.ringT || 0, 5.5);
    }
    for (const o of level.enemies) {
      if (o.hp > 0 && !o.awake && o.group === e.group && Math.hypot(o.x - e.x, o.z - e.z) < 16.5) {
        o.awake = true;
        o.suspicion = 0;
        if (o.type === 'boss') {
          o.cd = Math.max(o.cd || 0, 1.25);
          o.ringT = Math.max(o.ringT || 0, 5.5);
        }
      }
    }
  }

  _callout(level, e, callbacks, cue, duration = 3.4) {
    if (!callbacks?.radio || level.calloutCd > 0 || e.disarmed || e.downed || e.executing) return;
    if (callbacks.radio(cue, duration, e) !== false) level.calloutCd = 8.5;
  }

  hearShot(level, player, callbacks, muzzleY = player.y + 1.42 - (player.shoulderDrop || 0)) {
    let listener = null;
    let listenerDistance = 24;
    for (const e of level.enemies) {
      const dx = e.x - player.x, dz = e.z - player.z;
      const d = Math.hypot(dx, dz);
      if (e.hp <= 0 || d >= 24) continue;
      this.wake(level, e);
      if (e.disarmed || e.downed || e.executing) continue;
      const firstShot = !(e.shotNoiseT > 0);
      e.shotNoiseT = 2.4;
      if (!e.sees) {
        e.heardShot = { x: player.x, z: player.z };
        if (firstShot && !(e.searchT > 0) && d < listenerDistance) {
          listener = e;
          listenerDistance = d;
        }
      }
      if (!firstShot) continue;
      const inFront = dx * Math.cos(player.ang) + dz * Math.sin(player.ang) > d * 0.75;
      if ((d < 8 || inFront) && level.los3(player.x, muzzleY, player.z, e.x, enemyStanceHeight(e) * 0.8, e.z)) {
        this._takeShelter(level, e, player.x, player.z, { fromShot: true });
      }
    }
    if (listener) this._callout(level, listener, callbacks, 'heard-shot');
  }

  _lookForPlayer(e, ctx, eyeHeight, playerHeight) {
    const { level, player, callbacks } = ctx;
    const dx = player.x - e.x, dz = player.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    if (e.heardShot) {
      const facing = dx * Math.cos(e.ang) + dz * Math.sin(e.ang);
      if (facing < dist * 0.25) return false;
    }
    let visible = level.los3(e.x, eyeHeight, e.z, player.x, playerHeight, player.z);
    if (!visible && e.type === 'boss') {
      // Boss checks left/right shoulder sightlines so tight 3rd-person corner peeks expose the shooter
      const rx = -dz / dist;
      const rz = dx / dist;
      visible =
        level.los3(e.x + rx * 0.36, eyeHeight, e.z + rz * 0.36, player.x + rx * 0.26, playerHeight, player.z + rz * 0.26) ||
        level.los3(e.x - rx * 0.36, eyeHeight, e.z - rz * 0.36, player.x - rx * 0.26, playerHeight, player.z - rz * 0.26);
    }
    if (!visible) return false;
    if (!e.lastSeen) this._callout(level, e, callbacks, 'spot-' + e.type);
    e.heardShot = null;
    e.lastSeen = { x: player.x, z: player.z };
    e.searchT = e.type === 'boss' ? 8.5 : 2.4;
    return true;
  }

  _takeShelter(level, e, x, z, opts = {}) {
    if (e.defense || e.defenseCd > 0 || e.executing || e.downed || e.disarmed || e.type === 'boss') return;
    if (e.post || e.cover || e.way?.length || e.windupT > 0 || e.recoveryT > 0) return;
    const fromHit = !!opts.fromHit;
    const vulnerable = fromHit
      ? !e.brave && (e.limpT > 0 || e.hp < e.max * 0.30)
      : e.limpT > 0 || e.hp < e.max * 0.5;
    const cautiousBlade = !fromHit && (e.type === 'thug' || e.melee) && !e.brave;
    if (!vulnerable && !cautiousBlade) return;
    const path = level.shelterRoute(e, x, z);
    if (fromHit && !path.length) return;
    e.defense = {
      path,
      destination: path.at(-1),
      brace: opts.fromShot ? rnd(0.20, 0.34) : 0,
      fromShot: !!opts.fromShot,
      travelT: 4.5,
      hold: rnd(1.0, 1.65)
    };
    e.aimT = e.burst = 0;
  }

  _move(e, level, dt, dx, dz, speed) {
    const x = e.x, z = e.z;
    level.moveEnt(e, dx * speed * dt, dz * speed * dt);
    const moved = Math.hypot(e.x - x, e.z - z);
    e.moving = moved > 0.001;
    e.spd = dt > 0 ? moved / dt : 0;
    e.walk += moved / 0.7;
    return moved;
  }

  _followRefuge(e, level, dt, path, speed) {
    const next = path[0];
    if (!next) return;
    const dx = next.x - e.x, dz = next.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.001 && dt > 0) {
      this._faceToward(e, Math.atan2(dz, dx), dt * 6);
      this._move(e, level, dt, dx / d, dz / d, Math.min(speed, d / dt));
    }
    if (Math.hypot(next.x - e.x, next.z - e.z) < 0.12) path.shift();
  }

  findCover(level, e, P) {
    const ex = Math.floor(e.x / TILE);
    const ez = Math.floor(e.z / TILE);
    let best = null;
    let bd = 1e9;
    for (let z = ez - 5; z <= ez + 5; z++) {
      for (let x = ex - 5; x <= ex + 5; x++) {
        if (level.T(x, z) !== 2 || level.tileH[z * MW + x] > 1.25) continue;
        const cx = (x + 0.5) * TILE;
        const cz = (z + 0.5) * TILE;
        const dx = cx - P.x;
        const dz = cz - P.z;
        const dl = Math.hypot(dx, dz);
        if (dl < 9.4 || dl > 32.5) continue;
        const sx = Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0;
        const sz = sx ? 0 : Math.sign(dz);
        if (level.T(x + sx, z + sz) !== 0) continue;
        const px = (x + sx + 0.5) * TILE;
        const pz = (z + sz + 0.5) * TILE;
        const dd = Math.hypot(px - e.x, pz - e.z);
        if (dd < bd && level.los(e.x, e.z, px, pz)) {
          bd = dd;
          best = { x: px, z: pz };
        }
      }
    }
    return best;
  }

  update(dt, ctx) {
    const { level, player: P, physics, audio } = ctx;
    const enemies = level.enemies;
    if (level.calloutCd > 0) level.calloutCd = Math.max(0, level.calloutCd - dt);
    if (level.corpses?.length) {
      for (const c of level.corpses) c.t = (c.t || 0) + dt;
      level.corpses = level.corpses.filter(c => c.t < 24);
    }

    for (const e of enemies) {
      if (e.hp <= 0) continue;
      this._updateOne(e, dt, ctx);
      if (e.moving && !e.downed) {
        const distance = Math.hypot(e.x - P.x, e.z - P.z);
        if (distance < 16) {
          e.stepTravel = (e.stepTravel || 0) + e.spd * dt;
          if (e.stepTravel >= (e.duck ? 0.8 : 1.35)) {
            e.stepTravel = 0;
            audio.playStep(level.cfg.style, (e.duck ? 0.10 : 0.18) * (1 - distance / 16), e.duck);
          }
        }
      }
    }

    // Soft crowd separation between active enemies
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.hp <= 0 || !a.awake) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.hp <= 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const m = a.r + b.r;
        if (d < m) {
          const push = (m - d) * 0.5;
          const nx = d > 0.001 ? dx / d : Math.cos(a.ang);
          const nz = d > 0.001 ? dz / d : Math.sin(a.ang);
          if (!a.executing) level.moveEnt(a, -nx * push, -nz * push);
          if (!b.executing) level.moveEnt(b, nx * push, nz * push);
        }
      }
    }

    // Sync kinematic Rapier capsules
    for (const e of enemies) {
      if (e.hp > 0) {
        const target = e.duck && !e.executing && !e.downed ? 1 : 0;
        e.crouchK = (e.crouchK || 0) + (target - (e.crouchK || 0)) * Math.min(1, dt * 11);
        physics.updateEnemyCollider(e, e.x, e.z, enemyStanceHeight(e));
      }
    }

    level.enemies = enemies.filter(e => e.hp > 0);
  }

  _updateOne(e, dt, ctx) {
    const { level, player: P, audio, callbacks } = ctx;
    const t = ENEMY_TYPES[e.type];
    const dx = P.x - e.x;
    const dz = P.z - e.z;
    const d = Math.hypot(dx, dz) || 0.01;
    const ph = P.y + P.currentHeight() - 0.1;
    e.moving = false;
    e.spd = 0;
    e.backpedal = false;
    e.guarding = false;
    e.defenseCd = Math.max(0, (e.defenseCd || 0) - dt);
    if (e.shotNoiseT > 0) {
      e.shotNoiseT = Math.max(0, e.shotNoiseT - dt);
      if (!e.shotNoiseT) e.heardShot = null;
    }

    if (e.flash > 0) e.flash -= dt;
    if (e.flinch > 0) e.flinch = Math.max(0, e.flinch - dt * 5.5);
    if (e.stun > 0) e.stun = Math.max(0, e.stun - dt);
    if ((e.staggerT || 0) > 0) {
      e.staggerT = Math.max(0, e.staggerT - dt);
      e.flinch = Math.max(e.flinch || 0, 0.36);
    }
    if (e.inv > 0) e.inv -= dt;
    if (e.poiseCd > 0) e.poiseCd = Math.max(0, e.poiseCd - dt);
    if (e.cornerReadyT > 0) e.cornerReadyT = Math.max(0, e.cornerReadyT - dt);
    if (e.executing) {
      e.moving = false;
      e.spd = 0;
      return;
    }

    // Hit-reaction states (see systems/HitReactions.js)
    if (e.react) {
      e.react.t += dt;
      if (e.react.t >= e.react.dur) e.react = null;
    }
    if (e.limpT > 0) e.limpT = Math.max(0, e.limpT - dt);
    if (e.downed) {
      this._updateDowned(e, dt, ctx);
      return;
    }
    if (e.react?.kind === 'kneel') {
      e.moving = false;
      e.spd = 0;
      this._faceToward(e, Math.atan2(dz, dx), dt * 3);
      return;
    }
    if (!e.awake) {
      if (stepGuardSuspicion(level, e, P, dt)) {
        this.wake(level, e);
      } else {
        const corpse = this._spotCorpse(level, e);
        if (corpse) {
          corpse.found = true;
          this.wake(level, e);
          e.lastSeen = { x: corpse.x, z: corpse.z };
          e.searchT = 6.5;
          this._callout(level, e, callbacks, 'ally-down', 3.0);
          callbacks.say?.('守卫发现了同伴的尸体！');
          return;
        }
        if ((e.suspicion || 0) > 0.14) {
          this._faceToward(e, Math.atan2(dz, dx), dt * 1.35);
        } else if (e.patrol?.length >= 2) {
          this._patrol(level, e, dt);
        }
        return;
      }
    }

    e.seeT -= dt;
    if (e.seeT <= 0) {
      e.seeT = 0.15;
      e.sees = this._lookForPlayer(e, ctx, enemyStanceHeight(e) - 0.2, ph);
    }

    if (!e.sees) e.searchT = Math.max(0, e.searchT - dt);
    const toP = Math.atan2(dz, dx);
    if (e.disarmed) {
      this._updateSurrender(e, dt, d, dx, dz, ctx);
      return;
    }
    const knife = e.type === 'thug' || e.melee;
    const watched = e.sees && !P.melee && -(dx * Math.cos(P.ang) + dz * Math.sin(P.ang)) > d * 0.65;
    const threatened = watched && (P.ads > 0.35 || P.gunHoldT > 0.2 || P.combatStance);
    if (knife) {
      const pressed = threatened && d < 20 && d > 2;
      if (pressed && !e.wasThreatened) this._takeShelter(level, e, P.x, P.z);
      e.wasThreatened = pressed;
    }
    if (e.defense) {
      const defense = e.defense;
      defense.brace = Math.max(0, defense.brace - dt);
      e.guarding = knife;
      if (defense.brace <= 0 && e.staggerT <= 0) {
        if (defense.path.length && defense.travelT > 0) {
          // Always hustle/run upright (or limp upright) toward cover — never crouch-walk across the street!
          e.duck = false;
          defense.travelT -= dt;
          const pace = Math.min(t.sp * 0.92, 4.35) * (e.limpT > 0 ? 0.55 : 1);
          this._followRefuge(e, level, dt, defense.path, pace);
        } else {
          // Only crouch once stationary and actually sheltered behind cover
          e.duck = !level.los3(P.x, ph, P.z, e.x, e.ht * 0.52, e.z);
          defense.hold -= dt;
          if (e.sees) this._faceToward(e, toP, dt * 4);
        }
      } else {
        e.duck = defense.brace > 0 && !!defense.fromShot;
        if (e.sees) this._faceToward(e, toP, dt * 4);
      }
      if (defense.hold <= 0) {
        e.defense = null;
        e.duck = false;
        e.defenseCd = e.brave ? 5.2 : 3.6;
      }
      return;
    }
    if (!e.sees) {
      if (e.type === 'boss' && e.lastSeen) {
        if ((e.hiddenT || 0) === 0 && (e.aimT > 0 || e.burst > 0)) e.cornerReadyT = 2.4;
        e.hiddenT = (e.hiddenT || 0) + dt;
      }
      e.aimT = e.burst = e.windupT = e.ringWindupT = 0;
      if (e.heardShot) this._faceToward(e, Math.atan2(e.heardShot.z - e.z, e.heardShot.x - e.x), dt * 4);
      if (!e.cover && !e.way?.length && !e.post && e.type !== 'boss') {
        e.duck = false;
        if (!e.heardShot && e.lastSeen && e.searchT > 0) {
          const { x, z } = e.lastSeen;
          const dist = Math.hypot(x - e.x, z - e.z);
          this._faceToward(e, Math.atan2(z - e.z, x - e.x), dt * 4);
          if (dist > 0.65 && level.los(e.x, e.z, x, z)) {
            this._move(e, level, dt, (x - e.x) / dist, (z - e.z) / dist, e.limpT > 0 ? 0.8 : 1.7);
          }
        }
        return;
      }
    } else if (e.type === 'boss') {
      if ((e.hiddenT || 0) > 0.15 && (e.hiddenT || 0) < 2.6) e.cornerReadyT = 2.2;
      e.hiddenT = 0;
      e.cheeseHits = 0;
    }
    let vx = 0;
    let vz = 0;
    let sp = t.sp;

    if (knife) {
      e.duck = false;
      e.cd -= dt;
      this._faceToward(e, toP, dt * 5);
      const reach = e.r + 1.05;
      if (e.staggerT > 0 || e.stun > 0) {
        e.windupT = 0;
        return;
      }
      if (e.windupT > 0) {
        e.windupT = Math.max(0, e.windupT - dt);
        if (!e.windupT) {
          e.recoveryT = MELEE_RECOVERY;
          e.cd = 1.25;
          if (d < reach && level.los3(e.x, 1, e.z, P.x, P.y + 0.9, P.z)) callbacks.hurtPlayer(9, e.x, e.z);
        }
        return;
      }
      if (e.recoveryT > 0) {
        e.recoveryT = Math.max(0, e.recoveryT - dt);
        if (d < reach + 0.8) {
          this._move(e, level, dt, -dx / d, -dz / d, 1.2);
          e.backpedal = e.moving;
        }
        return;
      }
      if (d < reach && e.cd <= 0) {
        e.windupT = MELEE_WINDUP;
        if (!e.warCried) { e.warCried = true; callbacks.radio?.('charge', 2.6, e); }
        return;
      }
      e.guarding = watched || d < 4;
      if (d > reach - 0.12 && !threatened && !(watched && d < 6.5)) {
        const f = level.canWalk(e.x, e.z, P.x, P.z, e.r * 0.9) ? [dx / d, dz / d] : level.flowDir(e);
        if (f) [vx, vz] = f;
        sp = watched ? 1.9 : Math.min(3.8, t.sp * 0.70);
      }
    } else {
      const pref = t.pref;
      const busy = e.aimT > 0 || e.burst > 0;
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = rnd(1, 2.6);
        e.strafe = -e.strafe;
      }
      e.coverT -= dt;

      if (e.way && e.way.length) {
        const w = e.way[0];
        const wd = Math.hypot(w.x - e.x, w.z - e.z);
        e.wayT += dt;
        if (e.wayT > 5) {
          const danger = e.lastSeen || P;
          e.way = level.shelterRoute(e, danger.x, danger.z);
          e.post = e.way.at(-1) || { x: e.x, z: e.z };
          e.wayT = 0;
        } else if (wd < 0.65) {
          e.way.shift();
          e.wayT = 0;
        } else {
          vx = (w.x - e.x) / wd;
          vz = (w.z - e.z) / wd;
          sp *= 1.6;
        }
        if (!e.way.length) {
          e.cover = e.post;
          e.coverAge = 0;
        }
      } else if (e.cover) {
        const cd = Math.hypot(e.cover.x - e.x, e.cover.z - e.z);
        e.coverAge += dt;
        if (cd > 0.56) {
          vx = (e.cover.x - e.x) / cd;
          vz = (e.cover.z - e.z) / cd;
          e.duck = false;
          if (e.coverAge > 5 && !e.post) e.cover = null;
        } else {
          e.duck = !busy;
          e.peekT = (e.peekT ?? 1.6) - dt;
          if (!busy && e.peekT <= 0 && e.cd <= 0) {
            e.duck = false;
            e.peekT = rnd(1.6, 2.8);
            e.sees = this._lookForPlayer(e, ctx, e.ht - 0.15, ph);
            if (e.sees) {
              e.aimT = 0.34;
            } else if (!e.post) {
              e.cover = null;
              e.coverT = 2.2;
            }
          }
          if (e.type === 'boss' && e.post && ((e.hiddenT || 0) > 2.0 || d < 9.5)) {
            e.post = null;
            e.cover = null;
            e.duck = false;
            e.coverT = 5.0;
          }
          if (!e.post && (d < 8.1 || e.coverAge > 12 || level.los3(e.x, e.ht * 0.45, e.z, P.x, ph, P.z))) {
            e.cover = null;
            e.duck = false;
            e.coverT = 3;
          }
        }
      } else {
        e.duck = false;
        if (!e.brave && e.sees && e.coverT <= 0 && !busy) {
          e.coverT = 2.5;
          const c = this.findCover(level, e, P);
          if (c) {
            e.cover = c;
            e.coverAge = 0;
          }
        }
        if (!e.cover && e.sees) {
          if (d > pref + 3.1) {
            const f = level.flowDir(e) || [dx / d, dz / d];
            vx = f[0] + (-dz / d) * e.strafe * 0.6;
            vz = f[1] + (dx / d) * e.strafe * 0.6;
            const l = Math.hypot(vx, vz) || 1;
            vx /= l;
            vz /= l;
          } else if (d < pref - 5.6) {
            vx = -dx / d;
            vz = -dz / d;
          } else {
            vx = (-dz / d) * e.strafe;
            vz = (dx / d) * e.strafe;
            sp *= 0.6;
          }
        } else if (!e.cover && e.type === 'boss' && e.lastSeen) {
          // Boss refuses to freeze when the player hides around a corner: actively flank & wrap around cover
          const lx = e.lastSeen.x - e.x;
          const lz = e.lastSeen.z - e.z;
          const ld = Math.hypot(lx, lz) || 0.01;
          const direct = ld > 2.4 && level.canWalk(e.x, e.z, e.lastSeen.x, e.lastSeen.z, e.r * 0.9);
          const f = direct ? [lx / ld, lz / ld] : level.flowDir(e) || [lx / ld, lz / ld];
          const sideX = -f[1] * e.strafe;
          const sideZ = f[0] * e.strafe;
          const flankBias = ld < 3.2 ? 0.72 : 0.42;
          vx = f[0] + sideX * flankBias;
          vz = f[1] + sideZ * flankBias;
          const l = Math.hypot(vx, vz) || 1;
          vx /= l;
          vz /= l;
          sp = t.sp * 0.96;
        }
      }

      if (busy) sp = t.sp * 0.25;
      if (e.sees) {
        const df = Math.atan2(Math.sin(toP - e.ang), Math.cos(toP - e.ang));
        e.ang = Math.atan2(Math.sin(e.ang + clamp(df, -dt * 6, dt * 6)), Math.cos(e.ang + clamp(df, -dt * 6, dt * 6)));
      } else if (e.type === 'boss' && e.lastSeen) {
        this._faceToward(e, Math.atan2(e.lastSeen.z - e.z, e.lastSeen.x - e.x), dt * 5.2);
      } else if (vx || vz) {
        e.ang = Math.atan2(vz, vx);
      }

      const canShoot = e.sees && !e.duck && (e.staggerT || 0) <= 0 && (e.stun || 0) <= 0;
      // At a post the next peek waits for this cooldown to finish.
      if (canShoot || e.cover) e.cd = Math.max(0, e.cd - dt);
      if (canShoot && !(e.ringWindupT > 0)) {
        if (e.burst > 0) {
          e.burstT -= dt;
          if (e.burstT <= 0) {
            const bStyle = e.bossCfg?.attackStyle || 'smg';
            e.burstT = e.type === 'boss' ? (bStyle === 'zb26' ? 0.125 : bStyle === 'mp18' ? 0.115 : 0.135) : 0.11;
            e.burst--;
            const bSpread = e.type === 'boss' ? (bStyle === 'zb26' ? 0.088 : bStyle === 'mp18' ? 0.10 : 0.095) : 0.075;
            const bSpeed = e.type === 'boss' ? (bStyle === 'zb26' ? 320 : 275) : 295;
            const bDmg = e.type === 'boss' ? (bStyle === 'mp18' ? 4 : 5) : 6;
            this._fire(e, bSpread, bSpeed, bDmg, false, ctx);
          }
        } else if (e.aimT > 0) {
          e.aimT -= dt;
          if (e.aimT <= 0) {
            if (e.type === 'gunman' || e.type === 'officer') {
              this._fire(e, 0.055, 310, 9, false, ctx);
              e.cd = rnd(0.95, 1.55);
            } else if (e.type === 'soldier') {
              this._fire(e, 0.030, 680, 15, false, ctx);
              e.cd = rnd(1.6, 2.2);
            } else if (e.type === 'boss') {
              const bStyle = e.bossCfg?.attackStyle || 'smg';
              const low = e.hp < e.max * 0.5;
              if (bStyle === 'shotgun') {
                const pellets = low ? 6 : 5;
                for (let i = 0; i < pellets; i++) this._fire(e, 0.145, 310, 4, i > 0, ctx);
                audio.sfx('shotgun');
                e.cd = rnd(2.0, 2.7);
              } else if (bStyle === 'sniper') {
                this._fire(e, 0.022, 820, 18, false, ctx);
                audio.sfx('sniper');
                e.cd = rnd(2.2, 3.0);
              } else if (bStyle === 'zb26') {
                e.burst = low ? 7 : 6;
                e.burstT = 0;
                e.cd = rnd(2.2, 3.0);
              } else if (bStyle === 'mp18') {
                e.burst = low ? 7 : 6;
                e.burstT = 0;
                e.cd = rnd(1.9, 2.6);
              } else {
                e.burst = low ? 6 : 5;
                e.burstT = 0;
                e.cd = rnd(2.1, 2.9);
              }
            } else {
              e.burst = 5;
              e.burstT = 0;
              e.cd = rnd(1.4, 2.0);
            }
          }
        } else if (e.sees && d < (e.type === 'boss' ? (e.bossCfg?.attackStyle === 'sniper' ? 52 : 36) : 42) && e.cd <= 0 && !(e.way && e.way.length)) {
          const bossAim = e.bossCfg?.attackStyle === 'sniper'
            ? (e.cornerReadyT > 0 ? 0.55 : 0.92)
            : (e.cornerReadyT > 0 ? 0.30 : 0.62);
          e.aimT =
            e.type === 'boss'
              ? bossAim
              : e.type === 'soldier'
                ? 0.52
                : 0.34;
        }
      }

      if (e.type === 'gunner' || e.type === 'boss') {
        e.nadeCd -= dt;
        const bName = e.bossCfg?.name || '黑龙';
        const bossFlush =
          e.type === 'boss' &&
          !e.sees &&
          e.lastSeen &&
          ((e.hiddenT || 0) > 1.35 || (e.cheeseHits || 0) >= 2);
        if (e.nadeCd <= 0 && bossFlush) {
          const fx = e.lastSeen.x - e.x;
          const fz = e.lastSeen.z - e.z;
          const fd = Math.hypot(fx, fz);
          if (fd > 4.5 && fd < 26.2) {
            e.nadeCd = rnd(6.5, 9.5);
            e.cheeseHits = 0;
            const v = Math.sqrt(9.8 * fd) * 0.78;
            callbacks.spawnGrenade?.(e.x, 1.75, e.z, (fx / fd) * v, v * 0.95, (fz / fd) * v, false, true);
            callbacks.say?.(`${bName}朝你的掩体扔了手雷！快转移位置！`);
          }
        } else if (e.nadeCd <= 0 && e.sees && P.still > 2.5 && d > 8.1 && d < 26.2) {
          e.nadeCd = rnd(8, 12);
          const v = Math.sqrt(9.8 * d) * 0.76;
          callbacks.spawnGrenade?.(e.x, 1.6, e.z, (dx / d) * v, v * 0.85, (dz / d) * v, false, true);
          callbacks.say?.('手雷！快离开！');
        }
      }

      if (e.type === 'officer' && !e.called) {
        if (e.callT <= 0 && e.sees) {
          e.callT = 4.5;
          audio.sfx('whistle');
          callbacks.say('军官在吹哨叫人，先打掉他！');
        } else if (e.callT > 0) {
          e.callT -= dt;
          if (e.callT <= 0) {
            e.called = true;
            callbacks.say('增援到了！');
            for (let i = 0; i < 2; i++) {
              callbacks.spawnLive(i ? 'soldier' : 'gunman', e.x + rnd(-4.4, 4.4), e.z - rnd(2.5, 6.9), e.x, e.z);
            }
          }
        }
      }

      if (e.type === 'boss') {
        const bName = e.bossCfg?.name || '黑龙';
        const low = e.hp < e.max * 0.5;
        const canScatter = e.sees && d < 25 && !e.duck && !(e.way && e.way.length) && (e.staggerT || 0) <= 0 && (e.stun || 0) <= 0;
        if (e.ringWindupT > 0) {
          if (!canScatter) {
            e.ringWindupT = 0;
          } else {
            e.ringWindupT -= dt;
            if (e.ringWindupT <= 0) {
              e.ringWindupT = 0;
              e.ringT = low ? 5.8 : 7.5;
              e.cd = Math.max(e.cd, 1.65);
              for (let i = 0; i < 6; i++) this._fire(e, 0.15, 310, 4, i > 0, ctx);
              audio.sfx('shotgun');
              callbacks.addShake(0.22);
            }
          }
        } else if (canScatter) {
          e.ringT -= dt;
          if (e.ringT <= 0 && e.burst <= 0) {
            e.ringWindupT = 0.85;
            e.aimT = 0;
            audio?.sfx?.('tick');
            callbacks.say?.(`${bName}正在蓄力霰弹齐射！快找掩体或翻滚！`);
          }
        }
        if (low && !e.p2) {
          e.p2 = true;
          e.inv = 3.5;
          e.wayT = 0;
          e.post = { x: level.exitPos.x, z: 3.6 * TILE };
          e.way = [
            { x: level.exitPos.x - TILE, z: 6.6 * TILE },
            { x: level.exitPos.x - TILE, z: 4.4 * TILE },
            e.post
          ];
          e.aimT = 0;
          e.burst = 0;
          e.ringWindupT = 0;
          callbacks.say(`${bName}退到掩体后面了！`);
          for (let i = 0; i < 2; i++) {
            callbacks.spawnLive(
              i % 2 ? 'soldier' : 'gunner',
              level.exitPos.x + (i - 0.5) * 6.25,
              10 * TILE,
              e.x,
              e.z + 3 * TILE
            );
          }
        }
        if (e.summoned === 0 && e.hp < e.max * 0.25) {
          e.summoned++;
          callbacks.radio?.('boss-summon', 3, e);
          for (let i = 0; i < 2; i++) {
            callbacks.spawnLive('thug', e.x + rnd(-5.6, 5.6), e.z + rnd(2.5, 6.9), e.x, e.z);
          }
        }
      }
    }

    if (e.stun > 0 || e.staggerT > 0) sp *= 0.25;
    if (e.limpT > 0) sp *= 0.5;
    if (vx || vz) {
      this._move(e, level, dt, vx, vz, sp);
      e.backpedal = e.moving && (vx * Math.cos(e.ang) + vz * Math.sin(e.ang) < -0.45);
    }
  }

  _spotCorpse(level, e) {
    if (!level.corpses?.length) return null;
    const eyeY = enemyStanceHeight(e) - 0.2;
    const fx = Math.cos(e.ang), fz = Math.sin(e.ang);
    for (const c of level.corpses) {
      if (c.found || c.t < 0.35) continue;
      const dx = c.x - e.x, dz = c.z - e.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 14 || dist < 0.01) continue;
      if (dx * fx + dz * fz < dist * 0.25) continue;
      if (level.los3(e.x, eyeY, e.z, c.x, 0.35, c.z)) return c;
    }
    return null;
  }

  _patrol(level, e, dt) {
    if (e.patrolWait > 0) {
      e.patrolWait = Math.max(0, e.patrolWait - dt);
      return;
    }
    const goal = e.patrol[e.patrolIdx % e.patrol.length];
    if (!goal) return;
    const dx = goal.x - e.x, dz = goal.z - e.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.45) {
      e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
      e.patrolWait = rnd(1.8, 3.4);
      return;
    }
    this._faceToward(e, Math.atan2(dz, dx), dt * 3.2);
    const moved = this._move(e, level, dt, dx / dist, dz / dist, Math.min(1.45, dist / Math.max(dt, 0.01)));
    if (moved < 0.002 && dt > 0) {
      e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
      e.patrolWait = 1.2;
    }
  }

  _faceToward(e, want, rate) {
    const df = Math.atan2(Math.sin(want - e.ang), Math.cos(want - e.ang));
    e.ang = Math.atan2(Math.sin(e.ang + clamp(df, -rate, rate)), Math.cos(e.ang + clamp(df, -rate, rate)));
  }

  // Badly wounded: collapse, then crawl away from the shooter until bleeding out
  _updateDowned(e, dt, ctx) {
    const { level, player: P } = ctx;
    e.bleedT -= dt;
    if (e.bleedT <= 0) {
      this.hitEnemy(e, 9999, 0, 0, 0.3, ctx, false, 0, 'torso');
      return;
    }
    if (e.react?.kind === 'down') {
      e.moving = false;
      e.spd = 0;
      return;
    }
    this._faceToward(e, Math.atan2(e.z - P.z, e.x - P.x), dt * 1.6);
    this._move(e, level, dt, Math.cos(e.ang), Math.sin(e.ang), 0.5);
  }

  // Surrender is permanent. When the immediate threat passes, leave the open lane upright and huddle in shelter.
  _updateSurrender(e, dt, d, dx, dz, ctx) {
    const { level } = ctx;
    e.surrenderT = Math.max(0, (e.surrenderT || 0) - dt);
    e.handsUp = e.surrenderT > 0 || (e.sees && d < 9);
    if (e.handsUp) {
      e.duck = false;
      e.escapePath = null;
      if (e.sees) {
        this._faceToward(e, Math.atan2(dz, dx), dt * 4);
        if (d < 6) {
          this._move(e, level, dt, -dx / d, -dz / d, 0.85);
          e.backpedal = e.moving;
        }
      }
    } else if (e.lastSeen) {
      e.escapePath ??= level.shelterRoute(e, e.lastSeen.x, e.lastSeen.z);
      if (e.escapePath.length) {
        e.duck = false;
        this._followRefuge(e, level, dt, e.escapePath, e.limpT > 0 ? 1.4 : 3.4);
      } else {
        e.duck = true;
      }
    } else {
      e.duck = false;
    }
  }

  // Non-lethal hit reaction by body part
  _react(e, part, dmg, dx, dz, ctx) {
    const { audio, callbacks } = ctx;
    if (e.downed) return;
    const boss = e.type === 'boss';
    const c = Math.cos(e.ang);
    const s = Math.sin(e.ang);
    const side = -(dx || 0) * s + (dz || 0) * c > 0 ? 1 : -1;
    const leg = part === 'legL' || part === 'legR';

    if (!boss && !e.melee && e.hp < e.max * 0.34 && dmg >= 12 && Math.random() < (leg ? 0.75 : 0.4)) {
      e.downed = true;
      e.react = { kind: 'down', t: 0, dur: 0.6, side };
      e.bleedT = rnd(11, 15);
      e.duck = false;
      e.surrenderT = 0;
      e.handsUp = false;
      e.defense = null;
      e.windupT = e.recoveryT = 0;
      e.cover = null;
      e.way = null;
      e.aimT = 0;
      e.burst = 0;
      return;
    }

    if (part === 'head') {
      e.react = { kind: 'headSnap', t: 0, dur: boss ? 0.38 : 0.5, side };
      e.staggerT = Math.max(e.staggerT || 0, boss ? 0.36 : 0.5);
      const u = e.mesh?.userData;
      if (u?.hatMesh && u.hatMesh.visible) {
        u.hatMesh.visible = false;
        callbacks.spawnFlyingHat?.(e.type, e.x, (e.ht || 1.75) * 0.92, e.z, dx || 0, dz || 0);
      }
    } else if (leg && !boss) {
      const ls = part === 'legL' ? -1 : 1;
      e.react = { kind: 'kneel', t: 0, dur: 1.5, side: ls };
      e.limpT = 10;
      e.limpSide = ls;
      e.staggerT = Math.max(e.staggerT || 0, 1.5);
      e.duck = false;
    } else if (part === 'armR' && !boss && !e.disarmed && !e.melee && e.type !== 'thug') {
      e.disarmed = true;
      e.handsUp = true;
      if (ctx.player) e.lastSeen = { x: ctx.player.x, z: ctx.player.z };
      e.defense = null;
      e.surrenderT = rnd(5.5, 7.5);
      e.react = { kind: 'disarm', t: 0, dur: 0.5, side };
      e.aimT = 0;
      e.burst = 0;
      e.duck = false;
      e.cover = null;
      e.way = null;
      callbacks.dropGun?.(e, dx || 0, dz || 0);
      audio?.playVoiceShout?.('grunt', 0);
      callbacks.radio?.('surrender', 2.2, e);
    } else {
      if (boss && (e.poiseCd || 0) > 0) return;
      e.react = { kind: 'stagger', t: 0, dur: boss ? 0.24 : 0.42, side };
      e.staggerT = Math.max(e.staggerT || 0, boss ? 0.16 : 0.42);
    }
  }

  _fire(e, spread, speed, dmg, quiet, ctx) {
    const { player: P, audio, callbacks } = ctx;
    const k = e.ht / 1.8;
    const c = Math.cos(e.ang);
    const s = Math.sin(e.ang);
    const ox = e.x + c * 0.81;
    const oz = e.z + s * 0.81;
    const oh = 1.42 * k;
    const stance = (P.currentHeight() - PLAYER_CROUCH_HEIGHT) / (PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT);
    const th = P.y + 0.7 + 0.45 * clamp(stance, 0, 1);

    const dx = P.x - ox;
    const dy = th - oh;
    const dz = P.z - oz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const a = Math.atan2(dz, dx) + rnd(-spread, spread);
    const el = Math.asin(clamp(dy / dl, -1, 1)) + rnd(-spread, spread) * 0.6;
    const ce = Math.cos(el);

    callbacks.shootBullet(ox, oh, oz, Math.cos(a) * ce, Math.sin(el), Math.sin(a) * ce, speed, dmg, false);
    if (!quiet) {
      callbacks.puff(ox + c * 0.31, oh, oz + s * 0.31, 3, '#ffb060', 2.5, 0.12);
      audio.playEnemyShot(e.type, Math.hypot(e.x - P.x, e.z - P.z));
    }
  }

  hitEnemy(e, dmg, dx, dz, hitY, ctx, head = false, execBoost = 0, part = null) {
    if (e.hp <= 0 || (e.inv > 0 && !execBoost)) return;
    const { level, player: P, physics, audio, callbacks } = ctx;
    const boss = e.type === 'boss';
    e.duck = false;
    e.hp -= dmg;
    e.flash = 0.08;
    e.flinch = execBoost ? 1.8 : boss ? 0.55 : 1.0;
    if (boss) {
      const heavyBreak = head || !(e.poiseCd > 0);
      e.stun = Math.max(e.stun || 0, heavyBreak ? 0.2 : 0.05);
      if (e.hp > 0) {
        e.staggerT = Math.max(e.staggerT || 0, heavyBreak ? 0.22 : 0.06);
        if (heavyBreak && !head) e.poiseCd = 2.0;
        if (part && !execBoost) this._react(e, part, dmg, dx, dz, ctx);
        if (P && !execBoost) {
          e.lastSeen = { x: P.x, z: P.z };
          e.searchT = 9.0;
          e.ang = Math.atan2(P.z - e.z, P.x - e.x);
          if (!e.sees) {
            e.cheeseHits = (e.cheeseHits || 0) + 1;
            e.cornerReadyT = 2.4;
            if (e.post || e.cover) {
              e.post = null;
              e.cover = null;
              e.coverT = 4.5;
            }
          }
        }
      }
    } else {
      e.stun = Math.max(e.stun || 0, dmg >= 28 ? 0.45 : 0.18);
      if (e.hp > 0) {
        e.staggerT = Math.max(e.staggerT || 0, dmg >= 26 ? 0.65 : 0.22);
        if (part && !execBoost) this._react(e, part, dmg, dx, dz, ctx);
        if (!execBoost && P) this._takeShelter(level, e, P.x, P.z, { fromHit: true });
      }
    }
    if (!ctx.stealthTakedown) this.wake(level, e);
    const bloodCnt = execBoost >= 4.5 ? 22 : execBoost > 0 ? 14 : 7;
    const bloodSpd = execBoost >= 4.5 ? 8.2 : 5.2;
    callbacks.puff(e.x, hitY ?? 1.25, e.z, bloodCnt, '#b3261e', bloodSpd, 0.52);
    if (execBoost > 0) {
      callbacks.puff(e.x + (dx || 0) * 0.35, (hitY ?? 1.35) + 0.08, e.z + (dz || 0) * 0.35, 12, '#6e0d09', 6.4, 0.62);
    }
    const distP = P ? Math.hypot(e.x - P.x, e.z - P.z) : 0;
    if (!ctx.stealthTakedown) audio?.playVoiceShout?.(e.hp <= 0 ? 'die' : 'grunt', distP);

    if (e.hp <= 0) {
      const wasDowned = !!e.downed;
      let witness = null;
      let witnessDistance = 22;
      for (const mate of level.enemies) {
        if (mate === e || !mate.awake || mate.hp <= 0 || mate.disarmed || mate.downed || mate.executing) continue;
        const distance = Math.hypot(mate.x - e.x, mate.z - e.z);
        if (distance >= 22 || !level.los3(mate.x, mate.ht * 0.82, mate.z, e.x, 1.1, e.z)) continue;
        if (distance <= 9) this._takeShelter(level, mate, e.x, e.z);
        if (distance < witnessDistance) {
          witness = mate;
          witnessDistance = distance;
        }
      }
      e.executing = false;
      e.flash = 0;
      e.downed = false;
      e.react = null;
      e.surrenderT = 0;
      if (witness && !ctx.stealthTakedown && callbacks.radio && (level.calloutCd || 0) <= 0 && Math.random() < (execBoost >= 4.5 ? 0.65 : 0.35)) {
        this._callout(level, witness, callbacks, execBoost >= 4.5 ? 'witness' : 'ally-down', 2.8);
      }
      callbacks.onEnemyKilled(e, head);
      if (Array.isArray(level.corpses)) level.corpses.push({ x: e.x, z: e.z, t: 0, found: false });
      if (e.phys) {
        physics.queueRemoveBody(e.phys.rb);
        e.phys = null;
      }
      if (e.mesh) {
        const u = e.mesh.userData;
        e.mesh.position.y = 0;
        u.glint.visible = false;
        u.gun.visible = false;
        u.mat.emissive.setHex(0);
        if (u.coatMat) u.coatMat.emissive.setHex(0);
        u.pose = null;

        // Back to an upright body before the corpse system takes over (kneeling / prone reactions)
        u.pivot.rotation.z = 0;
        u.pivot.position.set(0, 0.9, 0);
        u.reactPivot = false;

        const scale = CHAR_STYLES[e.type]?.scale || 1;
        const dirSign = dx !== undefined && dx * Math.cos(e.ang) + dz * Math.sin(e.ang) > 0 ? -1 : 1;
        // A converted Mixamo death plays out on the standing corpse; otherwise the procedural topple
        const clipDeath = !execBoost && !wasDowned && !!callbacks.playDeathClip?.(e, part, dx, dz);
        if (!clipDeath) callbacks.poseCorpse?.(e.mesh, dirSign);

        if ((head || dmg >= 34 || execBoost > 0) && u.hatMesh && u.hatMesh.visible) {
          u.hatMesh.visible = false;
          callbacks.spawnFlyingHat?.(e.type, e.x, (e.ht || 1.75) * 0.92, e.z, dx || 0, dz || 0);
        }

        // Location-based fall with weapon-scaled kinetic knockback impulse:
        // heavy shotgun / sniper / rifle / Dadao chop hurls defeated foes violently across the cobbles!
        let pushX = dx || 0;
        let pushZ = dz || 0;
        const hitImpulse = ctx.hitImpulse || 0;
        let slide = execBoost > 0
          ? execBoost
          : hitImpulse > 0
            ? clamp(hitImpulse, 3.6, 12.5)
            : dmg > 55 ? 8.8 : dmg > 36 ? 6.4 : 4.0;
        let fallDur;
        if (!execBoost && part === 'head') {
          slide *= hitImpulse >= 8 ? 0.82 : 0.55;
          fallDur = 0.30;
        } else if (!execBoost && (part === 'legL' || part === 'legR')) {
          pushX = -pushX;
          pushZ = -pushZ;
          slide *= 0.65;
          fallDur = 0.52;
        }
        physics.spawnCorpseBody(e.mesh, e.x, e.z, -e.ang, dirSign, pushX, pushZ, scale, clipDeath ? slide * 0.55 : slide, {
          fallDur,
          instant: wasDowned,
          upright: clipDeath
        });
      }

      if (e.type === 'soldier' && Math.random() < 0.65) callbacks.dropAt(e.x, e.z, 'rifle');
      else if (e.type === 'gunner') callbacks.dropAt(e.x, e.z, 'smg');
      else if (e.type === 'boss') {
        for (let i = 0; i < 4; i++) callbacks.explode(e.x + rnd(-2.5, 2.5), e.z + rnd(-2.5, 2.5), 4.5, 0);
      } else if (!ctx.stealthTakedown && Math.random() < 0.26) {
        callbacks.dropAt(e.x, e.z);
      }
    }
  }
}
