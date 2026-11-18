import * as THREE from 'three';
import { MW, TILE, SHANGHAI_SIGNS, GROUP_WORLD } from '../config/constants.js';
import { makeCanvasTexture } from '../core/AssetManager.js';
import { createWetGroundMaterial, createVolumetricConeMaterial } from '../core/Renderer.js';
import { partSpec, buildColoredGeometry } from '../utils/GeometryBuilder.js';

const rnd = (a, b) => a + Math.random() * (b - a);

function makeInteriorWindowMaterial(mullionTex) {
  const mat = new THREE.MeshStandardMaterial({
    map: mullionTex,
    roughness: 0.14,
    metalness: 0.45,
    envMapIntensity: 1.5
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWinUv;
        varying vec3 vWinRayLocal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWinUv = uv;
        vec4 mvW = vec4(transformed, 1.0);
        mat3 inst3 = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          mvW = instanceMatrix * mvW;
          inst3 = inst3 * mat3(instanceMatrix);
        #endif
        vec3 wp = (modelMatrix * mvW).xyz;
        vec3 rayW = wp - cameraPosition;
        vec3 rAxis = normalize(inst3 * vec3(1.0, 0.0, 0.0));
        vec3 uAxis = normalize(inst3 * vec3(0.0, 1.0, 0.0));
        vec3 fAxis = normalize(inst3 * vec3(0.0, 0.0, 1.0));
        vWinRayLocal = vec3(dot(rayW, rAxis), dot(rayW, uAxis), dot(rayW, fAxis));`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWinUv;
        varying vec3 vWinRayLocal;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 rd = normalize(vWinRayLocal);
        float zDir = rd.z < -0.001 ? rd.z : -0.001;
        vec2 p2 = vWinUv - 0.5;
        float tBack = -0.78 / zDir;
        float tX = (rd.x > 0.0 ? 0.5 - p2.x : -0.5 - p2.x) / (abs(rd.x) > 0.001 ? rd.x : 0.001);
        float tY = (rd.y > 0.0 ? 0.5 - p2.y : -0.5 - p2.y) / (abs(rd.y) > 0.001 ? rd.y : 0.001);
        float tHit = min(tBack, min(max(tX, 0.0), max(tY, 0.0)));
        vec3 hit = vec3(p2, 0.0) + rd * tHit;

        vec3 roomCol = vec3(0.88, 0.58, 0.26);
        if (hit.z < -0.76) {
          // Back wall with warm plaster & dark wooden dado wainscoting
          roomCol = hit.y < -0.15 ? vec3(0.32, 0.16, 0.08) : vec3(0.95, 0.68, 0.34);
          // Wall hanging frame silhouette
          if (abs(hit.x) < 0.18 && hit.y > -0.02 && hit.y < 0.28) roomCol *= 0.55;
        } else if (tY < tX && tY < tBack) {
          // Ceiling lamp glow or wood floor
          if (rd.y > 0.0) {
            float lampD = length(hit.xz - vec2(0.0, -0.38));
            roomCol = mix(vec3(0.7, 0.44, 0.2), vec3(1.6, 1.28, 0.78), smoothstep(0.24, 0.03, lampD));
          } else {
            roomCol = vec3(0.26, 0.14, 0.07);
          }
        } else {
          // Side walls
          roomCol = hit.y < -0.15 ? vec3(0.28, 0.14, 0.07) : vec3(0.78, 0.52, 0.24);
        }

        // Subtle draped curtains on left/right window panes
        float curtain = smoothstep(0.26, 0.44, abs(p2.x));
        roomCol *= mix(1.0, 0.38, curtain);

        // Preserve wooden window mullions at z=0
        float frameMask = (abs(p2.x) < 0.045 || abs(p2.y - 0.18) < 0.03 || abs(p2.y + 0.16) < 0.03 || abs(p2.x) > 0.46 || abs(p2.y) > 0.46) ? 0.0 : 1.0;
        totalEmissiveRadiance += roomCol * frameMask * 1.15;`
      );
  };
  mat.customProgramCacheKey = () => 'shanghai-interior-win-v1';
  return mat;
}

function makeSkyDomeTexture() {
  return makeCanvasTexture(512, 256, c => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#050811');
    g.addColorStop(0.45, '#0b1428');
    g.addColorStop(0.75, '#131d32');
    g.addColorStop(1, '#090e19');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 256);
    // Wispy storm clouds catching faint moonlight
    for (let i = 0; i < 45; i++) {
      const cx = Math.random() * 512;
      const cy = 40 + Math.random() * 140;
      const rx = 40 + Math.random() * 90;
      const ry = 8 + Math.random() * 18;
      const cg = c.createRadialGradient(cx, cy, 2, cx, cy, rx);
      cg.addColorStop(0, 'rgba(65,86,128,0.16)');
      cg.addColorStop(1, 'rgba(15,24,45,0)');
      c.fillStyle = cg;
      c.save();
      c.translate(cx, cy);
      c.scale(1, ry / rx);
      c.beginPath();
      c.arc(0, 0, rx, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  });
}

function makeWindowTexture(lit) {
  return makeCanvasTexture(64, 96, c => {
    if (lit) {
      c.fillStyle = '#24180e';
      c.fillRect(0, 0, 64, 96);
    } else {
      const g = c.createLinearGradient(0, 0, 64, 96);
      g.addColorStop(0, '#1c2a3a');
      g.addColorStop(1, '#080c14');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 96);
      c.fillStyle = 'rgba(155,190,235,0.16)';
      c.beginPath();
      c.moveTo(0, 58);
      c.lineTo(38, 0);
      c.lineTo(56, 0);
      c.lineTo(0, 88);
      c.fill();
    }
    c.fillStyle = lit ? '#2b1b10' : '#26231e';
    c.fillRect(29, 0, 6, 96);
    c.fillRect(0, 30, 64, 5);
    c.fillRect(0, 62, 64, 5);
    c.strokeStyle = c.fillStyle;
    c.lineWidth = 5;
    c.strokeRect(0, 0, 64, 96);
  });
}

function makeDoorTexture() {
  return makeCanvasTexture(96, 160, c => {
    c.fillStyle = '#3a2216';
    c.fillRect(0, 0, 96, 160);
    c.fillStyle = '#24140c';
    c.fillRect(45, 0, 6, 160);
    for (const x of [10, 56]) {
      c.strokeStyle = '#5a3822';
      c.lineWidth = 4;
      c.strokeRect(x, 16, 30, 58);
      c.strokeRect(x, 86, 30, 62);
    }
    c.fillStyle = '#d9a441';
    c.beginPath();
    c.arc(38, 86, 4, 0, Math.PI * 2);
    c.arc(58, 86, 4, 0, Math.PI * 2);
    c.fill();
  });
}

function makeSignTexture(text, col, vertical = false) {
  const w = vertical ? 88 : 256;
  const h = vertical ? 256 : 80;
  return makeCanvasTexture(w, h, c => {
    c.fillStyle = '#12080a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = col;
    c.lineWidth = 4;
    c.shadowColor = col;
    c.shadowBlur = 14;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (vertical) {
      c.font = '50px "Ma Shan Zheng","STKaiti","KaiTi",serif';
      const chars = text.split('');
      const step = (h - 32) / chars.length;
      chars.forEach((ch, idx) => c.fillText(ch, w / 2, 22 + step * (idx + 0.5)));
    } else {
      c.font = '50px "Ma Shan Zheng","STKaiti","KaiTi",serif';
      c.fillText(text.split('').join(text.length > 2 ? '' : ' '), w / 2, h / 2 + 2);
    }
  });
}

function makeSkylineTexture() {
  return makeCanvasTexture(128, 256, c => {
    c.fillStyle = '#090f1d';
    c.fillRect(0, 0, 128, 256);
    for (let y = 10; y < 248; y += 16) {
      for (let x = 8; x < 120; x += 14) {
        const h = ((x * 13 + y * 29) & 15);
        if (h < 3) {
          c.fillStyle = 'rgba(255,190,104,0.52)';
          c.fillRect(x, y, 7, 8);
        } else if (h < 7) {
          c.fillStyle = 'rgba(65,98,150,0.22)';
          c.fillRect(x, y, 7, 8);
        }
      }
    }
  });
}

function makeVintagePosterTexture(title, sub, bg, accent) {
  return makeCanvasTexture(128, 176, c => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 128, 176);
    // Aged rain-stained border
    c.fillStyle = 'rgba(32,20,10,0.24)';
    c.fillRect(0, 134, 128, 42);
    c.fillRect(0, 0, 128, 14);
    c.strokeStyle = accent;
    c.lineWidth = 4;
    c.strokeRect(8, 8, 112, 160);
    // Decorative vintage frame & figure/headline silhouette
    c.fillStyle = accent;
    c.fillRect(18, 20, 92, 26);
    c.fillStyle = bg;
    c.font = 'bold 20px "Ma Shan Zheng","KaiTi",serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(title, 64, 33);
    c.fillStyle = 'rgba(42,28,22,0.82)';
    c.fillRect(22, 56, 84, 72);
    c.fillStyle = accent;
    c.beginPath();
    c.arc(64, 88, 22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#241814';
    c.font = 'bold 14px "Noto Sans SC",sans-serif';
    c.fillText(sub, 64, 148);
  });
}

function makeRiverMaterial(timeUniform) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x06101a,
    roughness: 0.08,
    metalness: 0.25,
    envMapIntensity: 2.4
  });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRivPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRivPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vRivPos;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float w1 = sin(vRivPos.x * 1.4 + uTime * 1.7 + cos(vRivPos.z * 0.9)) * 0.5;
        float w2 = cos(vRivPos.z * 2.1 - uTime * 2.2) * 0.5;
        roughnessFactor = clamp(0.05 + abs(w1 + w2) * 0.06, 0.03, 0.16);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float nx = cos(vRivPos.x * 1.6 + uTime * 1.9) * 0.08;
        float nz = sin(vRivPos.z * 2.2 - uTime * 2.3) * 0.08;
        normal = normalize(normal + vec3(nx, 0.0, nz));`
      );
  };
  mat.customProgramCacheKey = () => 'huangpu-river-v1';
  return mat;
}

export class ArchitectureBuilder {
  constructor(gameRenderer, assets) {
    this.gr = gameRenderer;
    this.assets = assets;
    this.kit = null;
    this.mats = null;
  }

  _ensureKit() {
    if (this.kit) return;
    const G = this.gr.G;

    // 1. Recessed 3D Window Alcove + Slatted Shutters
    const winParts = [
      partSpec(G.box, '#8a8579', [0, 0.88, 0.06], [1.34, 0.14, 0.24]),   // stone lintel
      partSpec(G.box, '#9a9486', [0, -0.87, 0.09], [1.4, 0.1, 0.3]),     // stone sill
      partSpec(G.box, '#706b62', [-0.6, 0, 0.04], [0.14, 1.64, 0.16]),   // left jamb
      partSpec(G.box, '#706b62', [0.6, 0, 0.04], [0.14, 1.64, 0.16]),    // right jamb
      partSpec(G.box, '#2b1b12', [0, 0, 0.08], [0.06, 1.56, 0.06]),      // center mullion
      partSpec(G.box, '#2b1b12', [0, 0.28, 0.08], [1.04, 0.05, 0.06]),   // upper transom
      partSpec(G.box, '#2b1b12', [0, -0.26, 0.08], [1.04, 0.05, 0.06]),  // lower transom
      // Left & right open louvered shutters
      partSpec(G.box, '#24342d', [-0.74, 0, 0.16], [0.24, 1.56, 0.05], [0, 0.32, 0]),
      partSpec(G.box, '#24342d', [0.74, 0, 0.16], [0.24, 1.56, 0.05], [0, -0.32, 0])
    ];

    // 2. Cast-iron overhanging balcony
    const balcParts = [
      partSpec(G.box, '#6c6860', [0, 0, 0.36], [1.96, 0.13, 0.76]),      // stone slab
      partSpec(G.box, '#16181e', [0, 0.88, 0.71], [1.92, 0.05, 0.06]),   // front rail
      partSpec(G.box, '#16181e', [-0.94, 0.88, 0.36], [0.05, 0.05, 0.72]),
      partSpec(G.box, '#16181e', [0.94, 0.88, 0.36], [0.05, 0.05, 0.72])
    ];
    for (let x = -0.84; x <= 0.85; x += 0.21) {
      balcParts.push(partSpec(G.box, '#1d2028', [x, 0.45, 0.71], [0.035, 0.82, 0.035]));
    }
    for (const z of [0.18, 0.44]) {
      balcParts.push(partSpec(G.box, '#1d2028', [-0.94, 0.45, z], [0.035, 0.82, 0.035]));
      balcParts.push(partSpec(G.box, '#1d2028', [0.94, 0.45, z], [0.035, 0.82, 0.035]));
    }

    // 3. Shikumen carved stone archway frame with semicircular ExtrudeGeometry pediment
    const archShape = new THREE.Shape();
    archShape.moveTo(-1.02, 0);
    archShape.lineTo(1.02, 0);
    archShape.absarc(0, 0, 1.02, 0, Math.PI, false);
    archShape.closePath();
    const archExtrude = new THREE.ExtrudeGeometry(archShape, {
      depth: 0.24,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.035,
      bevelThickness: 0.035
    });

    const shikuParts = [
      partSpec(G.box, '#8b867b', [-0.92, 1.3, 0.14], [0.28, 2.6, 0.32]),
      partSpec(G.box, '#8b867b', [0.92, 1.3, 0.14], [0.28, 2.6, 0.32]),
      partSpec(G.box, '#9e988c', [0, 2.66, 0.16], [2.24, 0.22, 0.38]),
      partSpec(archExtrude, '#7d786d', [0, 2.74, 0.02], [0.85, 0.65, 1]),
      partSpec(G.box, '#a8a296', [0, 3.36, 0.16], [0.22, 0.24, 0.32]), // keystone
      partSpec(G.box, '#b8944a', [0, 2.66, 0.36], [0.55, 0.14, 0.04])
    ];
    archExtrude.dispose();

    // 4. Corrugated awning bracket
    const awnParts = [
      partSpec(G.box, '#3a4048', [0, 0, 0.65], [2.35, 0.08, 1.35], [0.22, 0, 0]),
      partSpec(G.box, '#1e2228', [-1.05, -0.28, 0.45], [0.07, 0.07, 1.05], [-0.42, 0, 0]),
      partSpec(G.box, '#1e2228', [1.05, -0.28, 0.45], [0.07, 0.07, 1.05], [-0.42, 0, 0])
    ];

    this.kit = {
      winFrame: buildColoredGeometry(winParts),
      balcony: buildColoredGeometry(balcParts),
      shikumen: buildColoredGeometry(shikuParts),
      awning: buildColoredGeometry(awnParts)
    };

    const p = this.assets.procTex;
    this.mats = {
      stoneVertex: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x736e63, roughness: 0.88 }),
      roof: new THREE.MeshStandardMaterial({ map: p.roofTile, roughness: 0.85, color: 0x3b404c }),
      steelBeam: new THREE.MeshStandardMaterial({ color: 0x262a32, roughness: 0.5, metalness: 0.72 }),
      walk: this.assets.pbr('concrete_floor_worn_001', { roughness: 0.82 }),
      winLit: makeInteriorWindowMaterial(makeWindowTexture(true)),
      winDark: new THREE.MeshStandardMaterial({
        map: makeWindowTexture(false),
        roughness: 0.08,
        metalness: 0.55,
        envMapIntensity: 1.8
      }),
      door: new THREE.MeshStandardMaterial({ map: makeDoorTexture(), roughness: 0.72 }),
      ao: new THREE.MeshBasicMaterial({
        map: p.ao,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1
      }),
      spill: new THREE.MeshBasicMaterial({
        map: p.glow,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1
      }),
      skylightCone: createVolumetricConeMaterial(0xa4c2ff, 0.075),
      river: makeRiverMaterial(this.gr.timeUniform),
      pierWood: new THREE.MeshStandardMaterial({ map: p.plank, roughness: 0.88, color: 0x62503e }),
      skyDome: new THREE.MeshBasicMaterial({ map: makeSkyDomeTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
      skyline: new THREE.MeshBasicMaterial({ map: makeSkylineTexture(), color: 0xffffff, fog: true }),
      skylineWin: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffbd66).multiplyScalar(1.3), toneMapped: false }),
      posterMats: [
        new THREE.MeshStandardMaterial({ map: makeVintagePosterTexture('百乐门', '夜爵士舞', '#c7b899', '#a62c22'), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }),
        new THREE.MeshStandardMaterial({ map: makeVintagePosterTexture('申 报', '今夜号外', '#b9ae98', '#222832'), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 }),
        new THREE.MeshStandardMaterial({ map: makeVintagePosterTexture('黑龙令', '悬赏通缉', '#c4aa82', '#7a1c14'), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 })
      ]
    };
  }

  build(level, worldGroup, physics) {
    this._ensureKit();
    const cfg = level.cfg;
    const MH = level.MH;
    const G = this.gr.G;

    // Ground material per level with procedural raindrop puddles + planar reflections
    if (!cfg.mats) {
      cfg.mats = {
        walls: cfg.walls.map(id => this.assets.pbr(id)),
        ground: createWetGroundMaterial(this.assets, cfg.ground, this.gr, cfg.style === 'concrete' ? 0.85 : 1.0)
      };
    }

    const totalW = MW * TILE;
    const totalD = MH * TILE;
    const pg = new THREE.PlaneGeometry(totalW, totalD);
    const pu = pg.attributes.uv;
    for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * MW, pu.getY(i) * MH);
    const gm = new THREE.Mesh(pg, cfg.mats.ground);
    gm.rotation.x = -Math.PI / 2;
    gm.position.set(totalW * 0.5, 0, totalD * 0.5);
    gm.receiveShadow = true;
    worldGroup.add(gm);
    physics.addGroundPlane(totalW, totalD);

    // Nocturnal storm-cloud sky dome & distant 1930s Shanghai Bund skyline silhouette
    this._buildSkyAndSkyline(worldGroup, totalW, totalD);

    const reflectHide = [gm];

    const wins = [];
    const doors = [];
    const balconies = [];
    const shikumens = [];
    const awnings = [];
    const aos = [];
    const posters = [[], [], []];
    let posterIdx = 0;

    for (const r of level.rects) {
      if (r.seawall) {
        this._buildHarborSeawall(worldGroup, physics, r, level);
        continue;
      }
      const floors = r.border ? 4 : cfg.boss ? 3 + ((Math.random() * 2) | 0) : 2 + ((Math.random() * 3) | 0);
      const floorH = cfg.boss ? 3.5 : 3.2;
      const H = floors * floorH;
      const wi = (Math.random() * 2) | 0;
      const ws = { red_bricks_04: 2.5, brick_wall_006: 3, dark_brick_wall: 1.6, factory_brick: 1.8, grey_plaster_02: 3 }[cfg.walls[wi]] || 2.5;

      const bw = r.w * TILE;
      const bd = r.h * TILE;
      const cx = (r.x + r.w * 0.5) * TILE;
      const cz = (r.y + r.h * 0.5) * TILE;

      const geo = new THREE.BoxGeometry(bw, H, bd);
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue;
        const hz = (f < 2 ? bd : bw) / ws;
        const off = Math.random();
        for (let i = 0; i < 4; i++) {
          const k = f * 4 + i;
          uv.setXY(k, uv.getX(k) * hz + off, uv.getY(k) * (H / ws));
        }
      }
      const fm = cfg.mats.walls[wi];
      const m = new THREE.Mesh(geo, [fm, fm, this.mats.roof, this.mats.roof, fm, fm]);
      m.position.set(cx, H * 0.5, cz);
      m.castShadow = true;
      m.receiveShadow = true;
      worldGroup.add(m);

      // Register building box collider
      physics.addStaticBox(cx, H * 0.5, cz, bw * 0.5, H * 0.5, bd * 0.5, 0, { kind: 'wall' }, GROUP_WORLD);

      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) level.tileH[(r.y + j) * MW + r.x + i] = H;
      }

      if (!r.border) {
        // Sidewalk curb
        const sg = new THREE.BoxGeometry(bw + 1.0, 0.14, bd + 1.0);
        const su = sg.attributes.uv;
        for (let i = 0; i < su.count; i++) {
          su.setXY(i, su.getX(i) * (bw + 1.0) / 2.5, su.getY(i) * (bd + 1.0) / 2.5);
        }
        const sw = new THREE.Mesh(sg, this.mats.walk);
        sw.position.set(cx, 0.07, cz);
        sw.receiveShadow = true;
        worldGroup.add(sw);
        physics.addStaticBox(cx, 0.07, cz, (bw + 1.0) * 0.5, 0.07, (bd + 1.0) * 0.5, 0, { kind: 'curb' }, GROUP_WORLD);

        // Granite plinth base
        const base = new THREE.Mesh(G.box, this.mats.trim);
        base.scale.set(bw + 0.16, 0.52, bd + 0.16);
        base.position.set(cx, 0.26, cz);
        base.receiveShadow = true;
        worldGroup.add(base);

        // Inter-floor belt cornices
        for (let fl = 1; fl < floors; fl++) {
          const belt = new THREE.Mesh(G.box, this.mats.trim);
          belt.scale.set(bw + 0.22, 0.16, bd + 0.22);
          belt.position.set(cx, fl * floorH, cz);
          worldGroup.add(belt);
        }

        // Pitched dark-tile roof for Shikumen alleys & dock warehouses; Art-Deco blocks get corner pilasters + stepped crown tower
        if (!cfg.boss && !r.artDeco) {
          this._buildPitchedRoof(worldGroup, cx, H, cz, bw, bd, cfg.style === 'cobble');
        }
        if (!cfg.boss && r.artDeco) {
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const pil = new THREE.Mesh(G.box, this.mats.trim);
              pil.scale.set(0.36, H + 0.14, 0.36);
              pil.position.set(cx + sx * (bw * 0.5 + 0.04), H * 0.5, cz + sz * (bd * 0.5 + 0.04));
              worldGroup.add(pil);
            }
          }
          const t1 = new THREE.Mesh(G.box, fm);
          t1.scale.set(3.4, 2.6, 3.4);
          t1.position.set(cx, H + 1.3, cz);
          t1.castShadow = true;
          worldGroup.add(t1);
          const t2 = new THREE.Mesh(G.box, this.mats.trim);
          t2.scale.set(2.1, 1.8, 2.1);
          t2.position.set(cx, H + 3.5, cz);
          t2.castShadow = true;
          worldGroup.add(t2);
          const pole = new THREE.Mesh(G.cylLo, this.mats.steelBeam);
          pole.scale.set(0.05, 3.2, 0.05);
          pole.position.set(cx, H + 6.0, cz);
          worldGroup.add(pole);
        }
      }

      // Roof coping cornice
      const top = new THREE.Mesh(G.box, this.mats.trim);
      top.scale.set(bw + 0.34, 0.34, bd + 0.34);
      top.position.set(cx, H - 0.12, cz);
      worldGroup.add(top);

      // Street-facing windows, doors, balconies, awnings
      const side = (tx, tz, nx, nz) => {
        if (level.T(tx + nx, tz + nz) === 1) return;
        const px = (tx + 0.5 + nx * 0.5) * TILE;
        const pz = (tz + 0.5 + nz * 0.5) * TILE;
        const ry = nx ? nx * Math.PI / 2 : (nz > 0 ? 0 : Math.PI);
        aos.push([px, r.border ? 0.02 : 0.15, pz, ry]);

        for (let fl = 0; fl < floors; fl++) {
          if (fl === 0 && !r.border) {
            const roll = Math.random();
            if (roll < 0.3) {
              doors.push([px, 1.32, pz, ry]);
              if (cfg.style === 'cobble') {
                shikumens.push([px, 0.14, pz, ry]);
              } else if (cfg.style === 'plank' && Math.random() < 0.65) {
                awnings.push([px, 2.95, pz, ry]);
              }
              continue;
            }
            if (roll < 0.5) {
              posters[posterIdx++ % 3].push([px, 1.56 + rnd(-0.12, 0.12), pz, ry]);
              continue;
            }
            // Ground-floor warm shopfront vitrine + awning
            wins.push([px, 1.72, pz, ry, Math.random() < 0.68]);
            if (Math.random() < 0.45) awnings.push([px, 2.95, pz, ry]);
            continue;
          }
          const wy = fl * floorH + 1.85;
          wins.push([px, wy, pz, ry, Math.random() < 0.48]);
          if (!r.border && fl === 1 && cfg.style === 'cobble' && Math.random() < 0.36) {
            balconies.push([px, fl * floorH + 0.08, pz, ry]);
          }
        }
      };

      for (let i = 0; i < r.w; i++) { side(r.x + i, r.y, 0, -1); side(r.x + i, r.y + r.h - 1, 0, 1); }
      for (let j = 0; j < r.h; j++) { side(r.x, r.y + j, -1, 0); side(r.x + r.w - 1, r.y + j, 1, 0); }

      // 3D Neon Signboards on ALL street-facing facades (East, West, South & North!)
      if (!r.border) {
        const tryFacadeSign = (wx, wz, spanM, openCheck, ry, prob) => {
          if (spanM < 5.0 || !openCheck || Math.random() > prob) return;
          const signSpec = SHANGHAI_SIGNS[(Math.random() * SHANGHAI_SIGNS.length) | 0];
          const vertical = Math.random() < 0.58;
          this._buildNeonSign(worldGroup, signSpec.text, signSpec.color, wx, vertical ? 4.4 : 3.45, wz, spanM, vertical, ry);
        };
        tryFacadeSign(cx, (r.y + r.h) * TILE, bw, level.T(r.x + (r.w >> 1), r.y + r.h) === 0, 0, 0.78);
        tryFacadeSign(cx, r.y * TILE, bw, level.T(r.x + (r.w >> 1), r.y - 1) === 0, Math.PI, 0.55);
        tryFacadeSign((r.x + r.w) * TILE, cz, bd, level.T(r.x + r.w, r.y + (r.h >> 1)) === 0, Math.PI / 2, 0.82);
        tryFacadeSign(r.x * TILE, cz, bd, level.T(r.x - 1, r.y + (r.h >> 1)) === 0, -Math.PI / 2, 0.82);
      }
    }

    // Instanced facade meshes
    this._inst(worldGroup, this.kit.winFrame, this.mats.stoneVertex, wins, 0.02);
    this._inst(worldGroup, G.plane, this.mats.winLit, wins.filter(w => w[4]), 0.06, 0.98, 1.48);
    this._inst(worldGroup, G.plane, this.mats.winDark, wins.filter(w => !w[4]), 0.06, 0.98, 1.48);
    this._inst(worldGroup, G.plane, this.mats.door, doors, 0.04, 1.44, 2.52);
    this._inst(worldGroup, this.kit.balcony, this.mats.stoneVertex, balconies, 0.0);
    this._inst(worldGroup, this.kit.shikumen, this.mats.stoneVertex, shikumens, 0.0);
    this._inst(worldGroup, this.kit.awning, this.mats.stoneVertex, awnings, 0.0);
    for (let k = 0; k < 3; k++) {
      this._inst(worldGroup, G.plane, this.mats.posterMats[k], posters[k], 0.03, 0.72, 0.98);
    }
    this._inst(worldGroup, G.flat, this.mats.ao, aos, 0.8, TILE, 1, 1.6);
    this._inst(
      worldGroup,
      G.flat,
      this.mats.spill,
      wins.filter(w => w[4] && w[1] < 6).map(w => [w[0], 0.16, w[2], w[3]]),
      1.75,
      2.5,
      1,
      3.5
    );

    // Level-specific monumental 3D structures
    if (level.gateways?.length) {
      this._buildOverstreetGatehouses(worldGroup, physics, level.gateways, cfg.mats.walls[0]);
    }
    if (cfg.style === 'plank') {
      const rivers = this._buildDockyardStructures(worldGroup, physics, totalW, totalD);
      reflectHide.push(...rivers);
    } else if (cfg.boss) {
      this._buildWarehouseTrusses(worldGroup, totalW, totalD);
    }

    return { reflectHide };
  }

  _buildSkyAndSkyline(worldGroup, totalW, totalD) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 14), this.mats.skyDome);
    sky.position.set(totalW * 0.5, 0, totalD * 0.5);
    worldGroup.add(sky);

    const G = this.gr.G;
    const cx = totalW * 0.5;
    const cz = totalD * 0.5;
    const baseR = Math.max(totalW, totalD) * 0.58 + 105;

    for (let i = 0; i < 32; i++) {
      const ang = (i / 32) * Math.PI * 2;
      const dist = baseR + (i % 3) * 18;
      const bx = cx + Math.cos(ang) * dist;
      const bz = cz + Math.sin(ang) * dist;
      const w = 13 + (i % 4) * 5;
      const h = 30 + ((i * 7) % 5) * 10;
      const tower = new THREE.Mesh(G.box, this.mats.skyline);
      tower.scale.set(w, h, w);
      tower.position.set(bx, h * 0.5 - 2, bz);
      tower.lookAt(cx, h * 0.5 - 2, cz);
      worldGroup.add(tower);

      const crown = new THREE.Mesh(G.box, this.mats.skyline);
      crown.scale.set(w * 0.72, 6, w * 0.72);
      crown.position.set(bx, h + 1, bz);
      crown.lookAt(cx, h + 1, cz);
      worldGroup.add(crown);

      if (i % 4 === 0) {
        // Stepped spire / Custom House clocktower silhouette
        const spire = new THREE.Mesh(G.box, this.mats.skyline);
        spire.scale.set(w * 0.44, 14, w * 0.44);
        spire.position.set(bx, h + 10, bz);
        spire.lookAt(cx, h + 10, cz);
        worldGroup.add(spire);
        const beacon = new THREE.Mesh(G.plane, this.mats.skylineWin);
        beacon.scale.set(2.2, 2.2, 1);
        beacon.position.set(bx - Math.cos(ang) * (w * 0.24), h + 10, bz - Math.sin(ang) * (w * 0.24));
        beacon.lookAt(cx, h + 10, cz);
        worldGroup.add(beacon);
      }
    }
  }

  _buildPitchedRoof(worldGroup, cx, H, cz, bw, bd, isShikumen) {
    const ridgeH = Math.min(2.1, Math.min(bw, bd) * 0.28);
    const alongX = bw >= bd;
    const span = alongX ? bd : bw;
    const length = alongX ? bw : bd;
    const slopeAngle = Math.atan2(ridgeH, span * 0.5);
    const slopeLen = Math.hypot(ridgeH, span * 0.5) + 0.25;

    for (const dir of [-1, 1]) {
      const m = new THREE.Mesh(this.gr.G.box, this.mats.roof);
      if (alongX) {
        m.scale.set(length + 0.35, 0.16, slopeLen);
        m.position.set(cx, H + ridgeH * 0.5 - 0.02, cz + dir * span * 0.25);
        m.rotation.x = dir * slopeAngle;
      } else {
        m.scale.set(slopeLen, 0.16, length + 0.35);
        m.position.set(cx + dir * span * 0.25, H + ridgeH * 0.5 - 0.02, cz);
        m.rotation.z = -dir * slopeAngle;
      }
      m.castShadow = true;
      worldGroup.add(m);
    }

    // Stepped gable parapets (马头墙 / 封火墙) for Shikumen alleys
    if (isShikumen) {
      for (const end of [-1, 1]) {
        const g1 = new THREE.Mesh(this.gr.G.box, this.mats.trim);
        const g2 = new THREE.Mesh(this.gr.G.box, this.mats.trim);
        if (alongX) {
          g1.scale.set(0.28, ridgeH * 0.65, span * 0.72);
          g1.position.set(cx + end * (length * 0.5 + 0.05), H + ridgeH * 0.32, cz);
          g2.scale.set(0.28, ridgeH * 0.5, span * 0.36);
          g2.position.set(cx + end * (length * 0.5 + 0.05), H + ridgeH * 0.8, cz);
        } else {
          g1.scale.set(span * 0.72, ridgeH * 0.65, 0.28);
          g1.position.set(cx, H + ridgeH * 0.32, cz + end * (length * 0.5 + 0.05));
          g2.scale.set(span * 0.36, ridgeH * 0.5, 0.28);
          g2.position.set(cx, H + ridgeH * 0.8, cz + end * (length * 0.5 + 0.05));
        }
        worldGroup.add(g1, g2);
      }
    }
  }

  _buildNeonSign(worldGroup, text, col, wx, cy, wz, spanW, vertical, ry = 0) {
    const tex = makeSignTexture(text, col, vertical);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    faceMat.userData.own = true;
    faceMat.userData.ownMap = true;

    const grp = new THREE.Group();
    grp.position.set(wx, cy, wz);
    grp.rotation.y = ry;

    const inner = new THREE.Group();
    grp.add(inner);
    const w = vertical ? 0.96 : Math.min(spanW - 0.5, 3.4);
    const h = vertical ? 2.75 : w * 0.31;

    if (vertical) {
      // Protrudes outward (+Z in facade local space) with two iron support struts
      inner.position.set(rnd(-spanW * 0.22, spanW * 0.22), 0, 0.88);
      const box = new THREE.Mesh(this.gr.G.box, this.gr.M.dark);
      box.scale.set(0.18, h + 0.12, w + 0.12);
      inner.add(box);
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(this.gr.G.plane, faceMat);
        f.scale.set(w, h, 1);
        f.position.x = side * 0.1;
        f.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        inner.add(f);
      }
      for (const oy of [-h * 0.34, h * 0.34]) {
        const arm = new THREE.Mesh(this.gr.G.box, this.mats.steelBeam);
        arm.scale.set(0.06, 0.06, 0.92);
        arm.position.set(0, oy, -0.46);
        inner.add(arm);
      }
    } else {
      inner.position.set(0, 0, 0.22);
      const box = new THREE.Mesh(this.gr.G.box, this.gr.M.dark);
      box.scale.set(w + 0.14, h + 0.14, 0.22);
      inner.add(box);
      const f = new THREE.Mesh(this.gr.G.plane, faceMat);
      f.scale.set(w, h, 1);
      f.position.z = 0.12;
      inner.add(f);
    }

    const gl = new THREE.Sprite(this.gr.M.glowSprite.clone());
    gl.material.color.set(col);
    gl.material.opacity = 0.28;
    gl.material.userData.own = true;
    gl.scale.set(vertical ? 2.1 : w * 1.5, vertical ? 2.8 : 2.1, 1);
    gl.position.z = vertical ? 0 : 0.32;
    inner.add(gl);

    worldGroup.add(grp);
  }

  _buildHarborSeawall(worldGroup, physics, r, level) {
    const G = this.gr.G;
    const bw = r.w * TILE;
    const bd = r.h * TILE;
    const cx = (r.x + r.w * 0.5) * TILE;
    const cz = (r.y + r.h * 0.5) * TILE;
    const wallH = 1.05;

    const seawall = new THREE.Mesh(G.box, this.mats.trim);
    seawall.scale.set(bw, wallH, bd);
    seawall.position.set(cx, wallH * 0.5, cz);
    seawall.castShadow = true;
    seawall.receiveShadow = true;
    worldGroup.add(seawall);

    // Tall invisible physics collider keeps player & enemies inside the dock while keeping river view open
    physics.addStaticBox(cx, 3.0, cz, bw * 0.5, 3.0, bd * 0.5, 0, { kind: 'wall' }, GROUP_WORLD);
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) level.tileH[(r.y + j) * MW + r.x + i] = wallH;
    }

    // Cast-iron mooring bollards & timber pilings along the dock edge
    for (let z = r.y * TILE + 2; z < (r.y + r.h) * TILE - 2; z += 5.0) {
      const bollard = new THREE.Mesh(G.cylLo, this.mats.steelBeam);
      bollard.scale.set(0.18, 0.55, 0.18);
      bollard.position.set(cx - 0.5, wallH + 0.27, z);
      bollard.castShadow = true;
      worldGroup.add(bollard);

      const cap = new THREE.Mesh(G.cylLo, this.mats.steelBeam);
      cap.scale.set(0.24, 0.08, 0.24);
      cap.position.set(cx - 0.5, wallH + 0.56, z);
      worldGroup.add(cap);

      const piling = new THREE.Mesh(G.cylLo, this.mats.pierWood);
      piling.scale.set(0.22, 2.8, 0.22);
      piling.position.set(cx + bw * 0.5 + 0.35, -0.1, z + 2.5);
      worldGroup.add(piling);
    }
  }

  _buildOverstreetGatehouses(worldGroup, physics, gateways, wallMat) {
    const G = this.gr.G;
    for (const gw of gateways) {
      const span = gw.x1 - gw.x0;
      const cx = (gw.x0 + gw.x1) * 0.5;
      const z = gw.z;
      const clearY = 4.25;
      const bridgeH = 3.1;
      const depth = 4.6;

      // Stone soffit arch beam & carved side corbels
      const soffit = new THREE.Mesh(G.box, this.mats.trim);
      soffit.scale.set(span + 0.3, 0.36, depth + 0.24);
      soffit.position.set(cx, clearY + 0.18, z);
      soffit.castShadow = true;
      soffit.receiveShadow = true;
      worldGroup.add(soffit);

      for (const sx of [-1, 1]) {
        const corbel = new THREE.Mesh(G.box, this.mats.trim);
        corbel.scale.set(0.65, 1.05, depth * 0.86);
        corbel.position.set(sx < 0 ? gw.x0 + 0.32 : gw.x1 - 0.32, clearY - 0.45, z);
        corbel.castShadow = true;
        worldGroup.add(corbel);
      }

      // Upper brick bridge room (leaves y < 4.25m clear for combat & vehicles)
      const room = new THREE.Mesh(G.box, wallMat);
      room.scale.set(span + 0.4, bridgeH, depth);
      room.position.set(cx, clearY + 0.36 + bridgeH * 0.5, z);
      room.castShadow = true;
      room.receiveShadow = true;
      worldGroup.add(room);
      physics.addStaticBox(
        cx,
        clearY + 0.36 + bridgeH * 0.5,
        z,
        span * 0.5,
        bridgeH * 0.5,
        depth * 0.5,
        0,
        { kind: 'wall' },
        GROUP_WORLD
      );

      this._buildPitchedRoof(worldGroup, cx, clearY + 0.36 + bridgeH, z, span + 0.3, depth + 0.25, true);

      // Lit Shikumen windows on both North & South facades of the overstreet room
      for (const side of [-1, 1]) {
        const ry = side > 0 ? 0 : Math.PI;
        const wz = z + side * (depth * 0.5 + 0.04);
        const wy = clearY + 0.36 + bridgeH * 0.5;
        const frame = new THREE.Mesh(this.kit.winFrame, this.mats.stoneVertex);
        frame.position.set(cx, wy, wz);
        frame.rotation.y = ry;
        worldGroup.add(frame);

        const glass = new THREE.Mesh(G.plane, this.mats.winLit);
        glass.scale.set(0.98, 1.48, 1);
        glass.position.set(cx, wy, wz + side * 0.04);
        glass.rotation.y = ry;
        worldGroup.add(glass);
      }

      // Warm passage lantern hung under arch center
      const lan = new THREE.Mesh(G.sphLo, this.gr.M.lanternBody);
      lan.scale.set(0.18, 0.24, 0.18);
      lan.position.set(cx, clearY - 0.22, z);
      worldGroup.add(lan);
      const gl = new THREE.Sprite(this.gr.M.glowSprite);
      gl.scale.set(2.4, 2.4, 1);
      gl.position.set(cx, clearY - 0.22, z);
      worldGroup.add(gl);
    }
  }

  _buildDockyardStructures(worldGroup, physics, totalW, totalD) {
    // Huangpu River lapping beyond the eastern pier border & north end
    const river = new THREE.Mesh(new THREE.PlaneGeometry(200, totalD + 140), this.mats.river);
    river.rotation.x = -Math.PI / 2;
    river.position.set(totalW + 96, -1.15, totalD * 0.5);
    river.receiveShadow = true;
    worldGroup.add(river);

    const northRiver = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 220, 130), this.mats.river);
    northRiver.rotation.x = -Math.PI / 2;
    northRiver.position.set(totalW * 0.5 + 30, -1.15, -65);
    worldGroup.add(northRiver);

    // Steel gantry cranes spanning the eastern waterfront quay with river overhang
    for (const zPos of [44, 115, 184]) {
      if (zPos < totalD - 20) {
        this._buildGantryCrane(worldGroup, totalW - 15.0, zPos, 13.75);
      }
    }
    this._buildMooredFreighter(worldGroup, totalW, totalD);
    return [river, northRiver];
  }

  _buildMooredFreighter(worldGroup, totalW, totalD) {
    const G = this.gr.G;
    const ship = new THREE.Group();
    ship.position.set(totalW + 14.5, -1.05, totalD * 0.48);

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x171c24, roughness: 0.68, metalness: 0.35 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0x5c1f1a, roughness: 0.72, metalness: 0.2 });
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xc8c0ae, roughness: 0.6 });
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0x4b3522, roughness: 0.85 });
    hullMat.userData.own = redMat.userData.own = bridgeMat.userData.own = hatchMat.userData.own = true;

    const hull = new THREE.Mesh(G.box, hullMat);
    hull.scale.set(9.6, 4.4, 46);
    hull.position.y = 2.0;
    hull.castShadow = true;
    ship.add(hull);

    const waterline = new THREE.Mesh(G.box, redMat);
    waterline.scale.set(9.8, 1.3, 46.2);
    waterline.position.y = 0.5;
    ship.add(waterline);

    const forecastle = new THREE.Mesh(G.box, hullMat);
    forecastle.scale.set(9.2, 2.2, 10.5);
    forecastle.position.set(0, 5.2, -17.5);
    ship.add(forecastle);

    const poopDeck = new THREE.Mesh(G.box, hullMat);
    poopDeck.scale.set(9.2, 2.0, 9.5);
    poopDeck.position.set(0, 5.1, 18.0);
    ship.add(poopDeck);

    // Timber cargo hatches & midship superstructure bridge
    for (const hz of [-8.8, 8.5]) {
      const hatch = new THREE.Mesh(G.box, hatchMat);
      hatch.scale.set(5.6, 0.9, 6.4);
      hatch.position.set(0, 4.6, hz);
      ship.add(hatch);
    }

    const bridge1 = new THREE.Mesh(G.box, bridgeMat);
    bridge1.scale.set(7.8, 3.2, 8.2);
    bridge1.position.set(0, 5.8, -0.5);
    ship.add(bridge1);

    const bridge2 = new THREE.Mesh(G.box, bridgeMat);
    bridge2.scale.set(6.4, 2.6, 4.8);
    bridge2.position.set(0, 8.6, -1.6);
    ship.add(bridge2);

    // Lit wheelhouse windows & portholes facing quay (-X)
    for (let pz = -4.0; pz <= 3.0; pz += 1.4) {
      const port = new THREE.Mesh(G.plane, this.mats.skylineWin);
      port.scale.set(0.55, 0.48, 1);
      port.position.set(-3.94, 6.2, pz);
      port.rotation.y = -Math.PI / 2;
      ship.add(port);
    }
    for (let pz = -3.2; pz <= 0.2; pz += 1.1) {
      const win = new THREE.Mesh(G.plane, this.mats.skylineWin);
      win.scale.set(0.75, 0.72, 1);
      win.position.set(-3.24, 9.0, pz);
      win.rotation.y = -Math.PI / 2;
      ship.add(win);
    }

    // Raked black-and-red steam funnel + soft drifting exhaust smoke
    const funnel = new THREE.Mesh(G.cylLo, hullMat);
    funnel.scale.set(1.05, 5.2, 1.05);
    funnel.position.set(0, 10.6, 1.8);
    funnel.rotation.x = 0.12;
    ship.add(funnel);
    const funnelBand = new THREE.Mesh(G.cylLo, redMat);
    funnelBand.scale.set(1.09, 1.35, 1.09);
    funnelBand.position.set(0, 11.4, 1.9);
    funnelBand.rotation.x = 0.12;
    ship.add(funnelBand);

    const smokeMat = new THREE.SpriteMaterial({
      map: this.assets.procTex.glow,
      color: 0x3b485e,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    smokeMat.userData.own = true;
    const smoke = new THREE.Sprite(smokeMat);
    smoke.scale.set(9, 6, 1);
    smoke.position.set(0, 14.8, 2.8);
    ship.add(smoke);

    // Twin cargo derrick masts & booms
    for (const mz of [-11.5, 11.5]) {
      const mast = new THREE.Mesh(G.cylLo, this.mats.steelBeam);
      mast.scale.set(0.24, 13.5, 0.24);
      mast.position.set(0, 10.5, mz);
      ship.add(mast);

      const boom = new THREE.Mesh(G.cylLo, this.mats.steelBeam);
      boom.scale.set(0.12, 9.5, 0.12);
      boom.position.set(-2.2, 11.2, mz);
      boom.rotation.z = 0.88;
      ship.add(boom);
    }

    worldGroup.add(ship);
  }

  _buildGantryCrane(worldGroup, x0, zPos, span) {
    const grp = new THREE.Group();
    const h = 15.2;
    const mat = this.mats.steelBeam;
    const G = this.gr.G;

    for (const lx of [x0, x0 + span]) {
      const leg1 = new THREE.Mesh(G.box, mat);
      leg1.scale.set(0.65, h, 0.65);
      leg1.position.set(lx, h * 0.5, zPos - 1.3);
      leg1.castShadow = true;
      grp.add(leg1);

      const leg2 = new THREE.Mesh(G.box, mat);
      leg2.scale.set(0.65, h, 0.65);
      leg2.position.set(lx, h * 0.5, zPos + 1.3);
      leg2.castShadow = true;
      grp.add(leg2);

      const foot = new THREE.Mesh(G.box, this.mats.trim);
      foot.scale.set(1.3, 0.6, 3.6);
      foot.position.set(lx, 0.3, zPos);
      grp.add(foot);
    }

    // Bridge girder extending 9m past east wall over the river
    const girder = new THREE.Mesh(G.box, mat);
    girder.scale.set(span + 11, 1.05, 1.5);
    girder.position.set(x0 + span * 0.5 + 4.5, h, zPos);
    girder.castShadow = true;
    grp.add(girder);

    const cab = new THREE.Mesh(G.box, new THREE.MeshStandardMaterial({ color: 0x6b2820, roughness: 0.7 }));
    cab.scale.set(2.4, 1.9, 1.8);
    cab.position.set(x0 + span * 0.5, h - 1.3, zPos);
    grp.add(cab);

    const cable = new THREE.Mesh(G.cylLo, mat);
    cable.scale.set(0.05, 5.2, 0.05);
    cable.position.set(x0 + span * 0.5, h - 4.6, zPos);
    grp.add(cable);

    worldGroup.add(grp);
  }

  _buildWarehouseTrusses(worldGroup, totalW, totalD) {
    const mat = this.mats.steelBeam;
    const G = this.gr.G;
    const h = 11.4;
    const coneGeo = new THREE.CylinderGeometry(0.9, 3.8, 9.8, 18, 1, true);

    for (let z = 10; z < totalD - 8; z += 11) {
      // Main horizontal steel truss beam spanning across warehouse
      const beam = new THREE.Mesh(G.box, mat);
      beam.scale.set(totalW - 5, 0.45, 0.38);
      beam.position.set(totalW * 0.5, h, z);
      beam.castShadow = true;
      worldGroup.add(beam);

      const topChord = new THREE.Mesh(G.box, mat);
      topChord.scale.set(totalW - 5, 0.35, 0.32);
      topChord.position.set(totalW * 0.5, h + 1.4, z);
      worldGroup.add(topChord);

      for (let x = 8; x < totalW - 8; x += 6) {
        const strut = new THREE.Mesh(G.box, mat);
        strut.scale.set(0.18, 1.7, 0.18);
        strut.position.set(x, h + 0.7, z);
        strut.rotation.z = (x % 12 === 0 ? 0.55 : -0.55);
        worldGroup.add(strut);
      }

      // Angled wall knee-braces supporting 95m industrial steel roof trusses
      for (const kx of [4.5, totalW - 4.5]) {
        const brace = new THREE.Mesh(G.box, mat);
        brace.scale.set(0.28, 3.8, 0.28);
        brace.position.set(kx, h - 1.4, z);
        brace.rotation.z = kx < totalW * 0.5 ? -0.72 : 0.72;
        worldGroup.add(brace);
      }

      // Cool moonlight skylight cones across left & right aisles
      if (z % 22 < 11) {
        for (const bx of [totalW * 0.33, totalW * 0.67]) {
          const beamCone = new THREE.Mesh(coneGeo, this.mats.skylightCone);
          beamCone.position.set(bx, 5.1, z);
          beamCone.rotation.z = bx < totalW * 0.5 ? 0.16 : -0.16;
          worldGroup.add(beamCone);
        }
      }
    }
  }

  _inst(worldGroup, geo, mat, list, out, sx = 1, sy = 1, sz = 1) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const mx4 = new THREE.Matrix4();
    const q4 = new THREE.Quaternion();
    const p4 = new THREE.Vector3();
    const s4 = new THREE.Vector3(sx, sy, sz);
    const Y = new THREE.Vector3(0, 1, 0);

    list.forEach((w, i) => {
      q4.setFromAxisAngle(Y, w[3]);
      p4.set(w[0] + Math.sin(w[3]) * out, w[1], w[2] + Math.cos(w[3]) * out);
      mx4.compose(p4, q4, s4);
      im.setMatrixAt(i, mx4);
    });
    im.frustumCulled = false;
    worldGroup.add(im);
  }
}
