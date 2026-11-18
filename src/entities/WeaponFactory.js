import * as THREE from 'three';
import { buildMultiMatGeometry } from '../utils/GeometryBuilder.js';

export const WEAPON_TIPS = {
  knife: 0.22,
  pistol: 0.34,
  smg: 0.64,
  shotgun: 0.84,
  rifle: 0.94
};

export class WeaponFactory {
  constructor(gameRenderer) {
    this.gr = gameRenderer;
    this.geos = {};
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
