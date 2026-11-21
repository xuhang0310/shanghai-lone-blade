import lines from '../config/dialogue.json' with { type: 'json' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function voiceUrl(folder, cue) {
  return `assets/voices/${folder}/${cue}.mp3`;
}

// Compute stereo pan (-0.9 left .. +0.9 right) and distance gain relative to player orientation.
export function spatialVoice(source, listener) {
  if (!source || !listener) return { gain: 1, pan: 0 };
  const dx = source.x - listener.x;
  const dz = source.z - listener.z;
  const dist = Math.hypot(dx, dz);
  const fwdX = Math.cos(listener.ang);
  const fwdZ = Math.sin(listener.ang);
  const rightX = -fwdZ;
  const rightZ = fwdX;
  const pan = dist > 0.25 ? clamp((dx * rightX + dz * rightZ) / Math.max(2.2, dist), -0.9, 0.9) : 0;
  let gain = clamp(1.04 - 0.029 * dist, 0.28, 1);
  if (dist > 1.5 && (dx * fwdX + dz * fwdZ) / dist < -0.25) gain *= 0.88;
  return { gain, pan };
}

export function dialogueTake(cue, preset, catalog = lines) {
  const { speaker, line, xiaLine, lang = 'zh-CN', actor, zh } = catalog[cue];
  const text = (preset.id === 'xia' && xiaLine ? xiaLine : line).replaceAll('{hero}', preset.name);
  const heroVersion = speaker === 'hero' || xiaLine || line.includes('{hero}');
  const folder = lang === 'ja-JP' ? 'ja/' + actor : heroVersion ? preset.id : 'cast';
  const translation = lang === 'ja-JP' ? (zh || '').replaceAll('{hero}', preset.name) : '';
  return { text, translation, name: speaker === 'hero' ? preset.name : speaker, lang, src: voiceUrl(folder, cue) };
}

export class DialoguePlayer {
  constructor() {
    this.media = new Audio();
    this.volume = 0.9;
    this.media.volume = this.volume;
    this.current = 0;
    this.paused = false;
    this.awaitingGesture = false;
    this.hasLine = false;
    this.subtitle = null;
    this.audioCtx = null;
    this.gainNode = null;
    this.panner = null;
    this.pan = 0;
    this.spatialGain = 1;
  }

  _ensureSpatialGraph() {
    if (this.panner) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC || typeof this.media?.play !== 'function') return false;
    try {
      const ctx = new AC();
      const src = ctx.createMediaElementSource(this.media);
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const gainNode = ctx.createGain();
      if (panner) {
        src.connect(panner);
        panner.connect(gainNode);
      } else {
        src.connect(gainNode);
      }
      gainNode.connect(ctx.destination);
      this.media.volume = 1;
      this.audioCtx = ctx;
      this.panner = panner;
      this.gainNode = gainNode;
      return true;
    } catch {
      return false;
    }
  }

  setSpatial(gain = 1, pan = 0) {
    this.spatialGain = clamp(gain, 0, 1);
    this.pan = clamp(pan, -0.9, 0.9);
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume * this.spatialGain;
      if (this.panner) this.panner.pan.value = this.pan;
    } else {
      this.media.volume = this.volume * this.spatialGain;
    }
  }

  start(cue, preset, gain = 1, pan = 0) {
    const { text, name, lang, translation, src } = dialogueTake(cue, preset);
    this.current++;
    this.hasLine = true;
    this.paused = false;
    this.awaitingGesture = false;
    this.media.lang = lang;
    this._ensureSpatialGraph();
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    this.setSpatial(gain, pan);
    this.media.src = src;
    this.subtitle = { text: name ? `${name}：「${text}」` : text, lang, translation };
    this.play();
    return this.subtitle.text;
  }

  play() {
    const current = this.current;
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    this.media.play().catch(error => {
      if (current !== this.current || this.paused || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') this.awaitingGesture = true;
      else this.hasLine = false;
    });
  }

  unlock() {
    this._ensureSpatialGraph();
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    if (this.awaitingGesture && !this.paused && this.hasLine) {
      this.awaitingGesture = false;
      this.play();
    }
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.hasLine || this.media.ended) return;
    if (paused) this.media.pause();
    else this.play();
  }

  get speaking() {
    return this.hasLine && !this.awaitingGesture && !this.media.ended && !this.media.error;
  }

  get ended() {
    return this.hasLine && this.media.ended && !this.media.error;
  }

  stop() {
    this.current++;
    this.hasLine = false;
    this.subtitle = null;
    this.awaitingGesture = false;
    this.media.pause();
  }
}
