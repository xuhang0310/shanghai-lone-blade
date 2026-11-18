import * as THREE from 'three';
import { buildMultiMatGeometry } from '../utils/GeometryBuilder.js';

export const WEAPON_TIPS = {
  knife: 0.22,
  pistol: 0.34,
  browning: 0.30,
  revolver: 0.33,
  mp18: 0.62,
  smg: 0.64,
  shotgun: 0.84,
  rifle: 0.94,
  zb26: 0.92
};

export class WeaponFactory {
  constructor(gameRenderer) {
    this.gr = gameRenderer;
    this.geos = {};
    this.previews = {};
    this.materials = [
      this.gr.M.gunSteel, // 0
      this.gr.M.walnut,   // 1
      this.gr.M.brass     // 2
    ];
    this._buildAll();
  }

  _buildAll() {
    const G = this.gr.G;
    const R = Math.PI / 2;

    // 1. Combat Dagger
    this.geos.knife = buildMultiMatGeometry([
      { geo: G.box, pos: [0.13, 0, 0], scale: [0.2, 0.008, 0.034], matIndex: 0 },
      { geo: G.box, pos: [0.035, 0, 0], scale: [0.015, 0.016, 0.07], matIndex: 2 },
      { geo: G.cylLo, pos: [-0.025, 0, 0], rot: [0, 0, R], scale: [0.016, 0.11, 0.016], matIndex: 1 }
    ]);

    // 2. Mauser C96 "Box Cannon" (毛瑟驳壳枪 / 盒子炮)
    this.geos.pistol = buildMultiMatGeometry([
      { geo: G.box, pos: [0.06, 0.035, 0], scale: [0.16, 0.048, 0.032], matIndex: 0 },        // upper receiver
      { geo: G.cyl, pos: [0.22, 0.044, 0], rot: [0, 0, R], scale: [0.013, 0.21, 0.013], matIndex: 0 }, // slender barrel
      { geo: G.box, pos: [0.095, -0.022, 0], scale: [0.052, 0.08, 0.028], matIndex: 0 },      // forward box mag
      { geo: G.box, pos: [0.32, 0.06, 0], scale: [0.014, 0.016, 0.008], matIndex: 2 },        // brass front sight
      { geo: G.box, pos: [-0.015, 0.062, 0], scale: [0.025, 0.016, 0.022], matIndex: 2 },     // hammer / rear sight
      { geo: G.cylLo, pos: [-0.035, -0.045, 0], rot: [0, 0, 0.28], scale: [0.02, 0.115, 0.018], matIndex: 1 } // broomhandle grip
    ]);

    // 3. Thompson M1928 SMG (汤姆逊冲锋枪 + 圆盘弹鼓)
    const smgEntries = [
      { geo: G.box, pos: [0.12, 0.035, 0], scale: [0.3, 0.062, 0.046], matIndex: 0 },         // receiver
      { geo: G.cyl, pos: [0.43, 0.042, 0], rot: [0, 0, R], scale: [0.016, 0.36, 0.016], matIndex: 0 }, // barrel
      { geo: G.cylLo, pos: [0.61, 0.042, 0], rot: [0, 0, R], scale: [0.02, 0.05, 0.02], matIndex: 0 }, // compensator
      { geo: G.cyl, pos: [0.18, -0.065, 0], rot: [R, 0, 0], scale: [0.095, 0.052, 0.095], matIndex: 0 }, // 50rd drum mag
      { geo: G.cylLo, pos: [0.18, -0.065, 0], rot: [R, 0, 0], scale: [0.032, 0.062, 0.032], matIndex: 2 }, // brass drum key
      { geo: G.box, pos: [-0.15, 0.0, 0], rot: [0, 0, -0.14], scale: [0.26, 0.078, 0.038], matIndex: 1 }, // walnut stock
      { geo: G.box, pos: [0.02, -0.04, 0], rot: [0, 0, 0.24], scale: [0.04, 0.1, 0.034], matIndex: 1 }, // rear grip
      { geo: G.box, pos: [0.35, -0.038, 0], rot: [0, 0, -0.15], scale: [0.042, 0.105, 0.036], matIndex: 1 } // foregrip
    ];
    for (let x = 0.28; x <= 0.42; x += 0.028) {
      smgEntries.push({ geo: G.cylLo, pos: [x, 0.042, 0], rot: [0, 0, R], scale: [0.024, 0.008, 0.024], matIndex: 0 });
    }
    this.geos.smg = buildMultiMatGeometry(smgEntries);

    // 4. Winchester M1897 Trench Shotgun (温彻斯特霰弹枪)
    this.geos.shotgun = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.47, 0.048, 0], rot: [0, 0, R], scale: [0.017, 0.68, 0.017], matIndex: 0 }, // main barrel
      { geo: G.cyl, pos: [0.42, 0.022, 0], rot: [0, 0, R], scale: [0.014, 0.54, 0.014], matIndex: 0 }, // mag tube
      { geo: G.box, pos: [0.07, 0.034, 0], scale: [0.22, 0.058, 0.042], matIndex: 0 },                 // receiver
      { geo: G.cylLo, pos: [0.58, 0.044, 0], rot: [0, 0, R], scale: [0.023, 0.24, 0.023], matIndex: 0 }, // heat shield
      { geo: G.box, pos: [0.80, 0.068, 0], scale: [0.014, 0.012, 0.01], matIndex: 2 },                  // brass bead
      { geo: G.cylLo, pos: [0.36, 0.018, 0], rot: [0, 0, R], scale: [0.026, 0.18, 0.026], matIndex: 1 }, // pump forend
      { geo: G.box, pos: [-0.20, -0.025, 0], rot: [0, 0, -0.15], scale: [0.28, 0.095, 0.04], matIndex: 1 } // stock
    ]);

    // 5. Chiang Kai-shek Mauser Rifle (中正式步枪)
    this.geos.rifle = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.52, 0.048, 0], rot: [0, 0, R], scale: [0.014, 0.80, 0.014], matIndex: 0 }, // long barrel
      { geo: G.box, pos: [0.07, 0.044, 0], scale: [0.22, 0.044, 0.036], matIndex: 0 },                 // bolt receiver
      { geo: G.cylLo, pos: [0.05, 0.048, 0.032], scale: [0.008, 0.05, 0.008], matIndex: 0 },           // bolt handle
      { geo: G.box, pos: [0.24, 0.02, 0], scale: [0.68, 0.052, 0.04], matIndex: 1 },                   // full walnut stock
      { geo: G.box, pos: [-0.22, -0.024, 0], rot: [0, 0, -0.14], scale: [0.30, 0.098, 0.04], matIndex: 1 }, // buttstock
      { geo: G.box, pos: [0.46, 0.032, 0], scale: [0.022, 0.058, 0.046], matIndex: 2 },                // brass barrel band
      { geo: G.box, pos: [0.66, 0.032, 0], scale: [0.02, 0.054, 0.044], matIndex: 2 },                 // front band
      { geo: G.box, pos: [0.90, 0.068, 0], scale: [0.014, 0.016, 0.01], matIndex: 2 }                  // front sight
    ]);

    // 6. Browning M1911 .45 Pistol (勃朗宁 M1911)
    this.geos.browning = buildMultiMatGeometry([
      { geo: G.box, pos: [0.095, 0.036, 0], scale: [0.24, 0.044, 0.032], matIndex: 0 },      // slab-sided slide
      { geo: G.cyl, pos: [0.225, 0.036, 0], rot: [0, 0, R], scale: [0.012, 0.04, 0.012], matIndex: 0 }, // muzzle bushing
      { geo: G.box, pos: [0.025, 0.008, 0], scale: [0.12, 0.024, 0.028], matIndex: 0 },      // lower dust cover
      { geo: G.box, pos: [-0.01, -0.045, 0], rot: [0, 0, 0.22], scale: [0.042, 0.11, 0.028], matIndex: 0 }, // grip frame
      { geo: G.box, pos: [-0.01, -0.045, 0], rot: [0, 0, 0.22], scale: [0.034, 0.088, 0.033], matIndex: 1 }, // walnut panels
      { geo: G.box, pos: [0.20, 0.062, 0], scale: [0.014, 0.012, 0.008], matIndex: 2 },       // brass front blade
      { geo: G.box, pos: [-0.01, 0.061, 0], scale: [0.02, 0.012, 0.018], matIndex: 0 }        // rear notch
    ]);

    // 7. Smith & Wesson M1917 Revolver (史密斯威森 M1917 左轮)
    this.geos.revolver = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.175, 0.04, 0], rot: [0, 0, R], scale: [0.014, 0.19, 0.014], matIndex: 0 }, // ribbed barrel
      { geo: G.box, pos: [0.055, 0.048, 0], scale: [0.095, 0.016, 0.022], matIndex: 0 },     // top strap
      { geo: G.box, pos: [0.055, 0.008, 0], scale: [0.095, 0.02, 0.024], matIndex: 0 },      // lower frame
      { geo: G.cyl, pos: [0.055, 0.028, 0], rot: [0, 0, R], scale: [0.026, 0.052, 0.026], matIndex: 0 }, // 6-shot cylinder
      { geo: G.cylLo, pos: [0.055, 0.028, 0], rot: [0, 0, R], scale: [0.0275, 0.014, 0.0275], matIndex: 2 }, // brass extractor collar
      { geo: G.box, pos: [-0.028, -0.038, 0], rot: [0, 0, 0.42], scale: [0.038, 0.115, 0.028], matIndex: 1 }, // curved walnut grip
      { geo: G.box, pos: [0.258, 0.058, 0], scale: [0.014, 0.014, 0.008], matIndex: 2 }      // brass blade sight
    ]);

    // 8. Bergmann MP18 "Flower Organ" SMG (伯格曼花机关)
    const mp18Entries = [
      { geo: G.cyl, pos: [0.21, 0.038, 0], rot: [0, 0, R], scale: [0.022, 0.56, 0.022], matIndex: 0 }, // perforated tubular shroud
      { geo: G.cyl, pos: [0.54, 0.038, 0], rot: [0, 0, R], scale: [0.013, 0.14, 0.013], matIndex: 0 }, // protruding barrel
      { geo: G.box, pos: [0.25, 0.032, -0.14], rot: [0, 0.18, 0], scale: [0.038, 0.044, 0.25], matIndex: 0 }, // side horizontal magwell + mag
      { geo: G.box, pos: [0.25, 0.032, -0.26], scale: [0.042, 0.048, 0.026], matIndex: 2 }, // brass mag endcap
      { geo: G.box, pos: [0.09, 0.006, 0], scale: [0.34, 0.052, 0.042], matIndex: 1 },      // carbine walnut body
      { geo: G.box, pos: [-0.19, -0.026, 0], rot: [0, 0, -0.14], scale: [0.28, 0.092, 0.04], matIndex: 1 }, // buttstock
      { geo: G.box, pos: [0.56, 0.062, 0], scale: [0.014, 0.014, 0.008], matIndex: 2 }      // front sight
    ];
    for (let x = 0.28; x <= 0.46; x += 0.036) {
      mp18Entries.push({ geo: G.cylLo, pos: [x, 0.038, 0], rot: [0, 0, R], scale: [0.025, 0.01, 0.025], matIndex: 2 });
    }
    this.geos.mp18 = buildMultiMatGeometry(mp18Entries);

    // 9. ZB-26 Light Machine Gun (捷克式轻机枪)
    const zbEntries = [
      { geo: G.box, pos: [0.10, 0.036, 0], scale: [0.32, 0.068, 0.054], matIndex: 0 },      // heavy machined receiver
      { geo: G.cyl, pos: [0.56, 0.048, 0], rot: [0, 0, R], scale: [0.016, 0.66, 0.016], matIndex: 0 }, // long finned barrel
      { geo: G.cyl, pos: [0.46, 0.018, 0], rot: [0, 0, R], scale: [0.013, 0.44, 0.013], matIndex: 0 }, // lower gas cylinder
      { geo: G.box, pos: [0.12, 0.16, 0], rot: [0, 0, -0.08], scale: [0.058, 0.22, 0.034], matIndex: 0 }, // top 20-rd vertical mag
      { geo: G.box, pos: [0.12, 0.27, 0], rot: [0, 0, -0.08], scale: [0.062, 0.02, 0.038], matIndex: 2 }, // brass mag floorplate
      { geo: G.box, pos: [-0.21, -0.02, 0], rot: [0, 0, -0.12], scale: [0.30, 0.105, 0.046], matIndex: 1 }, // heavy walnut buttstock
      { geo: G.box, pos: [-0.01, -0.05, 0], rot: [0, 0, 0.24], scale: [0.042, 0.11, 0.036], matIndex: 1 }, // pistol grip
      { geo: G.cylLo, pos: [0.68, -0.08, -0.045], rot: [0.18, 0, -0.25], scale: [0.012, 0.24, 0.012], matIndex: 0 }, // folded bipod L
      { geo: G.cylLo, pos: [0.68, -0.08, 0.045], rot: [-0.18, 0, -0.25], scale: [0.012, 0.24, 0.012], matIndex: 0 }, // folded bipod R
      { geo: G.box, pos: [0.86, 0.072, 0], scale: [0.016, 0.018, 0.01], matIndex: 2 }       // front blade sight
    ];
    for (let x = 0.29; x <= 0.48; x += 0.032) {
      zbEntries.push({ geo: G.cylLo, pos: [x, 0.048, 0], rot: [0, 0, R], scale: [0.026, 0.008, 0.026], matIndex: 0 });
    }
    this.geos.zb26 = buildMultiMatGeometry(zbEntries);
  }

  generatePreviews(weapons) {
    const renderer = this.gr.renderer;
    const W = 320;
    const H = 150;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, W / H, 0.05, 10);

    const amb = new THREE.AmbientLight(0xdbe6ff, 1.35);
    const key = new THREE.DirectionalLight(0xffebc8, 2.8);
    key.position.set(2.2, 3.0, 2.6);
    const rim = new THREE.DirectionalLight(0x7aa4e6, 1.6);
    rim.position.set(-2.5, 1.4, -2.0);
    sc.add(amb, key, rim);

    const buf = new Uint8Array(W * H * 4);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    const tmpCv = document.createElement('canvas');
    tmpCv.width = W;
    tmpCv.height = H;
    const tmpCtx = tmpCv.getContext('2d');

    const prevRT = renderer.getRenderTarget();
    const prevCol = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();

    for (const w of weapons) {
      if (this.previews[w.modelKey]) continue;
      const mesh = this.createWeaponMesh(w.modelKey);
      mesh.rotation.set(0.12, -0.22, 0);
      sc.add(mesh);
      mesh.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x / 1.85, size.y * 1.1, size.z) || 0.5;
      const dist = span / Math.tan((cam.fov * Math.PI) / 360) * 1.12;
      cam.position.set(center.x, center.y + span * 0.08, center.z + dist);
      cam.lookAt(center);

      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(sc, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);

      sc.remove(mesh);

      // Draw crisp blueprint background
      ctx.fillStyle = '#0c121e';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(217,164,65,0.09)';
      ctx.lineWidth = 1;
      for (let gx = 20; gx < W; gx += 20) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 20; gy < H; gy += 20) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Flip Y and apply subtle gamma lift so gunsteel/walnut details pop
      const imgData = tmpCtx.createImageData(W, H);
      const dst = imgData.data;
      for (let y = 0; y < H; y++) {
        const srcRow = (H - 1 - y) * W * 4;
        const dstRow = y * W * 4;
        for (let x = 0; x < W; x++) {
          const si = srcRow + x * 4;
          const di = dstRow + x * 4;
          const a = buf[si + 3];
          if (a > 6) {
            dst[di] = Math.min(255, Math.pow(buf[si] / 255, 0.72) * 255);
            dst[di + 1] = Math.min(255, Math.pow(buf[si + 1] / 255, 0.72) * 255);
            dst[di + 2] = Math.min(255, Math.pow(buf[si + 2] / 255, 0.72) * 255);
            dst[di + 3] = a;
          } else {
            dst[di + 3] = 0;
          }
        }
      }
      tmpCtx.putImageData(imgData, 0, 0);
      ctx.drawImage(tmpCv, 0, 0);

      // Subtle brass blueprint corner brackets
      ctx.strokeStyle = 'rgba(217,164,65,0.42)';
      ctx.lineWidth = 1.5;
      for (const [cx, cy, dx, dy] of [[6, 6, 10, 10], [W - 6, 6, -10, 10], [6, H - 6, 10, -10], [W - 6, H - 6, -10, -10]]) {
        ctx.beginPath(); ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy); ctx.stroke();
      }
      this.previews[w.modelKey] = cv.toDataURL('image/png');
    }

    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevCol, prevAlpha);
    rt.dispose();
  }

  getGeometry(kind) {
    return this.geos[kind] || this.geos.pistol;
  }

  createWeaponMesh(kind = 'pistol') {
    const mesh = new THREE.Mesh(this.getGeometry(kind), this.materials);
    mesh.castShadow = true;
    return mesh;
  }
}
