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
      skyline: new THREE.MeshBasicMaterial({ color: 0x090f1d, fog: true }),
      skylineWin: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffbd66).multiplyScalar(1.3), toneMapped: false })
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

        // Pitched dark-tile roof for Level 0 (弄堂) & Level 1 (码头货栈)
        if (!cfg.boss) {
          this._buildPitchedRoof(worldGroup, cx, H, cz, bw, bd, cfg.style === 'cobble');
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
          if (fl === 0 && !r.border && Math.random() < 0.32) {
            doors.push([px, 1.32, pz, ry]);
            if (cfg.style === 'cobble') {
              shikumens.push([px, 0.14, pz, ry]);
            } else if (cfg.style === 'plank' && Math.random() < 0.65) {
              awnings.push([px, 2.95, pz, ry]);
            }
            continue;
          }
          const wy = fl * floorH + 1.85;
          wins.push([px, wy, pz, ry, Math.random() < 0.36]);
          if (!r.border && fl === 1 && cfg.style === 'cobble' && Math.random() < 0.32) {
            balconies.push([px, fl * floorH + 0.08, pz, ry]);
          }
        }
      };

      for (let i = 0; i < r.w; i++) { side(r.x + i, r.y, 0, -1); side(r.x + i, r.y + r.h - 1, 0, 1); }
      for (let j = 0; j < r.h; j++) { side(r.x, r.y + j, -1, 0); side(r.x + r.w - 1, r.y + j, 1, 0); }

      // 3D Neon Signboards (horizontal or vertical hanging)
      if (!r.border && r.w >= 2 && level.T(r.x + (r.w >> 1), r.y + r.h) !== 1 && Math.random() < 0.78) {
        const signSpec = SHANGHAI_SIGNS[(Math.random() * SHANGHAI_SIGNS.length) | 0];
        const vertical = Math.random() < 0.42;
        this._buildNeonSign(
          worldGroup,
          signSpec.text,
          signSpec.color,
          cx,
          vertical ? 4.3 : 3.45,
          (r.y + r.h) * TILE,
          bw,
          vertical
        );
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
    if (cfg.style === 'plank') {
      const rivers = this._buildDockyardStructures(worldGroup, physics, totalW, totalD);
      reflectHide.push(...rivers);
    } else if (cfg.boss) {
      this._buildWarehouseTrusses(worldGroup, totalW, totalD);
    }

    return { reflectHide };
  }

  _buildSkyAndSkyline(worldGroup, totalW, totalD) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 14), this.mats.skyDome);
    sky.position.set(totalW * 0.5, 0, totalD * 0.5);
    worldGroup.add(sky);

    const G = this.gr.G;
    const cx = totalW * 0.5;
    const cz = totalD * 0.5;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const dist = 105 + (i % 3) * 14;
      const bx = cx + Math.cos(ang) * dist;
      const bz = cz + Math.sin(ang) * dist;
      const w = 10 + (i % 4) * 5;
      const h = 24 + ((i * 7) % 5) * 9;
      const tower = new THREE.Mesh(G.box, this.mats.skyline);
      tower.scale.set(w, h, w);
      tower.position.set(bx, h * 0.5 - 2, bz);
      tower.lookAt(cx, h * 0.5 - 2, cz);
      worldGroup.add(tower);

      if (i % 4 === 0) {
        // Stepped spire / Custom House clocktower silhouette
        const spire = new THREE.Mesh(G.box, this.mats.skyline);
        spire.scale.set(w * 0.48, 12, w * 0.48);
        spire.position.set(bx, h + 4, bz);
        worldGroup.add(spire);
        const beacon = new THREE.Mesh(G.plane, this.mats.skylineWin);
        beacon.scale.set(1.8, 1.8, 1);
        beacon.position.set(bx - Math.cos(ang) * (w * 0.25), h + 4, bz - Math.sin(ang) * (w * 0.25));
        beacon.lookAt(cx, h + 4, cz);
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

  _buildNeonSign(worldGroup, text, col, cx, cy, wallZ, bw, vertical) {
    const tex = makeSignTexture(text, col, vertical);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    faceMat.userData.own = true;
    faceMat.userData.ownMap = true;

    const grp = new THREE.Group();
    const w = vertical ? 0.92 : Math.min(bw - 0.5, 3.3);
    const h = vertical ? 2.65 : w * 0.31;

    if (vertical) {
      // Protrudes outward from facade with two iron support struts
      grp.position.set(cx + rnd(-bw * 0.25, bw * 0.25), cy, wallZ + 0.85);
      const box = new THREE.Mesh(this.gr.G.box, this.gr.M.dark);
      box.scale.set(0.18, h + 0.12, w + 0.12);
      grp.add(box);
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(this.gr.G.plane, faceMat);
        f.scale.set(w, h, 1);
        f.position.x = side * 0.1;
        f.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        grp.add(f);
      }
      for (const oy of [-h * 0.34, h * 0.34]) {
        const arm = new THREE.Mesh(this.gr.G.box, this.mats.steelBeam);
        arm.scale.set(0.06, 0.06, 0.9);
        arm.position.set(0, oy, -0.45);
        grp.add(arm);
      }
    } else {
      grp.position.set(cx, cy, wallZ + 0.22);
      const box = new THREE.Mesh(this.gr.G.box, this.gr.M.dark);
      box.scale.set(w + 0.14, h + 0.14, 0.22);
      grp.add(box);
      const f = new THREE.Mesh(this.gr.G.plane, faceMat);
      f.scale.set(w, h, 1);
      f.position.z = 0.12;
      grp.add(f);
    }

    const gl = new THREE.Sprite(this.gr.M.glowSprite.clone());
    gl.material.color.set(col);
    gl.material.opacity = 0.38;
    gl.material.userData.own = true;
    gl.scale.set(vertical ? 2.4 : w * 1.75, vertical ? 3.2 : 2.5, 1);
    gl.position.z = vertical ? 0 : 0.35;
    grp.add(gl);

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

  _buildDockyardStructures(worldGroup, physics, totalW, totalD) {
    // Huangpu River lapping beyond the eastern pier border & north end
    const river = new THREE.Mesh(new THREE.PlaneGeometry(140, totalD + 80), this.mats.river);
    river.rotation.x = -Math.PI / 2;
    river.position.set(totalW + 66, -1.15, totalD * 0.5);
    river.receiveShadow = true;
    worldGroup.add(river);

    const northRiver = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 140, 90), this.mats.river);
    northRiver.rotation.x = -Math.PI / 2;
    northRiver.position.set(totalW * 0.5 + 30, -1.15, -45);
    worldGroup.add(northRiver);

    // Steel gantry cranes straddling the outer pier walls with east overhang over the river
    for (const zPos of [38, 96]) {
      if (zPos < totalD - 16) {
        this._buildGantryCrane(worldGroup, 1.25, zPos, totalW - 2.5);
      }
    }
    return [river, northRiver];
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

      // Cool moonlight skylight beam on alternating trusses
      if (z % 22 < 11) {
        const beamCone = new THREE.Mesh(coneGeo, this.mats.skylightCone);
        beamCone.position.set(totalW * 0.5 + ((z % 3) - 1) * 4, 5.1, z);
        beamCone.rotation.z = 0.16;
        worldGroup.add(beamCone);
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
