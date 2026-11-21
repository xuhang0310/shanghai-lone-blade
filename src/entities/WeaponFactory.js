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
  zb26: 0.92,
  sniper: 1.04
};

export class WeaponFactory {
  constructor(gameRenderer) {
    this.gr = gameRenderer;
    this.geos = {};
    this.previews = {};
    this.hudIcons = {};
    this.cutoutUrls = {};
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

    // Helper: trigger guard + curved trigger assembly
    const trig = (tx, ty) => [
      { geo: G.torus, pos: [tx, ty, 0], scale: [0.22, 0.16, 0.12], matIndex: 0 },
      { geo: G.box, pos: [tx + 0.004, ty + 0.004, 0], rot: [0, 0, 0.35], scale: [0.006, 0.022, 0.006], matIndex: 2 }
    ];

    // 1. Combat Dagger
    this.geos.knife = buildMultiMatGeometry([
      { geo: G.box, pos: [0.13, 0, 0], scale: [0.2, 0.008, 0.034], matIndex: 0 },
      { geo: G.box, pos: [0.035, 0, 0], scale: [0.015, 0.016, 0.07], matIndex: 2 },
      { geo: G.cylLo, pos: [-0.025, 0, 0], rot: [0, 0, R], scale: [0.016, 0.11, 0.016], matIndex: 1 }
    ]);

    // 2. Mauser C96 "Box Cannon" (毛瑟 C96 二十响驳壳枪)
    const c96 = [
      { geo: G.box, pos: [0.06, 0.036, 0], scale: [0.165, 0.048, 0.032], matIndex: 0 },       // machined receiver
      { geo: G.box, pos: [0.055, 0.062, 0], scale: [0.095, 0.012, 0.024], matIndex: 0 },      // upper bolt bridge
      { geo: G.cyl, pos: [0.225, 0.044, 0], rot: [0, 0, R], scale: [0.013, 0.22, 0.013], matIndex: 0 }, // stepped barrel
      { geo: G.cylLo, pos: [0.15, 0.044, 0], rot: [0, 0, R], scale: [0.017, 0.06, 0.017], matIndex: 0 }, // barrel chamber taper
      { geo: G.box, pos: [0.098, -0.022, 0], scale: [0.058, 0.082, 0.027], matIndex: 0 },     // 20-rd integral box mag
      { geo: G.box, pos: [0.098, -0.064, 0], scale: [0.062, 0.008, 0.03], matIndex: 2 },      // brass mag floorplate
      { geo: G.box, pos: [0.325, 0.06, 0], scale: [0.014, 0.018, 0.008], matIndex: 2 },       // front blade sight
      { geo: G.box, pos: [0.08, 0.068, 0], scale: [0.032, 0.01, 0.014], matIndex: 2 },        // tangent rear sight
      { geo: G.torus, pos: [-0.024, 0.056, 0], scale: [0.13, 0.13, 0.12], matIndex: 0 },      // iconic ring hammer
      { geo: G.cylLo, pos: [-0.036, -0.048, 0], rot: [0, 0, 0.28], scale: [0.021, 0.118, 0.019], matIndex: 1 }, // broomhandle walnut grip
      { geo: G.torus, pos: [-0.056, -0.105, 0], scale: [0.11, 0.11, 0.11], matIndex: 2 },     // lanyard ring
      ...trig(0.028, -0.006)
    ];
    for (let y = -0.08; y <= -0.02; y += 0.015) {
      c96.push({ geo: G.box, pos: [-0.036 - y * 0.26, y, 0], rot: [0, 0, 0.28], scale: [0.036, 0.004, 0.04], matIndex: 2 });
    }
    this.geos.pistol = buildMultiMatGeometry(c96);

    // 3. Thompson M1928 SMG (汤姆逊冲锋枪 + 50发弹鼓)
    const smgEntries = [
      { geo: G.box, pos: [0.12, 0.038, 0], scale: [0.31, 0.062, 0.046], matIndex: 0 },        // blued steel receiver
      { geo: G.box, pos: [0.08, 0.072, 0], scale: [0.032, 0.016, 0.026], matIndex: 2 },       // Lyman rear aperture sight + actuator knob
      { geo: G.cyl, pos: [0.43, 0.044, 0], rot: [0, 0, R], scale: [0.016, 0.36, 0.016], matIndex: 0 }, // finned barrel
      { geo: G.cylLo, pos: [0.615, 0.044, 0], rot: [0, 0, R], scale: [0.022, 0.058, 0.022], matIndex: 2 }, // Cutts compensator
      { geo: G.cyl, pos: [0.185, -0.068, 0], rot: [R, 0, 0], scale: [0.102, 0.054, 0.102], matIndex: 0 }, // 50rd drum mag
      { geo: G.cylLo, pos: [0.185, -0.068, 0], rot: [R, 0, 0], scale: [0.038, 0.062, 0.038], matIndex: 2 }, // brass winding key
      { geo: G.box, pos: [-0.155, -0.006, 0], rot: [0, 0, -0.15], scale: [0.27, 0.082, 0.038], matIndex: 1 }, // contoured walnut stock
      { geo: G.box, pos: [-0.288, -0.026, 0], rot: [0, 0, -0.15], scale: [0.016, 0.088, 0.04], matIndex: 2 }, // brass buttplate
      { geo: G.box, pos: [0.02, -0.042, 0], rot: [0, 0, 0.24], scale: [0.04, 0.105, 0.034], matIndex: 1 }, // rear pistol grip
      { geo: G.box, pos: [0.36, -0.038, 0], rot: [0, 0, -0.14], scale: [0.042, 0.108, 0.036], matIndex: 1 }, // vertical foregrip
      ...trig(0.065, -0.006)
    ];
    for (let x = 0.28; x <= 0.44; x += 0.024) {
      smgEntries.push({ geo: G.cylLo, pos: [x, 0.044, 0], rot: [0, 0, R], scale: [0.025, 0.008, 0.025], matIndex: 0 });
    }
    this.geos.smg = buildMultiMatGeometry(smgEntries);

    // 4. Winchester M1897 Trench Shotgun (温彻斯特战壕霰弹枪)
    const sgEntries = [
      { geo: G.cyl, pos: [0.47, 0.048, 0], rot: [0, 0, R], scale: [0.017, 0.68, 0.017], matIndex: 0 }, // main barrel
      { geo: G.cyl, pos: [0.42, 0.02, 0], rot: [0, 0, R], scale: [0.014, 0.54, 0.014], matIndex: 0 },  // mag tube
      { geo: G.box, pos: [0.07, 0.034, 0], scale: [0.23, 0.06, 0.042], matIndex: 0 },                  // receiver
      { geo: G.box, pos: [0.09, 0.04, 0.022], scale: [0.085, 0.022, 0.006], matIndex: 2 },             // brass ejection port / carrier
      { geo: G.cylLo, pos: [0.58, 0.048, 0], rot: [0, 0, R], scale: [0.023, 0.25, 0.023], matIndex: 0 }, // perforated trench heat shield
      { geo: G.box, pos: [0.68, 0.018, 0], scale: [0.03, 0.045, 0.032], matIndex: 2 },                 // bayonet lug collar
      { geo: G.box, pos: [0.80, 0.068, 0], scale: [0.014, 0.014, 0.01], matIndex: 2 },                 // brass bead
      { geo: G.cylLo, pos: [0.36, 0.018, 0], rot: [0, 0, R], scale: [0.027, 0.19, 0.027], matIndex: 1 }, // ribbed walnut pump forend
      { geo: G.box, pos: [-0.20, -0.026, 0], rot: [0, 0, -0.15], scale: [0.29, 0.096, 0.04], matIndex: 1 }, // walnut stock
      { geo: G.box, pos: [-0.34, -0.048, 0], rot: [0, 0, -0.15], scale: [0.016, 0.10, 0.042], matIndex: 2 }, // buttplate
      ...trig(0.01, -0.008)
    ];
    this.geos.shotgun = buildMultiMatGeometry(sgEntries);

    // 5. Chiang Kai-shek Mauser Rifle (中正式步枪)
    this.geos.rifle = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.52, 0.048, 0], rot: [0, 0, R], scale: [0.014, 0.80, 0.014], matIndex: 0 }, // long barrel
      { geo: G.box, pos: [0.07, 0.046, 0], scale: [0.22, 0.044, 0.036], matIndex: 0 },                 // Mauser bolt receiver
      { geo: G.cylLo, pos: [0.05, 0.046, 0.034], rot: [R, 0, 0], scale: [0.008, 0.055, 0.008], matIndex: 2 }, // bolt handle
      { geo: G.sphLo, pos: [0.05, 0.046, 0.062], scale: [0.014, 0.014, 0.014], matIndex: 2 },          // bolt knob
      { geo: G.box, pos: [0.24, 0.02, 0], scale: [0.68, 0.054, 0.04], matIndex: 1 },                   // full walnut stock
      { geo: G.box, pos: [-0.22, -0.024, 0], rot: [0, 0, -0.14], scale: [0.30, 0.098, 0.04], matIndex: 1 }, // buttstock
      { geo: G.box, pos: [-0.365, -0.045, 0], rot: [0, 0, -0.14], scale: [0.016, 0.102, 0.042], matIndex: 2 }, // brass buttplate
      { geo: G.box, pos: [0.28, 0.068, 0], scale: [0.045, 0.014, 0.018], matIndex: 2 },                // leaf sight
      { geo: G.box, pos: [0.46, 0.032, 0], scale: [0.022, 0.058, 0.046], matIndex: 2 },                // barrel band
      { geo: G.box, pos: [0.66, 0.032, 0], scale: [0.02, 0.054, 0.044], matIndex: 2 },                 // front nosecap
      { geo: G.box, pos: [0.90, 0.068, 0], scale: [0.016, 0.018, 0.012], matIndex: 2 },                // hooded front sight
      ...trig(0.015, -0.012)
    ]);

    // 6. Browning M1911 .45 Pistol (勃朗宁 M1911)
    this.geos.browning = buildMultiMatGeometry([
      { geo: G.box, pos: [0.095, 0.038, 0], scale: [0.245, 0.045, 0.032], matIndex: 0 },     // slab-sided slide
      { geo: G.box, pos: [0.095, 0.044, 0.017], scale: [0.055, 0.018, 0.004], matIndex: 2 }, // brass ejection port
      { geo: G.cyl, pos: [0.228, 0.036, 0], rot: [0, 0, R], scale: [0.012, 0.045, 0.012], matIndex: 0 }, // muzzle bushing
      { geo: G.box, pos: [0.035, 0.01, 0], scale: [0.14, 0.022, 0.028], matIndex: 0 },       // frame & dust cover
      { geo: G.box, pos: [-0.012, -0.046, 0], rot: [0, 0, 0.22], scale: [0.044, 0.114, 0.028], matIndex: 0 }, // grip frame
      { geo: G.box, pos: [-0.012, -0.046, 0], rot: [0, 0, 0.22], scale: [0.036, 0.092, 0.034], matIndex: 1 }, // checkered walnut panels
      { geo: G.box, pos: [-0.024, -0.104, 0], rot: [0, 0, 0.22], scale: [0.048, 0.01, 0.032], matIndex: 2 },  // mag baseplate
      { geo: G.box, pos: [0.205, 0.064, 0], scale: [0.014, 0.012, 0.008], matIndex: 2 },      // front blade
      { geo: G.box, pos: [-0.01, 0.063, 0], scale: [0.02, 0.012, 0.018], matIndex: 2 },       // rear notch
      ...trig(0.035, -0.012)
    ]);

    // 7. Smith & Wesson M1917 Revolver (史密斯威森 M1917 左轮)
    this.geos.revolver = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.18, 0.042, 0], rot: [0, 0, R], scale: [0.013, 0.195, 0.013], matIndex: 0 }, // tapered barrel
      { geo: G.cylLo, pos: [0.155, 0.024, 0], rot: [0, 0, R], scale: [0.008, 0.12, 0.008], matIndex: 0 }, // underlug ejector rod
      { geo: G.box, pos: [0.055, 0.052, 0], scale: [0.10, 0.014, 0.022], matIndex: 0 },      // top strap
      { geo: G.box, pos: [0.055, 0.004, 0], scale: [0.10, 0.018, 0.024], matIndex: 0 },      // lower frame
      { geo: G.cyl, pos: [0.055, 0.028, 0], rot: [0, 0, R], scale: [0.028, 0.054, 0.028], matIndex: 0 }, // 6-shot cylinder
      { geo: G.cylLo, pos: [0.055, 0.028, 0], rot: [0, 0, R], scale: [0.0295, 0.012, 0.0295], matIndex: 2 }, // brass cylinder ring
      { geo: G.box, pos: [-0.005, 0.054, 0], rot: [0, 0, -0.4], scale: [0.018, 0.022, 0.01], matIndex: 2 }, // hammer spur
      { geo: G.box, pos: [-0.03, -0.042, 0], rot: [0, 0, 0.40], scale: [0.04, 0.118, 0.03], matIndex: 1 }, // rounded walnut grip
      { geo: G.cylLo, pos: [-0.03, -0.035, 0], rot: [R, 0, 0], scale: [0.01, 0.033, 0.01], matIndex: 2 }, // S&W brass medallion
      { geo: G.box, pos: [0.262, 0.058, 0], scale: [0.016, 0.016, 0.008], matIndex: 2 },     // half-moon sight
      ...trig(0.035, -0.016)
    ]);

    // 8. Bergmann MP18 "Flower Organ" SMG (伯格曼花机关)
    const mp18Entries = [
      { geo: G.cyl, pos: [0.22, 0.04, 0], rot: [0, 0, R], scale: [0.023, 0.56, 0.023], matIndex: 0 }, // perforated cooling jacket
      { geo: G.cyl, pos: [0.54, 0.04, 0], rot: [0, 0, R], scale: [0.013, 0.14, 0.013], matIndex: 0 }, // barrel tip
      { geo: G.box, pos: [0.25, 0.034, -0.14], rot: [0, 0.18, 0], scale: [0.04, 0.044, 0.25], matIndex: 0 }, // side horizontal mag
      { geo: G.cylLo, pos: [0.25, 0.034, -0.27], rot: [0, R, 0], scale: [0.052, 0.035, 0.052], matIndex: 2 }, // snail-drum endcap
      { geo: G.box, pos: [0.09, 0.006, 0], scale: [0.35, 0.054, 0.042], matIndex: 1 },       // carbine walnut stock
      { geo: G.box, pos: [-0.19, -0.026, 0], rot: [0, 0, -0.14], scale: [0.28, 0.094, 0.04], matIndex: 1 }, // buttstock
      { geo: G.box, pos: [-0.325, -0.045, 0], rot: [0, 0, -0.14], scale: [0.016, 0.098, 0.042], matIndex: 2 }, // brass buttplate
      { geo: G.box, pos: [0.56, 0.064, 0], scale: [0.014, 0.016, 0.008], matIndex: 2 },      // front sight
      ...trig(0.02, -0.024)
    ];
    for (let x = 0.26; x <= 0.47; x += 0.035) {
      mp18Entries.push({ geo: G.cylLo, pos: [x, 0.04, 0], rot: [0, 0, R], scale: [0.0255, 0.01, 0.0255], matIndex: 2 });
    }
    this.geos.mp18 = buildMultiMatGeometry(mp18Entries);

    // 9. ZB-26 Light Machine Gun (捷克式轻机枪)
    const zbEntries = [
      { geo: G.box, pos: [0.10, 0.036, 0], scale: [0.32, 0.068, 0.054], matIndex: 0 },       // machined receiver
      { geo: G.cyl, pos: [0.56, 0.048, 0], rot: [0, 0, R], scale: [0.016, 0.66, 0.016], matIndex: 0 }, // finned barrel
      { geo: G.cylLo, pos: [0.89, 0.048, 0], rot: [0, 0, R], scale: [0.024, 0.055, 0.024], matIndex: 2 }, // conical flash hider
      { geo: G.cyl, pos: [0.46, 0.016, 0], rot: [0, 0, R], scale: [0.013, 0.44, 0.013], matIndex: 0 }, // gas tube
      { geo: G.box, pos: [0.12, 0.165, 0], rot: [0, 0, -0.08], scale: [0.06, 0.22, 0.034], matIndex: 0 }, // top 20-rd vertical mag
      { geo: G.box, pos: [0.11, 0.275, 0], rot: [0, 0, -0.08], scale: [0.064, 0.02, 0.038], matIndex: 2 }, // brass mag floorplate
      { geo: G.cylLo, pos: [0.24, 0.11, 0.025], rot: [0, 0, 0.4], scale: [0.014, 0.11, 0.014], matIndex: 1 }, // wooden carry handle
      { geo: G.box, pos: [-0.21, -0.02, 0], rot: [0, 0, -0.12], scale: [0.30, 0.106, 0.046], matIndex: 1 }, // walnut buttstock
      { geo: G.box, pos: [-0.355, -0.036, 0], rot: [0, 0, -0.12], scale: [0.018, 0.112, 0.048], matIndex: 2 }, // shoulder rest plate
      { geo: G.box, pos: [-0.01, -0.052, 0], rot: [0, 0, 0.24], scale: [0.042, 0.11, 0.036], matIndex: 1 }, // pistol grip
      { geo: G.cylLo, pos: [0.68, -0.08, -0.045], rot: [0.18, 0, -0.25], scale: [0.012, 0.24, 0.012], matIndex: 0 }, // bipod L
      { geo: G.cylLo, pos: [0.68, -0.08, 0.045], rot: [-0.18, 0, -0.25], scale: [0.012, 0.24, 0.012], matIndex: 0 }, // bipod R
      { geo: G.box, pos: [0.85, 0.074, 0], scale: [0.016, 0.02, 0.01], matIndex: 2 },        // front blade sight
      ...trig(0.035, -0.012)
    ];
    for (let x = 0.28; x <= 0.49; x += 0.028) {
      zbEntries.push({ geo: G.cylLo, pos: [x, 0.048, 0], rot: [0, 0, R], scale: [0.027, 0.008, 0.027], matIndex: 0 });
    }
    this.geos.zb26 = buildMultiMatGeometry(zbEntries);

    // 10. Mauser Kar98k Optical Sniper Rifle (毛瑟 Kar98k 光学狙击步枪 + 德制4倍蔡司瞄具)
    this.geos.sniper = buildMultiMatGeometry([
      { geo: G.cyl, pos: [0.58, 0.048, 0], rot: [0, 0, R], scale: [0.015, 0.90, 0.015], matIndex: 0 },       // precision heavy barrel
      { geo: G.cylLo, pos: [1.01, 0.048, 0], rot: [0, 0, R], scale: [0.020, 0.055, 0.020], matIndex: 2 },   // brass muzzle crown
      { geo: G.box, pos: [0.08, 0.046, 0], scale: [0.24, 0.046, 0.038], matIndex: 0 },                       // Mauser bolt receiver
      { geo: G.cylLo, pos: [0.04, 0.036, 0.032], rot: [R + 0.35, 0, 0], scale: [0.008, 0.058, 0.008], matIndex: 2 }, // bent sniper bolt handle
      { geo: G.sphLo, pos: [0.04, 0.020, 0.060], scale: [0.014, 0.014, 0.014], matIndex: 2 },                // brass bolt knob
      { geo: G.box, pos: [0.27, 0.018, 0], scale: [0.74, 0.056, 0.042], matIndex: 1 },                       // full sniper walnut stock
      { geo: G.box, pos: [-0.22, -0.020, 0], rot: [0, 0, -0.13], scale: [0.31, 0.102, 0.042], matIndex: 1 }, // buttstock
      { geo: G.box, pos: [-0.18, 0.024, 0.006], rot: [0, 0, -0.08], scale: [0.16, 0.028, 0.032], matIndex: 1 }, // raised cheekpiece
      { geo: G.box, pos: [-0.37, -0.040, 0], rot: [0, 0, -0.13], scale: [0.016, 0.106, 0.044], matIndex: 2 }, // brass buttplate
      { geo: G.box, pos: [0.48, 0.032, 0], scale: [0.022, 0.060, 0.048], matIndex: 2 },                      // barrel band
      { geo: G.box, pos: [0.72, 0.032, 0], scale: [0.020, 0.056, 0.046], matIndex: 2 },                      // front nosecap
      { geo: G.box, pos: [0.97, 0.068, 0], scale: [0.016, 0.018, 0.012], matIndex: 2 },                      // hooded front sight
      // Zeiss ZF39 optical scope assembly (high-mount rings, slender steel tube, flared brass-ringed bells & turrets)
      { geo: G.box, pos: [0.03, 0.084, 0], scale: [0.024, 0.044, 0.026], matIndex: 0 },                      // rear scope mount bracket
      { geo: G.box, pos: [0.21, 0.084, 0], scale: [0.024, 0.044, 0.026], matIndex: 0 },                      // front scope mount bracket
      { geo: G.cyl, pos: [0.13, 0.112, 0], rot: [0, 0, R], scale: [0.016, 0.34, 0.016], matIndex: 0 },       // main scope optical tube
      { geo: G.cylLo, pos: [0.30, 0.112, 0], rot: [0, 0, R], scale: [0.024, 0.075, 0.024], matIndex: 0 },    // flared front objective bell
      { geo: G.cylLo, pos: [0.338, 0.112, 0], rot: [0, 0, R], scale: [0.025, 0.010, 0.025], matIndex: 2 },   // brass objective bezel ring
      { geo: G.cylLo, pos: [-0.045, 0.112, 0], rot: [0, 0, R], scale: [0.021, 0.062, 0.021], matIndex: 0 },  // flared rear eyepiece bell
      { geo: G.cylLo, pos: [-0.076, 0.112, 0], rot: [0, 0, R], scale: [0.022, 0.010, 0.022], matIndex: 2 },  // brass eyepiece bezel ring
      { geo: G.cylLo, pos: [0.125, 0.134, 0], scale: [0.011, 0.018, 0.011], matIndex: 2 },                   // brass elevation turret
      { geo: G.cylLo, pos: [0.125, 0.112, 0.021], rot: [R, 0, 0], scale: [0.010, 0.016, 0.010], matIndex: 2 }, // brass windage turret
      ...trig(0.015, -0.012)
    ]);
  }

  generatePreviews(weapons) {
    const renderer = this.gr.renderer;
    const W = 440;
    const H = 196;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    const sc = new THREE.Scene();
    sc.environment = this.gr.scene.environment;
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 10);

    // High-contrast studio 4-point weapon showcase lighting (makes blued steel & walnut gleam!)
    const amb = new THREE.HemisphereLight(0xdceaff, 0x4a3824, 2.2);
    const key = new THREE.DirectionalLight(0xfff0d4, 4.6);
    key.position.set(2.4, 3.2, 2.8);
    const rim = new THREE.DirectionalLight(0x8ec0ff, 3.4);
    rim.position.set(-2.6, 2.0, -2.2);
    const bottomBounce = new THREE.DirectionalLight(0xffb868, 1.8);
    bottomBounce.position.set(0, -2.5, 1.8);
    sc.add(amb, key, rim, bottomBounce);

    const previewMats = [
      new THREE.MeshStandardMaterial({ color: 0x66758c, roughness: 0.24, metalness: 0.72 }),
      new THREE.MeshStandardMaterial({ map: this.gr.assets.procTex.walnut, color: 0xc8905c, roughness: 0.48, metalness: 0.08 }),
      new THREE.MeshStandardMaterial({ color: 0xf6cc68, roughness: 0.22, metalness: 0.86 })
    ];

    const buf = new Uint8Array(W * H * 4);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    const prevRT = renderer.getRenderTarget();
    const prevCol = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();

    for (const w of weapons) {
      if (this.previews[w.modelKey]) continue;
      const mesh = new THREE.Mesh(this.getGeometry(w.modelKey), previewMats);
      mesh.rotation.set(0.14, -0.24, 0.03);
      sc.add(mesh);
      mesh.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x / 2.05, size.y * 1.15, size.z) || 0.45;
      const dist = (span / Math.tan((cam.fov * Math.PI) / 360)) * 1.08;
      cam.position.set(center.x, center.y + span * 0.06, center.z + dist);
      cam.lookAt(center);

      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(sc, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      sc.remove(mesh);

      // Transparent weapon cutout canvas (also reused directly on the 3-Slot In-Game HUD!)
      const iconCv = document.createElement('canvas');
      iconCv.width = W;
      iconCv.height = H;
      const iconCtx = iconCv.getContext('2d');
      const imgData = iconCtx.createImageData(W, H);
      const dst = imgData.data;
      for (let y = 0; y < H; y++) {
        const srcRow = (H - 1 - y) * W * 4;
        const dstRow = y * W * 4;
        for (let x = 0; x < W; x++) {
          const si = srcRow + x * 4;
          const di = dstRow + x * 4;
          const a = buf[si + 3];
          if (a > 6) {
            dst[di] = Math.min(255, Math.pow(buf[si] / 255, 0.52) * 255 + 14);
            dst[di + 1] = Math.min(255, Math.pow(buf[si + 1] / 255, 0.52) * 255 + 12);
            dst[di + 2] = Math.min(255, Math.pow(buf[si + 2] / 255, 0.52) * 255 + 10);
            dst[di + 3] = a;
          }
        }
      }
      iconCtx.putImageData(imgData, 0, 0);
      this.hudIcons[w.modelKey] = iconCv;
      this.cutoutUrls[w.modelKey] = iconCv.toDataURL('image/png');

      // Rich Velvet-Slate & Art-Deco Brass Armory Card Background
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, W * 0.62);
      bg.addColorStop(0, '#1e2b42');
      bg.addColorStop(0.65, '#121a2a');
      bg.addColorStop(1, '#0b101b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(217,164,65,0.08)';
      ctx.lineWidth = 1;
      for (let gx = 22; gx < W; gx += 22) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 22; gy < H; gy += 22) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Soft warm drop-glow behind gun silhouette
      ctx.save();
      ctx.shadowColor = 'rgba(255,205,120,0.28)';
      ctx.shadowBlur = 18;
      ctx.drawImage(iconCv, 0, 0);
      ctx.restore();

      // Art-Deco double corner ornaments + caliber watermark
      ctx.strokeStyle = 'rgba(217,164,65,0.55)';
      ctx.lineWidth = 1.5;
      for (const [cx, cy, dx, dy] of [[8, 8, 16, 16], [W - 8, 8, -16, 16], [8, H - 8, 16, -16], [W - 8, H - 8, -16, -16]]) {
        ctx.beginPath(); ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy); ctx.stroke();
      }
      ctx.font = '700 11px "Noto Sans SC",sans-serif';
      ctx.fillStyle = 'rgba(217,164,65,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(w.caliber || '', W - 14, H - 12);

      this.previews[w.modelKey] = cv.toDataURL('image/png');
    }

    previewMats.forEach(m => m.dispose());
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
