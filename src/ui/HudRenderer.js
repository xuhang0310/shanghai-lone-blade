import * as THREE from 'three';
import { WEAPONS, TILE, TAU } from '../config/constants.js';

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
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
      score, kills = 0, banner, msg, msgT, radioMsg, radioT,
      hurtFlash, hurtAng,
      hitMark, killMark, headMark, aimHit, execTarget,
      nades, pickups, timeLeft, planted,
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
    vg.addColorStop(1, P.btK > 0.02 ? `rgba(18,58,108,${0.32 + P.btK * 0.22})` : 'rgba(3,6,14,0.26)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (P.btK > 0.02) {
      const sg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
      sg.addColorStop(0, 'rgba(40,130,220,0)');
      sg.addColorStop(1, `rgba(72,175,255,${P.btK * 0.18})`);
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

    // 2. Top-Left 1937 Art-Deco Vital & Mission Plaque
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
      focGrad.addColorStop(0, '#2d93c9');
      focGrad.addColorStop(1, '#7ce0ff');
    } else {
      focGrad.addColorStop(0, '#9c6e21');
      focGrad.addColorStop(1, '#e8b654');
    }
    ctx.fillStyle = P.focus > 15 || P.bulletTime ? focGrad : '#6b5e44';
    ctx.fillRect(barX + 1, fy + 1, (barW - 2) * focusRatio, 12);
    ctx.strokeStyle = P.bulletTime ? 'rgba(150,230,255,0.8)' : 'rgba(217,164,65,0.38)';
    ctx.strokeRect(barX + 0.5, fy + 0.5, barW - 1, 13);

    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = '#f5ebd6';
    ctx.textAlign = 'left';
    ctx.fillText(P.bulletTime ? '[TAB] 子弹时间 · 激活' : '[TAB] 战术专注', barX + 6, fy + 10.5);
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

    const objText =
      cfg.mission === 'boss'
        ? '◆ 击毙黑龙帮主“黑龙”'
        : cfg.mission === 'rescue'
          ? level.hostage?.free
            ? '◆ 护送联络人撤往北面出口'
            : '◆ 深入街区解救地下联络人'
          : planted < 3
            ? `◆ 军火箱安放炸药 (${planted}/3)`
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
        dot(e.x, e.z, e.type === 'boss' ? '#d47aff' : '#ff4d3d', e.type === 'boss' ? 4.2 : 2.8);
      }
    }
    for (const p of pickups) dot(p.x, p.z, '#6ed0ff', 2.2);
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
    const g = WEAPONS[P.gun];
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
    ctx.fillText(g.fullName, blX + 12, wCardY + 22);

    const stanceTxt = P.diveT > 0 ? '飞扑慢镜' : P.ads > 0.35 ? '精准肩射' : P.crouch ? '潜行蹲伏' : g.caliber || '';
    ctx.font = '600 10.5px ' + FONT;
    ctx.fillStyle = P.ads > 0.35 ? '#ffd67c' : '#a8a090';
    ctx.fillText(stanceTxt, blX + 12, wCardY + 38);

    // Big tabular ammo readout on right side of weapon plaque
    const curMag = P.mags[P.gun];
    const curRes = P.res[P.gun] === Infinity ? '∞' : P.res[P.gun];
    ctx.textAlign = 'right';
    if (P.reloadT > 0) {
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

    // Visual magazine fill bar along bottom of weapon plaque
    const magFrac = g.mag ? clamp(curMag / g.mag, 0, 1) : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(blX + 12, wCardY + 56, 102, 5);
    ctx.fillStyle = curMag > 0 ? '#e5b352' : '#d63628';
    ctx.fillRect(blX + 12, wCardY + 56, 102 * magFrac, 5);

    // 5. Bottom-Right Visual 3-Slot Weapon Equipment Hotbar (真·三格枪械装备栏 + 军械箱入口)
    if (!it) {
      const slots = P.loadout || [0];
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
      ctx.fillText(
        `[1-3 / Q] 切换随身火器  ·  [B] 打开军械装备箱  ·  [H] 画质：${qualityLabel || (bloomEnabled ? '极致电影' : '流畅直出')}`,
        w - 16,
        dockY - 10
      );

      for (let i = 0; i < 3; i++) {
        const wIdx = slots[i];
        const sw = wIdx !== undefined ? WEAPONS[wIdx] : null;
        const active = i === P.slot && sw;
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
          ctx.fillText('空枪套 [B]', sx + slotW * 0.5, sy + slotH * 0.5 + 5);
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

      if (!input.locked && state === 'play') {
        ctx.textAlign = 'center';
        ctx.font = '600 12px ' + FONT;
        ctx.fillStyle = 'rgba(236, 227, 207, 0.78)';
        ctx.fillText('点击画面锁定准星 · 按 [B] 打开八枪军械箱', w / 2, h - 22);
      }
    }

    // 6. Floating Execution / Stealth Takedown Lock-On Diamond & Callout
    if (execTarget && state === 'play') {
      _tmpV.set(execTarget.x, execTarget.ht * 0.7, execTarget.z).project(camera);
      if (_tmpV.z > -1 && _tmpV.z < 1) {
        const ex = clamp((_tmpV.x * 0.5 + 0.5) * w, 90, w - 90);
        const ey = clamp((-_tmpV.y * 0.5 + 0.5) * h, 70, h - 120);

        // Rotating / pulsing target diamond below prompt
        const pulseR = 11 + Math.sin(time * 8) * 2;
        ctx.save();
        ctx.translate(ex, ey + 24);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = execTarget.awake ? '#ff5242' : '#ffd27a';
        ctx.lineWidth = 2;
        ctx.strokeRect(-pulseR * 0.5, -pulseR * 0.5, pulseR, pulseR);
        ctx.restore();

        const label = execTarget.awake ? '[E] 近身处决' : '[E] 悄声暗杀';
        ctx.font = '700 13px ' + FONT;
        const bw = ctx.measureText(label).width + 28;
        chamferPath(ctx, ex - bw * 0.5, ey - 16, bw, 28, 5);
        ctx.fillStyle = 'rgba(18, 12, 18, 0.90)';
        ctx.fill();
        ctx.strokeStyle = execTarget.awake ? '#ff5e4d' : '#ebb858';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe094';
        ctx.fillText(label, ex, ey + 3);
      }
    }

    // 7. Enemy Floating Health Bars
    for (const e of level.enemies) {
      if (e.hp >= e.max || e.type === 'boss') continue;
      _tmpV.set(e.x, e.ht + 0.35, e.z).project(camera);
      if (_tmpV.z > 1 || _tmpV.z < -1) continue;
      const x = (_tmpV.x * 0.5 + 0.5) * w;
      const y = (-_tmpV.y * 0.5 + 0.5) * h;
      ctx.fillStyle = 'rgba(6, 10, 18, 0.78)';
      ctx.fillRect(x - 19, y - 4, 38, 6);
      ctx.fillStyle = '#e63e30';
      ctx.fillRect(x - 18, y - 3, (36 * e.hp) / e.max, 4);
    }

    // 8. Boss Health Plaque
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
      ctx.fillText('黑龙帮魁首 · 黑 龙', w / 2, byy - 7);
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
          ? '◆ 终局决战 · 击毙帮主黑龙 ◆'
          : cfg.mission === 'rescue'
            ? '◆ 解救地下联络人 · 护送撤往北面出口 ◆'
            : '◆ 六分钟内于三处军火箱安放炸药 ◆',
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

    // Incoming grenade warning
    if (
      nades.some(n => {
        if (!n.data?.foe) return false;
        const p = n.body.translation();
        return Math.hypot(p.x - P.x, p.z - P.z) < 8.8;
      }) &&
      Math.floor(time * 8) % 2
    ) {
      ctx.font = '700 18px ' + FONT;
      ctx.fillStyle = '#ff4d3d';
      ctx.fillText('⚠ 当心敌方手雷！', w / 2, h * 0.39);
    }

    // Action feedback toast
    if (msgT > 0) {
      const a = clamp(msgT, 0, 1);
      ctx.font = '700 15px ' + FONT;
      ctx.fillStyle = `rgba(255, 224, 148, ${a})`;
      ctx.fillText(msg, w / 2, h * 0.69);
    }

    // Cinematic Radio / Dialogue Subtitle Bar
    if (radioT > 0 && radioMsg) {
      const a = clamp(radioT, 0, 1);
      ctx.font = '600 14px ' + FONT;
      const tw = Math.min(w - 48, ctx.measureText(radioMsg).width + 44);
      const ry = h - (it ? 106 : 114);
      chamferPath(ctx, (w - tw) / 2, ry - 22, tw, 32, 5);
      ctx.fillStyle = `rgba(8, 12, 22, ${a * 0.86})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(229, 179, 82, ${a * 0.62})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = `rgba(229, 179, 82, ${a})`;
      ctx.fillRect((w - tw) / 2 + 8, ry - 15, 3, 18);
      ctx.fillStyle = `rgba(246, 237, 216, ${a})`;
      ctx.fillText(radioMsg, w / 2 + 3, ry - 1);
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

    // 10. Precision Art-Deco Crosshair & Hitmarkers
    if (state === 'play') {
      const x = w / 2;
      const y = h / 2;
      const sp =
        3.5 +
        WEAPONS[P.gun].spread *
          (1 + P.bloom * 1.8) *
          (P.moving ? 1.35 : 1) *
          (1 - 0.78 * P.ads) *
          (P.crouch ? 0.7 : 1) *
          290;

      if (hitMark > 0 || killMark > 0) {
        ctx.strokeStyle = killMark > 0 ? '#ff4a3a' : headMark > 0 ? '#ffd24a' : '#ffffff';
        ctx.lineWidth = killMark > 0 ? 2.8 : 2;
        ctx.beginPath();
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          ctx.moveTo(x + a * 6, y + b * 6);
          ctx.lineTo(x + a * 14, y + b * 14);
        }
        ctx.stroke();
      }

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
    }
  }
}
