import * as THREE from 'three';
import { MW, TILE, GROUP_PROP, GROUP_WORLD } from '../config/constants.js';
import { partSpec, buildColoredGeometry } from '../utils/GeometryBuilder.js';
import { PropInstancer } from './PropInstancer.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class PropsBuilder {
  constructor(gameRenderer, assets) {
    this.gr = gameRenderer;
    this.assets = assets;
    this.templates = null;
    this.mats = null;
  }

  _ensureTemplates() {
    if (this.templates) return;
    const G = this.gr.G;

    // 1. 1930s Shanghai Rickshaw geometry
    const rickParts = [
      // Main carriage body & seat
      partSpec(G.box, '#241812', [0, 0.62, -0.05], [0.92, 0.34, 0.92]),
      partSpec(G.box, '#17110e', [0, 0.96, -0.42], [0.9, 0.68, 0.14], [-0.18, 0, 0]),   // backrest
      partSpec(G.box, '#5e1a18', [0, 0.8, -0.02], [0.78, 0.12, 0.66]),                    // crimson cushion
      partSpec(G.box, '#241812', [-0.46, 0.88, -0.08], [0.08, 0.28, 0.82]),               // left armrest
      partSpec(G.box, '#241812', [0.46, 0.88, -0.08], [0.08, 0.28, 0.82]),                // right armrest
      partSpec(G.box, '#141418', [0, 1.38, -0.45], [0.96, 0.42, 0.62], [0.22, 0, 0]),    // folded canopy
      // Footrest & axle
      partSpec(G.box, '#2b1c14', [0, 0.42, 0.5], [0.76, 0.08, 0.38]),
      partSpec(G.cylLo, '#1a1a1f', [0, 0.54, -0.08], [0.035, 1.24, 0.035], [0, 0, Math.PI / 2]),
      // Two pull shafts resting down toward the cobbles
      partSpec(G.box, '#482d1a', [-0.36, 0.34, 1.05], [0.055, 0.06, 1.55], [0.24, 0, 0]),
      partSpec(G.box, '#482d1a', [0.36, 0.34, 1.05], [0.055, 0.06, 1.55], [0.24, 0, 0]),
      partSpec(G.box, '#482d1a', [0, 0.16, 1.72], [0.78, 0.05, 0.06])                    // cross handle
    ];
    // Spoked big wheels
    const wheelRim = new THREE.TorusGeometry(0.52, 0.04, 8, 20);
    for (const wx of [-0.6, 0.6]) {
      rickParts.push(partSpec(wheelRim, '#151518', [wx, 0.54, -0.08], [1, 1, 1], [0, Math.PI / 2, 0]));
      for (let i = 0; i < 6; i++) {
        rickParts.push(partSpec(G.box, '#5e3c22', [wx, 0.54, -0.08], [0.025, 1.0, 0.025], [(i * Math.PI) / 6, 0, 0]));
      }
    }
    wheelRim.dispose();

    // 2. Sandbag Barricade geometry (burlap)
    const bagGeo = new THREE.BoxGeometry(0.72, 0.24, 0.42);
    const bagParts = [];
    for (let row = 0; row < 3; row++) {
      const count = row < 2 ? 3 : 2;
      const off = (count - 1) * 0.37;
      for (let i = 0; i < count; i++) {
        const bx = i * 0.74 - off;
        const by = 0.12 + row * 0.23;
        const bz = row === 1 ? 0.04 : -0.02;
        bagParts.push(partSpec(bagGeo, row % 2 ? '#8f7d5a' : '#7b6b4b', [bx, by, bz], [1, 1, 1], [0, (i - 1) * 0.06, 0]));
      }
    }
    bagGeo.dispose();

    // 3. 1930s Flatbed Cargo Truck geometry (total ~5.0m long, 2.05m wide)
    const truckParts = [
      // Chassis rails
      partSpec(G.box, '#15161a', [0, 0.46, 0], [1.75, 0.24, 4.75]),
      // Retro engine hood + radiator grille (+Z is front)
      partSpec(G.box, '#333d35', [0, 1.05, 1.55], [1.38, 0.78, 1.38]),
      partSpec(G.box, '#8a7a48', [0, 1.06, 2.26], [1.18, 0.72, 0.08]),     // brass radiator frame
      partSpec(G.box, '#141416', [0, 1.06, 2.28], [0.96, 0.58, 0.06]),     // grille slats
      // Fenders
      partSpec(G.box, '#1f2622', [-0.84, 0.74, 1.52], [0.36, 0.18, 1.2]),
      partSpec(G.box, '#1f2622', [0.84, 0.74, 1.52], [0.36, 0.18, 1.2]),
      // Cab
      partSpec(G.box, '#2d3730', [0, 1.48, 0.38], [1.86, 1.38, 1.18]),
      partSpec(G.box, '#171c22', [0, 1.72, 0.98], [1.56, 0.56, 0.06]),     // windshield
      // Flatbed floor & wooden stakes
      partSpec(G.box, '#5e4024', [0, 0.86, -1.28], [2.04, 0.22, 2.52]),    // top around y=0.97m
      partSpec(G.box, '#4c321b', [-0.98, 1.28, -1.28], [0.09, 0.62, 2.48]),
      partSpec(G.box, '#4c321b', [0.98, 1.28, -1.28], [0.09, 0.62, 2.48]),
      partSpec(G.box, '#4c321b', [0, 1.28, -2.5], [2.04, 0.62, 0.09])
    ];
    // 4 heavy wheels
    for (const wx of [-0.92, 0.92]) {
      for (const wz of [1.45, -1.55]) {
        truckParts.push(partSpec(G.cyl, '#141416', [wx, 0.44, wz], [0.44, 0.28, 0.44], [0, 0, Math.PI / 2]));
        truckParts.push(partSpec(G.cylLo, '#62666e', [wx + Math.sign(wx) * 0.06, 0.44, wz], [0.22, 0.22, 0.22], [0, 0, Math.PI / 2]));
      }
    }

    // 4. 1930s Shanghai Noir Sedan (老上海流线型老爷轿车, ~4.3m long)
    const sedanParts = [
      partSpec(G.box, '#161922', [0, 0.52, 0], [1.62, 0.44, 4.15]),              // lower body
      partSpec(G.box, '#1f232e', [0, 0.86, 1.05], [1.14, 0.42, 1.52]),           // long rounded hood
      partSpec(G.box, '#b8bcc4', [0, 0.86, 1.84], [0.76, 0.36, 0.08]),           // chrome grille
      partSpec(G.box, '#191c24', [0, 1.18, -0.22], [1.48, 0.62, 1.72]),          // arched passenger cabin
      partSpec(G.box, '#141c24', [0, 1.24, 0.65], [1.34, 0.42, 0.06], [-0.24, 0, 0]), // sloped windshield
      partSpec(G.box, '#141c24', [0, 1.22, -1.08], [1.28, 0.38, 0.06], [0.32, 0, 0]), // rear glass
      partSpec(G.box, '#191c24', [0, 0.78, -1.52], [1.44, 0.42, 0.92], [0.22, 0, 0]), // fastback trunk
      partSpec(G.box, '#b8bcc4', [0, 0.38, 2.12], [1.72, 0.09, 0.1]),            // front chrome bumper
      partSpec(G.box, '#b8bcc4', [0, 0.38, -2.1], [1.72, 0.09, 0.1]),            // rear chrome bumper
      // Swept fenders & running boards
      partSpec(G.box, '#12151c', [-0.78, 0.62, 1.15], [0.34, 0.24, 1.25]),
      partSpec(G.box, '#12151c', [0.78, 0.62, 1.15], [0.34, 0.24, 1.25]),
      partSpec(G.box, '#12151c', [-0.78, 0.62, -1.25], [0.34, 0.24, 1.15]),
      partSpec(G.box, '#12151c', [0.78, 0.62, -1.25], [0.34, 0.24, 1.15]),
      partSpec(G.box, '#b8bcc4', [-0.88, 0.28, -0.05], [0.16, 0.05, 1.38]),
      partSpec(G.box, '#b8bcc4', [0.88, 0.28, -0.05], [0.16, 0.05, 1.38]),
      partSpec(G.sphLo, '#dcdfe6', [0, 1.07, 1.78], [0.04, 0.04, 0.09]),        // chrome hood ornament
      // Spare tire mounted at rear
      partSpec(G.cyl, '#141416', [0, 0.82, -2.06], [0.36, 0.18, 0.36], [Math.PI / 2, 0, 0])
    ];
    for (const wx of [-0.82, 0.82]) {
      for (const wz of [1.2, -1.25]) {
        sedanParts.push(partSpec(G.cyl, '#141416', [wx, 0.36, wz], [0.36, 0.22, 0.36], [0, 0, Math.PI / 2]));
        sedanParts.push(partSpec(G.cylLo, '#b8bcc4', [wx + Math.sign(wx) * 0.05, 0.36, wz], [0.18, 0.18, 0.18], [0, 0, Math.PI / 2]));
      }
    }

    // 5. 1930s Shanghai Electric Tramcar (有轨铛铛车, ~8.0m long)
    const tramParts = [
      // Steel rail track bed beneath tram
      partSpec(G.box, '#24272e', [0, 0.03, 0], [2.4, 0.06, 9.6]),
      partSpec(G.box, '#7c828c', [-0.74, 0.06, 0], [0.07, 0.06, 9.6]),
      partSpec(G.box, '#7c828c', [0.74, 0.06, 0], [0.07, 0.06, 9.6]),
      // Bogie undercarriage & cowcatcher aprons
      partSpec(G.box, '#141518', [0, 0.28, 0], [1.75, 0.34, 7.6]),
      partSpec(G.box, '#1b3328', [0, 0.86, 0], [2.16, 1.05, 7.95]),              // dark green lower panels
      partSpec(G.box, '#9c7c3a', [0, 1.42, 0], [2.2, 0.08, 8.0]),                // brass waist belt
      // Dark glazed interior box + cream window pillars
      partSpec(G.box, '#18242e', [0, 1.92, 0], [1.96, 0.92, 7.45]),
      partSpec(G.box, '#d8ceb8', [0, 1.92, 3.92], [2.12, 0.96, 0.14]),
      partSpec(G.box, '#d8ceb8', [0, 1.92, -3.92], [2.12, 0.96, 0.14]),
      // Clerestory walnut roof
      partSpec(G.box, '#2d221b', [0, 2.48, 0], [2.24, 0.22, 8.1]),
      partSpec(G.box, '#211914', [0, 2.74, 0], [1.4, 0.32, 6.2]),
      // Slanted overhead trolley pole & collector shoe
      partSpec(G.box, '#1a1c20', [0, 3.0, -0.5], [0.28, 0.18, 0.45]),
      partSpec(G.cylLo, '#5a606a', [0, 4.02, -1.65], [0.035, 3.1, 0.035], [-0.66, 0, 0]),
      // Front & rear destination signboards
      partSpec(G.box, '#141418', [0, 2.52, 4.08], [1.05, 0.26, 0.06]),
      partSpec(G.box, '#d9a441', [0, 2.52, 4.11], [0.85, 0.14, 0.04]),
      partSpec(G.box, '#141418', [0, 2.52, -4.08], [1.05, 0.26, 0.06]),
      partSpec(G.box, '#d9a441', [0, 2.52, -4.11], [0.85, 0.14, 0.04])
    ];
    for (const tz of [-3.3, -2.0, -0.65, 0.65, 2.0, 3.3]) {
      tramParts.push(partSpec(G.box, '#d8ceb8', [-1.05, 1.92, tz], [0.1, 0.96, 0.18]));
      tramParts.push(partSpec(G.box, '#d8ceb8', [1.05, 1.92, tz], [0.1, 0.96, 0.18]));
    }

    // 6. 1930s Street Newspaper / Tobacco Kiosk (申报烟纸亭)
    const kioskParts = [
      partSpec(G.box, '#1f3429', [0, 0.54, 0], [2.04, 1.08, 2.04]),
      partSpec(G.box, '#52341e', [0, 1.12, 0], [2.24, 0.1, 2.24]),
      partSpec(G.box, '#d99b42', [0, 1.66, 0], [1.66, 1.0, 1.66]),
      partSpec(G.box, '#54241e', [0, 2.34, 0], [2.56, 0.22, 2.56]),
      partSpec(G.box, '#421b17', [0, 2.58, 0], [1.68, 0.26, 1.68]),
      partSpec(G.box, '#d9a441', [0, 2.82, 0], [0.2, 0.24, 0.2])
    ];
    for (const sx of [-0.88, 0.88]) {
      for (const sz of [-0.88, 0.88]) {
        kioskParts.push(partSpec(G.box, '#241913', [sx, 1.68, sz], [0.16, 1.06, 0.16]));
      }
    }

    // 7. 1930s Wooden Telegraph Pole with Crossarms & Ceramic Insulators
    const poleParts = [
      partSpec(G.cylLo, '#322419', [0, 3.3, 0], [0.11, 6.6, 0.11]),
      partSpec(G.box, '#281c14', [0, 5.85, 0], [1.55, 0.09, 0.09]),
      partSpec(G.box, '#281c14', [0, 6.3, 0], [1.55, 0.09, 0.09])
    ];
    for (const ix of [-0.65, 0, 0.65]) {
      poleParts.push(partSpec(G.cylLo, '#dcdad2', [ix, 5.95, 0], [0.032, 0.14, 0.032]));
      poleParts.push(partSpec(G.cylLo, '#dcdad2', [ix, 6.4, 0], [0.032, 0.14, 0.032]));
    }

    // 8. 1930s Shanghai French-Concession Plane Tree (法国梧桐行道树 + 铸铁树池)
    const treeParts = [
      partSpec(G.box, '#22252c', [0, 0.04, 0], [1.28, 0.08, 1.28]),                     // cast-iron curb grate
      partSpec(G.box, '#5e5a52', [0, 0.09, 0], [1.36, 0.06, 1.36]),                     // stone tree curb
      partSpec(G.cylLo, '#5a5044', [0, 1.55, 0], [0.20, 3.1, 0.20], [0.04, 0, -0.03]),  // mottled sycamore trunk
      // 4 spreading boughs
      partSpec(G.cylLo, '#4d443a', [0.46, 3.35, 0.25], [0.09, 1.65, 0.09], [0.22, 0, -0.58]),
      partSpec(G.cylLo, '#4d443a', [-0.48, 3.4, -0.22], [0.09, 1.7, 0.09], [-0.2, 0, 0.6]),
      partSpec(G.cylLo, '#4d443a', [0.18, 3.5, -0.52], [0.08, 1.55, 0.08], [-0.56, 0, -0.18]),
      partSpec(G.cylLo, '#4d443a', [-0.15, 3.45, 0.54], [0.08, 1.55, 0.08], [0.58, 0, 0.16]),
      // Late-autumn olive/russet canopy clusters (high y=4.1..5.2 so sightlines underneath stay clear!)
      partSpec(G.sphLo, '#3b4632', [0, 4.55, 0], [1.45, 0.95, 1.45]),
      partSpec(G.sphLo, '#4f482d', [0.85, 4.15, 0.42], [1.08, 0.78, 1.05]),
      partSpec(G.sphLo, '#35402e', [-0.88, 4.2, -0.38], [1.12, 0.82, 1.08]),
      partSpec(G.sphLo, '#59492a', [0.32, 4.25, -0.88], [1.0, 0.75, 1.0]),
      partSpec(G.sphLo, '#444b33', [-0.28, 4.3, 0.92], [1.02, 0.76, 1.02])
    ];

    this.templates = {
      rickshaw: buildColoredGeometry(rickParts),
      sandbag: buildColoredGeometry(bagParts),
      truck: buildColoredGeometry(truckParts),
      sedan: buildColoredGeometry(sedanParts),
      tram: buildColoredGeometry(tramParts),
      kiosk: buildColoredGeometry(kioskParts),
      pole: buildColoredGeometry(poleParts),
      wutong: buildColoredGeometry(treeParts)
    };

    const p = this.assets.procTex;
    this.mats = {
      vertexLit: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.15 }),
      carPaint: new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.24,
        metalness: 0.42,
        clearcoat: 0.92,
        clearcoatRoughness: 0.14,
        envMapIntensity: 2.1
      }),
      burlap: new THREE.MeshStandardMaterial({ vertexColors: true, map: p.burlap, roughness: 0.92 }),
      headlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1c4).multiplyScalar(1.9), toneMapped: false }),
      tramGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffbd66).multiplyScalar(1.35), toneMapped: false }),
      taillight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2818).multiplyScalar(1.8), toneMapped: false }),
      plankDebris: new THREE.MeshStandardMaterial({ map: p.plank, roughness: 0.82 }),
      steam: new THREE.SpriteMaterial({
        map: p.glow,
        color: 0xaabed8,
        transparent: true,
        opacity: 0.09,
        depthWrite: false
      })
    };
    // Low street clutter is skipped by the puddle-reflection pass (see LAYER_NO_REFLECT)
    this.mats.vertexLit.userData.noReflect = true;
    this.mats.burlap.userData.noReflect = true;
    for (const k of ['crate', 'barrel']) {
      this.assets.glb[k].traverse(o => {
        if (o.isMesh) o.material.userData.noReflect = true;
      });
    }
    this.gr.M.lanternCap.userData.noReflect = true;
  }

  _lanternTemplate() {
    if (this._lanternTpl) return this._lanternTpl;
    const G = this.gr.G;
    const M = this.gr.M;
    const t = new THREE.Group();
    const body = new THREE.Mesh(G.sph, M.lanternBody);
    body.scale.set(0.21, 0.27, 0.21);
    const caps = new THREE.Mesh(
      buildColoredGeometry([
        partSpec(G.cylLo, '#ffffff', [0, 0.26, 0], [0.11, 0.05, 0.11]),
        partSpec(G.cylLo, '#ffffff', [0, -0.26, 0], [0.11, 0.05, 0.11])
      ]),
      M.lanternCap
    );
    const tassel = new THREE.Mesh(G.cylLo, M.brass);
    tassel.scale.set(0.03, 0.14, 0.03);
    tassel.position.y = -0.35;
    t.add(body, caps, tassel);
    return (this._lanternTpl = t);
  }

  build(level, worldGroup, physics) {
    this._ensureTemplates();
    const MH = level.MH;
    const tileMesh = {};
    const tileColliders = {};
    const barrelsByTile = {};
    const G = this.gr.G;
    const M = this.gr.M;
    const inst = new PropInstancer(worldGroup);
    const xf = new THREE.Object3D();
    const place = (x, y, z, ry, s, parent = null) => {
      xf.position.set(x, y, z);
      xf.rotation.set(0, ry, 0);
      xf.scale.setScalar(s);
      xf.updateMatrix();
      return parent ? new THREE.Matrix4().multiplyMatrices(parent, xf.matrix) : xf.matrix.clone();
    };

    // 1. Crates & Dynamic Explosive Barrels
    for (let z = 0; z < MH; z++) {
      for (let x = 0; x < MW; x++) {
        const k = z * MW + x;
        const g = level.grid[k];
        if (g !== 2 && g !== 3) continue;

        const wx = (x + 0.5) * TILE;
        const wz = (z + 0.5) * TILE;

        if (g === 2) {
          const rotY = (Math.random() < 0.5 ? 0 : Math.PI / 2) + rnd(-0.04, 0.04);
          const tileXf = place(wx, 0, wz, rotY, 1);
          const isTall = !level.lowTiles.has(k) && Math.random() < 0.55;
          level.tileH[k] = isTall ? 2.02 : 1.04;

          const crateTpl = this.assets.glb.crate;
          const handles = [];
          for (const ox of [-0.56, 0.56]) {
            handles.push(inst.add(crateTpl, place(ox, 0.04, rnd(-0.04, 0.04), 0, 2, tileXf)));
          }
          if (isTall) {
            handles.push(inst.add(crateTpl, place(0, 1.0, 0, Math.PI / 2 + rnd(-0.2, 0.2), 2, tileXf)));
          }
          tileMesh[k] = handles;

          const hy = isTall ? 1.0 : 0.52;
          const res = physics.addStaticBox(
            wx,
            hy,
            wz,
            1.15,
            hy,
            1.15,
            rotY,
            { kind: 'crate', tx: x, tz: z, tileKey: k, isTall },
            GROUP_PROP
          );
          tileColliders[k] = res.rb;
        } else {
          level.tileH[k] = 1.18;
          barrelsByTile[k] = [];
          for (const [ox, oz] of [[-0.5, -0.4], [0.5, -0.3], [0, 0.5]]) {
            // Physics drives this proxy; the instancer mirrors it into the shared barrel batch
            const b = new THREE.Object3D();
            b.scale.setScalar(1.35);
            const bx = wx + ox;
            const bz = wz + oz;
            b.position.set(bx, 0, bz);
            b.rotation.y = rnd(0, Math.PI * 2);

            const link = physics.createDynamicBarrel(
              b,
              bx,
              0,
              bz,
              0.38,
              0.59,
              { kind: 'barrel', tx: x, tz: z, tileKey: k }
            );
            link.instHandle = inst.addDynamic(this.assets.glb.barrel, b);
            barrelsByTile[k].push(link);
          }
        }
      }
    }

    // 2. Street Lamps + Volumetric Light Cones + Alley Steam
    const steamSprites = [];
    this._poolTpl ??= new THREE.Mesh(G.circ, M.pool);
    this._coneTpl ??= new THREE.Mesh(G.lampCone, M.lampCone);
    for (let li = 0; li < level.lamps.length; li++) {
      const l = level.lamps[li];
      const ry = Math.random() < 0.5 ? 0 : Math.PI;
      inst.add(this.assets.glb.lamp, place(l.x, 0, l.z, ry, 1));

      const t = this.assets.lampTop.clone().applyAxisAngle(Y_AXIS, ry);
      l.lx = l.x + t.x;
      l.ly = t.y;
      l.lz = l.z + t.z;

      const sp = new THREE.Sprite(M.glowSprite);
      sp.scale.set(1.1, 1.1, 1);
      sp.position.set(l.lx, l.ly, l.lz);
      worldGroup.add(sp);

      xf.position.set(l.lx, 0.03, l.lz);
      xf.rotation.set(-Math.PI / 2, 0, 0);
      xf.scale.setScalar(4.8);
      xf.updateMatrix();
      inst.add(this._poolTpl, xf.matrix);
      inst.add(this._coneTpl, place(l.lx, l.ly - 2.15, l.lz, 0, 1));

      if (li % 2 === 0 && steamSprites.length < 14) {
        const stm = new THREE.Sprite(this.mats.steam);
        stm.position.set(l.x + rnd(-0.8, 0.8), 0.9, l.z + rnd(-0.8, 0.8));
        stm.scale.set(2.6, 1.8, 1);
        stm.userData = { baseX: stm.position.x, baseY: 0.9, ph: rnd(0, Math.PI * 2) };
        worldGroup.add(stm);
        steamSprites.push(stm);
      }

      physics.addStaticBox(l.x, 1.8, l.z, 0.18, 1.8, 0.18, 0, { kind: 'metal' }, GROUP_WORLD);
    }

    // 3. Swinging Overhead Red Lanterns with Spherical Joints
    for (let z = 8; z < MH - 6; z += 7) {
      const c0 = level.street[z];
      let xl = c0;
      let xr = c0;
      while (level.T(xl, z) !== 1) xl--;
      while (level.T(xr, z) !== 1) xr++;
      if (xr - xl < 5 || xr - xl > 19 || xl === 0 || xr === MW - 1) continue;

      const x0 = (xl + 1) * TILE;
      const x1 = xr * TILE;
      const wz = (z + 0.5) * TILE;
      const at = t => new THREE.Vector3(x0 + (x1 - x0) * t, 5.4 - Math.sin(t * Math.PI) * 0.55, wz);

      const pts = [];
      for (let i = 0; i <= 12; i++) pts.push(at(i / 12));
      worldGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.wire));

      for (const t of [0.25, 0.5, 0.75]) {
        const anchorPos = at(t);
        // Physics swings this proxy; the instancer mirrors it into the shared lantern batches
        const lGrp = new THREE.Object3D();
        lGrp.position.set(anchorPos.x, anchorPos.y - 0.36, anchorPos.z);
        inst.addDynamic(this._lanternTemplate(), lGrp);

        const g2 = new THREE.Sprite(M.redGlow);
        g2.scale.set(1.05, 1.05, 1);
        g2.position.copy(lGrp.position);
        worldGroup.add(g2);

        const wireGeo = new THREE.BufferGeometry().setFromPoints([
          anchorPos.clone(),
          new THREE.Vector3(anchorPos.x, anchorPos.y - 0.18, anchorPos.z)
        ]);
        const wireLine = new THREE.Line(wireGeo, M.wire);
        wireLine.userData.dynamic = true;
        worldGroup.add(wireLine);

        const entry = physics.createHangingLantern(anchorPos.x, anchorPos.y, anchorPos.z, lGrp, 0.36);
        entry.glowSprite = g2;
        entry.wireLine = wireLine;
      }
    }

    // 4. Thematic Street Props: Rickshaws, Sandbag Barricades, 1930s Trucks
    for (const p of level.props) {
      if (p.kind === 'rickshaw') {
        const m = new THREE.Mesh(this.templates.rickshaw, this.mats.vertexLit);
        m.position.set(p.x, 0, p.z);
        m.rotation.y = p.rotY;
        m.castShadow = true;
        m.receiveShadow = true;
        worldGroup.add(m);
      } else if (p.kind === 'sandbag') {
        const m = new THREE.Mesh(this.templates.sandbag, this.mats.burlap);
        m.position.set(p.x, 0, p.z);
        m.rotation.y = p.rotY;
        m.castShadow = true;
        m.receiveShadow = true;
        worldGroup.add(m);
      } else if (p.kind === 'truck') {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        grp.rotation.y = p.rotY;
        const body = new THREE.Mesh(this.templates.truck, this.mats.carPaint);
        body.castShadow = true;
        body.receiveShadow = true;
        grp.add(body);

        // Dual headlights + volumetric beams
        for (const hx of [-0.62, 0.62]) {
          const bulb = new THREE.Mesh(G.sphLo, this.mats.headlight);
          bulb.scale.set(0.11, 0.11, 0.06);
          bulb.position.set(hx, 0.92, 2.26);
          grp.add(bulb);

          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.05, 4.6, 14, 1, true), M.headlightCone);
          beam.position.set(hx, 0.72, 4.55);
          beam.rotation.x = -Math.PI / 2 - 0.08;
          grp.add(beam);
        }
        worldGroup.add(grp);

      } else if (p.kind === 'sedan') {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        grp.rotation.y = p.rotY;
        const body = new THREE.Mesh(this.templates.sedan, this.mats.carPaint);
        body.castShadow = true;
        body.receiveShadow = true;
        grp.add(body);

        for (const hx of [-0.52, 0.52]) {
          const bulb = new THREE.Mesh(G.sphLo, this.mats.headlight);
          bulb.scale.set(0.09, 0.09, 0.05);
          bulb.position.set(hx, 0.72, 1.85);
          grp.add(bulb);

          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.9, 4.0, 14, 1, true), M.headlightCone);
          beam.position.set(hx, 0.56, 3.8);
          beam.rotation.x = -Math.PI / 2 - 0.08;
          grp.add(beam);
        }
        for (const tx of [-0.58, 0.58]) {
          const tail = new THREE.Mesh(G.sphLo, this.mats.taillight);
          tail.scale.set(0.06, 0.06, 0.04);
          tail.position.set(tx, 0.66, -2.06);
          grp.add(tail);
        }
        worldGroup.add(grp);
      } else if (p.kind === 'tram') {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        grp.rotation.y = p.rotY;
        const body = new THREE.Mesh(this.templates.tram, this.mats.carPaint);
        body.castShadow = true;
        body.receiveShadow = true;
        grp.add(body);

        // Warm lit interior core & front/rear cyclops tram headlamps
        const core = new THREE.Mesh(G.box, this.mats.tramGlow);
        core.scale.set(1.5, 0.65, 6.2);
        core.position.set(0, 1.9, 0);
        grp.add(core);

        for (const dir of [-1, 1]) {
          const bulb = new THREE.Mesh(G.sphLo, this.mats.headlight);
          bulb.scale.set(0.14, 0.14, 0.08);
          bulb.position.set(0, 1.02, dir * 4.02);
          grp.add(bulb);
        }
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.3, 5.5, 14, 1, true), M.headlightCone);
        beam.position.set(0, 0.75, 6.7);
        beam.rotation.x = -Math.PI / 2 - 0.08;
        grp.add(beam);

        worldGroup.add(grp);
      } else if (p.kind === 'kiosk') {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        grp.rotation.y = p.rotY;
        const body = new THREE.Mesh(this.templates.kiosk, this.mats.vertexLit);
        body.castShadow = true;
        body.receiveShadow = true;
        grp.add(body);
        const lamp = new THREE.Sprite(M.glowSprite);
        lamp.scale.set(1.05, 1.05, 1);
        lamp.position.set(0, 1.75, 0);
        grp.add(lamp);
        worldGroup.add(grp);
      }
    }
    for (const b of level.streetBoxes) {
      physics.addStaticBox(b.x, b.hy, b.z, b.hx, b.hy, b.hz, b.rotY, { kind: b.kind }, GROUP_PROP);
    }

    // 5. Wooden Telegraph Poles & Catenary Overhead Wires
    if (level.poles?.length) {
      for (let i = 0; i < level.poles.length; i++) {
        const pl = level.poles[i];
        const pm = new THREE.Mesh(this.templates.pole, this.mats.vertexLit);
        pm.position.set(pl.x, 0, pl.z);
        pm.castShadow = true;
        worldGroup.add(pm);
        physics.addStaticBox(pl.x, 2.0, pl.z, 0.16, 2.0, 0.16, 0, { kind: 'prop' }, GROUP_WORLD);

        if (i > 0) {
          const prev = level.poles[i - 1];
          const d = Math.hypot(pl.x - prev.x, pl.z - prev.z);
          if (d < 32) {
            for (const wx of [-0.65, 0, 0.65]) {
              const pts = [];
              for (let s = 0; s <= 10; s++) {
                const t = s / 10;
                const sag = Math.sin(t * Math.PI) * 0.38;
                pts.push(
                  new THREE.Vector3(
                    prev.x + (pl.x - prev.x) * t + wx,
                    6.34 - sag,
                    prev.z + (pl.z - prev.z) * t
                  )
                );
              }
              worldGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.wire));
            }
          }
        }
      }
    }

    // 6. 1930s Shanghai Avenue Plane Trees (法国梧桐)
    if (level.trees?.length) {
      for (const tr of level.trees) {
        const tm = new THREE.Mesh(this.templates.wutong, this.mats.vertexLit);
        tm.position.set(tr.x, 0, tr.z);
        tm.rotation.y = tr.rotY;
        tm.scale.setScalar(tr.scale);
        tm.castShadow = true;
        tm.receiveShadow = true;
        worldGroup.add(tm);
        physics.addStaticBox(tr.x, 1.5, tr.z, 0.22, 1.5, 0.22, 0, { kind: 'crate', tx: -1, tz: -1 }, GROUP_WORLD);
      }
    }

    inst.finalize();
    return { tileMesh, tileColliders, barrelsByTile, steamSprites, instancer: inst };
  }

  spawnCrateFracture(worldGroup, physics, wx, wz, hitDirX, hitDirY, hitDirZ, isTall) {
    // 1. Flying Crate Lid from crate.json
    if (this.assets.crateLid) {
      const lid = this.assets.crateLid.clone();
      lid.scale.setScalar(2);
      lid.castShadow = true;
      worldGroup.add(lid);
      physics.spawnDynamicDebris(
        lid,
        wx,
        isTall ? 1.85 : 0.9,
        wz,
        0.5,
        0.08,
        1.0,
        hitDirX * 3.5 + rnd(-2, 2),
        rnd(3.8, 6.2),
        hitDirZ * 3.5 + rnd(-2, 2),
        rnd(-6, 6),
        rnd(-5, 5),
        rnd(-6, 6),
        8.0
      );
    }

    // 2. Six splintered wooden plank rigid bodies
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(this.gr.G.box, this.mats.plankDebris);
      const sx = rnd(0.55, 0.95);
      const sy = 0.08;
      const sz = rnd(0.18, 0.32);
      plank.scale.set(sx, sy, sz);
      plank.castShadow = true;
      worldGroup.add(plank);

      const ang = (i / 6) * Math.PI * 2 + rnd(-0.3, 0.3);
      const sp = rnd(2.5, 5.5);
      physics.spawnDynamicDebris(
        plank,
        wx + Math.cos(ang) * 0.4,
        rnd(0.35, isTall ? 1.6 : 0.95),
        wz + Math.sin(ang) * 0.4,
        sx * 0.5,
        sy * 0.5,
        sz * 0.5,
        Math.cos(ang) * sp + hitDirX * 3.0,
        rnd(2.2, 5.8) + Math.max(0, hitDirY * 2),
        Math.sin(ang) * sp + hitDirZ * 3.0,
        rnd(-10, 10),
        rnd(-10, 10),
        rnd(-10, 10),
        7.0
      );
    }
  }
}
