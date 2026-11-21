import * as THREE from 'three';
import { WEAPONS, enemyStanceHeight } from '../config/constants.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const MAX_PER_ENEMY = 4;

// RDR-style Dead Eye on the focus meter. While active, time crawls; sweeping the sights over an enemy
// paints a mark (dwelling paints more, head marks stay on the head). Releasing the sights, clicking, or
// pressing Tab again fires the volley: the hero snaps from mark to mark in painting order.
export class DeadEye {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.marks = [];
    this.volley = null;
    this.k = 0;
    this.lastEnemy = null;
    this.dwell = 0;
    this.heartT = 0;
    this.wasAiming = false;
    this.flashes = [];
  }

  get busy() {
    return this.active || !!this.volley;
  }

  start(ctx) {
    if (this.busy || ctx.P.focus < 15) return false;
    this.active = true;
    this.marks = [];
    this.lastEnemy = null;
    this.dwell = 0;
    this.heartT = 0.25;
    this.wasAiming = ctx.isAiming();
    ctx.audio.sfx('deadEyeOn');
    return true;
  }

  stop(ctx) {
    if (!this.busy) return;
    this.active = false;
    this.volley = null;
    this.marks = [];
    ctx.audio.sfx('slowoff');
  }

  // Tab / click while painting: fire what is marked, or bail out if nothing is
  trigger(ctx) {
    if (!this.active) return false;
    if (this.marks.length) this._fire();
    else this.stop(ctx);
    return true;
  }

  markPos(m, out = new THREE.Vector3()) {
    const c = Math.cos(m.e.ang);
    const s = Math.sin(m.e.ang);
    const y = m.heightFraction * enemyStanceHeight(m.e);
    return out.set(m.e.x + m.lf * c - m.lr * s, y, m.e.z + m.lf * s + m.lr * c);
  }

  // Marks live in enemy-local space so they ride along as the target moves or turns. The hit capsule is
  // wider than the body, so the mark is pulled onto the body's centre plane: it draws on the figure and
  // the volley shot (fired from the muzzle, not the camera) can't graze past the capsule edge.
  _addMark(e, pt, ctx) {
    const c = Math.cos(e.ang);
    const s = Math.sin(e.ang);
    const dx = pt.x - e.x;
    const dz = pt.z - e.z;
    const k = e.ht / 1.8;
    const height = enemyStanceHeight(e);
    const head = pt.y > height - 0.3 * k;
    const lr = clamp(-dx * s + dz * c, -0.13 * k, 0.13 * k);
    this.marks.push({ e, lf: 0, lr: head ? lr * 0.4 : lr, heightFraction: pt.y / height, head, t: 0 });
    ctx.audio.sfx('mark');
  }

  update(dtReal, dtGame, ctx, aim) {
    const { P, audio } = ctx;
    this.k += ((this.busy ? 1 : 0) - this.k) * Math.min(1, dtReal * 7);
    for (const m of this.marks) m.t += dtReal;
    for (const f of this.flashes) f.t -= dtReal;
    this.flashes = this.flashes.filter(f => f.t > 0);

    if (this.active) {
      P.focus = Math.max(0, P.focus - dtGame * 18);
      this.heartT -= dtReal;
      if (this.heartT <= 0) {
        this.heartT = 0.8;
        audio.sfx('heart');
      }

      const aiming = ctx.isAiming();
      const e = aim.enemy;
      const magAvail = P.gun >= 0 ? P.mags[P.gun] || 0 : 0;
      if (aiming && e && e.hp > 0 && !e.disarmed && ctx.canMark?.() !== false && this.marks.length < magAvail) {
        let onIt = 0;
        let freshest = Infinity;
        for (const m of this.marks) {
          if (m.e !== e) continue;
          onIt++;
          freshest = Math.min(freshest, m.t);
        }
        if (e !== this.lastEnemy) {
          // Re-entry cooldown: sights flickering across a silhouette edge must not spray marks
          if (onIt < MAX_PER_ENEMY && freshest > 0.25) this._addMark(e, aim, ctx);
          this.dwell = 0;
        } else {
          this.dwell += dtReal;
          if (this.dwell > 0.3 && onIt < MAX_PER_ENEMY) {
            this._addMark(e, aim, ctx);
            this.dwell = 0;
          }
        }
      }
      this.lastEnemy = aiming ? e : null;

      if (this.wasAiming && !aiming && this.marks.length) this._fire();
      else if (P.focus <= 0) {
        if (this.marks.length) this._fire();
        else this.stop(ctx);
      }
      this.wasAiming = aiming;
    }

    if (this.volley) this._updateVolley(dtReal, ctx);
  }

  _fire() {
    this.active = false;
    this.volley = { i: 0, t: 0.07 };
  }

  _updateVolley(dtReal, ctx) {
    const { P } = ctx;
    const v = this.volley;
    while (v.i < this.marks.length && (this.marks[v.i].e.hp <= 0 || this.marks[v.i].e.disarmed)) this.marks[v.i++].done = true;
    if (v.i >= this.marks.length || P.gun < 0 || !WEAPONS[P.gun] || P.mags[P.gun] <= 0) {
      this.stop(ctx);
      return;
    }
    const m = this.marks[v.i];
    const target = this.markPos(m);

    // Snap the hero (and the over-the-shoulder camera) onto the mark
    const want = Math.atan2(target.z - P.z, target.x - P.x);
    const dAng = Math.atan2(Math.sin(want - P.ang), Math.cos(want - P.ang));
    P.ang = Math.atan2(Math.sin(P.ang + dAng * Math.min(1, dtReal * 24)), Math.cos(P.ang + dAng * Math.min(1, dtReal * 24)));
    const dist = Math.hypot(target.x - P.x, target.z - P.z);
    const wantPitch = clamp(Math.atan2(P.y + 1.6 - target.y, dist), -0.5, 0.75);
    P.pitch += (wantPitch - P.pitch) * Math.min(1, dtReal * 20);

    v.t -= dtReal;
    if (v.t <= 0 && Math.abs(dAng) < 0.14) {
      ctx.fireAt(target);
      this.flashes.push({ x: target.x, y: target.y, z: target.z, t: 0.32 });
      m.done = true;
      v.i++;
      v.t = clamp(WEAPONS[P.gun].rate * 0.45, 0.08, 0.2);
    }
  }
}
