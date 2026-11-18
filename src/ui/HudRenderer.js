import * as THREE from 'three';
import { WEAPONS, TILE, TAU } from '../config/constants.js';

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _tmpV = new THREE.Vector3();

export class HudRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  draw(s) {
    const {
      state, time, player: P, level, camera, input,
      score, banner, msg, msgT, radioMsg, radioT,
      hurtFlash, hurtAng,
      hitMark, killMark, headMark, aimHit,
      nades, pickups, timeLeft, planted,
      bloomEnabled, qualityLabel, exitOpen
    } = s;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;
    const it = input.isTouch;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state === 'menu') return;

    // Vignette + slow-motion cool edge tint + damage flash
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, P.btK > 0.02 ? `rgba(18,52,96,${0.55 + P.btK * 0.25})` : 'rgba(0,0,8,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (P.btK > 0.02) {
      const sg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
      sg.addColorStop(0, 'rgba(40,120,210,0)');
      sg.addColorStop(1, `rgba(60,160,240,${P.btK * 0.22})`);
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);
    }

    if (hurtFlash > 0) {
      const a = Math.min(1, hurtFlash * 2);
      const hg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      hg.addColorStop(0, 'rgba(179,38,30,0)');
      hg.addColorStop(1, `rgba(179,38,30,${a * 0.7})`);
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);
      if (hurtAng !== null) {
        const rel = hurtAng - P.ang;
        ctx.strokeStyle = `rgba(255,70,50,${a})`;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 90, rel - Math.PI / 2 - 0.35, rel - Math.PI / 2 + 0.35);
        ctx.stroke();
      }
    }

    // Top-left health, armor & mission info
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(10,15,28,0.72)';
    ctx.fillRect(14, 14, 212, 22);
    ctx.fillStyle = P.hp > 35 ? '#b3261e' : (Math.floor(time * 6) % 2 ? '#ff4a3a' : '#b3261e');
    ctx.fillRect(16, 16, 208 * (P.hp / 100), 18);
    ctx.strokeStyle = '#ece3cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(14.5, 14.5, 212, 22);
    ctx.fillStyle = '#ece3cf';
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText('生命 ' + Math.ceil(P.hp), 22, 30);

    if (P.armor > 0) {
      ctx.fillStyle = 'rgba(10,15,28,0.7)';
      ctx.fillRect(14, 38, 212, 7);
      ctx.fillStyle = '#4a86d8';
      ctx.fillRect(16, 39.5, 208 * (P.armor / 100), 4);
    }

    // Focus / Bullet-Time gauge
    const fy = P.armor > 0 ? 48 : 40;
    ctx.fillStyle = 'rgba(10,15,28,0.72)';
    ctx.fillRect(14, fy, 212, 13);
    ctx.fillStyle = P.bulletTime ? '#5ec8f2' : P.focus > 20 ? '#d9a441' : '#7b6c4a';
    ctx.fillRect(16, fy + 2, 208 * clamp((P.focus ?? 100) / 100, 0, 1), 9);
    ctx.strokeStyle = P.bulletTime ? '#9ae2ff' : 'rgba(236,227,207,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(14.5, fy + 0.5, 212, 13);
    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = '#ece3cf';
    ctx.fillText(P.bulletTime ? '[TAB] 子弹时间 · 开启' : '[TAB] 专注', 20, fy + 10);

    const cfg = level.cfg;
    const my0 = fy + 28;
    ctx.font = '13px ' + FONT;
    ctx.fillStyle = '#b9b2a2';
    ctx.fillText(cfg.name, 14, my0);

    const objText =
      cfg.mission === 'boss'
        ? '目标：击毙黑龙'
        : cfg.mission === 'rescue'
          ? level.hostage?.free
            ? '目标：护送联络人到北面出口'
            : '目标：找到并解救联络人'
          : planted < 3
            ? `目标：安放炸药 ${planted} / 3`
            : '目标：撤到北面出口';

    ctx.fillStyle = '#ece3cf';
    ctx.fillText(objText, 14, my0 + 20);

    if (cfg.mission === 'demo' && planted < 3) {
      ctx.fillStyle = timeLeft < 60 ? '#ff4a3a' : '#d9a441';
      ctx.font = '700 16px ' + FONT;
      ctx.fillText('剩余 ' + Math.floor(timeLeft / 60) + ':' + String(Math.floor(timeLeft % 60)).padStart(2, '0'), 14, my0 + 42);
    }

    // Score & rotating architectural radar
    ctx.textAlign = 'right';
    const rx = w - (it ? 68 : 14);
    ctx.font = '700 20px ' + FONT;
    ctx.fillStyle = '#d9a441';
    ctx.fillText(String(score).padStart(6, '0'), rx, 32);

    const R = it ? 46 : 58;
    const rcx = rx - R;
    const rcy = 48 + R;
    const rangeM = 35;
    const cs = Math.cos(P.ang);
    const sn = Math.sin(P.ang);

    ctx.save();
    ctx.beginPath();
    ctx.arc(rcx, rcy, R, 0, TAU);
    ctx.fillStyle = 'rgba(10,15,28,0.68)';
    ctx.fill();
    ctx.clip();

    // Draw street building footprints in radar local space
    ctx.fillStyle = 'rgba(85,105,135,0.34)';
    for (const r of level.rects) {
      const bx = (r.x + r.w * 0.5) * TILE - P.x;
      const bz = (r.y + r.h * 0.5) * TILE - P.z;
      if (Math.abs(bx) > rangeM + r.w * TILE || Math.abs(bz) > rangeM + r.h * TILE) continue;
      const f = bx * cs + bz * sn;
      const right = -bx * sn + bz * cs;
      const px = rcx + (right / rangeM) * R;
      const py = rcy - (f / rangeM) * R;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(P.ang + Math.PI / 2);
      const rw = (r.w * TILE / rangeM) * R;
      const rh = (r.h * TILE / rangeM) * R;
      ctx.fillRect(-rw * 0.5, -rh * 0.5, rw, rh);
      ctx.restore();
    }

    const dot = (x, z, c, sz) => {
      const dx = x - P.x;
      const dz = z - P.z;
      const f = dx * cs + dz * sn;
      const right = -dx * sn + dz * cs;
      let px = (right / rangeM) * R;
      let py = (-f / rangeM) * R;
      const l = Math.hypot(px, py);
      if (l > R - 3) {
        px *= (R - 3) / l;
        py *= (R - 3) / l;
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(rcx + px, rcy + py, sz, 0, TAU);
      ctx.fill();
    };

    for (const e of level.enemies) {
      if (e.awake || Math.hypot(e.x - P.x, e.z - P.z) < 26) {
        dot(e.x, e.z, e.type === 'boss' ? '#c06aff' : '#ff4a3a', e.type === 'boss' ? 4 : 2.5);
      }
    }
    for (const p of pickups) dot(p.x, p.z, '#6ac8ff', 2);
    if (!cfg.boss) dot(level.exitPos.x, level.exitPos.z, exitOpen ? '#ffc050' : '#7a5a30', 4);
    if (level.hostage) dot(level.hostage.x, level.hostage.z, '#5aff8a', 4);
    for (const c of level.charges) if (!c.done) dot(c.x, c.z, '#5aff8a', 4);
    for (const n of nades) {
      if (n.data?.foe) {
        const t = n.body.translation();
        dot(t.x, t.z, '#ffffff', 3);
      }
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(236,227,207,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rcx, rcy, R, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = '#ece3cf';
    ctx.beginPath();
    ctx.moveTo(rcx, rcy - 5);
    ctx.lineTo(rcx - 4, rcy + 4);
    ctx.lineTo(rcx + 4, rcy + 4);
    ctx.fill();

    // Weapon status bottom-left
    const g = WEAPONS[P.gun];
    const by = it ? 154 : h - 18;
    ctx.textAlign = 'left';
    const wx = 14;
    ctx.font = '700 18px ' + FONT;
    ctx.fillStyle = '#ece3cf';
    ctx.fillText(g.fullName, wx, by - 28);

    ctx.font = '700 26px ' + FONT;
    ctx.fillStyle = P.mags[P.gun] ? '#d9a441' : '#b3261e';
    ctx.fillText(
      P.reloadT > 0
        ? '换弹…'
        : `${P.mags[P.gun]} / ${P.res[P.gun] === Infinity ? '∞' : P.res[P.gun]}`,
      wx,
      by
    );

    ctx.font = '13px ' + FONT;
    ctx.fillStyle = '#ece3cf';
    ctx.fillText(`手雷 × ${P.nades}　燃烧瓶 × ${P.molo}${P.crouch ? '　蹲伏' : ''}`, wx, by - 52);

    if (!it) {
      ctx.fillStyle = '#b9b2a2';
      ctx.textAlign = 'right';
      let t = '';
      for (let i = 0; i < 4; i++) {
        if (i < 3 || P.mags[3] + P.res[3] > 0) {
          t += (i === P.gun ? '【' : ' ') + (i + 1) + ' ' + WEAPONS[i].name + (i === P.gun ? '】' : ' ') + ' ';
        }
      }
      ctx.fillText(t, w - 14, h - 18);
      ctx.font = '12px ' + FONT;
      ctx.fillStyle = bloomEnabled ? '#d9a441' : '#7f7a70';
      ctx.fillText(`[H] 画质: ${qualityLabel || (bloomEnabled ? '极致电影' : '流畅直出')}`, w - 14, h - 42);

      if (!input.locked && state === 'play') {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#b9b2a2';
        ctx.fillText('点击画面锁定鼠标 · 未锁定时把鼠标移向屏幕两侧或按 ← → 转向', w / 2, h - 46);
      }
    }

    // Enemy floating health bars
    for (const e of level.enemies) {
      if (e.hp >= e.max || e.type === 'boss') continue;
      _tmpV.set(e.x, e.ht + 0.35, e.z).project(camera);
      if (_tmpV.z > 1 || _tmpV.z < -1) continue;
      const x = (_tmpV.x * 0.5 + 0.5) * w;
      const y = (-_tmpV.y * 0.5 + 0.5) * h;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(x - 17, y - 3, 34, 5);
      ctx.fillStyle = '#e0392b';
      ctx.fillRect(x - 16, y - 2, (32 * e.hp) / e.max, 3);
    }

    if (level.boss && level.boss.hp > 0 && level.boss.awake) {
      const bw = Math.min(420, w - 40);
      const bx = (w - bw) / 2;
      const byy = it ? 120 : h * 0.1;
      ctx.fillStyle = 'rgba(10,15,28,0.75)';
      ctx.fillRect(bx, byy, bw, 14);
      ctx.fillStyle = '#8a3fb0';
      ctx.fillRect(bx + 2, byy + 2, ((bw - 4) * level.boss.hp) / level.boss.max, 10);
      ctx.textAlign = 'center';
      ctx.font = '700 14px ' + FONT;
      ctx.fillStyle = '#ece3cf';
      ctx.fillText('黑龙帮主 · 黑龙', w / 2, byy - 6);
    }

    ctx.textAlign = 'center';
    if (banner > 0) {
      const a = clamp(banner, 0, 1);
      ctx.fillStyle = `rgba(10,15,28,${a * 0.72})`;
      ctx.fillRect(0, h * 0.26, w, 92);
      ctx.fillStyle = `rgba(236,227,207,${a})`;
      ctx.font = `400 ${Math.min(42, w / 11)}px "Ma Shan Zheng","KaiTi",serif`;
      ctx.fillText(cfg.name, w / 2, h * 0.26 + 46);
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = `rgba(217,164,65,${a})`;
      ctx.fillText(
        cfg.mission === 'boss'
          ? '击毙帮主黑龙'
          : cfg.mission === 'rescue'
            ? '解救联络人，护送他到北面出口'
            : '五分钟内在三处军火箱安放炸药',
        w / 2,
        h * 0.26 + 74
      );
    }

    const pc = level.charges.find(c => !c.done && c.k > 0);
    if (pc) {
      ctx.fillStyle = 'rgba(10,15,28,0.75)';
      ctx.fillRect(w / 2 - 90, h * 0.62, 180, 12);
      ctx.fillStyle = '#5aff8a';
      ctx.fillRect(w / 2 - 88, h * 0.62 + 2, 176 * pc.k, 8);
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = '#ece3cf';
      ctx.fillText('安放炸药中……站在原地', w / 2, h * 0.62 - 8);
    }

    if (
      nades.some(n => {
        if (!n.data?.foe) return false;
        const p = n.body.translation();
        return Math.hypot(p.x - P.x, p.z - P.z) < 8.8;
      }) &&
      Math.floor(time * 8) % 2
    ) {
      ctx.font = '700 20px ' + FONT;
      ctx.fillStyle = '#ff4a3a';
      ctx.fillText('手雷！', w / 2, h * 0.4);
    }

    if (msgT > 0) {
      ctx.font = '700 15px ' + FONT;
      ctx.fillStyle = `rgba(236,227,207,${clamp(msgT, 0, 1)})`;
      ctx.fillText(msg, w / 2, h * 0.7);
    }

    if (radioT > 0 && radioMsg) {
      const a = clamp(radioT, 0, 1);
      ctx.font = '600 14px ' + FONT;
      const tw = Math.min(w - 40, ctx.measureText(radioMsg).width + 36);
      const ry = h - (it ? 96 : 86);
      ctx.fillStyle = `rgba(8,11,20,${a * 0.78})`;
      ctx.strokeStyle = `rgba(217,164,65,${a * 0.55})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect((w - tw) / 2, ry - 20, tw, 30, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(242,232,208,${a})`;
      ctx.fillText(radioMsg, w / 2, ry);
    }

    const st = input.sticks.move;
    if (st) {
      ctx.strokeStyle = 'rgba(236,227,207,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, 52, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(236,227,207,0.4)';
      ctx.beginPath();
      ctx.arc(st.ox + st.dx * 52, st.oy + st.dy * 52, 24, 0, TAU);
      ctx.fill();
    }

    if (state === 'play') {
      const x = w / 2;
      const y = h / 2;
      const sp = 4 + WEAPONS[P.gun].spread * (1 + P.bloom * 1.8) * (P.moving ? 1.4 : 1) * (1 - 0.55 * P.ads) * (P.crouch ? 0.7 : 1) * 300;
      if (hitMark > 0 || killMark > 0) {
        ctx.strokeStyle = killMark > 0 ? '#ff4a3a' : headMark > 0 ? '#ffc84a' : '#ffffff';
        ctx.lineWidth = killMark > 0 ? 3 : 2;
        ctx.beginPath();
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          ctx.moveTo(x + a * 7, y + b * 7);
          ctx.lineTo(x + a * 15, y + b * 15);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = aimHit ? '#ff4a3a' : '#ece3cf';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - sp - 8, y);
      ctx.lineTo(x - sp, y);
      ctx.moveTo(x + sp, y);
      ctx.lineTo(x + sp + 8, y);
      ctx.moveTo(x, y - sp - 8);
      ctx.lineTo(x, y - sp);
      ctx.moveTo(x, y + sp);
      ctx.lineTo(x, y + sp + 8);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
}
