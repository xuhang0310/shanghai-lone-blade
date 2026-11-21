import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HERO_PRESETS, LEVELS } from '../config/constants.js';

export function makeCanvasTexture(w, h, draw, rx = 0, ry = 0, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (rx) t.repeat.set(rx, ry || rx);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class AssetManager {
  constructor() {
    this.tex = {};
    this.glb = {};
    this.anims = null;
    this.mixamoAnims = {};
    this.pendingMotions = new Map();
    this.previewMotions = new Map();
    this.pendingHeroes = new Map();
    this.pendingTex = new Map();
    this._glLoader = null;
    this._texLoader = null;
    this.manClips = {};
    this.soldierClips = {};
    this.skinImg = null;
    this.soldierImg = null;
    this.manNor = null;
    this.lampTop = new THREE.Vector3(0, 3.6, 0);
    this.crateBody = null;
    this.crateLid = null;
    this.manMetrics = { scale: 1, footY: 0, offX: 0, offZ: 0 };
    this.soldierMetrics = { scale: 1, footY: 0, offX: 0, offZ: 0 };
    this.procTex = {};
  }

  _getTexLoader() {
    return this._texLoader || (this._texLoader = new THREE.TextureLoader());
  }

  ensureTexSet(id) {
    if (this.tex[id]?.diff && this.tex[id]?.nor && this.tex[id]?.rough) {
      return Promise.resolve(this.tex[id]);
    }
    if (this.pendingTex.has(id)) return this.pendingTex.get(id);
    const tl = this._getTexLoader();
    this.tex[id] = this.tex[id] || {};
    const req = Promise.all(
      ['diff', 'nor', 'rough'].map(
        k =>
          new Promise((resolve, reject) => {
            tl.load(
              `assets/tex/${id}_${k}.jpg`,
              t => {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                t.anisotropy = 8;
                if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
                this.tex[id][k] = t;
                resolve(t);
              },
              undefined,
              reject
            );
          })
      )
    )
      .then(() => this.tex[id])
      .finally(() => this.pendingTex.delete(id));
    this.pendingTex.set(id, req);
    return req;
  }

  levelTexIds(lvlIndex = 0) {
    const cfg = LEVELS[lvlIndex] || LEVELS[0];
    if (!cfg) return [...new Set(LEVELS.flatMap(l => [l.ground, ...l.walls]))];
    // Sidewalks in ArchitectureBuilder always use concrete_floor_worn_001 across every chapter
    return [...new Set(['concrete_floor_worn_001', cfg.ground, ...cfg.walls])];
  }

  ensureLevelTextures(lvlIndex = 0) {
    return Promise.all(this.levelTexIds(lvlIndex).map(id => this.ensureTexSet(id)));
  }

  preloadRemainingLevelTextures(excludeLvlIndex = 0) {
    const skip = new Set(this.levelTexIds(excludeLvlIndex));
    const rest = [...new Set(LEVELS.flatMap(l => [l.ground, ...l.walls]))].filter(id => !skip.has(id));
    // Stagger silently in background so menu / gameplay stays silky smooth
    rest.forEach((id, i) => {
      setTimeout(() => { this.ensureTexSet(id).catch(() => {}); }, 250 + i * 180);
    });
  }

  async loadAll(onProgress, initialHeroId = HERO_PRESETS[0]?.id || 'ranger', initialLvlIndex = 0) {
    const tl = this._getTexLoader();
    const gl = (this._glLoader = new GLTFLoader());
    const jobs = [];
    const items = [];
    let activePhase = '正在唤醒雨夜物理与弹道系统…';

    const emit = () => {
      let totalW = 0;
      let doneW = 0;
      for (const it of items) {
        totalW += it.w;
        doneW += it.w * it.p;
      }
      onProgress?.(totalW > 0 ? doneW / totalW : 0, activePhase);
    };

    const addSlot = (w, phase) => {
      const slot = { w, p: 0, phase };
      items.push(slot);
      return slot;
    };

    const track = (promise, w = 2, phase = '') => {
      const slot = addSlot(w, phase);
      jobs.push(
        promise.then(
          val => {
            slot.p = 1;
            if (phase) activePhase = phase;
            emit();
            return val;
          },
          err => {
            console.error('Asset load error:', err);
            throw err;
          }
        )
      );
      return slot;
    };

    // Only block startup on the initial chapter's required PBR texture sets (remaining chapters preload silently in background!)
    const initCfg = LEVELS[initialLvlIndex] || LEVELS[0];
    const texIds = this.levelTexIds(initialLvlIndex);
    const stageShort = initCfg ? initCfg.name.split('· ')[1] || initCfg.name : '沪上街区';
    for (const id of texIds) {
      track(this.ensureTexSet(id), 4, `正在铺设${stageShort}雨夜石砖与材质…`);
    }

    const tc = {};
    const loadModelTex = (dir, fn, srgb) => {
      const key = `${dir}/${fn}`;
      if (tc[key]) return tc[key];
      tc[key] = new Promise((resolve, reject) => {
        tl.load(
          `assets/${dir}/${fn}`,
          t => {
            t.flipY = false;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 4;
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            resolve(t);
          },
          undefined,
          reject
        );
      });
      return tc[key];
    };

    for (const [k, dir, phase] of [
      ['crate', 'models', '正在布置街巷木箱与掩体道具…'],
      ['barrel', 'models', '正在布置易燃油桶与爆破物件…'],
      ['lamp', 'models', '正在点亮沪上复古煤气路灯…'],
      ['man', 'chars', '正在整备黑龙帮敌寇人物骨骼…'],
      ['soldier', 'chars', '正在整备敌军重装守卫模型…']
    ]) {
      const slot = addSlot(5, phase);
      jobs.push(
        new Promise((resolve, reject) => {
          gl.load(
            `assets/${dir}/${k}.glb`,
            g => {
              this.glb[k] = g.scene;
              const wait = [];
              g.scene.traverse(o => {
                if (!o.isMesh) return;
                const m = o.material;
                const t = m?.userData?.tex;
                if (!t || m.userData.done) return;
                m.userData.done = 1;
                if (t.diff && /png$/i.test(t.diff)) {
                  m.transparent = true;
                  m.opacity = 0.38;
                  m.roughness = 0.08;
                  m.metalness = 0.15;
                  m.depthWrite = false;
                } else {
                  // Closed solid props: skip back faces (halves raster work in every scene/shadow pass)
                  m.side = THREE.FrontSide;
                  if (t.diff) wait.push(loadModelTex(dir, t.diff, true).then(x => { m.map = x; m.needsUpdate = true; }));
                }
                if (t.nor) {
                  wait.push(loadModelTex(dir, t.nor, false).then(x => { m.normalMap = x; m.needsUpdate = true; }));
                }
                if (t.orm) {
                  wait.push(loadModelTex(dir, t.orm, false).then(x => {
                    m.aoMap = x;
                    m.roughnessMap = x;
                    m.metalnessMap = x;
                    m.needsUpdate = true;
                  }));
                }
              });
              Promise.all(wait).then(() => {
                slot.p = 1;
                activePhase = phase;
                emit();
                resolve();
              }, reject);
            },
            xhr => {
              if (xhr && xhr.total > 0) {
                slot.p = Math.min(0.85, (xhr.loaded / xhr.total) * 0.85);
                activePhase = phase;
                emit();
              }
            },
            reject
          );
        })
      );
    }

    // Use the same model for a saved selection and a later switch in the menu, with real byte-streaming progress!
    const initPreset = HERO_PRESETS.find(p => p.id === initialHeroId) || HERO_PRESETS[0];
    if (initPreset) {
      const heroPhase = `正在整备${initPreset.name}角色模型与二十九军式大刀…`;
      const heroSlot = addSlot(48, heroPhase);
      jobs.push(
        this.ensureHeroPreset(initPreset.id, xhr => {
          if (xhr && xhr.total > 0) {
            heroSlot.p = Math.min(0.98, xhr.loaded / xhr.total);
            activePhase = heroPhase;
            emit();
          }
        }).then(res => {
          heroSlot.p = 1;
          activePhase = heroPhase;
          emit();
          return res;
        })
      );
    }
    track(fetch('assets/chars/anims.json').then(r => r.json()).then(j => { this.anims = j; }), 4, '正在同步基础战斗动作骨架…');
    // Optional Mixamo clips (tools/convert-mixamo.mjs); the game falls back to procedural motion without them
    track(
      fetch('assets/chars/anims-mixamo.json')
        .then(r => (r.ok ? r.json() : {}))
        .catch(() => ({}))
        .then(j => { this.mixamoAnims = j && typeof j === 'object' ? j : {}; }),
      10,
      '正在接入 65 骨骼实战与潜行动作库…'
    );
    track(new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { this.skinImg = im; resolve(); };
      im.onerror = reject;
      im.src = 'assets/chars/man_diff.png';
    }), 3, '正在渲染人物肌理与衣料纹理…');
    track(new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { this.soldierImg = im; resolve(); };
      im.onerror = reject;
      im.src = 'assets/chars/soldier.png';
    }), 2, '正在渲染敌军制服与装备纹理…');
    track(loadModelTex('chars', 'man_nor.jpg', false).then(t => { this.manNor = t; }), 2, '正在烘焙雨夜法线高光…');

    emit();
    await Promise.all(jobs);
    activePhase = '正在烘焙雨夜光影与军械预览…';
    onProgress?.(0.98, activePhase);
    this._prepAssets();
    this._buildProceduralTextures();
    onProgress?.(1, '电台密电接通，准备踏入雨夜');
  }

  _prepGlb(k) {
    const root = this.glb[k];
    if (!root || root.userData._prepped) return;
    root.userData._prepped = true;
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (o.isMesh) {
        o.geometry.userData.shared = true;
        o.castShadow = true;
        o.receiveShadow = k !== 'man' && k !== 'soldier';
      }
      if (o.isBone) o.name = o.name.replace(/^mixamorig:?/, '');
    });
  }

  async ensureHeroPreset(id, onProgress = null) {
    const key = `hero-${id}`;
    if (this.glb[key]) return this.glb[key];
    if (!this.pendingHeroes.has(key)) {
      const gl = this._glLoader || (this._glLoader = new GLTFLoader());
      const model = HERO_PRESETS.find(preset => preset.id === id)?.model || key;
      const req = gl.loadAsync(`assets/chars/${model}.glb`, onProgress || undefined).then(gltf => {
        this.glb[key] = gltf.scene;
        this._prepGlb(key);
        return gltf.scene;
      }).catch(err => {
        console.warn(`角色模型 ${key} 按需加载失败。`, err);
        return null;
      }).finally(() => this.pendingHeroes.delete(key));
      this.pendingHeroes.set(key, req);
    }
    return this.pendingHeroes.get(key);
  }

  _prepAssets() {
    for (const k in this.glb) this._prepGlb(k);

    // Lamp bulb glow & center
    const bb = new THREE.Box3();
    this.glb.lamp.traverse(o => {
      if (o.isMesh && /bulb|glass/i.test(o.material.name)) {
        o.material.emissive = new THREE.Color(0xffc478);
        o.material.emissiveIntensity = /bulb/i.test(o.material.name) ? 3.5 : 0.45;
        o.castShadow = false;
        if (/bulb/i.test(o.material.name)) {
          o.geometry.computeBoundingBox();
          bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
        }
      }
    });
    if (!bb.isEmpty()) bb.getCenter(this.lampTop);

    // Extract crate body and lid for physical destructible fragmentation
    this.glb.crate.traverse(o => {
      if (!o.isMesh) return;
      if (/lid|Cube\.008/i.test(o.name) || /lid/i.test(o.parent?.name || '')) {
        this.crateLid = o;
      } else {
        this.crateBody = o;
      }
    });

    // Build AnimationClips for man and soldier
    const idleZ0 = this.anims.Idle.hipsY[2];
    const soldierHips = this.glb.soldier.getObjectByName('Hips');
    const sx = soldierHips ? soldierHips.position.x : 10.1182;
    const sy = soldierHips ? soldierHips.position.y : 10.9295;
    const sz = soldierHips ? soldierHips.position.z : -27.2223;

    for (const cn in this.anims) {
      const c = this.anims[cn];
      const times = [];
      for (let i = 0; i < c.n; i++) times.push(i / 30);

      const manTracks = [new THREE.VectorKeyframeTrack('Hips.position', times, c.hipsY)];
      const solHipsPos = new Float32Array(c.hipsY.length);
      for (let i = 0; i < c.n; i++) {
        solHipsPos[i * 3] = sx;
        solHipsPos[i * 3 + 1] = sy;
        solHipsPos[i * 3 + 2] = sz + (c.hipsY[i * 3 + 2] - idleZ0);
      }
      const solTracks = [new THREE.VectorKeyframeTrack('Hips.position', times, solHipsPos)];

      for (const b in c.q) {
        manTracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, c.q[b]));
        solTracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, c.q[b]));
      }
      this.manClips[cn] = new THREE.AnimationClip(cn, c.dur, manTracks);
      this.soldierClips[cn] = new THREE.AnimationClip(cn, c.dur, solTracks);
    }

    for (const key in this.mixamoAnims) {
      const c = this.mixamoAnims[key];
      if (!c?.man || !c?.soldier) continue;
      const clips = this._motionClips(key, c);
      this.manClips[key] = clips.man;
      this.soldierClips[key] = clips.soldier;
      delete c.man;
      delete c.soldier;
    }

    this.manClips.RelaxIdle = this._buildRelaxIdleClip(this.glb.man);
    this.soldierClips.RelaxIdle = this._buildRelaxIdleClip(this.glb.soldier);

    this.manMetrics = this._measureRig(this.glb.man, this.manClips.Idle);
    this.soldierMetrics = this._measureRig(this.glb.soldier, this.soldierClips.Idle);
  }

  _motionClips(key, tracks) {
    const { n, family, stance } = this.mixamoAnims[key];
    const man = this._clipFromTracks(key, n, tracks.man);
    const soldier = this._clipFromTracks(key, n, tracks.soldier);
    man.userData.family = soldier.userData.family = family || key;
    man.userData.stance = soldier.userData.stance = stance;
    return { man, soldier };
  }

  async loadMotion(key) {
    if (this.manClips[key]) return { man: this.manClips[key], soldier: this.soldierClips[key] };
    const cached = this.previewMotions.get(key);
    if (cached) {
      this.previewMotions.delete(key);
      this.previewMotions.set(key, cached);
      return cached;
    }
    const item = this.mixamoAnims[key];
    if (!item?.file) throw new Error('找不到动作文件');
    if (!this.pendingMotions.has(key)) {
      const request = fetch('assets/chars/' + item.file).then(r => {
        if (!r.ok) throw new Error('动作文件加载失败');
        return r.json();
      }).then(tracks => {
        const clips = this._motionClips(key, tracks);
        this.previewMotions.set(key, clips);
        if (this.previewMotions.size > 8) this.previewMotions.delete(this.previewMotions.keys().next().value);
        return clips;
      }).finally(() => this.pendingMotions.delete(key));
      this.pendingMotions.set(key, request);
    }
    return this.pendingMotions.get(key);
  }

  _clipFromTracks(name, n, { hips, q, turnYaw }) {
    const times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = i / 30;
    const tracks = [new THREE.VectorKeyframeTrack('Hips.position', times, hips)];
    for (const b in q) tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, q[b]));
    const clip = new THREE.AnimationClip(name, (n - 1) / 30, tracks);
    clip.userData = { turnYaw };
    return clip;
  }

  _buildRelaxIdleClip(rigRoot) {
    const tmp = rigRoot.clone(true);
    tmp.rotation.y = Math.PI / 2;
    const B = {};
    tmp.traverse(o => {
      if (o.isBone && !B[o.name]) B[o.name] = o;
    });
    tmp.updateMatrixWorld(true);

    const point = (b, x, y, z) => {
      if (!b) return;
      const ch = b.children.find(c => c.isBone);
      if (!ch) return;
      b.updateWorldMatrix(true, true);
      const cur = ch.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
      const dq = new THREE.Quaternion().setFromUnitVectors(cur, new THREE.Vector3(x, y, z).normalize());
      const wq = b.getWorldQuaternion(new THREE.Quaternion());
      const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
      b.updateWorldMatrix(false, true);
    };

    const mulEuler = (b, rx, ry, rz) => {
      if (!b) return;
      b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)));
    };

    // Upright relaxed standing posture (soft knees, feet flush with Walk/Run ground plane, arms relaxed at sides)
    if (B.Hips) {
      B.Hips.position.z += 2.15;
      mulEuler(B.Hips, 0, 0, 0.055);
    }
    mulEuler(B.Spine, 0.03, 0, -0.02);
    mulEuler(B.LeftUpLeg, 0.06, 0, 0.03);
    mulEuler(B.LeftLeg, -0.11, 0, 0);
    mulEuler(B.RightUpLeg, -0.02, 0, -0.03);
    mulEuler(B.RightLeg, -0.07, 0, 0);

    point(B.LeftArm, 0.02, -0.97, -0.14);
    point(B.LeftForeArm, 0.24, -0.96, 0.04);
    point(B.RightArm, 0.08, -0.96, 0.16);
    point(B.RightForeArm, 0.42, -0.89, 0.03);

    const trackBones = [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'
    ].filter(n => B[n]);

    const baseQ = {};
    for (const n of trackBones) baseQ[n] = B[n].quaternion.clone();
    const baseHips = B.Hips ? B.Hips.position.clone() : new THREE.Vector3();

    const N = 49;
    const dur = 2.6;
    const times = new Float32Array(N);
    const hipsPos = new Float32Array(N * 3);
    const qArrays = {};
    for (const n of trackBones) qArrays[n] = new Float32Array(N * 4);

    const qTmp = new THREE.Quaternion();
    const eTmp = new THREE.Euler();

    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * dur;
      const th = (i / (N - 1)) * Math.PI * 2;
      times[i] = t;

      hipsPos[i * 3] = baseHips.x;
      hipsPos[i * 3 + 1] = baseHips.y + Math.sin(th) * 0.08;
      hipsPos[i * 3 + 2] = baseHips.z + Math.sin(th) * 0.22;

      for (const n of trackBones) {
        qTmp.copy(baseQ[n]);
        if (n === 'Spine1') {
          qTmp.multiply(new THREE.Quaternion().setFromEuler(eTmp.set(Math.sin(th) * 0.016, 0, 0)));
        } else if (n === 'Spine2') {
          qTmp.multiply(new THREE.Quaternion().setFromEuler(eTmp.set(-0.015 + Math.sin(th - 0.35) * 0.022, Math.cos(th) * 0.014, 0)));
        } else if (n === 'Head') {
          qTmp.multiply(new THREE.Quaternion().setFromEuler(eTmp.set(0.02 - Math.sin(th - 0.35) * 0.016, Math.cos(th) * 0.024, 0)));
        } else if (n === 'LeftArm') {
          qTmp.multiply(new THREE.Quaternion().setFromEuler(eTmp.set(Math.sin(th - 0.5) * 0.015, 0, -Math.sin(th) * 0.01)));
        } else if (n === 'RightArm') {
          qTmp.multiply(new THREE.Quaternion().setFromEuler(eTmp.set(Math.sin(th - 0.2) * 0.014, 0, Math.sin(th) * 0.01)));
        }
        qTmp.toArray(qArrays[n], i * 4);
      }
    }

    const tracks = [new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos)];
    for (const n of trackBones) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, qArrays[n]));
    }
    return new THREE.AnimationClip('RelaxIdle', dur, tracks);
  }

  _measureRig(rigRoot, idleClip) {
    const tmp = rigRoot.clone(true);
    tmp.rotation.y = Math.PI / 2;
    const mixer = new THREE.AnimationMixer(tmp);
    const act = mixer.clipAction(idleClip);
    act.play();
    mixer.update(0);
    tmp.updateMatrixWorld(true);

    let fy = 0;
    let ty = 1.7;
    const hipsPos = new THREE.Vector3();
    tmp.traverse(o => {
      if (o.isBone && o.name === 'LeftToeBase') fy = o.getWorldPosition(new THREE.Vector3()).y;
      if (o.isBone && o.name === 'HeadTop_End') ty = o.getWorldPosition(new THREE.Vector3()).y;
      if (o.isBone && o.name === 'Hips') o.getWorldPosition(hipsPos);
    });
    const scale = 1.78 / Math.max(0.5, ty - fy + 0.06);
    const footY = (0.055 - fy) * scale;
    const offX = -hipsPos.x * scale;
    const offZ = -hipsPos.z * scale;
    return { scale, footY, offX, offZ };
  }

  _buildProceduralTextures() {
    this.procTex.glow = makeCanvasTexture(128, 128, c => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,228,175,0.95)');
      g.addColorStop(0.22, 'rgba(255,186,98,0.45)');
      g.addColorStop(0.55, 'rgba(255,160,60,0.12)');
      g.addColorStop(1, 'rgba(255,140,40,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    });
    this.procTex.glow.wrapS = this.procTex.glow.wrapT = THREE.ClampToEdgeWrapping;

    this.procTex.walnut = makeCanvasTexture(128, 128, c => {
      c.fillStyle = '#4e2f1b';
      c.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 2) {
        c.fillStyle = y % 6 === 0 ? 'rgba(25,12,5,0.28)' : 'rgba(115,72,42,0.18)';
        c.fillRect(0, y, 128, 2);
      }
      for (let i = 0; i < 40; i++) {
        c.fillStyle = 'rgba(20,8,2,0.16)';
        c.fillRect(Math.random() * 100, Math.random() * 126, 20 + Math.random() * 40, 1);
      }
    }, 1, 1);

    this.procTex.burlap = makeCanvasTexture(128, 128, c => {
      c.fillStyle = '#8b7958';
      c.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 128; i += 4) {
        c.fillStyle = i % 8 === 0 ? 'rgba(40,32,18,0.15)' : 'rgba(210,192,155,0.12)';
        c.fillRect(i, 0, 2, 128);
        c.fillRect(0, i, 128, 2);
      }
    }, 2, 2);

    this.procTex.plank = makeCanvasTexture(128, 128, c => {
      c.fillStyle = '#7e5932';
      c.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = ['#704e2a', '#8a6237', '#674624'][i % 3];
        c.fillRect(0, i * 22, 128, 20);
      }
      c.fillStyle = 'rgba(25,15,5,0.35)';
      for (let i = 0; i < 12; i++) c.fillRect(0, i * 11, 128, 1);
    }, 1, 1);

    this.procTex.roofTile = makeCanvasTexture(128, 128, c => {
      c.fillStyle = '#1b1d24';
      c.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) {
        c.fillStyle = '#252832';
        c.fillRect(0, y, 128, 8);
        c.fillStyle = '#111319';
        c.fillRect(0, y + 13, 128, 3);
      }
      for (let x = 0; x < 128; x += 16) {
        c.fillStyle = 'rgba(10,12,16,0.45)';
        c.fillRect(x, 0, 2, 128);
      }
    }, 4, 4);

    this.procTex.ao = makeCanvasTexture(4, 64, c => {
      const g = c.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.68)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 4, 64);
    }, 1, 1, false);
    this.procTex.ao.wrapS = this.procTex.ao.wrapT = THREE.ClampToEdgeWrapping;

    this.procTex.moon = makeCanvasTexture(128, 128, c => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.28, '#e8eeff');
      g.addColorStop(0.35, 'rgba(170,190,255,0.38)');
      g.addColorStop(1, 'rgba(150,170,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }, 1, 1);

    this.procTex.cloud = makeCanvasTexture(128, 128, c => {
      c.clearRect(0, 0, 128, 128);
      const puffs = [
        [64, 64, 52, 0.85],
        [44, 52, 34, 0.72],
        [84, 54, 34, 0.72],
        [52, 82, 32, 0.68],
        [78, 80, 32, 0.68]
      ];
      for (const [cx, cy, rad, a] of puffs) {
        const g = c.createRadialGradient(cx, cy, 2, cx, cy, rad);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.45, `rgba(245,245,245,${a * 0.62})`);
        g.addColorStop(1, 'rgba(220,220,220,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
      }
    }, 1, 1);
    this.procTex.cloud.wrapS = this.procTex.cloud.wrapT = THREE.ClampToEdgeWrapping;

    this.procTex.flame = makeCanvasTexture(96, 160, c => {
      c.clearRect(0, 0, 96, 160);
      const tongues = [
        [48, 118, 30, 0.92],
        [40, 86, 24, 0.78],
        [56, 82, 24, 0.75],
        [48, 50, 18, 0.62],
        [48, 28, 11, 0.38]
      ];
      for (const [cx, cy, rad, a] of tongues) {
        const g = c.createRadialGradient(cx, cy, 1, cx, cy, rad);
        g.addColorStop(0, `rgba(255,250,210,${a})`);
        g.addColorStop(0.38, `rgba(255,148,42,${a * 0.82})`);
        g.addColorStop(0.75, `rgba(210,48,14,${a * 0.38})`);
        g.addColorStop(1, 'rgba(120,16,6,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 96, 160);
      }
    }, 1, 1);
    this.procTex.flame.wrapS = this.procTex.flame.wrapT = THREE.ClampToEdgeWrapping;
  }

  pbr(id, extra = {}) {
    const t = this.tex[id] || Object.values(this.tex).find(x => x?.diff) || {};
    return new THREE.MeshStandardMaterial({
      map: t.diff || null,
      normalMap: t.nor || null,
      roughnessMap: t.rough || null,
      roughness: 1,
      ...extra
    });
  }
}
