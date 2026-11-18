const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioManager {
  constructor() {
    this.AC = null;
    this.noiseBuf = null;
    this.BUF = {};
    this.convolver = null;
    this.revSend = null;
    this.revBuffers = {};
    this.pendingEnvStyle = 'cobble';
    this.music = null;
    this.musicOn = true;
    this.musicName = '';
    this.rainNode = null;
  }

  init() {
    if (this.AC) {
      if (this.AC.state === 'suspended') this.AC.resume();
      return;
    }
    try {
      const AC = new (window.AudioContext || window.webkitAudioContext)();
      this.AC = AC;
      this.noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.6, AC.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      const cv = AC.createConvolver();
      this.convolver = cv;
      this.revSend = AC.createGain();
      this.revSend.gain.value = 0.5;
      this.revSend.connect(cv);
      cv.connect(AC.destination);
      this.setEnvironment(this.pendingEnvStyle);

      const names = ['pistol', 'smg1', 'smg2', 'smg3', 'shotgun', 'rifle', 'esmg', 'reload', 'pump'];
      for (const n of names) {
        fetch(`assets/sfx/${n}.mp3`)
          .then(r => r.arrayBuffer())
          .then(b => AC.decodeAudioData(b))
          .then(b => { this.BUF[n] = b; })
          .catch(() => {});
      }
    } catch {
      this.AC = null;
    }
  }

  playBuf(name, vol, rate = 1) {
    if (!this.AC || !this.BUF[name]) return;
    const s = this.AC.createBufferSource();
    const g = this.AC.createGain();
    s.buffer = this.BUF[name];
    s.playbackRate.value = rate;
    g.gain.value = vol;
    s.connect(g);
    g.connect(this.AC.destination);
    if (this.revSend) g.connect(this.revSend);
    s.start();
  }

  playMusic(name) {
    if (this.musicName === name && this.music) {
      if (this.musicOn && this.music.paused) this.music.play().catch(() => {});
      return;
    }
    this.musicName = name;
    if (this.music) this.music.pause();
    this.music = new Audio(`assets/music/${name}.mp3`);
    this.music.loop = true;
    this.music.volume = 0.28;
    if (this.musicOn) this.music.play().catch(() => {});
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.music) {
      if (this.musicOn) this.music.play().catch(() => {});
      else this.music.pause();
    }
    return this.musicOn;
  }

  startRain() {
    if (!this.AC || this.rainNode) return;
    const s = this.AC.createBufferSource();
    const f = this.AC.createBiquadFilter();
    const g = this.AC.createGain();
    s.buffer = this.noiseBuf;
    s.loop = true;
    f.type = 'highpass';
    f.frequency.value = 2500;
    g.gain.value = 0.035;
    s.connect(f);
    f.connect(g);
    g.connect(this.AC.destination);
    s.start();
    this.rainNode = s;
  }

  noise(dur, freq, q, vol, type = 'bandpass') {
    if (!this.AC || !this.noiseBuf) return;
    const t = this.AC.currentTime;
    const s = this.AC.createBufferSource();
    const f = this.AC.createBiquadFilter();
    const g = this.AC.createGain();
    s.buffer = this.noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.AC.destination);
    s.start(t);
    s.stop(t + dur);
  }

  tone(f0, f1, dur, vol, type = 'sine') {
    if (!this.AC) return;
    const t = this.AC.currentTime;
    const o = this.AC.createOscillator();
    const g = this.AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.AC.destination);
    o.start(t);
    o.stop(t + dur);
  }

  setEnvironment(style = 'cobble') {
    this.pendingEnvStyle = style;
    if (!this.AC || !this.convolver || !this.revSend) return;
    if (!this.revBuffers[style]) {
      const AC = this.AC;
      const cfg =
        style === 'concrete'
          ? { dur: 2.5, decay: 2.4, lpK: 0.28, send: 0.68 }
          : style === 'plank'
            ? { dur: 1.95, decay: 3.1, lpK: 0.42, send: 0.46 }
            : { dur: 1.35, decay: 3.6, lpK: 0.32, send: 0.56 };
      const len = Math.floor(AC.sampleRate * cfg.dur);
      const ir = AC.createBuffer(2, len, AC.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const a = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += (Math.random() * 2 - 1 - lp) * cfg.lpK;
          const env = Math.pow(1 - i / len, cfg.decay) * (i < 350 ? i / 350 : 1);
          a[i] = lp * env;
        }
      }
      this.revBuffers[style] = { buf: ir, send: cfg.send };
    }
    const env = this.revBuffers[style];
    this.convolver.buffer = env.buf;
    this.revSend.gain.value = env.send;
  }

  playEnemyShot(type, distMeters) {
    if (!this.AC || distMeters > 78) return;
    const v = clamp(0.6 * (1 - distMeters / 82), 0.06, 0.6);
    const n = type === 'soldier' ? 'rifle' : type === 'gunman' ? 'pistol' : 'esmg';
    if (this.BUF[n]) {
      this.playBuf(n, v, type === 'gunman' ? 1.08 : rnd(0.97, 1.03));
    } else {
      this.sfx('eshot');
    }
  }

  sfx(n) {
    if (!this.AC) return;
    const real = {
      pistol: ['pistol', 0.85],
      smg: ['smg' + (1 + ((Math.random() * 3) | 0)), 0.7],
      shotgun: ['shotgun', 1],
      rifle: ['rifle', 0.95],
      reload: ['reload', 0.55]
    }[n];
    if (real && this.BUF[real[0]]) {
      this.playBuf(real[0], real[1], rnd(0.96, 1.04));
      if (n === 'shotgun' || n === 'rifle') {
        setTimeout(() => {
          if (this.AC && this.BUF.pump) this.playBuf('pump', 0.45, 1);
        }, 420);
      }
      return;
    }

    switch (n) {
      case 'land': this.noise(0.12, 180, 1, 0.35, 'lowpass'); break;
      case 'whistle':
        for (let i = 0; i < 5; i++) setTimeout(() => this.AC && this.tone(2500, 2900, 0.09, 0.09, 'square'), i * 110);
        break;
      case 'fire':
        this.noise(0.5, 500, 0.5, 0.5, 'lowpass');
        this.noise(0.3, 2500, 1, 0.15);
        break;
      case 'tick': this.tone(1900, 1200, 0.035, 0.1, 'square'); break;
      case 'whiz':
        this.noise(0.09, rnd(2500, 4200), 6, 0.25);
        this.tone(1500, 500, 0.09, 0.05);
        break;
      case 'ping': this.tone(2500, 2100, 0.14, 0.13, 'triangle'); break;
      case 'tink': this.tone(rnd(3800, 4600), 3000, 0.05, 0.03); break;
      case 'pistol': this.noise(0.12, 1800, 0.8, 0.35); this.tone(220, 60, 0.1, 0.3); break;
      case 'smg': this.noise(0.07, 2400, 0.9, 0.25); this.tone(260, 90, 0.06, 0.2); break;
      case 'shotgun': this.noise(0.3, 900, 0.5, 0.55); this.tone(160, 40, 0.22, 0.45); break;
      case 'eshot': this.noise(0.09, 1300, 1, 0.14); break;
      case 'boom': this.noise(0.55, 300, 0.4, 0.8, 'lowpass'); this.tone(110, 25, 0.5, 0.6); break;
      case 'hit': this.noise(0.05, 600, 2, 0.2); break;
      case 'hurt': this.tone(300, 90, 0.2, 0.3, 'sawtooth'); break;
      case 'pick': this.tone(660, 1320, 0.12, 0.18, 'triangle'); break;
      case 'reload': this.noise(0.04, 3000, 3, 0.15); break;
      case 'roll': this.noise(0.18, 500, 0.6, 0.12); break;
      case 'crate': this.noise(0.16, 680, 0.65, 0.34); this.tone(160, 75, 0.1, 0.18, 'triangle'); break;
      case 'glass': this.noise(0.14, 3600, 1.8, 0.22, 'highpass'); this.tone(3200, 1800, 0.08, 0.12); break;
      case 'thunder':
        this.noise(1.6, 135, 0.55, 0.65, 'lowpass');
        this.tone(68, 24, 1.1, 0.38, 'sine');
        setTimeout(() => this.AC && this.noise(1.1, 210, 0.7, 0.4, 'lowpass'), 220);
        break;
      case 'ricochet':
        this.tone(rnd(2600, 3400), rnd(900, 1400), 0.11, 0.14, 'triangle');
        break;
      case 'slowon':
        this.tone(240, 78, 0.22, 0.2, 'sine');
        break;
      case 'slowoff':
        this.tone(85, 250, 0.18, 0.16, 'sine');
        break;
      case 'win':
        this.tone(440, 880, 0.3, 0.2, 'triangle');
        setTimeout(() => this.AC && this.tone(660, 1320, 0.4, 0.2, 'triangle'), 160);
        break;
    }
  }
}
