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
    this.droneGain = null;
    this.droneOsc1 = null;
    this.droneOsc2 = null;
    this.foghornTimer = null;
    this.musicOn = true;
    this.rainNode = null;
    this.rainLowNode = null;
  }

  init() {
    if (this.AC) {
      if (this.AC.state === 'suspended') this.AC.resume();
      this._startTensionDrone();
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
      this._startTensionDrone();
      this.startRain();

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

  _startTensionDrone() {
    if (!this.AC || this.droneGain) return;
    const AC = this.AC;
    const lp = AC.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 185;
    const g = AC.createGain();
    g.gain.value = this.musicOn ? 0.03 : 0;

    const o1 = AC.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = 55;
    const o2 = AC.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 82.4;

    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(AC.destination);
    o1.start();
    o2.start();
    this.droneGain = g;
    this.droneOsc1 = o1;
    this.droneOsc2 = o2;

    if (!this.foghornTimer) {
      this.foghornTimer = setInterval(() => {
        if (this.AC && this.AC.state === 'running' && this.musicOn && Math.random() < 0.65) {
          this.playFoghorn();
        }
      }, 24000);
    }
  }

  playFoghorn() {
    if (!this.AC) return;
    const AC = this.AC;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    const f = AC.createBiquadFilter();
    const g = AC.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(76, t);
    o.frequency.linearRampToValueAtTime(72, t + 2.4);
    f.type = 'lowpass';
    f.frequency.value = 230;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    o.connect(f);
    f.connect(g);
    g.connect(AC.destination);
    if (this.revSend) g.connect(this.revSend);
    o.start(t);
    o.stop(t + 2.65);
  }

  playMusic() {
    if (this.AC) this._startTensionDrone();
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.droneGain && this.AC) {
      this.droneGain.gain.setTargetAtTime(this.musicOn ? 0.03 : 0, this.AC.currentTime, 0.08);
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
    f.frequency.value = 2800;
    g.gain.value = 0.026;
    s.connect(f);
    f.connect(g);
    g.connect(this.AC.destination);
    s.start();
    this.rainNode = s;

    // Stone/roof mid-low rain patter layer
    const sl = this.AC.createBufferSource();
    const fl = this.AC.createBiquadFilter();
    const gl = this.AC.createGain();
    sl.buffer = this.noiseBuf;
    sl.loop = true;
    fl.type = 'bandpass';
    fl.frequency.value = 430;
    fl.Q.value = 0.65;
    gl.gain.value = 0.028;
    sl.connect(fl);
    fl.connect(gl);
    gl.connect(this.AC.destination);
    sl.start();
    this.rainLowNode = sl;
  }

  playStep(style = 'cobble', vol = 0.22, crouch = false) {
    if (!this.AC || !this.noiseBuf) return;
    const AC = this.AC;
    const t = AC.currentTime;
    const v = vol * (crouch ? 0.55 : 1) * rnd(0.88, 1.12);
    const s = AC.createBufferSource();
    const f = AC.createBiquadFilter();
    const g = AC.createGain();
    s.buffer = this.noiseBuf;
    if (style === 'plank') {
      f.type = 'lowpass';
      f.frequency.value = rnd(260, 340);
      this.tone(rnd(130, 165), 62, 0.065, v * 0.45, 'triangle');
    } else if (style === 'concrete') {
      f.type = 'bandpass';
      f.frequency.value = rnd(750, 980);
      f.Q.value = 1.2;
      this.tone(rnd(160, 200), 80, 0.045, v * 0.25, 'sine');
    } else {
      f.type = 'bandpass';
      f.frequency.value = rnd(1050, 1450);
      f.Q.value = 1.4;
      this.tone(rnd(185, 225), 85, 0.05, v * 0.35, 'triangle');
      if (Math.random() < 0.45) {
        this.noise(0.055, rnd(2600, 3600), 1.8, v * 0.22, 'highpass');
      }
    }
    g.gain.setValueAtTime(v * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    s.connect(f);
    f.connect(g);
    g.connect(AC.destination);
    if (this.revSend) g.connect(this.revSend);
    s.start(t);
    s.stop(t + 0.09);
  }

  playVoiceShout(kind = 'charge', distMeters = 0) {
    if (!this.AC || distMeters > 38) return;
    const AC = this.AC;
    const t = AC.currentTime;
    const att = clamp(1 - distMeters / 38, 0.06, 1);

    if (kind === 'exec') {
      this.noise(0.075, 2100, 1.5, 0.26 * att, 'bandpass');
      this.tone(180, 52, 0.14, 0.32 * att, 'triangle');
      return;
    }

    const dur = kind === 'die' ? 0.38 : kind === 'grunt' ? 0.14 : 0.32;
    const f0 = kind === 'charge' ? rnd(145, 170) : kind === 'grunt' ? rnd(125, 148) : rnd(118, 132);
    const f1 = kind === 'charge' ? f0 * 0.85 : kind === 'grunt' ? 88 : 58;
    const osc = AC.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    if (kind === 'charge') osc.frequency.linearRampToValueAtTime(f0 * 1.26, t + 0.1);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

    const fmt1 = AC.createBiquadFilter();
    fmt1.type = 'bandpass';
    fmt1.frequency.value = kind === 'charge' ? 720 : 580;
    fmt1.Q.value = 4.2;

    const fmt2 = AC.createBiquadFilter();
    fmt2.type = 'bandpass';
    fmt2.frequency.value = kind === 'charge' ? 1280 : 1080;
    fmt2.Q.value = 5.0;

    const g = AC.createGain();
    const peak = (kind === 'charge' ? 0.18 : 0.15) * att;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(fmt1);
    osc.connect(fmt2);
    fmt1.connect(g);
    fmt2.connect(g);
    g.connect(AC.destination);
    if (this.revSend) g.connect(this.revSend);
    osc.start(t);
    osc.stop(t + dur + 0.02);
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
      pistol: ['pistol', 0.85, 1.0],
      browning: ['pistol', 0.95, 0.82],
      revolver: ['pistol', 1.0, 0.72],
      mp18: ['smg2', 0.68, 0.88],
      smg: ['smg' + (1 + ((Math.random() * 3) | 0)), 0.72, 1.0],
      shotgun: ['shotgun', 1.0, 1.0],
      rifle: ['rifle', 0.96, 1.0],
      zb26: ['rifle', 0.86, 1.06],
      reload: ['reload', 0.55, 1.0]
    }[n];
    if (real && this.BUF[real[0]]) {
      this.playBuf(real[0], real[1], real[2] * rnd(0.96, 1.04));
      if (n === 'browning' || n === 'revolver' || n === 'zb26') {
        this.tone(n === 'revolver' ? 195 : 155, 44, 0.14, 0.34, 'triangle');
      } else if (n === 'mp18') {
        this.tone(240, 95, 0.055, 0.14, 'square');
      }
      if (n === 'shotgun' || n === 'rifle') {
        setTimeout(() => {
          if (this.AC && this.BUF.pump) this.playBuf('pump', 0.45, 1);
        }, 420);
      }
      return;
    }

    switch (n) {
      case 'land': this.noise(0.14, 180, 1, 0.38, 'lowpass'); break;
      case 'whistle':
        for (let i = 0; i < 5; i++) setTimeout(() => this.AC && this.tone(2500, 2900, 0.09, 0.09, 'square'), i * 110);
        break;
      case 'fire':
      case 'molotov':
        this.noise(0.14, 3800, 1.8, 0.26, 'highpass');
        this.noise(0.75, 580, 0.55, 0.52, 'lowpass');
        this.tone(260, 75, 0.42, 0.25, 'sine');
        break;
      case 'execDash':
        this.noise(0.16, 420, 0.8, 0.32, 'lowpass');
        this.noise(0.09, 1800, 1.6, 0.18, 'bandpass');
        this.tone(155, 46, 0.16, 0.34, 'sine');
        break;
      case 'execCrunch':
        this.noise(0.075, 1950, 1.4, 0.44, 'bandpass');
        this.noise(0.14, 340, 0.7, 0.52, 'lowpass');
        this.tone(145, 32, 0.18, 0.58, 'triangle');
        this.tone(920, 210, 0.055, 0.26, 'sawtooth');
        break;
      case 'execSlash':
        this.noise(0.11, 3400, 2.2, 0.34, 'highpass');
        this.noise(0.14, 720, 1.1, 0.32, 'bandpass');
        this.tone(2400, 680, 0.09, 0.18, 'triangle');
        this.tone(118, 34, 0.22, 0.48, 'sine');
        break;
      case 'execFinisher':
        this.noise(0.12, 1600, 0.9, 0.48, 'bandpass');
        this.noise(0.55, 210, 0.5, 0.76, 'lowpass');
        this.tone(96, 22, 0.46, 0.72, 'sine');
        this.tone(210, 42, 0.22, 0.48, 'triangle');
        break;
      case 'stealthExec':
        this.noise(0.09, 2400, 1.8, 0.22, 'highpass');
        this.tone(140, 48, 0.15, 0.35, 'triangle');
        break;
      case 'combatExec':
        this.noise(0.08, 1200, 1.2, 0.28, 'bandpass');
        if (this.BUF.pistol) this.playBuf('pistol', 0.95, 0.85);
        this.tone(180, 45, 0.16, 0.4, 'triangle');
        break;
      case 'tick': this.tone(1900, 1200, 0.035, 0.1, 'square'); break;
      case 'whiz':
        this.noise(0.09, rnd(2500, 4200), 6, 0.25);
        this.tone(1500, 500, 0.09, 0.05);
        break;
      case 'ping': this.tone(2500, 2100, 0.14, 0.13, 'triangle'); break;
      case 'tink': this.tone(rnd(3800, 4600), 3000, 0.05, 0.03); break;
      case 'pistol': this.noise(0.12, 1800, 0.8, 0.35); this.tone(220, 60, 0.1, 0.3); break;
      case 'browning':
      case 'revolver': this.noise(0.16, 1300, 0.7, 0.42); this.tone(190, 45, 0.14, 0.38); break;
      case 'mp18':
      case 'smg': this.noise(0.07, 2400, 0.9, 0.25); this.tone(260, 90, 0.06, 0.2); break;
      case 'zb26':
      case 'rifle':
      case 'shotgun': this.noise(0.3, 900, 0.5, 0.55); this.tone(160, 40, 0.22, 0.45); break;
      case 'eshot': this.noise(0.09, 1300, 1, 0.14); break;
      case 'boom':
        this.noise(0.09, 2600, 0.9, 0.38, 'bandpass');
        this.noise(0.95, 240, 0.45, 0.85, 'lowpass');
        this.tone(95, 22, 0.72, 0.72, 'sine');
        break;
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
