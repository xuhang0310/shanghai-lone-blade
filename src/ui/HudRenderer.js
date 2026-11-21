import * as THREE from 'three';
import { WEAPONS, TILE, TAU, enemyStanceHeight } from '../config/constants.js';
import { ULTIMATES } from '../systems/Melee.js';
import { BOSS_ULTIMATES } from '../systems/DuelSystem.js';
import { MELEE_WEAPONS } from '../entities/BladeModel.js';

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const JAPANESE_FONT = '"Yu Gothic","Hiragino Sans","Noto Sans JP","Meiryo",sans-serif';
const DISPLAY_FONT = '"Ma Shan Zheng","STKaiti","KaiTi",serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _tmpV = new THREE.Vector3();

function chamferPath(ctx, x, y, w, h, c = 6) {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function drawCornerTicks(ctx, x, y, w, h, len = 7, color = 'rgba(229,179,82,0.85)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  // TL
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  // TR
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  // BL
  ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h);
  // BR
  ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
}

const _markV = new THREE.Vector3();

export class HudRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
  }

  // Dead Eye: brush-stroke red crosses riding on the marked enemies, plus a burst where each shot lands
  _drawDeadEyeMarks(ctx, de, camera, w, h) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const m of de.marks) {
      if (m.done) continue;
      de.markPos(m, _markV).project(camera);
      if (_markV.z > 1) continue;
      const x = (_markV.x * 0.5 + 0.5) * w;
      const y = (-_markV.y * 0.5 + 0.5) * h;
      const pop = Math.min(1, m.t / 0.12);
      const r = (m.head ? 9 : 11) * (1.6 - 0.6 * pop);
      ctx.strokeStyle = `rgba(20,0,0,${0.55 * pop})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      ctx.stroke();
      ctx.strokeStyle = `rgba(232,38,24,${pop})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r * 0.92); ctx.lineTo(x + r * 1.05, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r * 0.95, y + r * 1.04);
      ctx.stroke();
    }
    for (const f of de.flashes) {
      _markV.set(f.x, f.y, f.z).project(camera);
      if (_markV.z > 1) continue;
      const x = (_markV.x * 0.5 + 0.5) * w;
      const y = (-_markV.y * 0.5 + 0.5) * h;
      const k = f.t / 0.32;
      ctx.strokeStyle = `rgba(255,214,150,${k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6 + (1 - k) * 22, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  draw(s) {
    const {
      state, time, player: P, level, camera, input,
      score, kills = 0, banner, msg, msgT, subtitle, radioT,
      hurtFlash, hurtAng,
      hitMark, killMark, headMark, aimHit, aimDist = 0, execTarget, execKind, execFX, deadEye, melee,
      nades, pickups, timeLeft, planted, throwAim, perfStats,
      bloomEnabled, qualityLabel, exitOpen, hudIcons
    } = s;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;
    const it = input.isTouch;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state === 'menu' || state === 'armory') return;

    // 1. Subtle cinematic edge framing (kept light so night streets stay crystal-clear!)
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.44, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, P.btK > 0.02 ? `rgba(46,24,6,${0.3 + P.btK * 0.2})` : 'rgba(3,6,14,0.26)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (state === 'play' && P.scopeK > 0.12) {
      this._drawSniperScope(ctx, w, h, P, aimHit, aimDist, hitMark, killMark, headMark);
    }

    if (P.btK > 0.02) {
      const sg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
      sg.addColorStop(0, 'rgba(160,96,30,0)');
      sg.addColorStop(1, `rgba(150,82,24,${P.btK * 0.14})`);
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);
    }

    if (hurtFlash > 0) {
      const a = Math.min(1, hurtFlash * 2);
      const hg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.7);
      hg.addColorStop(0, 'rgba(179,38,30,0)');
      hg.addColorStop(1, `rgba(185,32,24,${a * 0.62})`);
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);
      if (hurtAng !== null) {
        const rel = hurtAng - P.ang;
        ctx.strokeStyle = `rgba(255,78,56,${a})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 92, rel - Math.PI / 2 - 0.34, rel - Math.PI / 2 + 0.34);
        ctx.stroke();
      }
    }

    // Cinema Execution Close-Up & Freeze-Frame Overlay (pre-HUD layer)
    const hudAlpha = clamp(1 - (execFX?.k || 0) * 1.45, 0, 1);

    if (s.duel?.active) {
      this._drawDojoHud(ctx, s, w, h, hudAlpha);
      return;
    }

    // 2. Top-Left 1937 Art-Deco Vital & Mission Plaque
    ctx.save();
    ctx.globalAlpha = hudAlpha;
    ctx.textBaseline = 'alphabetic';
    const px = 16;
    const py = 16;
    const pw = 252;
    const hasArmor = P.armor > 0;
    const ph = hasArmor ? 74 : 64;

    chamferPath(ctx, px, py, pw, ph, 6);
    ctx.fillStyle = 'rgba(9, 14, 25, 0.80)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawCornerTicks(ctx, px + 2, py + 2, pw - 4, ph - 4, 6);

    // Health bar (segmented crimson lacquer)
    const barX = px + 12;
    const barW = pw - 24;
    const hpRatio = clamp(P.hp / 100, 0, 1);
    ctx.fillStyle = 'rgba(24, 30, 44, 0.9)';
    ctx.fillRect(barX, py + 11, barW, 18);

    const hpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    if (P.hp > 35 || Math.floor(time * 6) % 2 === 0) {
      hpGrad.addColorStop(0, '#961d16');
      hpGrad.addColorStop(1, '#de3c2e');
    } else {
      hpGrad.addColorStop(0, '#d93829');
      hpGrad.addColorStop(1, '#ff6b57');
    }
    ctx.fillStyle = hpGrad;
    ctx.fillRect(barX + 1, py + 12, Math.max(0, (barW - 2) * hpRatio), 16);

    // Subtle 20% segment dividers on HP bar
    ctx.fillStyle = 'rgba(9, 14, 25, 0.38)';
    for (let sIdx = 1; sIdx < 5; sIdx++) {
      ctx.fillRect(barX + (barW * sIdx) / 5, py + 12, 1, 16);
    }
    ctx.strokeStyle = 'rgba(236, 227, 207, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, py + 11.5, barW - 1, 17);

    ctx.font = '700 12px ' + FONT;
    ctx.fillStyle = '#f5ebd6';
    ctx.textAlign = 'left';
    ctx.fillText('生 命', barX + 7, py + 24);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(P.hp)}`, barX + barW - 7, py + 24);

    // Armor slim bar
    let fy = py + 34;
    if (hasArmor) {
      ctx.fillStyle = 'rgba(22, 30, 46, 0.9)';
      ctx.fillRect(barX, fy, barW, 6);
      ctx.fillStyle = '#5698eb';
      ctx.fillRect(barX + 1, fy + 1, (barW - 2) * clamp(P.armor / 100, 0, 1), 4);
      fy += 10;
    }

    // Bullet-Time / Focus bar
    const focusRatio = clamp((P.focus ?? 100) / 100, 0, 1);
    ctx.fillStyle = 'rgba(22, 28, 42, 0.9)';
    ctx.fillRect(barX, fy, barW, 14);
    const focGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    if (P.bulletTime) {
      focGrad.addColorStop(0, '#8e1f16');
      focGrad.addColorStop(1, '#e8553c');
    } else {
      focGrad.addColorStop(0, '#9c6e21');
      focGrad.addColorStop(1, '#e8b654');
    }
    ctx.fillStyle = P.focus > 15 || P.bulletTime ? focGrad : '#6b5e44';
    ctx.fillRect(barX + 1, fy + 1, (barW - 2) * focusRatio, 12);
    ctx.strokeStyle = P.bulletTime ? 'rgba(255,120,90,0.85)' : 'rgba(217,164,65,0.38)';
    ctx.strokeRect(barX + 0.5, fy + 0.5, barW - 1, 13);

    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = '#f5ebd6';
    ctx.textAlign = 'left';
    const deLabel = deadEye?.volley
      ? '死亡之眼 · 齐射'
      : deadEye?.active
        ? P.melee || !P.hasGun
          ? '死亡之眼 · 慢动作'
          : `死亡之眼 · 标记 ${deadEye.marks.length}/${P.mags[P.gun]}`
        : '[TAB] 死亡之眼';
    ctx.fillText(deLabel, barX + 6, fy + 10.5);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(P.focus ?? 100)}%`, barX + barW - 6, fy + 10.5);

    // Mission Objective Ribbon below Vital Plaque
    const cfg = level.cfg;
    const my = py + ph + 8;
    chamferPath(ctx, px, my, pw, cfg.mission === 'demo' && planted < 3 ? 66 : 46, 5);
    ctx.fillStyle = 'rgba(9, 14, 25, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.26)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = '#e5b352';
    ctx.fillText(cfg.name, px + 10, my + 16);

    ctx.textAlign = 'right';
    ctx.font = '600 11px ' + FONT;
    ctx.fillStyle = '#b9b2a2';
    ctx.fillText(`歼敌 ${kills}/${level.totalEnemies || 0}`, px + pw - 10, my + 16);

    const bossAlive = !!(level.boss && level.boss.hp > 0);
    const bossLoot = (pickups || []).find(p => p.type === 'bossWeapon' && !p.dead);
    const bossName = level.boss?.bossCfg?.name || cfg.bossCfg?.name || '黑龙';
    const objText =
      cfg.mission === 'boss'
        ? bossAlive
          ? `◆ 击毙头目“${bossName}”`
          : bossLoot
            ? `★ 拾取头目掉落的【${bossLoot.weaponName}】`
            : '◆ 头目已伏诛'
        : cfg.mission === 'rescue'
          ? !level.hostage?.free
            ? `◆ 解救联络人 · 击毙“${bossName}”`
            : bossAlive
              ? `◆ 击毙“${bossName}”打通北面出口`
              : bossLoot
                ? `★ 可拾取【${bossLoot.weaponName}】并撤往北面出口`
                : '◆ 护送联络人撤往北面出口'
          : planted < 3
            ? `◆ 安放炸药 (${planted}/3) · 击毙“${bossName}”`
            : bossAlive
              ? `◆ 炸药就绪！击毙“${bossName}”突围`
              : bossLoot
                ? `★ 可拾取【${bossLoot.weaponName}】并撤往北面出口`
                : '◆ 炸药就绪，立即撤往北面出口';

    ctx.textAlign = 'left';
    ctx.font = '600 12.5px ' + FONT;
    ctx.fillStyle = '#f2e8d4';
    ctx.fillText(objText, px + 10, my + 35);

    if (cfg.mission === 'demo' && planted < 3) {
      ctx.fillStyle = timeLeft < 60 ? '#ff5242' : '#e5b352';
      ctx.font = '700 13px ' + FONT;
      ctx.fillText(
        '倒计时 ' + Math.floor(timeLeft / 60) + ':' + String(Math.floor(timeLeft % 60)).padStart(2, '0'),
        px + 10,
        my + 55
      );
    }

    // 3. Top-Right Score & Brass-Bezel Architectural Tactical Radar
    const rx = w - (it ? 68 : 18);
    ctx.textAlign = 'right';
    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = 'rgba(229, 179, 82, 0.8)';
    ctx.fillText('战功 SCORE', rx, 22);
    ctx.font = '700 22px ' + FONT;
    ctx.fillStyle = '#f4e6c8';
    ctx.fillText(String(score).padStart(6, '0'), rx, 44);

    const R = it ? 46 : 60;
    const rcx = rx - R;
    const rcy = 56 + R;
    const rangeM = 50;
    const cs = Math.cos(P.ang);
    const sn = Math.sin(P.ang);

    ctx.save();
    ctx.beginPath();
    ctx.arc(rcx, rcy, R, 0, TAU);
    ctx.fillStyle = 'rgba(9, 15, 28, 0.80)';
    ctx.fill();
    ctx.clip();

    // Radar subtle range ring + forward FOV cone
    ctx.fillStyle = 'rgba(229, 179, 82, 0.07)';
    ctx.beginPath();
    ctx.moveTo(rcx, rcy);
    ctx.arc(rcx, rcy, R, -Math.PI / 2 - 0.46, -Math.PI / 2 + 0.46);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(217, 164, 65, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rcx, rcy, R * 0.52, 0, TAU);
    ctx.stroke();

    // Street building footprints in radar space
    ctx.fillStyle = 'rgba(112, 140, 178, 0.42)';
    for (const r of level.rects) {
      const bx = (r.x + r.w * 0.5) * TILE - P.x;
      const bz = (r.y + r.h * 0.5) * TILE - P.z;
      if (Math.abs(bx) > rangeM + r.w * TILE || Math.abs(bz) > rangeM + r.h * TILE) continue;
      const f = bx * cs + bz * sn;
      const right = -bx * sn + bz * cs;
      const bpx = rcx + (right / rangeM) * R;
      const bpy = rcy - (f / rangeM) * R;
      ctx.save();
      ctx.translate(bpx, bpy);
      ctx.rotate(P.ang + Math.PI / 2);
      const rw = ((r.w * TILE) / rangeM) * R;
      const rh = ((r.h * TILE) / rangeM) * R;
      ctx.fillRect(-rw * 0.5, -rh * 0.5, rw, rh);
      ctx.restore();
    }

    const dot = (x, z, c, sz) => {
      const dx = x - P.x;
      const dz = z - P.z;
      const f = dx * cs + dz * sn;
      const right = -dx * sn + dz * cs;
      let dpx = (right / rangeM) * R;
      let dpy = (-f / rangeM) * R;
      const l = Math.hypot(dpx, dpy);
      if (l > R - 4) {
        dpx *= (R - 4) / l;
        dpy *= (R - 4) / l;
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(rcx + dpx, rcy + dpy, sz, 0, TAU);
      ctx.fill();
    };

    for (const e of level.enemies) {
      if (e.awake || Math.hypot(e.x - P.x, e.z - P.z) < 28) {
        dot(e.x, e.z, e.disarmed ? '#a9b3b0' : e.type === 'boss' ? '#d47aff' : '#ff4d3d', e.type === 'boss' ? 4.2 : 2.8);
      }
    }
    for (const p of pickups) dot(p.x, p.z, p.type === 'bossWeapon' ? '#ffd860' : '#6ed0ff', p.type === 'bossWeapon' ? 4.4 : 2.2);
    if (!cfg.boss) dot(level.exitPos.x, level.exitPos.z, exitOpen ? '#ffc857' : '#8a6938', 4.2);
    if (level.hostage) dot(level.hostage.x, level.hostage.z, '#5aff8a', 4.2);
    for (const c of level.charges) if (!c.done) dot(c.x, c.z, '#5aff8a', 4.2);
    for (const n of nades) {
      if (n.data?.foe) {
        const t = n.body.translation();
        dot(t.x, t.z, '#ffffff', 3.2);
      }
    }
    ctx.restore();

    // Double Art-Deco brass radar bezel + North indicator
    ctx.strokeStyle = 'rgba(229, 179, 82, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(rcx, rcy, R, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 227, 207, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rcx, rcy, R + 3.5, 0, TAU);
    ctx.stroke();

    // North ('北', world -Z) indicator on radar rim
    const nFwd = -sn;
    const nRight = -cs;
    const nx = rcx + nRight * (R - 9);
    const ny = rcy - nFwd * (R - 9);
    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = '#e5b352';
    ctx.textAlign = 'center';
    ctx.fillText('北', nx, ny + 3.5);

    // Player center chevron
    ctx.fillStyle = '#f5ebd6';
    ctx.beginPath();
    ctx.moveTo(rcx, rcy - 5.5);
    ctx.lineTo(rcx - 4.2, rcy + 4.5);
    ctx.lineTo(rcx, rcy + 2.2);
    ctx.lineTo(rcx + 4.2, rcy + 4.5);
    ctx.closePath();
    ctx.fill();

    // 4. Bottom-Left Active Firearm Telemetry & Tactical Throwables
    const g = P.hasGun ? WEAPONS[P.gun] : null;
    const bladeMode = P.melee || !g;
    const blY = it ? 164 : h - 16;
    const blX = 16;

    // Throwable pills row above weapon plaque
    if (!it) {
      const pillY = blY - 102;
      const drawPill = (px0, label, count, activeCol) => {
        chamferPath(ctx, px0, pillY, 114, 24, 4);
        ctx.fillStyle = 'rgba(9, 14, 25, 0.78)';
        ctx.fill();
        ctx.strokeStyle = count > 0 ? 'rgba(217, 164, 65, 0.42)' : 'rgba(120, 120, 130, 0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = '600 11.5px ' + FONT;
        ctx.textAlign = 'left';
        ctx.fillStyle = count > 0 ? '#ece3cf' : '#77736a';
        ctx.fillText(label, px0 + 9, pillY + 16);
        ctx.textAlign = 'right';
        ctx.font = '700 12.5px ' + FONT;
        ctx.fillStyle = count > 0 ? activeCol : '#6e685f';
        ctx.fillText(`×${count}`, px0 + 105, pillY + 16);
      };
      drawPill(blX, '[G] 破片手雷', P.nades, '#e5b352');
      drawPill(blX + 122, '[F] 燃烧瓶', P.molo, '#ff8844');
    }

    // Active Weapon Plaque
    const wCardW = 236;
    const wCardH = 72;
    const wCardY = blY - wCardH;
    chamferPath(ctx, blX, wCardY, wCardW, wCardH, 6);
    ctx.fillStyle = 'rgba(9, 14, 25, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.48)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawCornerTicks(ctx, blX + 2, wCardY + 2, wCardW - 4, wCardH - 4, 5);

    ctx.textAlign = 'left';
    ctx.font = '700 15px ' + FONT;
    ctx.fillStyle = '#f5ebd6';
    ctx.fillText(bladeMode ? '二十九军式 大刀' : g.fullName, blX + 12, wCardY + 22);

    const meleeTxt = {
      draw: '拔刀出鞘', sheathe: '收刀入鞘', slashA: '斜劈', slashB: '横扫', chop: '力劈', spin: '回旋斩', recoil: '刀被弹开！'
    };
    const stanceTxt = bladeMode
      ? meleeTxt[melee?.atk?.name] || (P.hasGun ? '左键连斩 · 右键回旋斩 · [4] 收刀' : '左键连斩 · 右键回旋斩 · 击毙头目夺枪')
      : P.isScoped
        ? `${P.scopeZoomLabel} 光学开镜 [滚轮变倍 / Shift屏息]`
        : P.diveT > 0
          ? '飞扑慢镜'
          : P.ads > 0.35
            ? '精准肩射'
          : P.lowered
            ? (P.sneak
                ? (P.briskLow ? '猫腰快步' : '猫腰潜行 [Shift快步]')
                : (P.briskLow ? '低蹲快移' : '低蹲潜行 [Shift快移]'))
            : P.sprinting
              ? '疾步奔跑'
              : P.gunReady > 0.55
                ? '持枪戒备 [Z收枪]'
                : P.moving
                  ? '从容漫步 [Shift奔跑]'
                  : '轻松持枪 [Z戒备 / 右键瞄准]';
    ctx.font = '600 10.5px ' + FONT;
    ctx.fillStyle = P.ads > 0.35 || P.gunReady > 0.55 || P.briskLow ? '#ffd67c' : '#b5ad9c';
    const stealthTxt = P.crouch ? '低蹲潜行 [Shift快移]' : '猫腰潜行 [Shift快步]';
    ctx.fillText(P.stepT > 0 ? '闪避移步' : P.sneaking && !P.briskLow ? stealthTxt : stanceTxt, blX + 12, wCardY + 38);

    // Big tabular ammo readout on right side of weapon plaque
    const curMag = g ? P.mags[P.gun] : 0;
    const curRes = g ? (P.res[P.gun] === Infinity ? '∞' : P.res[P.gun]) : 0;
    ctx.textAlign = 'right';
    if (bladeMode) {
      ctx.font = '700 22px ' + DISPLAY_FONT;
      ctx.fillStyle = '#e8b654';
      ctx.fillText('近 战', blX + wCardW - 12, wCardY + 58);
    } else if (P.reloadT > 0) {
      ctx.font = '700 16px ' + FONT;
      ctx.fillStyle = '#e5b352';
      ctx.fillText('装填弹匣中…', blX + wCardW - 12, wCardY + 56);
    } else {
      ctx.font = '600 13px ' + FONT;
      ctx.fillStyle = '#9e9686';
      const resText = ` / ${curRes}`;
      ctx.fillText(resText, blX + wCardW - 12, wCardY + 58);
      const resW = ctx.measureText(resText).width;
      ctx.font = '700 28px ' + FONT;
      ctx.fillStyle = curMag > 0 ? '#e8b654' : '#e03e2d';
      ctx.fillText(String(curMag), blX + wCardW - 12 - resW, wCardY + 59);
    }

    // Visual magazine fill bar along bottom of weapon plaque (combo pips with the blade)
    if (bladeMode) {
      const done = melee?.comboT > 0 ? melee.combo || 3 : 0;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < done ? '#e5b352' : 'rgba(255,255,255,0.1)';
        ctx.fillRect(blX + 12 + i * 35, wCardY + 56, 31, 5);
      }
    } else {
      const magFrac = g.mag ? clamp(curMag / g.mag, 0, 1) : 1;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(blX + 12, wCardY + 56, 102, 5);
      ctx.fillStyle = curMag > 0 ? '#e5b352' : '#d63628';
      ctx.fillRect(blX + 12, wCardY + 56, 102 * magFrac, 5);
    }

    // 5. Bottom-Right Visual 3-Slot Weapon Equipment Hotbar (真·三格枪械装备栏 + 军械箱入口)
    if (!it) {
      const slots = P.loadout || [];
      const slotW = 132;
      const slotH = 62;
      const gap = 8;
      const armBtnW = 68;
      const totalDockW = 3 * slotW + 2 * gap + gap + armBtnW;
      const dockX0 = w - 16 - totalDockW;
      const dockY = h - 16 - slotH;

      // Subtle quality & controls micro-caption above dock
      ctx.textAlign = 'right';
      ctx.font = '600 11px ' + FONT;
      ctx.fillStyle = 'rgba(220, 210, 190, 0.72)';
      const modeHint = P.hasGun
        ? `[4] ${P.melee ? '收刀' : '大刀'}  ·  [Z] 轻松/持枪  ·  `
        : `开局仅持大刀 · 击毙头目夺枪  ·  `;
      ctx.fillText(
        `${modeHint}[Shift] 奔跑  ·  [B] 军械箱  ·  [H] ${qualityLabel || (bloomEnabled ? '极致电影' : '流畅直出')}`,
        w - 16,
        dockY - 10
      );

      for (let i = 0; i < 3; i++) {
        const wIdx = slots[i];
        const sw = wIdx !== undefined ? WEAPONS[wIdx] : null;
        const active = !bladeMode && i === P.slot && sw;
        const sx = dockX0 + i * (slotW + gap);
        const sy = active ? dockY - 4 : dockY;

        chamferPath(ctx, sx, sy, slotW, slotH, 5);
        if (active) {
          const gBg = ctx.createLinearGradient(sx, sy, sx, sy + slotH);
          gBg.addColorStop(0, 'rgba(38, 30, 20, 0.92)');
          gBg.addColorStop(1, 'rgba(14, 20, 34, 0.92)');
          ctx.fillStyle = gBg;
        } else {
          ctx.fillStyle = 'rgba(9, 14, 25, 0.78)';
        }
        ctx.fill();

        ctx.strokeStyle = active ? '#ebb858' : sw ? 'rgba(217, 164, 65, 0.30)' : 'rgba(130, 138, 155, 0.22)';
        ctx.lineWidth = active ? 1.8 : 1;
        ctx.stroke();

        if (active) {
          // Top gold indicator bar
          ctx.fillStyle = '#ebb858';
          ctx.fillRect(sx + 10, sy + 1, slotW - 20, 2.5);
        }

        // Slot number badge [1] [2] [3]
        ctx.textAlign = 'left';
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = active ? '#ffd87d' : 'rgba(217, 164, 65, 0.65)';
        ctx.fillText(`0${i + 1}`, sx + 8, sy + 15);

        if (sw) {
          // 3D Rendered Weapon Silhouette Icon inside the slot!
          const icon = hudIcons?.[sw.modelKey];
          if (icon) {
            const iw = 108;
            const ih = Math.round((icon.height / icon.width) * iw);
            ctx.save();
            ctx.globalAlpha = active ? 1 : 0.86;
            ctx.shadowColor = active ? 'rgba(255, 214, 128, 0.55)' : 'rgba(180, 205, 245, 0.32)';
            ctx.shadowBlur = active ? 10 : 6;
            ctx.drawImage(icon, sx + (slotW - iw) * 0.5 + 4, sy + (slotH - ih) * 0.5 - 3, iw, ih);
            ctx.restore();
          }

          ctx.textAlign = 'left';
          ctx.font = active ? '700 11.5px ' + FONT : '600 11px ' + FONT;
          ctx.fillStyle = active ? '#f7eedb' : '#c5beb0';
          ctx.fillText(sw.name, sx + 8, sy + slotH - 7);

          const mCnt = P.mags[wIdx];
          const rCnt = P.res[wIdx] === Infinity ? '∞' : P.res[wIdx];
          ctx.textAlign = 'right';
          ctx.font = '700 10.5px ' + FONT;
          ctx.fillStyle = mCnt > 0 ? (active ? '#ebb858' : '#9d9585') : '#e04232';
          ctx.fillText(`${mCnt}/${rCnt}`, sx + slotW - 8, sy + slotH - 7);
        } else {
          ctx.textAlign = 'center';
          ctx.font = '600 11px ' + FONT;
          ctx.fillStyle = 'rgba(160, 165, 178, 0.45)';
          ctx.fillText(slots.length ? '空枪套 [B]' : '击毙头目夺枪', sx + slotW * 0.5, sy + slotH * 0.5 + 5);
        }
      }

      // Dedicated [B] Armory Chest Card on right end of dock
      const ax = dockX0 + 3 * (slotW + gap);
      chamferPath(ctx, ax, dockY, armBtnW, slotH, 5);
      const armGrad = ctx.createLinearGradient(ax, dockY, ax, dockY + slotH);
      armGrad.addColorStop(0, 'rgba(42, 31, 18, 0.88)');
      armGrad.addColorStop(1, 'rgba(18, 16, 22, 0.90)');
      ctx.fillStyle = armGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 179, 82, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '700 14px ' + FONT;
      ctx.fillStyle = '#ffd678';
      ctx.fillText('[B]', ax + armBtnW * 0.5, dockY + 26);
      ctx.font = '700 11.5px ' + FONT;
      ctx.fillStyle = '#efe5d0';
      ctx.fillText('军械箱', ax + armBtnW * 0.5, dockY + 46);

      if (!input.locked && state === 'play' && P.scopeK < 0.12) {
        ctx.textAlign = 'center';
        ctx.font = '600 12px ' + FONT;
        ctx.fillStyle = 'rgba(236, 227, 207, 0.78)';
        ctx.fillText('点击画面锁定准星 · 按 [B] 打开九枪军械箱', w / 2, h - 22);
      }
    }

    if (execTarget && state === 'play' && P.execT <= 0) {
      const targetY = execTarget.downed ? 0.55 : enemyStanceHeight(execTarget) * 0.72;
      _tmpV.set(execTarget.x, targetY, execTarget.z).project(camera);
      if (_tmpV.z > -1 && _tmpV.z < 1) {
        const ex = clamp((_tmpV.x * 0.5 + 0.5) * w, 96, w - 96);
        const ey = clamp((-_tmpV.y * 0.5 + 0.5) * h, 78, h - 126);
        const isCombat = execKind === 'combat';
        const ringCol = isCombat ? '#ff6a4a' : '#ffd87a';

        // Outer rotating segmented God-of-War Finisher Seal around chest
        const sealY = ey + 28;
        const rOuter = 20 + Math.sin(time * 9) * 2.2;
        ctx.save();
        ctx.translate(ex, sealY);
        ctx.rotate(time * 2.4);
        ctx.strokeStyle = ringCol;
        ctx.lineWidth = 2.4;
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.arc(0, 0, rOuter, k * (Math.PI / 2) + 0.18, (k + 1) * (Math.PI / 2) - 0.18);
          ctx.stroke();
        }
        ctx.rotate(-time * 4.8 + Math.PI / 4);
        ctx.strokeStyle = isCombat ? '#ffd27a' : '#ffe29a';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(-8, -8, 16, 16);
        ctx.restore();

        const label = it ? '可处决' : isCombat ? '[E] 终结处决' : '[E] 潜行处决';
        ctx.font = '700 13.5px ' + FONT;
        const bw = ctx.measureText(label).width + 30;
        chamferPath(ctx, ex - bw * 0.5, ey - 18, bw, 30, 5);
        ctx.fillStyle = isCombat ? 'rgba(42, 12, 12, 0.92)' : 'rgba(28, 20, 12, 0.92)';
        ctx.fill();
        ctx.strokeStyle = ringCol;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = isCombat ? '#ffd8b0' : '#ffe7a4';
        ctx.fillText(label, ex, ey + 2);
      }
    }

    // 6b. Stealth Directional Suspicion Arcs & Guard '?' Markers
    if (state === 'play') {
      for (const e of level.enemies) {
        if (e.awake || e.hp <= 0 || !(e.suspicion > 0.06)) continue;
        const sVal = clamp(e.suspicion, 0, 1);
        const rel = Math.atan2(e.z - P.z, e.x - P.x) - P.ang;
        const col = sVal > 0.65 ? `rgba(255, 84, 58, ${0.45 + 0.5 * sVal})` : `rgba(255, 224, 146, ${0.35 + 0.55 * sVal})`;
        // Directional arc around crosshair
        ctx.save();
        ctx.strokeStyle = 'rgba(10, 14, 24, 0.55)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 74, rel - Math.PI / 2 - 0.28, rel - Math.PI / 2 + 0.28);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 74, rel - Math.PI / 2 - 0.28 * sVal, rel - Math.PI / 2 + 0.28 * sVal);
        ctx.stroke();
        ctx.restore();

        // Floating '?' above guard head when in front of camera
        _tmpV.set(e.x, enemyStanceHeight(e) + 0.42, e.z).project(camera);
        if (_tmpV.z > -1 && _tmpV.z < 1) {
          const sx = (_tmpV.x * 0.5 + 0.5) * w;
          const sy = (-_tmpV.y * 0.5 + 0.5) * h;
          ctx.textAlign = 'center';
          ctx.font = '700 16px ' + FONT;
          ctx.fillStyle = col;
          ctx.fillText(sVal > 0.72 ? '!' : '?', sx, sy);
        }
      }
    }

    // 7. Enemy Floating Health Bars (anchored to real stance height, occluded by walls, distinct downed/disarmed states)
    const eyeY = P.y + (P.currentHeight ? P.currentHeight() : 1.65) - 0.1;
    for (const e of level.enemies) {
      if (e.hp >= e.max || e.type === 'boss') continue;
      if (Math.hypot(e.x - P.x, e.z - P.z) > 38) continue;
      const barY = e.downed ? 0.62 : enemyStanceHeight(e) + 0.30;
      if (level.los3 && !level.los3(P.x, eyeY, P.z, e.x, barY, e.z)) continue;
      _tmpV.set(e.x, barY, e.z).project(camera);
      if (_tmpV.z > 1 || _tmpV.z < -1) continue;
      const x = (_tmpV.x * 0.5 + 0.5) * w;
      const y = (-_tmpV.y * 0.5 + 0.5) * h;
      if (e.disarmed) {
        ctx.textAlign = 'center';
        ctx.font = '600 10px ' + FONT;
        ctx.fillStyle = 'rgba(154, 186, 214, 0.85)';
        ctx.fillText('已缴械', x, y);
        continue;
      }
      ctx.fillStyle = 'rgba(6, 10, 18, 0.78)';
      ctx.fillRect(x - 19, y - 4, 38, 6);
      ctx.fillStyle = e.downed ? '#99221d' : '#e63e30';
      ctx.fillRect(x - 18, y - 3, 36 * clamp(e.hp / e.max, 0, 1), 4);
    }

    // 8. Boss Health Plaque + 3D World Location / Telegraph Marker
    if (level.boss && level.boss.hp > 0) {
      const b = level.boss;
      const bName = b.bossCfg?.name || '黑龙';
      const bDist = Math.hypot(b.x - P.x, b.z - P.z);
      const bY = enemyStanceHeight(b) + 0.48;
      if (b.awake || (bDist < 54 && (!level.los3 || level.los3(P.x, eyeY, P.z, b.x, bY, b.z)))) {
        _tmpV.set(b.x, bY, b.z).project(camera);
        const onScreen = _tmpV.z >= -1 && _tmpV.z <= 1 && Math.abs(_tmpV.x) <= 0.96 && Math.abs(_tmpV.y) <= 0.94;
        if (onScreen && (!level.los3 || level.los3(P.x, eyeY, P.z, b.x, bY, b.z))) {
          const sx = (_tmpV.x * 0.5 + 0.5) * w;
          const sy = (-_tmpV.y * 0.5 + 0.5) * h;
          const winding = (b.ringWindupT || 0) > 0;
          const sniping = b.bossCfg?.attackStyle === 'sniper' && (b.aimT || 0) > 0;
          const alert = winding || sniping;
          const pulse = 0.72 + 0.28 * Math.sin(time * (alert ? 22 : 7));
          ctx.save();
          ctx.translate(sx, sy);
          ctx.fillStyle = alert ? `rgba(255, 72, 48, ${pulse})` : 'rgba(229, 179, 82, 0.95)';
          ctx.strokeStyle = 'rgba(10, 12, 18, 0.9)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(6, 0);
          ctx.lineTo(0, 7);
          ctx.lineTo(-6, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.textAlign = 'center';
          ctx.font = '700 11.5px ' + FONT;
          ctx.fillStyle = alert ? '#ff7c68' : '#ffd984';
          const tag = winding ? '⚠ 霰弹齐射！快隐蔽' : sniping ? '⚠ 狙击瞄准！快闪避' : `${bName} · ${Math.round(bDist)}m`;
          ctx.fillText(tag, 0, -13);
          ctx.restore();
        } else if (b.awake) {
          const rel = Math.atan2(b.z - P.z, b.x - P.x) - P.ang;
          const ax = Math.sin(rel);
          const ay = -Math.cos(rel);
          const pad = 54;
          const halfW = w * 0.5 - pad;
          const halfH = h * 0.5 - pad;
          const scale = Math.min(halfW / (Math.abs(ax) || 0.001), halfH / (Math.abs(ay) || 0.001));
          const ex = w * 0.5 + ax * scale;
          const ey = h * 0.5 + ay * scale;
          const ang = Math.atan2(ay, ax);
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.fillStyle = (b.ringWindupT || 0) > 0 ? '#ff4a38' : '#e5b352';
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-6, -6);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-6, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.textAlign = 'center';
          ctx.font = '700 11px ' + FONT;
          ctx.fillStyle = (b.ringWindupT || 0) > 0 ? '#ff7c68' : '#ffd984';
          ctx.fillText(`${bName} ${Math.round(bDist)}m`, clamp(ex, 44, w - 44), clamp(ey + 18, 28, h - 18));
        }
      }
    }
    if (level.boss && level.boss.hp > 0 && level.boss.awake) {
      const bw = Math.min(440, w - 40);
      const bx = (w - bw) / 2;
      const byy = it ? 120 : 34;
      chamferPath(ctx, bx, byy, bw, 16, 4);
      ctx.fillStyle = 'rgba(12, 14, 24, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 179, 82, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const bGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      bGrad.addColorStop(0, '#8e2424');
      bGrad.addColorStop(1, '#d9483b');
      ctx.fillStyle = bGrad;
      ctx.fillRect(bx + 3, byy + 3, ((bw - 6) * level.boss.hp) / level.boss.max, 10);
      ctx.textAlign = 'center';
      ctx.font = '700 14px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.fillText(level.boss.bossCfg?.title || '黑龙帮魁首 · 黑 龙', w / 2, byy - 7);
    }

    // 9. Chapter Intro Banner (Art-Deco Gold & Lacquer)
    ctx.textAlign = 'center';
    if (banner > 0) {
      const a = clamp(banner, 0, 1);
      const by0 = h * 0.24;
      ctx.fillStyle = `rgba(8, 12, 22, ${a * 0.82})`;
      ctx.fillRect(0, by0, w, 98);
      ctx.strokeStyle = `rgba(229, 179, 82, ${a * 0.65})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.2, by0 + 1); ctx.lineTo(w * 0.8, by0 + 1);
      ctx.moveTo(w * 0.2, by0 + 97); ctx.lineTo(w * 0.8, by0 + 97);
      ctx.stroke();

      ctx.fillStyle = `rgba(245, 235, 214, ${a})`;
      ctx.font = `400 ${Math.min(44, w / 11)}px ${DISPLAY_FONT}`;
      ctx.fillText(cfg.name, w / 2, by0 + 50);
      ctx.font = '600 13.5px ' + FONT;
      ctx.fillStyle = `rgba(229, 179, 82, ${a})`;
      ctx.fillText(
        cfg.mission === 'boss'
          ? `◆ 决战时刻 · 击毙头目“${bossName}” ◆`
          : cfg.mission === 'rescue'
            ? `◆ 解救联络人 · 击毙把头“${bossName}”突围 ◆`
            : `◆ 安放三处炸药 · 击毙头目“${bossName}”撤离 ◆`,
        w / 2,
        by0 + 78
      );
    }

    // Demolition charge progress bar
    const pc = level.charges.find(c => !c.done && c.k > 0);
    if (pc) {
      chamferPath(ctx, w / 2 - 96, h * 0.62, 192, 14, 3);
      ctx.fillStyle = 'rgba(9, 14, 25, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 179, 82, 0.55)';
      ctx.stroke();
      ctx.fillStyle = '#5aff8a';
      ctx.fillRect(w / 2 - 93, h * 0.62 + 3, 186 * pc.k, 8);
      ctx.font = '700 13px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.fillText('正在安放定时炸药……保持警戒', w / 2, h * 0.62 - 8);
    }

    // Incoming grenade 3D spatial indicator (countdown fuse ring + distance + edge arrow when off-screen)
    let nearFoeNade = false;
    for (const n of nades) {
      if (!n.data?.foe || n.dead) continue;
      const np = n.body.translation();
      const nd = Math.hypot(np.x - P.x, np.z - P.z);
      if (nd > 16) continue;
      if (nd < 8.8) nearFoeNade = true;
      const fuseLeft = clamp(1 - (n.data.t || 0) / 2.2, 0, 1);
      _tmpV.set(np.x, np.y + 0.35, np.z).project(camera);
      const behind = _tmpV.z > 1;
      let gx = (_tmpV.x * 0.5 + 0.5) * w;
      let gy = (-_tmpV.y * 0.5 + 0.5) * h;
      if (behind) { gx = w - gx; gy = h - gy; }
      const margin = 52;
      const offscreen = behind || gx < margin || gx > w - margin || gy < margin || gy > h - margin;
      if (offscreen) {
        const ang = Math.atan2(gy - h / 2, gx - w / 2);
        const rx = w / 2 - margin;
        const ry = h / 2 - margin;
        const scale = 1 / Math.max(Math.abs(Math.cos(ang)) / rx, Math.abs(Math.sin(ang)) / ry);
        gx = w / 2 + Math.cos(ang) * scale;
        gy = h / 2 + Math.sin(ang) * scale;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(ang);
        ctx.fillStyle = '#ff4d3d';
        ctx.beginPath();
        ctx.moveTo(22, 0); ctx.lineTo(13, -6); ctx.lineTo(13, 6); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = 'rgba(28, 8, 8, 0.88)';
      ctx.beginPath();
      ctx.arc(gx, gy, 15, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 100, 80, 0.3)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(gx, gy, 15, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = fuseLeft < 0.35 && Math.floor(time * 14) % 2 ? '#fff0a0' : '#ff4636';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(gx, gy, 15, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * fuseLeft);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '700 10.5px ' + FONT;
      ctx.fillStyle = '#ffeae0';
      ctx.fillText(`${Math.max(1, Math.round(nd))}m`, gx, gy + 3.5);
      ctx.restore();
    }
    if (nearFoeNade && Math.floor(time * 8) % 2) {
      ctx.font = '700 16px ' + FONT;
      ctx.fillStyle = '#ff4d3d';
      ctx.fillText('⚠ 当心敌方手雷！', w / 2, h * 0.37);
    }

    // Contact, Boss Trophy & Exit Waypoint Markers (keeps escort target, dropped boss weapon & north extraction readable in rain)
    if (state === 'play') {
      const drawWaypoint = (wx, wy, wz, label, col, minDist = 3.5) => {
        const wd = Math.hypot(wx - P.x, wz - P.z);
        if (wd < minDist) return;
        _tmpV.set(wx, wy, wz).project(camera);
        const behind = _tmpV.z > 1;
        let sx = (_tmpV.x * 0.5 + 0.5) * w;
        let sy = (-_tmpV.y * 0.5 + 0.5) * h;
        if (behind) { sx = w - sx; sy = h - sy; }
        const m = 44;
        if (behind || sx < m || sx > w - m || sy < m || sy > h - m) {
          const ang = Math.atan2(sy - h / 2, sx - w / 2);
          const sc = 1 / Math.max(Math.abs(Math.cos(ang)) / (w / 2 - m), Math.abs(Math.sin(ang)) / (h / 2 - m));
          sx = w / 2 + Math.cos(ang) * sc;
          sy = h / 2 + Math.sin(ang) * sc;
        }
        ctx.save();
        ctx.translate(sx, sy);
        ctx.strokeStyle = col;
        ctx.fillStyle = 'rgba(9, 14, 25, 0.78)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = '600 10.5px ' + FONT;
        ctx.fillStyle = col;
        ctx.fillText(`${label} ${Math.round(wd)}m`, 0, -12);
        ctx.restore();
      };
      for (const p of pickups || []) {
        if (p.type === 'bossWeapon' && !p.dead) {
          drawWaypoint(p.x, 1.45, p.z, `★ 缴获：${p.weaponName}`, '#ffd860', 1.2);
        }
      }
      if (level.hostage?.free) {
        drawWaypoint(level.hostage.x, 1.9, level.hostage.z, '联络人', '#78e0ff');
      }
      if (exitOpen && level.exitPos) {
        drawWaypoint(level.exitPos.x, 2.2, level.exitPos.z, '北面出口', '#ffd26a');
      }
    }

    // Throw-aiming helper prompt
    if (throwAim && state === 'play') {
      const itemLabel = throwAim.kind === 'molo' ? '燃烧瓶' : '破片手雷';
      const txt = throwAim.danger
        ? `${itemLabel}落点过近（${throwAim.dist.toFixed(1)}m）· 右键取消`
        : `${itemLabel}瞄准（${throwAim.dist.toFixed(1)}m）· 松开投掷 / 右键取消`;
      ctx.font = '700 13px ' + FONT;
      const tw = ctx.measureText(txt).width + 26;
      const ty = h * 0.64;
      chamferPath(ctx, w / 2 - tw / 2, ty - 18, tw, 26, 4);
      ctx.fillStyle = 'rgba(9, 14, 25, 0.84)';
      ctx.fill();
      ctx.strokeStyle = throwAim.danger ? 'rgba(255, 104, 82, 0.75)' : 'rgba(229, 179, 82, 0.62)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = throwAim.danger ? '#ff7c68' : '#ffe298';
      ctx.fillText(txt, w / 2, ty);
    }

    // Action feedback toast
    if (msgT > 0) {
      const a = clamp(msgT, 0, 1);
      ctx.font = '700 15px ' + FONT;
      ctx.fillStyle = `rgba(255, 224, 148, ${a})`;
      ctx.fillText(msg, w / 2, h * 0.69);
    }

    // Touch virtual stick
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

    // 10. Precision Art-Deco Crosshair & Snappy Spring Hitmarkers (all combat modes)
    const drawImpactMarker = (cx, cy, baseIn = 6, baseOut = 14) => {
      if (hitMark <= 0 && killMark <= 0) return;
      const isKill = killMark > 0;
      const isHead = headMark > 0;
      const tNorm = isKill ? clamp(killMark / 0.4, 0, 1) : clamp(hitMark / 0.16, 0, 1);
      // Fast snap-in expand then spring tighten on impact frame!
      const pop = Math.pow(tNorm, 2.2) * (isKill ? 7.5 : 4.5);
      const rIn = baseIn + pop * 0.45;
      const rOut = baseOut + pop;
      ctx.save();
      ctx.globalAlpha = clamp(tNorm * 2.4, 0.25, 1);
      ctx.strokeStyle = isKill ? '#ff4436' : isHead ? '#ffd452' : '#f8f2e4';
      ctx.lineWidth = isKill ? 2.8 : isHead ? 2.3 : 2.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(cx + a * rIn, cy + b * rIn);
        ctx.lineTo(cx + a * rOut, cy + b * rOut);
      }
      ctx.stroke();
      // Double inner gold tick on headshots, crisp crimson outer burst ring on kills
      if (isHead && !isKill) {
        ctx.strokeStyle = 'rgba(255, 224, 120, 0.78)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, rIn + 2.5, 0, TAU);
        ctx.stroke();
      }
      if (isKill) {
        const ringR = baseOut + 4 + (1 - tNorm) * 14;
        ctx.strokeStyle = isHead ? `rgba(255, 212, 82, ${tNorm * 0.85})` : `rgba(255, 72, 56, ${tNorm * 0.72})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    };

    if (state === 'play' && (P.melee || !P.hasGun)) {
      const x = w / 2;
      const y = h / 2;
      ctx.save();
      ctx.globalAlpha = hudAlpha;
      ctx.strokeStyle = killMark > 0 ? '#ff4a3a' : hitMark > 0 ? '#ffd24a' : 'rgba(244,235,216,0.8)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath();
      ctx.stroke();
      ctx.restore();
      drawImpactMarker(x, y, 8, 16);
    } else if (state === 'play' && P.scopeK <= 0.45) {
      const x = w / 2;
      const y = h / 2;
      const sp =
        3.5 +
        (WEAPONS[P.gun]?.spread || 0.01) *
          (1 + P.bloom * 1.8) *
          (P.moving ? 1.35 : 1) *
          (1 - 0.78 * P.ads) *
          (P.lowered ? 0.7 : 1) *
          290;

      drawImpactMarker(x, y, 6, 14);

      const armLen = P.ads > 0.35 ? 10 : 8;
      const retCol = aimHit ? '#ff4d3d' : P.ads > 0.35 ? '#ffe298' : '#f4ebd8';
      ctx.strokeStyle = retCol;
      ctx.lineWidth = P.ads > 0.35 ? 1.8 : 2;
      ctx.beginPath();
      ctx.moveTo(x - sp - armLen, y); ctx.lineTo(x - sp, y);
      ctx.moveTo(x + sp, y); ctx.lineTo(x + sp + armLen, y);
      ctx.moveTo(x, y - sp - armLen); ctx.lineTo(x, y - sp);
      ctx.moveTo(x, y + sp); ctx.lineTo(x, y + sp + armLen);
      ctx.stroke();

      // ADS precision outer brackets
      if (P.ads > 0.25) {
        const bk = sp + armLen + 5;
        ctx.strokeStyle = aimHit ? 'rgba(255,77,61,0.65)' : `rgba(229,179,82,${0.55 * P.ads})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - bk, y - 5); ctx.lineTo(x - bk, y + 5);
        ctx.moveTo(x + bk, y - 5); ctx.lineTo(x + bk, y + 5);
        ctx.stroke();
      }

      ctx.fillStyle = retCol;
      ctx.beginPath();
      ctx.arc(x, y, P.ads > 0.35 ? 1.6 : 1.8, 0, TAU);
      ctx.fill();

      // Sleek Art-Deco radial reload progress ring around the crosshair
      if (P.reloadT > 0) {
        const reloadDur = P.reloadDur || WEAPONS[P.gun]?.reload || 1;
        const prog = clamp(1 - P.reloadT / reloadDur, 0, 1);
        ctx.strokeStyle = 'rgba(229, 179, 82, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = '#ffd678';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, 18, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * prog);
        ctx.stroke();
      }
    }
    if (perfStats?.show) {
      ctx.textAlign = 'right';
      ctx.font = '600 11px monospace';
      ctx.fillStyle = 'rgba(210, 232, 255, 0.82)';
      ctx.fillText(
        `${perfStats.fps} FPS · ${perfStats.ms.toFixed(1)}ms · ${Math.round((perfStats.resScale || 1) * 100)}%`,
        w - 18,
        196
      );
    }
    ctx.restore(); // End routine HUD alpha wrapper

    if (deadEye && (deadEye.marks.length || deadEye.flashes.length)) this._drawDeadEyeMarks(ctx, deadEye, camera, w, h);

    // 11. Master Cinema Close-Up & Stylized Noir Freeze-Frame Tableau (rendered cleanly ABOVE hidden HUD!)
    if (execFX && (execFX.k > 0.01 || execFX.flash > 0.01 || execFX.freeze > 0.01)) {
      const fk = clamp(execFX.freeze || 0, 0, 1);
      const fa = clamp(execFX.flash || 0, 0, 1);
      const ek = clamp(execFX.k || 0, 0, 1);

      // Projected 3D Muzzle / Blade Impact Point on screen
      let ix = w * 0.52;
      let iy = h * 0.46;
      if (execFX.impactPos) {
        _tmpV.set(execFX.impactPos.x, execFX.impactPos.y, execFX.impactPos.z).project(camera);
        if (_tmpV.z > -1 && _tmpV.z < 1) {
          ix = clamp((_tmpV.x * 0.5 + 0.5) * w, w * 0.15, w * 0.85);
          iy = clamp((-_tmpV.y * 0.5 + 0.5) * h, h * 0.18, h * 0.82);
        }
      }

      // High-contrast Noir Chiaroscuro Freeze-Frame Rim & Crimson-Gold Flash
      if (fk > 0.01 || fa > 0.01) {
        const rimG = ctx.createRadialGradient(ix, iy, Math.min(w, h) * 0.14, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
        rimG.addColorStop(0, `rgba(255, 244, 214, ${fa * 0.24})`);
        rimG.addColorStop(0.45, `rgba(210, 42, 28, ${fa * 0.18 + fk * 0.10})`);
        rimG.addColorStop(1, `rgba(6, 4, 10, ${fk * 0.62 + fa * 0.32})`);
        ctx.fillStyle = rimG;
        ctx.fillRect(0, 0, w, h);
      }

      // Anamorphic Horizontal Cinema Lens-Flare + 4-Point Razor Star right on Muzzle / Blade!
      if (fk > 0.02 || fa > 0.12) {
        const starA = clamp(Math.max(fk * 0.95, fa * 0.85), 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Horizontal 35mm Anamorphic Streak
        const streakW = Math.min(w * 0.42, 380);
        const hGrad = ctx.createLinearGradient(ix - streakW, iy, ix + streakW, iy);
        hGrad.addColorStop(0, 'rgba(255, 190, 95, 0)');
        hGrad.addColorStop(0.42, `rgba(255, 214, 138, ${starA * 0.42})`);
        hGrad.addColorStop(0.5, `rgba(255, 250, 232, ${starA * 0.92})`);
        hGrad.addColorStop(0.58, `rgba(255, 214, 138, ${starA * 0.42})`);
        hGrad.addColorStop(1, 'rgba(255, 190, 95, 0)');
        ctx.fillStyle = hGrad;
        ctx.fillRect(ix - streakW, iy - 2.5, streakW * 2, 5);

        // Diagonal Cross-Slash Needle Rays
        for (const ang of [-0.42, 1.15]) {
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(ang);
          const dLen = 150;
          const dGrad = ctx.createLinearGradient(-dLen, 0, dLen, 0);
          dGrad.addColorStop(0, 'rgba(255,220,160,0)');
          dGrad.addColorStop(0.5, `rgba(230,245,255,${starA * 0.85})`);
          dGrad.addColorStop(1, 'rgba(255,220,160,0)');
          ctx.fillStyle = dGrad;
          ctx.fillRect(-dLen, -1.6, dLen * 2, 3.2);
          ctx.restore();
        }

        // Core Pinpoint Sunburst
        const coreG = ctx.createRadialGradient(ix, iy, 0, ix, iy, 46);
        coreG.addColorStop(0, `rgba(255, 252, 240, ${starA * 0.9})`);
        coreG.addColorStop(0.32, `rgba(255, 196, 98, ${starA * 0.48})`);
        coreG.addColorStop(1, 'rgba(220, 60, 30, 0)');
        ctx.fillStyle = coreG;
        ctx.beginPath();
        ctx.arc(ix, iy, 46, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // Tapered Ink-Brush Radial Action Needles focused on Impact Point
      const needleA = Math.max(execFX.dash || 0, fk * 0.85, fa * 0.65);
      if (needleA > 0.04) {
        const rMin = Math.min(w, h) * 0.34;
        const rMax = Math.max(w, h) * 0.78;
        ctx.save();
        for (let i = 0; i < 36; i++) {
          const a0 = (i / 36) * TAU + ((i % 3) - 1) * 0.025;
          const r1 = rMin + ((i * 23) % 9) * 16;
          const x1 = ix + Math.cos(a0) * r1;
          const y1 = iy + Math.sin(a0) * r1;
          const x2 = ix + Math.cos(a0) * rMax;
          const y2 = iy + Math.sin(a0) * rMax;
          ctx.strokeStyle = i % 4 === 0
            ? `rgba(225, 58, 42, ${needleA * 0.36})`
            : `rgba(252, 232, 186, ${needleA * 0.26})`;
          ctx.lineWidth = i % 3 === 0 ? 2.2 : 1.1;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Widescreen 2.39:1 Anamorphic Cinema Letterbox + Art-Deco Frame Crop Marks
      if (ek > 0.02) {
        const barH = Math.round((fk > 0.02 ? 56 : 46) * ek);
        ctx.fillStyle = 'rgba(4, 5, 10, 0.96)';
        ctx.fillRect(0, 0, w, barH);
        ctx.fillRect(0, h - barH, w, barH);
        ctx.fillStyle = `rgba(229, 179, 82, ${0.65 * ek})`;
        ctx.fillRect(0, barH - 1.5, w, 1.5);
        ctx.fillRect(0, h - barH, w, 1.5);

        // Freeze-Frame Calligraphic Stamp & Cinnabar Seal ("一枪绝杀" / "无声抹喉")
        if (fk > 0.02) {
          const slamScale = 1 + Math.max(0, fk - 0.82) * 1.4;
          const sx = w - 68;
          const sy = h - barH - 28;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.scale(slamScale, slamScale);

          // Cinnabar Square Seal [孤枪]
          ctx.fillStyle = 'rgba(178, 28, 20, 0.94)';
          ctx.fillRect(-38, -42, 36, 36);
          ctx.strokeStyle = '#f8ecd4';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-35, -39, 30, 30);
          ctx.font = '700 13px ' + FONT;
          ctx.fillStyle = '#f8ecd4';
          ctx.textAlign = 'center';
          ctx.fillText('孤鸿', -20, -26);
          ctx.fillText('绝印', -20, -11);

          // Brush Calligraphy Title
          const stampTxt = execFX.stamp || '无 声 一 击';
          ctx.textAlign = 'right';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
          ctx.shadowBlur = 14;
          ctx.font = `400 44px ${DISPLAY_FONT}`;
          ctx.fillStyle = '#fbf1dc';
          ctx.fillText(stampTxt, -50, -10);

          ctx.shadowBlur = 0;
          ctx.font = '700 10.5px ' + FONT;
          ctx.fillStyle = '#e5b352';
          ctx.fillText(
            execFX.blade
              ? 'SHANGHAI 1937 · DADAO EXECUTION'
              : execFX.stealth === false
                ? 'SHANGHAI 1937 · POINT-BLANK FINISHER'
                : 'SHANGHAI 1937 · STEALTH TAKEDOWN',
            -50,
            6
          );
          ctx.restore();
        }

      }
    }
    if (radioT > 0 && subtitle) {
      const cinema = (execFX?.k || 0) > 0.02;
      this._drawSubtitle(ctx, subtitle, w, h, clamp(radioT, 0, 1), cinema, it ? input.crouchButton : null);
    }
  }

  _drawSniperScope(ctx, w, h, P, aimHit, aimDist, hitMark, killMark, headMark) {
    const k = clamp(P.scopeK || 0, 0, 1);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.445;

    ctx.save();
    ctx.globalAlpha = k;

    // 1. Subtle cool-glass lens tint & internal optical edge falloff inside the aperture
    const glassGrad = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r);
    glassGrad.addColorStop(0, 'rgba(180, 215, 240, 0.02)');
    glassGrad.addColorStop(0.78, 'rgba(10, 18, 28, 0.14)');
    glassGrad.addColorStop(0.95, 'rgba(4, 7, 12, 0.72)');
    glassGrad.addColorStop(1, 'rgba(2, 4, 8, 0.98)');
    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();

    // 2. Jet-black optical tube occlusion mask outside the circular lens
    ctx.fillStyle = 'rgba(3, 5, 10, 0.97)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, r, 0, TAU, true);
    ctx.fill('evenodd');

    // 3. Classic 1937 German #1 / Mil-Dot Reticle (clipped cleanly inside lens)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, TAU);
    ctx.clip();

    // Razor-thin central crosshairs
    ctx.strokeStyle = 'rgba(8, 10, 14, 0.92)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Heavy outer stadia posts (left, right, bottom) tapering toward center
    ctx.strokeStyle = 'rgba(6, 8, 12, 0.98)';
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.30, cy);
    ctx.moveTo(cx + r * 0.30, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy + r * 0.30); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Fine calibrated mil-dot rangefinder ticks along both axes
    const step = r * 0.075;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 1; i <= 4; i++) {
      const tick = i === 2 ? 6.5 : 4;
      const d = step * i;
      ctx.moveTo(cx - d, cy - tick); ctx.lineTo(cx - d, cy + tick);
      ctx.moveTo(cx + d, cy - tick); ctx.lineTo(cx + d, cy + tick);
      ctx.moveTo(cx - tick, cy + d); ctx.lineTo(cx + tick, cy + d);
      ctx.moveTo(cx - tick, cy - d); ctx.lineTo(cx + tick, cy - d);
    }
    ctx.stroke();

    // Subtle brass rim reflection arc at top-left of lens
    ctx.strokeStyle = 'rgba(229, 179, 82, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, -Math.PI * 0.85, -Math.PI * 0.38);
    ctx.stroke();

    // Center illuminated pinpoint & snappy spring hit/kill marker
    if (hitMark > 0 || killMark > 0) {
      const isKill = killMark > 0;
      const isHead = headMark > 0;
      const tNorm = isKill ? clamp(killMark / 0.4, 0, 1) : clamp(hitMark / 0.16, 0, 1);
      const pop = Math.pow(tNorm, 2.2) * (isKill ? 8 : 5);
      ctx.strokeStyle = isKill ? '#ff4436' : isHead ? '#ffd452' : '#ffffff';
      ctx.lineWidth = isKill ? 2.8 : 2.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(cx + a * (7 + pop * 0.45), cy + b * (7 + pop * 0.45));
        ctx.lineTo(cx + a * (16 + pop), cy + b * (16 + pop));
      }
      ctx.stroke();
      if (isKill) {
        ctx.strokeStyle = isHead ? `rgba(255, 212, 82, ${tNorm * 0.85})` : `rgba(255, 72, 56, ${tNorm * 0.72})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 20 + (1 - tNorm) * 14, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.fillStyle = aimHit ? '#ff4434' : 'rgba(255, 214, 128, 0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, aimHit ? 2.6 : 1.8, 0, TAU);
    ctx.fill();

    // Reload arc inside scope if reloading
    if (P.reloadT > 0) {
      const reloadDur = P.reloadDur || WEAPONS[P.gun]?.reload || 1;
      const prog = clamp(1 - P.reloadT / reloadDur, 0, 1);
      ctx.strokeStyle = '#ffd678';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * prog);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Antique brass / blued-steel outer optical housing bezel ring
    ctx.strokeStyle = 'rgba(229, 179, 82, 0.52)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90, 108, 130, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, TAU);
    ctx.stroke();

    // 5. Compact optical telemetry readout tucked beneath the lower arc
    const distTxt = aimDist > 0 && aimDist < 215 ? `${Math.round(aimDist)}m` : '--m';
    ctx.textAlign = 'center';
    ctx.font = '700 12px ' + FONT;
    ctx.fillStyle = P.breathSteady ? '#7effb2' : '#ffd984';
    ctx.fillText(
      `蔡司倍镜 ${P.scopeZoomLabel}  ·  测距 ${distTxt}${P.breathSteady ? '  ·  屏息稳枪' : ''}`,
      cx,
      cy + r + 24
    );
    ctx.font = '600 11px ' + FONT;
    ctx.fillStyle = 'rgba(216, 206, 186, 0.72)';
    ctx.fillText('[滚轮] 切换 4×/8× 倍率  ·  [Shift / 蹲姿] 屏息稳枪', cx, cy + r + 42);

    ctx.restore();
  }

  _drawSubtitle(ctx, caption, width, height, alpha, cinema, touchButton) {
    ctx.textAlign = 'center';
    const cached = this.subtitleLayout;
    if (cached?.caption !== caption || cached.width !== width || cached.height !== height ||
        cached.cinema !== cinema || cached.touchButton !== touchButton) {
      const controls = caption.translation && touchButton ? touchButton.getBoundingClientRect() : null;
      const right = controls?.width && width > height ? controls.left - 12 : width;
      const bottom = height - (cinema ? 16 : touchButton ? 106 : 114);
      const y = controls?.width && height >= width ? Math.min(bottom, controls.top - 20) : bottom;
      const available = Math.max(40, right - (caption.translation ? 60 : 92));
      const blocks = [[caption.text, '600 14px ' + (caption.lang === 'ja-JP' ? JAPANESE_FONT : FONT)]];
      if (caption.translation) blocks.push([caption.translation, '600 16px ' + FONT]);
      const rows = [];
      let widest = 0;
      for (const [text, font] of blocks) {
        ctx.font = font;
        let row = '';
        for (const char of text) {
          if (row && ctx.measureText(row + char).width > available) {
            rows.push({ text: row, font });
            widest = Math.max(widest, ctx.measureText(row).width);
            row = '';
          }
          row += char;
        }
        rows.push({ text: row, font });
        widest = Math.max(widest, ctx.measureText(row).width);
      }
      this.subtitleLayout = { caption, width, height, cinema, touchButton, rows, boxWidth: widest + 44, center: right / 2, y };
    }
    const { rows, boxWidth, center } = this.subtitleLayout;
    const lineHeight = caption.translation ? 21 : 19;
    const extra = (rows.length - 1) * lineHeight;
    const y = Math.max(extra + 25, this.subtitleLayout.y);
    const left = center - boxWidth / 2;
    chamferPath(ctx, left, y - 22 - extra, boxWidth, 32 + extra, 5);
    ctx.fillStyle = `rgba(8, 12, 22, ${alpha * 0.86})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(229, 179, 82, ${alpha * 0.62})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = `rgba(229, 179, 82, ${alpha})`;
    ctx.fillRect(left + 8, y - 15 - extra, 3, 18 + extra);
    ctx.fillStyle = `rgba(246, 237, 216, ${alpha})`;
    rows.forEach((row, i) => {
      ctx.font = row.font;
      ctx.fillText(row.text, center + 3, y - 1 - extra + i * lineHeight);
    });
  }

  _drawDojoHud(ctx, d, w, h, hudAlpha) {
    const {
      state, time, player: P, level, camera, input,
      banner, msg, msgT, hitMark, killMark, headMark,
      impactFlash = 0, impactFlashCol = '#ffd860',
      impactLinesT = 0, impactLinesCol = '#ffe89c',
      hitNums = [],
      execTarget, melee, duel, perfStats
    } = d;

    // 0. Screen-Space Kinetic Impact Flash & Wuxia Speed-Lines (Parry / Guard Break / Ultimates)
    if (impactFlash > 0.01) {
      ctx.save();
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, impactFlashCol);
      ctx.globalAlpha = clamp(impactFlash * 0.34, 0, 0.38);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (impactLinesT > 0.01) {
      ctx.save();
      const a = clamp(impactLinesT * 2.8, 0, 0.65);
      ctx.globalAlpha = a;
      ctx.strokeStyle = impactLinesCol;
      const cx0 = w * 0.5;
      const cy0 = h * 0.5;
      const maxR = Math.hypot(w, h) * 0.62;
      const innerR = Math.min(w, h) * 0.30;
      for (let i = 0; i < 28; i++) {
        const ang = (i / 28) * TAU + Math.sin(i * 12.9898) * 0.06;
        const r0 = innerR * (0.85 + ((i * 37) % 10) * 0.045);
        ctx.lineWidth = (i % 3 === 0 ? 2.6 : 1.3);
        ctx.beginPath();
        ctx.moveTo(cx0 + Math.cos(ang) * r0, cy0 + Math.sin(ang) * r0);
        ctx.lineTo(cx0 + Math.cos(ang) * maxR, cy0 + Math.sin(ang) * maxR);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = hudAlpha;
    ctx.textBaseline = 'alphabetic';

    // 1. Top-Left Hero Vital / Stamina / Posture / Blade Qi Plaque (Responsive: Compact on Mobile / Full on Desktop!)
    const prog = d.prog || null;
    const isCampaign = duel.mode === 'campaign';
    const isTouch = !!input?.isTouch;
    const isMobile = isTouch || h < 500 || w < 720;
    const isPortrait = w < 560 && h > w;
    const maxHp = P.maxHp || prog?.maxHp || 100;
    const maxStam = P.maxStamina || prog?.maxStamina || 100;
    const curStam = P.stamina ?? maxStam;
    const hpR = clamp(P.hp / maxHp, 0, 1);
    const stamR = clamp(curStam / maxStam, 0, 1);
    const posR = clamp(duel.playerPosture / duel.maxPlayerPosture, 0, 1);
    const qiR = clamp(duel.qi / duel.maxQi, 0, 1);

    let hudTopLeftMaxX = 0;
    let hudTopLeftMaxY = 0;

    if (isMobile) {
      // Compact Mobile Top-Left HUD (~188 x 76px) — leaves 80% of screen clear for 3D action & left thumb joystick!
      const px = 10;
      const py = 8;
      const pw = Math.min(196, Math.max(166, Math.round(w * 0.24)));
      const ph = 74;
      hudTopLeftMaxX = px + pw + 10;
      hudTopLeftMaxY = py + ph + 10;

      chamferPath(ctx, px, py, pw, ph, 5);
      ctx.fillStyle = 'rgba(8, 13, 24, 0.80)';
      ctx.fill();
      ctx.strokeStyle = melee?.guardCounterT > 0 ? '#ffe278' : 'rgba(217, 164, 65, 0.45)';
      ctx.lineWidth = melee?.guardCounterT > 0 ? 1.6 : 1.0;
      ctx.stroke();

      const bx = px + 8;
      const bw = pw - 16;

      // HP bar
      ctx.fillStyle = 'rgba(22, 28, 42, 0.90)';
      ctx.fillRect(bx, py + 7, bw, 11);
      ctx.fillStyle = hpR > 0.30 || Math.floor(time * 6) % 2 === 0 ? '#d8382c' : '#ff6b57';
      ctx.fillRect(bx + 1, py + 8, Math.max(0, (bw - 2) * hpR), 9);
      ctx.font = '700 9.5px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('命', bx + 4, py + 16);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(P.hp)}/${maxHp}`, bx + bw - 4, py + 16);

      // Stamina bar
      ctx.fillStyle = 'rgba(18, 30, 26, 0.90)';
      ctx.fillRect(bx, py + 21, bw, 9);
      ctx.fillStyle = stamR < 0.18 ? '#e88e38' : '#3ad278';
      ctx.fillRect(bx + 1, py + 22, Math.max(0, (bw - 2) * stamR), 7);
      ctx.font = '700 8.5px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('精', bx + 4, py + 28.5);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.floor(curStam)}`, bx + bw - 4, py + 28.5);

      // Qi bar
      ctx.fillStyle = 'rgba(18, 28, 44, 0.90)';
      ctx.fillRect(bx, py + 33, bw, 9);
      ctx.fillStyle = qiR >= 0.55 ? '#ffd86a' : '#56c2e6';
      ctx.fillRect(bx + 1, py + 34, Math.max(0, (bw - 2) * qiR), 7);
      ctx.font = '700 8.5px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('气', bx + 4, py + 40.5);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.floor(duel.qi)}`, bx + bw - 4, py + 40.5);

      // Slim player posture line
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(bx, py + 45, bw, 3);
      if (posR > 0.01) {
        ctx.fillStyle = posR > 0.72 ? '#ff6a42' : '#e5b352';
        ctx.fillRect(bx, py + 45, bw * posR, 3);
      }

      // Compact 1-line Objective / Status row
      ctx.textAlign = 'left';
      ctx.font = '700 10px ' + FONT;
      if (isCampaign) {
        const br = level.bossRoom;
        const bossDead = !!(level.boss && level.boss.hp <= 0);
        const distGate = br ? Math.max(0, Math.round(Math.hypot(br.gateX - P.x, br.gateZ - P.z))) : 0;
        ctx.fillStyle = br?.entered ? '#ff8470' : '#f2e4c4';
        const line = bossDead
          ? '★ 霸王伏诛 · 肃清！'
          : br?.entered
            ? '◆ 封闭战：霸王黑龙'
            : `距Boss ${distGate}m · ${d.kills || 0}/${level.totalEnemies || 0}`;
        ctx.fillText(line, bx, py + 65);
      } else {
        ctx.fillStyle = '#e5b352';
        ctx.fillText(`弹反 ${duel.parryCount} · 拼刀 ${duel.clashCount}`, bx, py + 65);
      }
    } else {
      const px = 16;
      const py = 16;
      const hpExtraW = Math.min(110, Math.max(0, (maxHp - 100) * 0.42));
      const stamExtraW = Math.min(96, Math.max(0, (maxStam - 100) * 0.54));
      const pw = Math.round(268 + Math.max(hpExtraW, stamExtraW));
      const ph = 114;
      hudTopLeftMaxX = px + pw + 16;
      hudTopLeftMaxY = py + ph + 72;

      chamferPath(ctx, px, py, pw, ph, 6);
      ctx.fillStyle = 'rgba(8, 13, 24, 0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.48)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      drawCornerTicks(ctx, px + 2, py + 2, pw - 4, ph - 4, 6);

      const bx = px + 12;
      const bw = pw - 24;
      const hpBarW = Math.round(244 + hpExtraW);
      const stamBarW = Math.round(244 + stamExtraW);

      // HP bar (scales wider with Vigor upgrades!)
      ctx.fillStyle = 'rgba(22, 28, 42, 0.92)';
      ctx.fillRect(bx, py + 11, hpBarW, 16);
      const hpG = ctx.createLinearGradient(bx, 0, bx + hpBarW, 0);
      if (hpR > 0.30 || Math.floor(time * 6) % 2 === 0) {
        hpG.addColorStop(0, '#961d16');
        hpG.addColorStop(1, '#e04234');
      } else {
        hpG.addColorStop(0, '#d93829');
        hpG.addColorStop(1, '#ff6b57');
      }
      ctx.fillStyle = hpG;
      ctx.fillRect(bx + 1, py + 12, Math.max(0, (hpBarW - 2) * hpR), 14);
      ctx.font = '700 11px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('生 命', bx + 6, py + 23);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(P.hp)} / ${maxHp}`, bx + hpBarW - 6, py + 23);

      // Stamina bar (Emerald Green Souls-like Endurance bar!)
      ctx.fillStyle = 'rgba(18, 30, 26, 0.92)';
      ctx.fillRect(bx, py + 32, stamBarW, 13);
      const stG = ctx.createLinearGradient(bx, 0, bx + stamBarW, 0);
      stG.addColorStop(0, stamR < 0.18 ? '#8c5218' : '#1f8a4c');
      stG.addColorStop(1, stamR < 0.18 ? '#e88e38' : '#4ee088');
      ctx.fillStyle = stG;
      ctx.fillRect(bx + 1, py + 33, Math.max(0, (stamBarW - 2) * stamR), 11);
      ctx.font = '700 10px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('精 力', bx + 6, py + 42);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.floor(curStam)} / ${maxStam}`, bx + stamBarW - 6, py + 42);

      // Player Posture bar (guard stability)
      ctx.fillStyle = 'rgba(22, 28, 42, 0.92)';
      ctx.fillRect(bx, py + 51, bw, 12);
      const posG = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      posG.addColorStop(0, posR > 0.72 ? '#d94824' : '#9c6e21');
      posG.addColorStop(1, posR > 0.72 ? '#ff7c48' : '#ebb858');
      ctx.fillStyle = posG;
      ctx.fillRect(bx + 1, py + 52, Math.max(0, (bw - 2) * posR), 10);
      ctx.font = '700 9.5px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText(duel.playerBrokenT > 0 ? '架 势 溃 散！' : '架 势 韧 性', bx + 6, py + 60.5);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(posR * 100)}%`, bx + bw - 6, py + 60.5);

      // Blade Qi bar (fuels the 3 cold-weapon ultimates)
      ctx.fillStyle = 'rgba(18, 28, 44, 0.92)';
      ctx.fillRect(bx, py + 69, bw, 14);
      const qiG = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      qiG.addColorStop(0, '#2a7298');
      qiG.addColorStop(0.55, '#5cc8e8');
      qiG.addColorStop(1, '#ffe28a');
      ctx.fillStyle = qiG;
      ctx.fillRect(bx + 1, py + 70, Math.max(0, (bw - 2) * qiR), 12);
      ctx.fillStyle = 'rgba(8, 12, 22, 0.55)';
      for (const mark of [0.35, 0.45, 0.55]) {
        ctx.fillRect(bx + bw * mark, py + 70, 1.5, 12);
      }
      ctx.font = '700 10px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.textAlign = 'left';
      ctx.fillText('刀 气（释放大招）', bx + 6, py + 80);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.floor(duel.qi)} / 100`, bx + bw - 6, py + 80);

      // Combat telemetry row + Flask indicator
      ctx.font = '600 11px ' + FONT;
      ctx.fillStyle = '#d4c8ae';
      ctx.textAlign = 'left';
      ctx.fillText(`完美弹反 ${duel.parryCount}  ·  拼刀 ${duel.clashCount}`, bx, py + 102);
      if (duel.comboHits >= 2) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd860';
        ctx.font = '700 12px ' + FONT;
        ctx.fillText(`${duel.comboHits} 连斩`, bx + bw, py + 102);
      } else if (isCampaign) {
        ctx.textAlign = 'right';
        ctx.fillStyle = (P.flasks || 0) > 0 ? '#ff8b78' : '#7b746a';
        ctx.font = '700 11px ' + FONT;
        ctx.fillText(`[Q] 金疮药 ×${P.flasks ?? 4}/${P.maxFlasks ?? 4}`, bx + bw, py + 102);
      }

      // Mode / Campaign Objective ribbon below vitals
      const my = py + ph + 8;
      const ribbonW = Math.max(268, pw);
      chamferPath(ctx, px, my, ribbonW, isCampaign ? 54 : 42, 5);
      ctx.fillStyle = 'rgba(8, 13, 24, 0.78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.30)';
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = '700 11.5px ' + FONT;
      ctx.fillStyle = '#e5b352';
      ctx.fillText(level.cfg?.name || '雨夜冷兵器演武场', px + 10, my + 17);
      if (isCampaign) {
        const br = level.bossRoom;
        const bossDead = !!(level.boss && level.boss.hp <= 0);
        const distGate = br ? Math.max(0, Math.round(Math.hypot(br.gateX - P.x, br.gateZ - P.z))) : 0;
        const objStr = bossDead
          ? '★ 霸王黑龙已伏诛 · 石库门肃清！'
          : br?.entered
            ? '◆ 封闭死斗场：斩杀「霸王 · 黑 龙」'
            : `◆ 推街斩敌至北口雾门（距 Boss 房 ${distGate}m）`;
        ctx.font = '700 11.5px ' + FONT;
        ctx.fillStyle = br?.entered ? '#ff8470' : '#f4ebd8';
        ctx.fillText(objStr, px + 10, my + 34);
        ctx.font = '600 10.5px ' + FONT;
        ctx.fillStyle = '#b9b2a2';
        ctx.fillText(`歼敌 ${d.kills || 0}/${level.totalEnemies || 0}  ·  [U] 积分强化  ·  [Q] 金疮药`, px + 10, my + 48);
      } else {
        ctx.font = '600 10.5px ' + FONT;
        ctx.fillStyle = '#b9b2a2';
        ctx.fillText('[F1] 枪 · [F2] 枪斧 · [F3] 霸王 · [F4] 三兵 · [R] 重置', px + 10, my + 34);
      }
    }

    // 1B. Top-Right Points Counter (战功积分) & Campaign Tactical Radar
    let hudTopRightMinX = w;
    let hudTopRightMaxY = 0;
    if (prog || isCampaign) {
      const pts = prog ? prog.points : (d.score || 0);
      const canUp = !!prog?.hasAnyAffordable?.();
      const rx = isTouch ? w - 118 : w - 16;
      const badgeW = isMobile ? 90 : 192;
      const badgeH = isMobile ? 32 : 52;
      const badgeX = rx - badgeW;
      const badgeY = isMobile ? 8 : 16;
      hudTopRightMinX = badgeX - 10;
      hudTopRightMaxY = badgeY + badgeH + 10;

      chamferPath(ctx, badgeX, badgeY, badgeW, badgeH, 5);
      ctx.fillStyle = canUp ? 'rgba(32, 24, 12, 0.88)' : 'rgba(8, 13, 24, 0.82)';
      ctx.fill();
      ctx.strokeStyle = canUp ? '#ffd872' : 'rgba(217, 164, 65, 0.48)';
      ctx.lineWidth = canUp ? 1.6 : 1.1;
      ctx.stroke();

      if (isMobile) {
        ctx.textAlign = 'left';
        ctx.font = '700 10px ' + FONT;
        ctx.fillStyle = '#e5b352';
        ctx.fillText('积分', badgeX + 8, badgeY + 20);
        ctx.textAlign = 'right';
        ctx.font = '800 16px ' + FONT;
        ctx.fillStyle = '#fff0c0';
        ctx.fillText(`${pts}`, badgeX + badgeW - 8, badgeY + 22);
      } else {
        ctx.textAlign = 'left';
        ctx.font = '700 10.5px ' + FONT;
        ctx.fillStyle = '#e5b352';
        ctx.fillText('战功积分', badgeX + 12, badgeY + 18);
        ctx.textAlign = 'right';
        ctx.font = '800 22px ' + FONT;
        ctx.fillStyle = '#fff0c0';
        ctx.fillText(`${pts}`, badgeX + badgeW - 12, badgeY + 26);
        ctx.textAlign = 'left';
        ctx.font = '600 10.5px ' + FONT;
        ctx.fillStyle = canUp ? '#ffe278' : '#b2a896';
        ctx.fillText(canUp ? '★ 可升级！按 [U] 打开强化台' : `总阶 Lv.${prog?.totalLevel || 1} · 按 [U] 强化`, badgeX + 12, badgeY + 43);
      }

      // Tactical Radar: tucked cleanly in top-right corner on mobile (y=48..108, well above right-thumb combat arc!)
      if (isCampaign && w >= 480) {
        const R = isMobile ? 30 : 58;
        const rcx = isTouch ? w - 12 - R : rx - R;
        const rcy = badgeY + badgeH + (isMobile ? 8 : 12) + R;
        hudTopRightMinX = Math.min(hudTopRightMinX, rcx - R - 8);
        hudTopRightMaxY = Math.max(hudTopRightMaxY, rcy + R + 8);
        const rangeM = 46;
        const cs = Math.cos(P.ang);
        const sn = Math.sin(P.ang);
        ctx.save();
        ctx.beginPath();
        ctx.arc(rcx, rcy, R, 0, TAU);
        ctx.fillStyle = 'rgba(8, 14, 26, 0.80)';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = 'rgba(229, 179, 82, 0.07)';
        ctx.beginPath();
        ctx.moveTo(rcx, rcy);
        ctx.arc(rcx, rcy, R, -Math.PI / 2 - 0.46, -Math.PI / 2 + 0.46);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(112, 140, 178, 0.42)';
        for (const r of level.rects || []) {
          const rbx = (r.x + r.w * 0.5) * TILE - P.x;
          const rbz = (r.y + r.h * 0.5) * TILE - P.z;
          if (Math.abs(rbx) > rangeM + r.w * TILE || Math.abs(rbz) > rangeM + r.h * TILE) continue;
          const f = rbx * cs + rbz * sn;
          const right = -rbx * sn + rbz * cs;
          const bpx = rcx + (right / rangeM) * R;
          const bpy = rcy - (f / rangeM) * R;
          ctx.save();
          ctx.translate(bpx, bpy);
          ctx.rotate(P.ang + Math.PI / 2);
          ctx.fillRect(-((r.w * TILE) / rangeM) * R * 0.5, -((r.h * TILE) / rangeM) * R * 0.5, ((r.w * TILE) / rangeM) * R, ((r.h * TILE) / rangeM) * R);
          ctx.restore();
        }
        const rDot = (x, z, col, sz) => {
          const dx = x - P.x;
          const dz = z - P.z;
          const f = dx * cs + dz * sn;
          const right = -dx * sn + dz * cs;
          let dpx = (right / rangeM) * R;
          let dpy = (-f / rangeM) * R;
          const l = Math.hypot(dpx, dpy);
          if (l > R - 4) { dpx *= (R - 4) / l; dpy *= (R - 4) / l; }
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(rcx + dpx, rcy + dpy, isMobile ? sz * 0.78 : sz, 0, TAU);
          ctx.fill();
        };
        for (const sh of level.shrines || []) rDot(sh.x, sh.z, '#ffd860', 3.6);
        for (const sc of level.soulCaches || []) if (!sc.claimed) rDot(sc.x, sc.z, '#78f0ff', 3.4);
        if (level.bossRoom && !level.bossRoom.cleared) {
          rDot(level.bossRoom.gateX, level.bossRoom.gateZ, '#ff4838', 4.6);
        }
        for (const e of level.enemies) {
          if (e.hp <= 0) continue;
          if (e.type === 'boss') {
            if (level.bossRoom?.entered) rDot(e.x, e.z, '#e07aff', 4.6);
          } else if (e.awake || Math.hypot(e.x - P.x, e.z - P.z) < 28) {
            rDot(e.x, e.z, '#ff5040', 3.0);
          }
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(229, 179, 82, 0.72)';
        ctx.lineWidth = isMobile ? 1.2 : 1.5;
        ctx.beginPath();
        ctx.arc(rcx, rcy, R, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = '#f5ebd6';
        ctx.beginPath();
        ctx.moveTo(rcx, rcy - 4);
        ctx.lineTo(rcx - 3.2, rcy + 3.2);
        ctx.lineTo(rcx, rcy + 1.6);
        ctx.lineTo(rcx + 3.2, rcy + 3.2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 2. Top-Center Locked Target / Duelist Health + Posture Bar (Compact & collision-free on Mobile!)
    const focusTarget = (duel.lockTarget && duel.lockTarget.hp > 0 && !duel.lockTarget.bossDormant)
      ? duel.lockTarget
      : isCampaign
        ? level.enemies.find(e => e.hp > 0 && !e.bossDormant && e.awake && Math.hypot(e.x - P.x, e.z - P.z) < 24)
        : level.enemies.find(e => e.hp > 0);
    if (focusTarget && focusTarget.duel && w >= 340) {
      const fd = focusTarget.duel;
      const isBoss = focusTarget.type === 'boss';
      const maxFreeW = isPortrait ? w - 44 : Math.max(156, (hudTopRightMinX - hudTopLeftMaxX) - 24);
      const bw2 = isMobile
        ? Math.min(isBoss ? 250 : 215, maxFreeW)
        : isBoss ? Math.min(488, w * 0.46) : Math.min(410, w * 0.38);
      const bx2 = isPortrait ? (w - bw2) * 0.5 : (isMobile ? (hudTopLeftMaxX + hudTopRightMinX - bw2) * 0.5 : (w - bw2) * 0.5);
      const by2 = isPortrait ? 90 : (isMobile ? 8 : 18);
      const boxH = isMobile ? 46 : 64;
      const padX = isMobile ? 8 : 14;
      chamferPath(ctx, bx2 - padX, by2, bw2 + padX * 2, boxH, 5);
      ctx.fillStyle = 'rgba(8, 13, 24, 0.84)';
      ctx.fill();
      ctx.strokeStyle = fd.state === 'broken' ? '#ffd860' : fd.peril || fd.state === 'bossUlt' || fd.phase === 2 ? '#ff4a38' : 'rgba(217, 164, 65, 0.50)';
      ctx.lineWidth = fd.state === 'broken' || fd.peril || fd.state === 'bossUlt' ? 1.8 : 1.1;
      ctx.stroke();

      const weapTitle = MELEE_WEAPONS[fd.weaponKind]?.name || '';
      ctx.textAlign = 'left';
      ctx.font = (isMobile ? '700 10.5px ' : '700 13px ') + FONT;
      ctx.fillStyle = fd.phase === 2 ? '#ff9678' : '#f6ecd8';
      const titleStr = isMobile
        ? `${fd.name}${fd.phase === 2 ? '[狂]' : ''}`
        : `${fd.name}${weapTitle ? ` · ${weapTitle}` : ''}${fd.phase === 2 ? ' [狂化]' : ''}`;
      ctx.fillText(titleStr, bx2, by2 + (isMobile ? 14 : 19));

      // Crimson Sekiro Deathblow Seal Orbs for multi-seal Bosses (3 seals on 2000 HP Boss!)
      const maxSeals = isBoss ? 3 : 1;
      const hpBasedSeals = focusTarget.hp > 1100 ? 3 : focusTarget.hp > 550 ? 2 : 1;
      const remSeals = isBoss ? Math.min(hpBasedSeals, Math.max(1, fd.deathblows || 3)) : 1;
      if (isBoss) {
        const orbR = isMobile ? 3.8 : 5.0;
        const orbGap = isMobile ? 11 : 15;
        const orbBaseX = isMobile ? bx2 + bw2 * 0.52 : bx2 + bw2 * 0.58;
        for (let sIdx = 0; sIdx < maxSeals; sIdx++) {
          const ox = orbBaseX + sIdx * orbGap;
          const oy = by2 + (isMobile ? 11 : 14);
          ctx.beginPath();
          ctx.arc(ox, oy, orbR, 0, TAU);
          ctx.fillStyle = sIdx < remSeals ? '#e03024' : 'rgba(60, 68, 84, 0.7)';
          ctx.fill();
          ctx.strokeStyle = sIdx < remSeals ? '#ffd878' : 'rgba(140, 148, 166, 0.4)';
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
      }

      const activeBossUlt = fd.state === 'bossUlt' && fd.ultKind ? BOSS_ULTIMATES[fd.ultKind] : null;
      ctx.textAlign = 'right';
      ctx.font = (isMobile ? '700 9.5px ' : '700 11px ') + FONT;
      ctx.fillStyle = fd.state === 'broken' ? '#ffd860' : fd.peril || activeBossUlt?.peril ? '#ff5846' : activeBossUlt ? '#ffe078' : '#c8bca6';
      ctx.fillText(
        fd.state === 'broken'
          ? (isTouch ? '★ 破防！点绝杀' : '★ 破防！贴近按 [E] 绝杀')
          : activeBossUlt
            ? (activeBossUlt.peril ? `危！${activeBossUlt.name}` : `★ ${activeBossUlt.name}`)
            : fd.peril
              ? '危！翻滚躲避'
              : `${Math.ceil(focusTarget.hp)}/${focusTarget.max}`,
        bx2 + bw2,
        by2 + (isMobile ? 14 : 19)
      );

      // Enemy HP bar with delayed white-amber damage drain trail
      const hpFrac = clamp(focusTarget.hp / focusTarget.max, 0, 1);
      const trailFrac = clamp((fd.displayHp ?? focusTarget.hp) / focusTarget.max, hpFrac, 1);
      const barY = by2 + (isMobile ? 20 : 27);
      const barH = isMobile ? 9 : 13;
      ctx.fillStyle = 'rgba(24, 28, 40, 0.94)';
      ctx.fillRect(bx2, barY, bw2, barH);
      if (trailFrac > hpFrac + 0.002) {
        ctx.fillStyle = '#ffe090';
        ctx.fillRect(bx2 + 1, barY + 1, (bw2 - 2) * trailFrac, barH - 2);
      }
      const bGrad = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
      bGrad.addColorStop(0, fd.phase === 2 ? '#a81814' : '#961e18');
      bGrad.addColorStop(1, fd.phase === 2 ? '#ff4430' : '#d8382a');
      ctx.fillStyle = bGrad;
      ctx.fillRect(bx2 + 1, barY + 1, (bw2 - 2) * hpFrac, barH - 2);
      if (isBoss) {
        ctx.fillStyle = 'rgba(255, 224, 148, 0.72)';
        ctx.fillRect(bx2 + bw2 * 0.55, barY, 1.5, barH);
      }

      // Enemy Posture bar (fills from center outward like Sekiro!)
      const ePosR = clamp(fd.posture / fd.maxPosture, 0, 1);
      const pBarY = by2 + (isMobile ? 33 : 46);
      const pBarH = isMobile ? 5 : 7;
      ctx.fillStyle = 'rgba(24, 28, 40, 0.92)';
      ctx.fillRect(bx2, pBarY, bw2, pBarH);
      const fillW = (bw2 - 2) * ePosR;
      ctx.fillStyle = fd.state === 'broken' ? '#ffe468' : ePosR > 0.72 ? '#ff8438' : '#e5b352';
      ctx.fillRect(bx2 + bw2 * 0.5 - fillW * 0.5, pBarY + 1, fillW, pBarH - 2);
    }

    // 3. 3D World Markers: Lock-On Diamond, Crimson 危 Peril Warning, Golden Guard-Break Prompt
    if (state === 'play') {
      for (const e of level.enemies) {
        if (e.hp <= 0 || !e.duel || e.bossDormant) continue;
        if (isCampaign && !e.awake && Math.hypot(e.x - P.x, e.z - P.z) > 22) continue;
        const ed = e.duel;
        const jy = ed.jumpY || 0;
        // Chest Lock-On diamond (tracks airborne leaps & backflips cleanly!)
        if (e === duel.lockTarget) {
          _tmpV.set(e.x, jy + e.ht * 0.62, e.z).project(camera);
          if (_tmpV.z < 1) {
            const lx = (_tmpV.x * 0.5 + 0.5) * w;
            const ly = (-_tmpV.y * 0.5 + 0.5) * h;
            ctx.save();
            ctx.translate(lx, ly);
            ctx.strokeStyle = ed.state === 'broken' ? '#ffe066' : 'rgba(248, 232, 192, 0.92)';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(0, -10); ctx.lineTo(10, 0); ctx.lineTo(0, 10); ctx.lineTo(-10, 0); ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = ed.state === 'broken' ? '#ff4a38' : '#ffd860';
            ctx.beginPath();
            ctx.arc(0, 0, 2.8, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
        }
        // Overhead Peril 危 or Guard-Break indicator
        _tmpV.set(e.x, jy + e.ht + 0.45, e.z).project(camera);
        if (_tmpV.z < 1) {
          const sx = (_tmpV.x * 0.5 + 0.5) * w;
          const sy = (-_tmpV.y * 0.5 + 0.5) * h;
          const inHudCorner =
            (sy < hudTopLeftMaxY && sx < hudTopLeftMaxX) ||
            (sy < hudTopRightMaxY && sx > hudTopRightMinX);
          if (ed.peril) {
            const pulse = 1 + Math.sin(time * 28) * 0.12;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.scale(pulse, pulse);
            ctx.textAlign = 'center';
            ctx.font = (isMobile ? '400 34px ' : '400 44px ') + DISPLAY_FONT;
            ctx.fillStyle = '#ff2a1e';
            ctx.shadowColor = 'rgba(255, 36, 20, 0.95)';
            ctx.shadowBlur = 18;
            ctx.fillText('危', 0, 8);
            ctx.restore();
          } else if (ed.state === 'broken') {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.font = '700 13px ' + FONT;
            ctx.fillStyle = '#ffe078';
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 8;
            ctx.fillText(isTouch ? '★ 破防 · 点击绝杀' : '★ 破防 · 按 [E] 一刀绝杀', sx, sy);
            ctx.restore();
          } else if (e !== focusTarget && !inHudCorner) {
            const mbw = isMobile ? 44 : 56;
            ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
            ctx.fillRect(sx - mbw / 2, sy - 6, mbw, 5);
            ctx.fillStyle = '#d63628';
            ctx.fillRect(sx - mbw / 2, sy - 6, mbw * clamp(e.hp / e.max, 0, 1), 5);
            ctx.fillStyle = '#e5b352';
            ctx.fillRect(sx - mbw / 2, sy, mbw * clamp(ed.posture / ed.maxPosture, 0, 1), 3);
          }
        }
      }
      // Floating 3D-projected damage numbers, Parry & Guard Break popups
      for (const hn of hitNums) {
        _tmpV.set(hn.x, hn.y, hn.z).project(camera);
        if (_tmpV.z > 1) continue;
        const hx = (_tmpV.x * 0.5 + 0.5) * w;
        const hy = (-_tmpV.y * 0.5 + 0.5) * h;
        const p = clamp(hn.t / hn.dur, 0, 1);
        const pop = p < 0.14 ? 0.65 + (p / 0.14) * 0.55 : 1.2 - Math.min(0.24, (p - 0.14) * 0.6);
        const alpha = p > 0.62 ? clamp(1 - (p - 0.62) / 0.38, 0, 1) : 1;
        ctx.save();
        ctx.globalAlpha = hudAlpha * alpha;
        ctx.translate(hx, hy);
        ctx.scale(pop * hn.scale, pop * hn.scale);
        ctx.textAlign = 'center';
        ctx.font = (isMobile ? '800 15px ' : '800 18px ') + FONT;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(6, 9, 16, 0.92)';
        ctx.strokeText(hn.text, 0, 0);
        ctx.fillStyle = hn.col || '#fff2d0';
        ctx.fillText(hn.text, 0, 0);
        ctx.restore();
      }
    }

    // 4 & 5. Desktop Bottom Plaques vs Mobile Virtual Joystick Indicator
    if (isTouch) {
      // Sleek Art-Deco Virtual Joystick in Bottom-Left Zone (zero overlap with buttons or HUD!)
      const st = input?.sticks?.move;
      const baseR = 46;
      const jx = st ? st.ox : Math.max(66, Math.min(96, w * 0.11));
      const jy = st ? st.oy : h - Math.max(66, Math.min(86, h * 0.19));
      ctx.save();
      ctx.beginPath();
      ctx.arc(jx, jy, baseR, 0, TAU);
      ctx.fillStyle = st ? 'rgba(10, 16, 28, 0.42)' : 'rgba(10, 16, 28, 0.18)';
      ctx.fill();
      ctx.strokeStyle = st ? 'rgba(235, 192, 102, 0.68)' : 'rgba(235, 224, 200, 0.22)';
      ctx.lineWidth = st ? 1.8 : 1.2;
      ctx.stroke();
      const mag = st ? Math.hypot(st.dx, st.dy) : 0;
      const kx = jx + (st ? st.dx * baseR : 0);
      const ky = jy + (st ? st.dy * baseR : 0);
      ctx.beginPath();
      ctx.arc(kx, ky, st ? 18 : 14, 0, TAU);
      ctx.fillStyle = mag > 0.72
        ? 'rgba(255, 214, 108, 0.72)'
        : st
          ? 'rgba(244, 232, 206, 0.56)'
          : 'rgba(244, 232, 206, 0.18)';
      ctx.fill();
      ctx.strokeStyle = st ? '#ffe494' : 'rgba(244, 232, 206, 0.28)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    } else {
      // 4. Bottom-Left Blade Stance Plaque (Desktop only)
      const blX = 16;
      const blY = h - 16 - 72;
      const wCardW = 248;
      const wCardH = 72;
      chamferPath(ctx, blX, blY, wCardW, wCardH, 6);
      ctx.fillStyle = 'rgba(8, 13, 24, 0.84)';
      ctx.fill();
      ctx.strokeStyle = melee?.guardCounterT > 0 ? '#ffe278' : melee?.isGuarding ? '#78e0ff' : 'rgba(217, 164, 65, 0.52)';
      ctx.lineWidth = melee?.guardCounterT > 0 || melee?.isGuarding ? 1.8 : 1.2;
      ctx.stroke();
      drawCornerTicks(ctx, blX + 2, blY + 2, wCardW - 4, wCardH - 4, 5);
      ctx.textAlign = 'left';
      ctx.font = '700 14px ' + FONT;
      ctx.fillStyle = '#f5ebd6';
      ctx.fillText(prog?.weaponTitle || '二十九军式 · 精钢大刀', blX + 12, blY + 23);
      if (prog && prog.levels.weapon > 1) {
        ctx.textAlign = 'right';
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = '#ffd868';
        ctx.fillText(`攻×${prog.weaponDmgMult.toFixed(2)}`, blX + wCardW - 12, blY + 23);
        ctx.textAlign = 'left';
      }

      const moveLabel = {
        slashA: '斜劈连斩', slashB: '横扫连斩', chop: '力劈重斩', spin: '回旋斩',
        guardCounter: '★ 黄金·防御反击斩',
        iaido: '★ 瞬步·居合一闪', cleave: '★ 破军·力劈华山', whirlwind: '★ 孤鸿·旋风乱舞'
      };
      const stTxt = melee?.guardCounterT > 0
        ? '★ 防御反击就绪！立刻按 [左键]'
        : melee?.parryWindowT > 0
          ? '⚡ 完美弹反判定窗！'
          : melee?.isGuarding
            ? '架刀格挡中（挡下后按左键防反）'
            : moveLabel[melee?.atk?.name] || '左键 连斩 · 右键 格挡/防反';
      ctx.font = '600 11px ' + FONT;
      ctx.fillStyle = melee?.guardCounterT > 0 || melee?.parryWindowT > 0 ? '#ffe078' : melee?.isGuarding ? '#8ce8ff' : '#c4bba8';
      ctx.fillText(stTxt, blX + 12, blY + 41);

      const doneCombo = melee?.comboT > 0 ? melee.combo || 3 : 0;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < doneCombo ? '#e5b352' : 'rgba(255,255,255,0.12)';
        ctx.fillRect(blX + 12 + i * 36, blY + 55, 32, 5);
      }
      ctx.textAlign = 'right';
      ctx.font = '700 16px ' + DISPLAY_FONT;
      ctx.fillStyle = '#e8b654';
      ctx.fillText(duel.lockTarget ? '锁 敌' : '自 由', blX + wCardW - 12, blY + 60);

      // 5. Bottom-Right 3 Cold-Weapon Ultimate Skill Cards (Desktop only — Touch uses tappable DOM .t-ult pills!)
      const ults = [ULTIMATES.iaido, ULTIMATES.cleave, ULTIMATES.whirlwind];
      const cardW = w >= 860 ? 156 : 112;
      const cardH = 66;
      const gap = 8;
      const dockW = ults.length * cardW + (ults.length - 1) * gap;
      const dockX0 = w - 16 - dockW;
      const dockY = h - 16 - cardH;

      if (w >= 760) {
        ctx.textAlign = 'right';
        ctx.font = '600 11px ' + FONT;
        ctx.fillStyle = 'rgba(224, 214, 194, 0.78)';
        ctx.fillText(
          isCampaign
            ? '[左键] 连斩 · [右键] 弹反/格挡 · [WASD+空格/Shift] 翻滚 · [Q] 金疮药 · [U] 升级强化 · [E] 互动/绝杀 · [Tab] 锁敌'
            : '[左键] 连斩 · [右键] 格挡/弹反 · [WASD+空格/Shift] 八向翻滚 · [双击A/D] 左右滚 · [E] 绝杀 · [Tab] 锁敌',
          w - 16,
          dockY - 10
        );
      }

      ults.forEach((u, i) => {
        const cd = duel.getCooldown ? duel.getCooldown(u.id) : (duel.cooldowns?.[u.id] || 0);
        const cdMax = duel.getMaxCooldown ? duel.getMaxCooldown(u.id) : (u.cd || 12);
        const onCd = cd > 0.01;
        const ready = !onCd && duel.qi >= u.cost && duel.playerBrokenT <= 0;
        const casting = melee?.atk?.name === u.id;
        const sx = dockX0 + i * (cardW + gap);
        const sy = casting ? dockY - 5 : dockY;

        chamferPath(ctx, sx, sy, cardW, cardH, 5);
        ctx.fillStyle = casting
          ? 'rgba(54, 38, 18, 0.94)'
          : ready
            ? 'rgba(18, 26, 42, 0.90)'
            : 'rgba(9, 13, 22, 0.80)';
        ctx.fill();

        if (onCd) {
          const cdFrac = clamp(cd / cdMax, 0, 1);
          ctx.save();
          chamferPath(ctx, sx, sy, cardW, cardH, 5);
          ctx.clip();
          ctx.fillStyle = 'rgba(4, 7, 14, 0.68)';
          ctx.fillRect(sx, sy + cardH * (1 - cdFrac), cardW, cardH * cdFrac);
          ctx.fillStyle = 'rgba(229, 179, 82, 0.45)';
          ctx.fillRect(sx, sy + cardH * (1 - cdFrac), cardW, 1.5);
          ctx.restore();
        }

        ctx.strokeStyle = casting ? '#ffe284' : ready ? 'rgba(229, 179, 82, 0.82)' : onCd ? 'rgba(217, 128, 65, 0.35)' : 'rgba(130, 140, 160, 0.26)';
        ctx.lineWidth = casting ? 2 : ready ? 1.4 : 1;
        chamferPath(ctx, sx, sy, cardW, cardH, 5);
        ctx.stroke();

        if (ready) {
          ctx.fillStyle = '#ebb858';
          ctx.fillRect(sx + 8, sy + 1, cardW - 16, 2.5);
        }

        ctx.textAlign = 'left';
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = ready ? '#ffd87d' : '#7d8290';
        ctx.fillText(`[${u.key}]`, sx + 9, sy + 17);

        ctx.textAlign = 'right';
        ctx.font = '700 10.5px ' + FONT;
        ctx.fillStyle = onCd ? '#ff9d64' : ready ? '#7ce2ff' : '#6d7584';
        ctx.fillText(onCd ? `冷却 ${cd.toFixed(1)}s` : `${u.cost} 刀气 · ${cdMax % 1 === 0 ? cdMax : cdMax.toFixed(1)}s`, sx + cardW - 9, sy + 17);

        ctx.textAlign = 'left';
        ctx.font = '700 13px ' + FONT;
        ctx.fillStyle = ready ? '#faf1de' : onCd ? 'rgba(190, 184, 172, 0.52)' : '#858a96';
        ctx.fillText(cardW >= 140 ? u.name : u.name.split('·')[1] || u.name, sx + 9, sy + 39);

        if (onCd) {
          ctx.textAlign = 'right';
          ctx.font = '800 16px ' + FONT;
          ctx.fillStyle = '#ffd294';
          ctx.fillText(`${Math.ceil(cd)}s`, sx + cardW - 10, sy + 41);
        }

        const frac = onCd ? clamp(1 - cd / cdMax, 0, 1) : clamp(duel.qi / u.cost, 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(sx + 9, sy + cardH - 11, cardW - 18, 4);
        ctx.fillStyle = onCd ? '#d47c3c' : ready ? '#ffd860' : '#4694b8';
        ctx.fillRect(sx + 9, sy + cardH - 11, (cardW - 18) * frac, 4);
      });
    }

    // 6. Center Combat Callouts (Responsive font size for Mobile Landscape!)
    if (duel.calloutT > 0 && duel.callout) {
      const a = clamp(duel.calloutT * 1.6, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = (isMobile ? '400 24px ' : '400 38px ') + DISPLAY_FONT;
      ctx.fillStyle = duel.calloutCol || '#ffd860';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
      ctx.shadowBlur = 14;
      ctx.fillText(duel.callout, w * 0.5, h * (isMobile ? 0.27 : 0.30));
      ctx.restore();
    }

    if (banner > 0) {
      const a = clamp(banner, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = (isMobile ? '400 26px ' : '400 40px ') + DISPLAY_FONT;
      ctx.fillStyle = '#f4ebd8';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 16;
      ctx.fillText(level.cfg?.name || '雨夜冷兵器演武场', w * 0.5, h * (isMobile ? 0.20 : 0.21));
      if (!isMobile || w >= 520) {
        ctx.font = (isMobile ? '600 10.5px ' : '600 13px ') + FONT;
        ctx.fillStyle = '#e5b352';
        ctx.fillText(`◆ ${level.cfg?.intro || ''} ◆`, w * 0.5, h * (isMobile ? 0.26 : 0.25));
      }
      ctx.restore();
    }

    // Center Interactive Prompt Pill (Deathblow / Crimson Boss Fog Gate / Shrine)
    const promptObj = execTarget && state === 'play'
      ? { text: isTouch ? '★ 破防绝杀 · 点击右侧 [绝杀]' : '[E] 破防绝杀', col: '#ffe078', border: 'rgba(255, 224, 120, 0.85)' }
      : d.worldPrompt && state === 'play'
        ? { ...d.worldPrompt, text: isTouch ? d.worldPrompt.text.replace('[E] ', '点击右侧按钮 · ') : d.worldPrompt.text }
        : null;
    if (promptObj) {
      ctx.save();
      ctx.font = (isMobile ? '700 12.5px ' : '700 15px ') + FONT;
      const tw = Math.min(w - 28, ctx.measureText(promptObj.text).width + (isMobile ? 24 : 36));
      const px0 = w * 0.5 - tw * 0.5;
      const py0 = h * (isMobile ? 0.48 : 0.58) - (isMobile ? 16 : 22);
      const ph0 = isMobile ? 28 : 34;
      chamferPath(ctx, px0, py0, tw, ph0, 6);
      ctx.fillStyle = 'rgba(9, 13, 24, 0.88)';
      ctx.fill();
      ctx.strokeStyle = promptObj.border || 'rgba(229, 179, 82, 0.78)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = promptObj.col || '#ffe078';
      ctx.fillText(promptObj.text, w * 0.5, py0 + (isMobile ? 18 : 22));
      ctx.restore();
    }

    if (msgT > 0 && msg) {
      ctx.textAlign = 'center';
      ctx.font = '700 14px ' + FONT;
      ctx.fillStyle = `rgba(255, 224, 148, ${clamp(msgT, 0, 1)})`;
      ctx.fillText(msg, w * 0.5, h * 0.67);
    }

    // Minimal center diamond + snappy hitmarker
    if (state === 'play') {
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.strokeStyle = killMark > 0 ? '#ff4a3a' : hitMark > 0 ? '#ffd24a' : 'rgba(244,235,216,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy); ctx.closePath();
      ctx.stroke();
      if (hitMark > 0 || killMark > 0) {
        const isKill = killMark > 0;
        const tNorm = isKill ? clamp(killMark / 0.4, 0, 1) : clamp(hitMark / 0.16, 0, 1);
        const pop = Math.pow(tNorm, 2.2) * (isKill ? 7.5 : 4.5);
        ctx.strokeStyle = isKill ? '#ff4436' : headMark > 0 ? '#ffd452' : '#f8f2e4';
        ctx.lineWidth = isKill ? 2.6 : 2.0;
        ctx.beginPath();
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          ctx.moveTo(cx + a * (7 + pop * 0.45), cy + b * (7 + pop * 0.45));
          ctx.lineTo(cx + a * (15 + pop), cy + b * (15 + pop));
        }
        ctx.stroke();
      }
    }

    if (state === 'play' && !input.locked && !input.isTouch) {
      ctx.textAlign = 'center';
      ctx.font = '600 12px ' + FONT;
      ctx.fillStyle = 'rgba(235, 224, 200, 0.72)';
      ctx.fillText('点击画面锁定视角 · 左键连斩 / 右键格挡弹反 / [1][2][3] 释放三大招', w * 0.5, h - 18);
    }

    if (perfStats?.show) {
      ctx.textAlign = 'right';
      ctx.font = '600 11px monospace';
      ctx.fillStyle = 'rgba(210, 232, 255, 0.82)';
      ctx.fillText(`FPS ${perfStats.fps} | ${perfStats.ms.toFixed(1)}ms`, w - 16, 22);
    }

    ctx.restore();
  }
}
