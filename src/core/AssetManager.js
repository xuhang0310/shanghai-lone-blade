import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LEVELS } from '../config/constants.js';

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
    this.manClips = {};
    this.soldierClips = {};
    this.skinImg = null;
    this.soldierImg = null;
    this.manNor = null;
    this.manOrm = null;
    this.lampTop = new THREE.Vector3(0, 3.6, 0);
    this.crateBody = null;
    this.crateLid = null;
    this.manMetrics = { scale: 1, footY: 0, offX: 0, offZ: 0 };
    this.soldierMetrics = { scale: 1, footY: 0, offX: 0, offZ: 0 };
    this.procTex = {};
  }

  async loadAll(onProgress) {
    const tl = new THREE.TextureLoader();
    const gl = new GLTFLoader();
    const jobs = [];
    let done = 0;

    const track = p => {
      jobs.push(
        p.then(
          val => {
            done++;
            onProgress?.(done / jobs.length);
            return val;
          },
          err => {
            console.error('Asset load error:', err);
            throw err;
          }
        )
      );
    };

    const texIds = [...new Set(LEVELS.flatMap(l => [l.ground, ...l.walls]))];
    for (const id of texIds) {
      this.tex[id] = {};
      for (const k of ['diff', 'nor', 'rough']) {
        track(
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
        );
      }
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

    for (const [k, dir] of [
      ['crate', 'models'],
      ['barrel', 'models'],
      ['lamp', 'models'],
      ['man', 'chars'],
      ['soldier', 'chars']
    ]) {
      track(
        new Promise((resolve, reject) => {
          gl.load(
            `assets/${dir}/${k}.json`,
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
                } else if (t.diff) {
                  wait.push(loadModelTex(dir, t.diff, true).then(x => { m.map = x; m.needsUpdate = true; }));
                }
                if (t.nor) {
                  wait.push(loadModelTex(dir, t.nor, false).then(x => { m.normalMap = x; m.needsUpdate = true; }));
                }
                if (t.orm) {
                  wait.push(loadModelTex(dir, t.orm, false).then(x => {
                    m.roughnessMap = x;
                    m.metalnessMap = x;
                    m.needsUpdate = true;
                  }));
                }
              });
              Promise.all(wait).then(resolve, reject);
            },
            undefined,
            reject
          );
        })
      );
    }

    track(fetch('assets/chars/anims.json').then(r => r.json()).then(j => { this.anims = j; }));
    track(new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { this.skinImg = im; resolve(); };
      im.onerror = reject;
      im.src = 'assets/chars/man_diff.png';
    }));
    track(new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { this.soldierImg = im; resolve(); };
      im.onerror = reject;
      im.src = 'assets/chars/soldier.png';
    }));
    track(loadModelTex('chars', 'man_nor.jpg', false).then(t => { this.manNor = t; }));
    track(loadModelTex('chars', 'man_orm.jpg', false).then(t => { this.manOrm = t; }));

    await Promise.all(jobs);
    this._prepAssets();
    this._buildProceduralTextures();
  }

  _prepAssets() {
    for (const k in this.glb) {
      this.glb[k].updateMatrixWorld(true);
      this.glb[k].traverse(o => {
        if (o.isMesh) {
          o.geometry.userData.shared = true;
          o.castShadow = true;
          o.receiveShadow = k !== 'man' && k !== 'soldier';
        }
        if (o.isBone) o.name = o.name.replace(/^mixamorig:?/, '');
      });
    }

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

    this.manMetrics = this._measureRig(this.glb.man, this.manClips.Idle);
    this.soldierMetrics = this._measureRig(this.glb.soldier, this.soldierClips.Idle);
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
    const t = this.tex[id];
    return new THREE.MeshStandardMaterial({
      map: t.diff,
      normalMap: t.nor,
      roughnessMap: t.rough,
      roughness: 1,
      ...extra
    });
  }
}
