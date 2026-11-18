import { ENEMY_TYPES, CHAR_STYLES, MW, TILE, TAU } from '../config/constants.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class EnemyManager {
  constructor() {}

  wake(level, e, callbacks = null) {
    if (e.awake) return;
    e.awake = true;
    if (callbacks?.radio && (level.calloutCd || 0) <= 0) {
      level.calloutCd = 8.5;
      const lines = {
        thug: '黑龙帮打手：「弄堂口有人！抄家伙围住他！」',
        gunman: '帮派枪手：「是那个冷枪手！快找掩体压制！」',
        soldier: '码头守卫：「有人闯进十六铺了，开火！」',
        officer: '守卫军官：「全队注意，给我包抄过去！」',
        gunner: '重机枪手：「火力压制！别让他靠近！」',
        boss: '帮主黑龙：「沈孤鸿……这间货仓今天就是你的葬身地！」'
      };
      callbacks.radio(lines[e.type] || '敌人：「发现目标，开火！」', 3.4);
    }
    for (const o of level.enemies) {
      if (!o.awake && o.group === e.group && Math.hypot(o.x - e.x, o.z - e.z) < 16.5) {
        o.awake = true;
      }
    }
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
    const { level, player: P, physics, audio, callbacks } = ctx;
    const enemies = level.enemies;
    if (level.calloutCd > 0) level.calloutCd = Math.max(0, level.calloutCd - dt);

    for (const e of enemies) {
      if (e.hp <= 0) continue;
      this._updateOne(e, dt, ctx);
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
        if (d < m && d > 0.01) {
          const push = (m - d) * 0.5;
          level.moveEnt(a, (-dx / d) * push, (-dz / d) * push);
          level.moveEnt(b, (dx / d) * push, (dz / d) * push);
        }
      }
    }

    // Sync kinematic Rapier capsules
    for (const e of enemies) {
      if (e.hp > 0) {
        physics.updateEnemyCollider(e, e.x, e.z, e.duck ? e.ht * 0.52 : e.ht);
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

    if (e.flash > 0) e.flash -= dt;
    if (e.flinch > 0) e.flinch = Math.max(0, e.flinch - dt * 5.5);
    if (e.stun > 0) e.stun -= dt;
    if (e.staggerT > 0) {
      e.staggerT = Math.max(0, e.staggerT - dt);
      e.flinch = Math.max(e.flinch || 0, 0.36);
    }
    if (e.inv > 0) e.inv -= dt;
    if (e.executing) {
      e.moving = false;
      e.spd = 0;
      return;
    }

    if (!e.awake) {
      if (d < 27 && (d < 7 || level.los3(e.x, e.ht - 0.2, e.z, P.x, ph, P.z))) {
        this.wake(level, e, callbacks);
      } else {
        return;
      }
    }

    e.seeT -= dt;
    if (e.seeT <= 0) {
      e.seeT = 0.15;
      e.sees = level.los3(e.x, e.ht - 0.2, e.z, P.x, ph, P.z);
    }

    const toP = Math.atan2(dz, dx);
    let vx = 0;
    let vz = 0;
    let sp = t.sp;

    if (e.type === 'thug') {
      if (d > 1.38) {
        const f = d < 4.4 && e.sees ? [dx / d, dz / d] : (level.flowDir(e) || [dx / d, dz / d]);
        vx = f[0];
        vz = f[1];
      }
      if (!e.warCried && d < 7.0 && e.sees) {
        e.warCried = true;
        audio.playVoiceShout('charge', d);
        callbacks.radio?.('黑龙帮打手：「剁了他！冲啊——！」', 2.6);
      }
      e.cd -= dt;
      if (d < e.r + 0.5 + 0.5 && e.cd <= 0) {
        e.cd = 0.8;
        callbacks.hurtPlayer(9, e.x, e.z);
      }
      e.ang = vx || vz ? Math.atan2(vz, vx) : toP;
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
          e.x = e.post.x;
          e.z = e.post.z;
          e.way = [];
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
          if (!e.post && (d < 8.1 || e.coverAge > 14 || level.los3(e.x, e.ht * 0.45, e.z, P.x, ph, P.z))) {
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
        if (!e.cover) {
          if (!e.sees || d > pref + 3.1) {
            const f = level.flowDir(e) || [dx / d, dz / d];
            vx = f[0];
            vz = f[1];
            if (e.sees) {
              vx += (-dz / d) * e.strafe * 0.6;
              vz += (dx / d) * e.strafe * 0.6;
              const l = Math.hypot(vx, vz) || 1;
              vx /= l;
              vz /= l;
            }
          } else if (d < pref - 5.6) {
            vx = -dx / d;
            vz = -dz / d;
          } else {
            vx = (-dz / d) * e.strafe;
            vz = (dx / d) * e.strafe;
            sp *= 0.6;
          }
        }
      }

      if (busy) sp = t.sp * 0.25;
      if (e.sees) {
        const df = ((toP - e.ang + Math.PI * 3) % TAU) - Math.PI;
        e.ang += clamp(df, -dt * 6, dt * 6);
      } else if (vx || vz) {
        e.ang = Math.atan2(vz, vx);
      }

      if (P.execT <= 0) {
        e.cd -= dt;
        if (e.burst > 0 && e.staggerT <= 0) {
          e.burstT -= dt;
          if (e.burstT <= 0) {
            e.burstT = 0.11;
            e.burst--;
            this._fire(e, 0.085, 285, e.type === 'boss' ? 7 : 6, false, ctx);
          }
        } else if (e.aimT > 0 && e.staggerT <= 0) {
          e.aimT -= dt;
          if (e.aimT <= 0) {
            if (e.type === 'gunman' || e.type === 'officer') {
              this._fire(e, 0.06, 300, 9, false, ctx);
              e.cd = rnd(1.1, 1.7);
            } else if (e.type === 'soldier') {
              this._fire(e, 0.032, 680, 15, false, ctx);
              e.cd = rnd(1.9, 2.5);
            } else {
              e.burst = e.type === 'boss' ? 8 : 5;
              e.burstT = 0;
              e.cd = rnd(1.6, 2.2);
            }
          }
        } else if (e.sees && d < 34 && e.cd <= 0 && (e.staggerT || 0) <= 0 && !(e.way && e.way.length)) {
          e.aimT = e.type === 'soldier' ? 0.6 : 0.38;
        }
      }

      if (e.type === 'gunner' || e.type === 'boss') {
        e.nadeCd -= dt;
        if (e.nadeCd <= 0 && P.still > 2.5 && d > 8.1 && d < 26.2 && (e.sees || d < 18.8)) {
          e.nadeCd = rnd(8, 12);
          const v = Math.sqrt(9.8 * d) * 0.76;
          callbacks.spawnGrenade(e.x, 1.6, e.z, (dx / d) * v, v * 0.85, (dz / d) * v, false, true);
          callbacks.say('手雷！快离开！');
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
        e.ringT -= dt;
        const low = e.hp < e.max * 0.5;
        if (e.ringT <= 0 && !e.duck && !(e.way && e.way.length)) {
          e.ringT = low ? 3 : 4.6;
          for (let i = 0; i < 9; i++) this._fire(e, 0.11, 330, 6, i > 0, ctx);
          audio.sfx('shotgun');
          callbacks.addShake(0.25);
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
          callbacks.say('黑龙退到掩体后面了！');
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
          callbacks.say('黑龙：来人！给我上！');
          for (let i = 0; i < 2; i++) {
            callbacks.spawnLive('thug', e.x + rnd(-5.6, 5.6), e.z + rnd(2.5, 6.9), e.x, e.z);
          }
        }
      }
    }

    if (e.stun > 0 || e.staggerT > 0) sp *= 0.25;
    e.moving = !!(vx || vz);
    e.spd = sp;
    if (e.moving) {
      level.moveEnt(e, vx * sp * dt, vz * sp * dt);
      e.walk += (dt * sp) / 0.7;
      if (d < 16) {
        e.stepT = (e.stepT || 0) - dt;
        if (e.stepT <= 0) {
          e.stepT = e.type === 'thug' ? 0.34 : 0.44;
          audio.playStep(level.cfg.style, clamp(0.18 * (1 - d / 16), 0.02, 0.16), false);
        }
      }
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
    const th = P.y + (P.crouch || P.rollT > 0 ? 0.7 : 1.15);

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

  hitEnemy(e, dmg, dx, dz, hitY, ctx, head = false, execBoost = 0) {
    if (e.hp <= 0 || (e.inv > 0 && !execBoost)) return;
    const { level, player: P, physics, audio, callbacks } = ctx;
    e.duck = false;
    e.hp -= dmg;
    e.flash = 0.08;
    e.flinch = execBoost ? 1.8 : 1.0;
    e.stun = Math.max(e.stun, dmg >= 28 ? 0.55 : 0.24);
    if (e.hp > 0 && (head || dmg >= 25 || (e.type === 'boss' ? e.hp <= e.max * 0.22 : e.hp <= e.max * 0.80))) {
      e.staggerT = Math.max(e.staggerT || 0, 5.5);
    }
    this.wake(level, e, callbacks);
    const bloodCnt = execBoost > 8 ? 22 : execBoost > 0 ? 14 : 7;
    const bloodSpd = execBoost > 8 ? 9.5 : 5.5;
    callbacks.puff(e.x, hitY ?? 1.25, e.z, bloodCnt, '#b3261e', bloodSpd, 0.52);
    if (execBoost > 0) {
      callbacks.puff(e.x + (dx || 0) * 0.35, (hitY ?? 1.35) + 0.08, e.z + (dz || 0) * 0.35, 12, '#6e0d09', 7.2, 0.62);
    }
    const distP = P ? Math.hypot(e.x - P.x, e.z - P.z) : 0;
    audio?.playVoiceShout?.(e.hp <= 0 ? 'die' : 'grunt', distP);

    if (e.hp <= 0) {
      e.executing = false;
      e.flash = 0;
      if (callbacks.radio && (level.calloutCd || 0) <= 0 && Math.random() < (execBoost > 8 ? 0.65 : 0.35)) {
        const hasMate = level.enemies.some(o => o !== e && o.hp > 0 && o.awake && Math.hypot(o.x - e.x, o.z - e.z) < 22);
        if (hasMate) {
          level.calloutCd = 8.5;
          callbacks.radio(
            execBoost > 8
              ? '帮派分子：「他一枪把老三贴脸崩飞了！！快退后开火！」'
              : '帮派分子：「有人倒了！散开找掩体，别露头！」',
            2.8
          );
        }
      }
      callbacks.onEnemyKilled(e, head);
      if (e.phys) {
        physics.queueRemoveBody(e.phys.rb);
        e.phys = null;
      }
      if (e.mesh) {
        const u = e.mesh.userData;
        u.glint.visible = false;
        u.gun.visible = false;
        u.mat.emissive.setHex(0);
        if (u.coatMat) u.coatMat.emissive.setHex(0);
        u.pose = null;
        u.strike = 0;

        const scale = CHAR_STYLES[e.type]?.scale || 1;
        const dirSign = dx !== undefined && dx * Math.cos(e.ang) + dz * Math.sin(e.ang) > 0 ? -1 : 1;
        callbacks.poseCorpse?.(e.mesh, dirSign);

        if ((head || dmg >= 34 || execBoost > 0) && u.hatMesh && u.hatMesh.visible) {
          u.hatMesh.visible = false;
          callbacks.spawnFlyingHat?.(e.type, e.x, (e.ht || 1.75) * 0.92, e.z, dx || 0, dz || 0);
        }

        physics.spawnCorpseBody(
          e.mesh,
          e.x,
          e.z,
          -e.ang,
          dirSign,
          dx || 0,
          dz || 0,
          scale,
          execBoost > 0 ? execBoost : dmg > 40 ? 7.2 : 3.8
        );
      }

      if (e.type === 'soldier' && Math.random() < 0.65) callbacks.dropAt(e.x, e.z, 'rifle');
      else if (e.type === 'gunner') callbacks.dropAt(e.x, e.z, 'smg');
      else if (e.type === 'boss') {
        for (let i = 0; i < 4; i++) callbacks.explode(e.x + rnd(-2.5, 2.5), e.z + rnd(-2.5, 2.5), 4.5, 0);
      } else if (Math.random() < 0.26) {
        callbacks.dropAt(e.x, e.z);
      }
    }
  }
}
