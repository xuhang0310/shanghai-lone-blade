// AAA 1937 Shanghai Rain-Noir Cinematic Loading Screen
// Features: 5-slide Ken Burns parallax gallery, live rain streaks canvas,
// interactive 1937 dossier & boss wanted cards, brass revolver cylinder spinner,
// smooth byte-weighted progress bar, and optional ambient rain wakeup.

const SLIDES = [
  { src: 'assets/loading/loading-shikumen.webp', loc: '第一关 · 闸北石库门 · 雨夜孤刃', pos: '50% 50%' },
  { src: 'assets/chars/portrait-ranger.webp', loc: '孤胆刀客 · 沈孤鸿', pos: '55% 22%' },
  { src: 'assets/chars/portrait-xia.webp', loc: '江湖女侠 · 陆青梧', pos: '52% 20%' }
];

const DOSSIERS = [
  {
    tag: '纯冷兵器 · 魂系死斗',
    title: '一柄大刀杀穿石库门长街',
    body: '全面摒弃一切热兵器。左键三连斩、右键架刀格挡、迎刃瞬按右键触发完美弹反；每击杀一名巡街死士都能赚取战功积分。'
  },
  {
    tag: '致命敌寇',
    title: '切莫轻敌：小兵亦有秒杀之力',
    body: '长街上的长枪卫、重斧护院与铁锤死士绝非草芥——他们的红光【危】重劈足以一刀秒杀未强化的游侠！务必善用翻滚与弹反。'
  },
  {
    tag: '积分成长',
    title: '赐福灯龛与随时锻造强化',
    body: '按 [U] 或在赐福灯龛按 [E] 即可消耗战功积分升级【武器锋刃】【体魄血条】【精力耐力】【刀气修为】，并补满金疮药。'
  },
  {
    tag: '封闭死斗场',
    title: '穿越猩红雾门 · 挑战霸王黑龙',
    body: '一路清剿巡街强敌推至北端雾门，按 [E] 踏入封闭石库门死斗场：2000 血三红印的「霸王 · 黑龙」携四大范围绝技镇守于此！'
  }
];

const BLADE_CREST_SVG =
  '<svg class="ld-cylinder" viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">' +
  '<circle cx="20" cy="20" r="17.5" fill="none" stroke="rgba(229,179,82,0.52)" stroke-width="1.4"/>' +
  '<polygon points="20,4 23.5,16.5 36,20 23.5,23.5 20,36 16.5,23.5 4,20 16.5,16.5" fill="rgba(255,217,132,0.88)" stroke="rgba(184,41,31,0.7)" stroke-width="1"/>' +
  '<circle cx="20" cy="20" r="3.5" fill="#b8291f"/>' +
  '</svg>';

export class LoadingScreen {
  constructor(el, audio = null) {
    this.el = el;
    this.audio = audio;
    this.active = false;
    this.targetP = 0.04;
    this.displayP = 0.02;
    this.phaseText = '正在整备 1937 雨夜冷兵器死斗场…';
    this.slideIdx = 0;
    this.dossierIdx = Math.floor(Math.random() * DOSSIERS.length);
    this.slideTimer = null;
    this.dossierTimer = null;
    this.rafId = 0;
    this.rainDrops = [];
    this.px = 0;
    this.py = 0;
    this.tx = 0;
    this.ty = 0;
    this.rainSoundOn = false;
    this._onMove = this._handleMouseMove.bind(this);
    this._onKey = this._handleKeyDown.bind(this);
    this._onResize = this._resizeRain.bind(this);
  }

  mount() {
    if (!this.el) return;
    this.active = true;
    this.el.hidden = false;
    this.el.classList.remove('is-done');

    const slidesHtml = SLIDES.map(
      (s, i) =>
        `<div class="ld-slide${i === 0 ? ' is-active' : ''}" data-slide="${i}">` +
        `<img src="${s.src}" alt="${s.loc}" style="object-position:${s.pos}" decoding="async">` +
        `</div>`
    ).join('');

    const dotsHtml = SLIDES.map(
      (_, i) => `<span class="ld-dot${i === 0 ? ' is-active' : ''}" data-dot="${i}"></span>`
    ).join('');

    this.el.innerHTML =
      `<div class="ld-stage" id="ldStage">${slidesHtml}</div>` +
      `<canvas class="ld-rain" id="ldRain"></canvas>` +
      `<div class="ld-vignette"></div>` +
      `<div class="ld-grain"></div>` +
      `<div class="ld-chrome">` +
      `  <header class="ld-top">` +
      `    <div class="ld-brand">` +
      `      <div class="ld-kicker">SHANGHAI · 1937 · COLD-STEEL</div>` +
      `      <h1 class="ld-title">沪上孤刀</h1>` +
      `      <div class="ld-loc-row"><span class="ld-loc-badge" id="ldLoc">${SLIDES[0].loc}</span><div class="ld-dots">${dotsHtml}</div></div>` +
      `    </div>` +
      `    <button type="button" class="ld-audio-btn" id="ldAudioBtn">♫ 开启雨夜环境音</button>` +
      `  </header>` +
      `  <div class="ld-mid">` +
      `    <aside class="ld-dossier" aria-live="polite">` +
      `      <div class="ld-dossier-hdr">` +
      `        <span class="ld-tag" id="ldTag"></span>` +
      `        <div class="ld-nav">` +
      `          <span class="ld-count" id="ldCount"></span>` +
      `          <button type="button" class="ld-nav-btn" id="ldPrev" aria-label="上一条情报">‹</button>` +
      `          <button type="button" class="ld-nav-btn" id="ldNext" aria-label="下一条情报">›</button>` +
      `        </div>` +
      `      </div>` +
      `      <h2 class="ld-dossier-title" id="ldDossierTitle"></h2>` +
      `      <p class="ld-dossier-body" id="ldDossierBody"></p>` +
      `      <div class="ld-dossier-hint">点击左右箭头或按 ← / → 键翻阅民国机密情报档案</div>` +
      `    </aside>` +
      `  </div>` +
      `  <footer class="ld-foot">` +
      `    <div class="ld-status-row">` +
      `      <div class="ld-phase-wrap"><span class="ld-pulse"></span><span class="ld-phase" id="ldPhase">${this.phaseText}</span></div>` +
      `      <div class="ld-pct-wrap">${BLADE_CREST_SVG}<span class="ld-pct" id="ldPct">0%</span></div>` +
      `    </div>` +
      `    <div class="ld-bar-track"><div class="ld-bar-fill" id="ldFill"></div></div>` +
      `  </footer>` +
      `</div>`;

    this.stageEl = this.el.querySelector('#ldStage');
    this.rainCv = this.el.querySelector('#ldRain');
    this.rainCtx = this.rainCv?.getContext('2d');
    this.locEl = this.el.querySelector('#ldLoc');
    this.tagEl = this.el.querySelector('#ldTag');
    this.countEl = this.el.querySelector('#ldCount');
    this.dossierTitleEl = this.el.querySelector('#ldDossierTitle');
    this.dossierBodyEl = this.el.querySelector('#ldDossierBody');
    this.dossierEl = this.el.querySelector('.ld-dossier');
    this.phaseEl = this.el.querySelector('#ldPhase');
    this.pctEl = this.el.querySelector('#ldPct');
    this.fillEl = this.el.querySelector('#ldFill');
    this.audioBtn = this.el.querySelector('#ldAudioBtn');

    this.el.querySelector('#ldPrev')?.addEventListener('click', () => this.stepDossier(-1));
    this.el.querySelector('#ldNext')?.addEventListener('click', () => this.stepDossier(1));
    this.audioBtn?.addEventListener('click', () => this._toggleAmbientRain());
    this.el.querySelectorAll('.ld-dot').forEach(dot => {
      dot.addEventListener('click', () => this.showSlide(+dot.dataset.dot));
    });

    window.addEventListener('mousemove', this._onMove, { passive: true });
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);

    this._renderDossier(false);
    this._resizeRain();
    this.slideTimer = setInterval(() => this.showSlide((this.slideIdx + 1) % SLIDES.length), 5800);
    this.dossierTimer = setInterval(() => this.stepDossier(1), 5200);
    this._tick();
  }

  _toggleAmbientRain() {
    if (!this.audio) return;
    this.audio.init();
    if (!this.rainSoundOn) {
      this.rainSoundOn = true;
      this.audio.startRain();
      this.audio.playFoghorn();
      if (this.audioBtn) {
        this.audioBtn.textContent = '♫ 雨夜环境音已开启';
        this.audioBtn.classList.add('is-on');
      }
    } else {
      this.rainSoundOn = false;
      this.audio.setRainVolume(0);
      if (this.audioBtn) {
        this.audioBtn.textContent = '♫ 雨夜环境音已静音';
        this.audioBtn.classList.remove('is-on');
      }
    }
  }

  showSlide(idx) {
    if (!this.active || !this.el) return;
    this.slideIdx = (idx + SLIDES.length) % SLIDES.length;
    this.el.querySelectorAll('.ld-slide').forEach((s, i) => s.classList.toggle('is-active', i === this.slideIdx));
    this.el.querySelectorAll('.ld-dot').forEach((d, i) => d.classList.toggle('is-active', i === this.slideIdx));
    if (this.locEl) this.locEl.textContent = SLIDES[this.slideIdx].loc;
  }

  stepDossier(delta) {
    if (!this.active) return;
    this.dossierIdx = (this.dossierIdx + delta + DOSSIERS.length) % DOSSIERS.length;
    if (this.dossierTimer) {
      clearInterval(this.dossierTimer);
      this.dossierTimer = setInterval(() => this.stepDossier(1), 5600);
    }
    this._renderDossier(true);
  }

  _renderDossier(animate) {
    const d = DOSSIERS[this.dossierIdx];
    if (!d) return;
    if (this.dossierEl && animate) {
      this.dossierEl.classList.remove('is-swap');
      void this.dossierEl.offsetWidth;
      this.dossierEl.classList.add('is-swap');
    }
    if (this.tagEl) this.tagEl.textContent = d.tag;
    if (this.countEl) this.countEl.textContent = `${String(this.dossierIdx + 1).padStart(2, '0')} / ${String(DOSSIERS.length).padStart(2, '0')}`;
    if (this.dossierTitleEl) this.dossierTitleEl.textContent = d.title;
    if (this.dossierBodyEl) this.dossierBodyEl.textContent = d.body;
  }

  _handleMouseMove(e) {
    const nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    const ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    this.tx = -nx * 11;
    this.ty = -ny * 7;
  }

  _handleKeyDown(e) {
    if (!this.active) return;
    if (e.code === 'ArrowRight' || e.code === 'Space') {
      e.preventDefault();
      this.stepDossier(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      this.stepDossier(-1);
    }
  }

  _resizeRain() {
    if (!this.rainCv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    this.rainCv.width = Math.round(w * dpr);
    this.rainCv.height = Math.round(h * dpr);
    this.rainW = w;
    this.rainH = h;
    this.rainDpr = dpr;
    const count = Math.min(115, Math.max(48, Math.round((w * h) / 15000)));
    this.rainDrops = [];
    for (let i = 0; i < count; i++) {
      this.rainDrops.push({
        x: Math.random() * (w + 140),
        y: Math.random() * h,
        len: 16 + Math.random() * 26,
        spd: 11 + Math.random() * 14,
        alpha: 0.08 + Math.random() * 0.18
      });
    }
  }

  setProgress(fraction, phaseLabel = '') {
    const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
    this.targetP = Math.max(this.targetP, clamped);
    if (phaseLabel) {
      this.phaseText = phaseLabel;
      if (this.phaseEl) this.phaseEl.textContent = phaseLabel;
    }
  }

  _tick() {
    if (!this.active) return;
    // Smooth eased progress interpolation so the gold bar glides steadily
    const diff = this.targetP - this.displayP;
    this.displayP += diff * 0.14 + (diff > 0.002 ? 0.0015 : 0);
    if (this.displayP > this.targetP) this.displayP = this.targetP;

    const pct = Math.min(100, Math.round(this.displayP * 100));
    if (this.pctEl) this.pctEl.textContent = `${pct}%`;
    if (this.fillEl) this.fillEl.style.transform = `scaleX(${Math.max(0.015, this.displayP)})`;

    // Smooth mouse parallax on the full-screen film stage
    this.px += (this.tx - this.px) * 0.08;
    this.py += (this.ty - this.py) * 0.08;
    if (this.stageEl) {
      this.stageEl.style.transform = `translate3d(${this.px.toFixed(2)}px, ${this.py.toFixed(2)}px, 0)`;
    }

    // Live subtle rain streaks across the noir film frame
    const ctx = this.rainCtx;
    if (ctx && this.rainDrops.length) {
      ctx.setTransform(this.rainDpr, 0, 0, this.rainDpr, 0, 0);
      ctx.clearRect(0, 0, this.rainW, this.rainH);
      ctx.lineWidth = 1;
      for (const r of this.rainDrops) {
        r.x -= r.spd * 0.16;
        r.y += r.spd;
        if (r.y > this.rainH + 30) {
          r.y = -r.len - Math.random() * 40;
          r.x = Math.random() * (this.rainW + 160);
        }
        ctx.strokeStyle = `rgba(195, 220, 248, ${r.alpha})`;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - r.len * 0.16, r.y + r.len);
        ctx.stroke();
      }
    }

    this.rafId = requestAnimationFrame(() => this._tick());
  }

  showError(html) {
    this._stopTimers();
    if (!this.el) return;
    if (this.phaseEl) this.phaseEl.textContent = '载入中断';
    const mid = this.el.querySelector('.ld-mid');
    if (mid) {
      mid.innerHTML = `<div class="ld-dossier ld-error">${html}</div>`;
    }
  }

  finish() {
    if (!this.active) return Promise.resolve();
    this.targetP = 1;
    this.displayP = 1;
    if (this.pctEl) this.pctEl.textContent = '100%';
    if (this.fillEl) this.fillEl.style.transform = 'scaleX(1)';
    if (this.phaseEl) this.phaseEl.textContent = '电台密电接通 · 踏入雨夜';
    return new Promise(resolve => {
      setTimeout(() => {
        if (this.el) this.el.classList.add('is-done');
        setTimeout(() => {
          this.destroy();
          resolve();
        }, 420);
      }, 140);
    });
  }

  _stopTimers() {
    if (this.slideTimer) clearInterval(this.slideTimer);
    if (this.dossierTimer) clearInterval(this.dossierTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.slideTimer = this.dossierTimer = null;
    this.rafId = 0;
  }

  destroy() {
    this.active = false;
    this._stopTimers();
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    if (this.el) {
      this.el.hidden = true;
      this.el.innerHTML = '';
    }
  }
}
