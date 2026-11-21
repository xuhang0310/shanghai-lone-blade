import { MW, TILE, LEVELS, ENEMY_TYPES, CHAR_STYLES } from '../config/constants.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CARDINALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Half extents of the street props, shared by the navigation grid and Rapier.
const STREET_SHAPES = {
  rickshaw: [{ hx: .65, hy: .60, hz: .90, kind: 'prop' }],
  sandbag: [{ hx: 1.15, hy: .38, hz: .42, kind: 'prop' }],
  truck: [{ hx: .96, hy: 1.05, hz: 1.32, offset: .95, kind: 'metal' },
          { hx: 1.02, hy: .49, hz: 1.24, offset: -1.28, kind: 'prop' }],
  sedan: [{ hx: .92, hy: .72, hz: 2.10, kind: 'metal' }],
  tram: [{ hx: 1.08, hy: 1.55, hz: 4.00, kind: 'metal' }],
  kiosk: [{ hx: 1.05, hy: 1.35, hz: 1.05, kind: 'prop' }]
};

export class LevelState {
  constructor() {
    this.lvlIndex = 0;
    this.cfg = LEVELS[0];
    this.MH = LEVELS[0].h;
    this.grid = new Uint8Array(MW * this.MH);
    this.tileHp = new Float32Array(MW * this.MH);
    this.tileH = new Float32Array(MW * this.MH);
    this.flow = new Int16Array(MW * this.MH);
    this.rects = [];
    this.lamps = [];
    this.street = [];
    this.crossZs = [];
    this.gateways = [];
    this.poles = [];
    this.lowTiles = new Set();
    this.startPos = { x: 0, z: 0 };
    this.exitPos = { x: 0, z: 0 };
    this.enemies = [];
    this.corpses = [];
    this.calloutCd = 0;
    this.boss = null;
    this.bossRoom = null;
    this.shrines = [];
    this.soulCaches = [];
    this.trees = [];
    this.hostage = null;
    this.charges = [];
    this.props = []; // { kind: 'rickshaw'|'sandbag'|'truck', x, z, rotY }
    this.indexStreetProps();
    this.totalEnemies = 0;
  }

  T(tx, tz) {
    if (tx < 0 || tz < 0 || tx >= MW || tz >= this.MH) return 1;
    return this.grid[tz * MW + tx];
  }

  solidAt(x, z) {
    return this.T(Math.floor(x / TILE), Math.floor(z / TILE)) !== 0 || this.propHeightAt(x, z) > 0;
  }

  hAt(x, z) {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    if (tx < 0 || tz < 0 || tx >= MW || tz >= this.MH) return 99;
    return Math.max(this.tileH[tz * MW + tx], this.propHeightAt(x, z));
  }

  boxHit(x, z, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const z0 = Math.floor((z - r) / TILE), z1 = Math.floor((z + r) / TILE);
    return !!(this.T(x0, z0) || this.T(x1, z0) || this.T(x0, z1) || this.T(x1, z1) || this.propHeightAt(x, z, r));
  }

  indexStreetProps() {
    this.streetBoxes = [];
    this.streetCells = [];
    this.propBlocked = new Uint8Array(MW * this.MH);
    for (const p of this.props) {
      const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
      for (const shape of STREET_SHAPES[p.kind] || []) {
        const offset = shape.offset || 0;
        const box = { ...shape, x: p.x + offset * s, z: p.z + offset * c, rotY: p.rotY, c, s };
        this.streetBoxes.push(box);
        const rx = Math.abs(c) * box.hx + Math.abs(s) * box.hz + 1;
        const rz = Math.abs(s) * box.hx + Math.abs(c) * box.hz + 1;
        for (let tz = Math.max(0, Math.floor((box.z - rz) / TILE)); tz <= Math.min(this.MH - 1, Math.floor((box.z + rz) / TILE)); tz++) {
          for (let tx = Math.max(0, Math.floor((box.x - rx) / TILE)); tx <= Math.min(MW - 1, Math.floor((box.x + rx) / TILE)); tx++) {
            (this.streetCells[tz * MW + tx] ??= []).push(box);
          }
        }
      }
    }
    this.streetCells.forEach((boxes, cell) => {
      const x = (cell % MW + .5) * TILE, z = (Math.floor(cell / MW) + .5) * TILE;
      this.propBlocked[cell] = this.propHeightAt(x, z, .56) > 0 ? 1 : 0;
    });
  }

  propHeightAt(x, z, radius = 0) {
    const boxes = this.streetCells[Math.floor(z / TILE) * MW + Math.floor(x / TILE)];
    if (!boxes) return 0;
    let height = 0;
    for (const b of boxes) {
      const dx = x - b.x, dz = z - b.z;
      const ox = Math.max(0, Math.abs(dx * b.c - dz * b.s) - b.hx);
      const oz = Math.max(0, Math.abs(dx * b.s + dz * b.c) - b.hz);
      if (ox * ox + oz * oz <= radius * radius) height = Math.max(height, 2 * b.hy);
    }
    return height;
  }

  moveEnt(e, dx, dz) {
    const r = e.r * 0.9;
    if (!this.boxHit(e.x + dx, e.z, r)) e.x += dx;
    if (!this.boxHit(e.x, e.z + dz, r)) e.z += dz;
  }

  canWalk(x, z, tx, tz, radius) {
    const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, tz - z) / 0.5));
    for (let i = 1; i <= steps; i++) {
      if (this.boxHit(x + (tx - x) * i / steps, z + (tz - z) * i / steps, radius)) return false;
    }
    return true;
  }

  // Search a few connected floor cells at the moment of a scare. Prefer a nearby
  // place out of sight, then open ground farther from the disturbance.
  shelterRoute(e, dangerX, dangerZ) {
    if (!this.los3(dangerX, 1.45, dangerZ, e.x, 0.76, e.z)) return [];
    const tx = Math.floor(e.x / TILE), tz = Math.floor(e.z / TILE);
    const startDist = Math.hypot(e.x - dangerX, e.z - dangerZ);
    const nodes = [{ tx, tz, x: e.x, z: e.z, parent: -1, depth: 0 }];
    const visited = new Set([tz * MW + tx]);
    const occupied = new Set();
    for (const other of this.enemies) {
      const end = other !== e && other.defense?.destination;
      if (end) occupied.add(Math.floor(end.z / TILE) * MW + Math.floor(end.x / TILE));
    }
    let best = 0;
    let bestScore = 0.35;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.depth >= 4) continue;
      for (const [ox, oz] of CARDINALS) {
        const nx = n.tx + ox, nz = n.tz + oz;
        const key = nz * MW + nx;
        if (this.T(nx, nz) || visited.has(key)) continue;
        const x = (nx + 0.5) * TILE, z = (nz + 0.5) * TILE;
        const gain = Math.hypot(x - dangerX, z - dangerZ) - startDist;
        if (gain < -0.9 || !this.canWalk(n.x, n.z, x, z, e.r * 0.9)) continue;
        visited.add(key);
        const depth = n.depth + 1;
        nodes.push({ tx: nx, tz: nz, x, z, parent: i, depth });
        const hidden = !this.los3(dangerX, 1.45, dangerZ, x, 0.76, z);
        const score = (hidden ? 14 : 0) + Math.min(gain, 6) - depth * 0.65 - (occupied.has(key) ? 5 : 0);
        if (score > bestScore) { best = nodes.length - 1; bestScore = score; }
      }
    }
    const route = [];
    for (let i = best; i > 0; i = nodes[i].parent) route.push({ x: nodes[i].x, z: nodes[i].z });
    return route.reverse();
  }

  los(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / 0.75));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  los3(x0, y0, z0, x1, y1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / 0.65));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.hAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > y0 + (y1 - y0) * t) {
        return false;
      }
    }
    return true;
  }

  computeFlow(px, pz) {
    this.flow.fill(-1);
    const sx = clamp(Math.floor(px / TILE), 0, MW - 1);
    const sz = clamp(Math.floor(pz / TILE), 0, this.MH - 1);
    const q = new Int32Array(MW * this.MH);
    let h = 0;
    let t = 0;
    const startIdx = sz * MW + sx;
    q[t++] = startIdx;
    this.flow[startIdx] = 0;

    while (h < t) {
      const k = q[h++];
      const x = k % MW;
      const z = (k / MW) | 0;
      const d = this.flow[k] + 1;
      for (const [ox, oz] of CARDINALS) {
        const nx = x + ox, nz = z + oz, next = nz * MW + nx;
        if (this.T(nx, nz) || this.propBlocked[next] || this.flow[next] >= 0) continue;
        this.flow[next] = d;
        q[t++] = next;
      }
    }
  }

  flowDir(e) {
    const tx = Math.floor(e.x / TILE);
    const tz = Math.floor(e.z / TILE);
    if (tx < 0 || tz < 0 || tx >= MW || tz >= this.MH) return null;
    let bestV = this.flow[tz * MW + tx];
    if (bestV < 0) return null;
    let bx = 0;
    let bz = 0;
    const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [ox, oz] of N8) {
      const nx = tx + ox;
      const nz = tz + oz;
      if (nx < 0 || nz < 0 || nx >= MW || nz >= this.MH) continue;
      const v = this.flow[nz * MW + nx];
      if (v < 0) continue;
      if (ox && oz && (this.grid[tz * MW + nx] || this.grid[nz * MW + tx] ||
                       this.propBlocked[tz * MW + nx] || this.propBlocked[nz * MW + tx])) continue;
      if (v < bestV) {
        bestV = v;
        bx = ox;
        bz = oz;
      }
    }
    if (!bx && !bz) return null;
    const cx = (tx + bx + 0.5) * TILE - e.x;
    const cz = (tz + bz + 0.5) * TILE - e.z;
    const len = Math.hypot(cx, cz) || 1;
    return [cx / len, cz / len];
  }

  nearbyFloor(x, z, radius) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (this.flow[tz * MW + tx] >= 0 && !this.boxHit(x, z, radius)) return { x, z };
    // Scripted placements may overlap a crate or a parked vehicle on a new layout.
    for (let ring = 1; ring < Math.max(MW, this.MH); ring++) {
      let nearest = null;
      let distance = Infinity;
      for (let iz = Math.max(1, tz - ring); iz <= Math.min(this.MH - 2, tz + ring); iz++) {
        for (let ix = Math.max(1, tx - ring); ix <= Math.min(MW - 2, tx + ring); ix++) {
          if (Math.max(Math.abs(ix - tx), Math.abs(iz - tz)) !== ring || this.flow[iz * MW + ix] < 0) continue;
          const wx = (ix + 0.5) * TILE, wz = (iz + 0.5) * TILE;
          const d = Math.hypot(wx - x, wz - z);
          if (d < distance && !this.boxHit(wx, wz, radius)) {
            nearest = { x: wx, z: wz };
            distance = d;
          }
        }
      }
      if (nearest) return nearest;
    }
    return { ...this.startPos };
  }

  generate(lvlIndex = 0) {
    const safeIdx = clamp(lvlIndex | 0, 0, LEVELS.length - 1);
    this.lvlIndex = safeIdx;
    this.cfg = LEVELS[safeIdx];
    this.bossRoom = null;
    this.shrines = [];
    this.soulCaches = [];
    if (this.cfg?.coldOnly) {
      this.generateColdCampaign(this.cfg);
      return;
    }
    const MH = (this.MH = this.cfg.h);
    this.grid = new Uint8Array(MW * MH);
    this.tileHp = new Float32Array(MW * MH);
    this.tileH = new Float32Array(MW * MH);
    this.flow = new Int16Array(MW * MH);
    const prot = new Uint8Array(MW * MH);
    const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

    for (let z = 0; z < MH; z++) {
      for (let x = 0; x < MW; x++) {
        if (x === 0 || z === 0 || x === MW - 1 || z === MH - 1) {
          this.grid[z * MW + x] = 1;
        }
      }
    }

    this.rects = [
      { x: 0, y: 0, w: MW, h: 1, border: 1 },
      { x: 0, y: MH - 1, w: MW, h: 1, border: 1 },
      { x: 0, y: 1, w: 1, h: MH - 2, border: 1 },
      { x: MW - 1, y: 1, w: 1, h: MH - 2, border: 1, seawall: this.cfg.style === 'plank' }
    ];

    // Winding main avenue with 1930s variable width (boulevard plazas & narrow Shikumen throats)
    const cxs = [];
    let cx = Math.floor(MW / 2);
    for (let z = MH - 1; z >= 0; z--) {
      if (z % 4 === 0) cx = clamp(cx + R(-2, 2), 7, MW - 8);
      cxs[z] = cx;
      const halfW = z % 18 < 11 ? 3 : 2;
      for (let x = cx - halfW; x <= cx + halfW; x++) prot[z * MW + x] = 1;
    }
    for (let z = MH - 8; z < MH - 1; z++) {
      for (let x = cxs[MH - 3] - 4; x <= cxs[MH - 3] + 4; x++) {
        if (x > 0 && x < MW - 1) prot[z * MW + x] = 1;
      }
    }
    const top = this.cfg.boss ? 20 : this.cfg.bossCfg ? 15 : 6;
    for (let z = 1; z < top; z++) {
      for (let x = 1; x < MW - 1; x++) prot[z * MW + x] = 1;
    }

    // East-West cross-streets & open crossroads plazas (5 spacious plazas along the enlarged district)
    this.crossZs = [
      Math.round(MH * 0.21),
      Math.round(MH * 0.37),
      Math.round(MH * 0.54),
      Math.round(MH * 0.70),
      Math.round(MH * 0.85)
    ].filter(z => z > top + 5 && z < MH - 11);
    for (const cz of this.crossZs) {
      for (let zz = cz - 1; zz <= cz + 1; zz++) {
        for (let xx = 2; xx < MW - 2; xx++) prot[zz * MW + xx] = 1;
      }
      const px0 = cxs[cz];
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          const xx = clamp(px0 + dx, 1, MW - 2);
          const zz = clamp(cz + dz, 2, MH - 3);
          prot[zz * MW + xx] = 1;
        }
      }
    }

    // Waterfront cargo quay for Shiliupu docks, or side Shikumen courtyards (天井院落)
    if (this.cfg.style === 'plank') {
      for (let zz = 7; zz <= MH - 9; zz++) {
        for (let xx = MW - 7; xx <= MW - 2; xx++) prot[zz * MW + xx] = 1;
      }
    } else if (this.cfg.style === 'cobble') {
      const courtyards = [
        [8, Math.round(MH * 0.26)],
        [MW - 9, Math.round(MH * 0.44)],
        [8, Math.round(MH * 0.62)],
        [MW - 9, Math.round(MH * 0.79)]
      ];
      for (const [qx, qz] of courtyards) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 3; dx++) {
            const xx = clamp(qx + dx, 2, MW - 3);
            const zz = clamp(qz + dz, top + 2, MH - 10);
            prot[zz * MW + xx] = 1;
          }
        }
        const xA = Math.min(qx, cxs[qz]);
        const xB = Math.max(qx, cxs[qz]);
        for (let xx = xA; xx <= xB; xx++) {
          prot[qz * MW + xx] = 1;
          prot[(qz + 1) * MW + xx] = 1;
        }
      }
    }

    // Place grand 1930s commercial blocks + Shikumen rowhouses (scaled for enlarged 120m × 340-390m districts)
    for (let n = 0; n < 520; n++) {
      const isGrand = n < 130;
      const w = isGrand ? R(4, 8) : R(2, 6);
      const h = isGrand ? R(4, 6) : R(2, 5);
      const x = R(1, MW - 1 - w);
      const z = R(top, MH - 8 - h);
      let ok = true;
      for (let zz = z - 1; zz <= z + h && ok; zz++) {
        for (let xx = x - 1; xx <= x + w; xx++) {
          const inside = xx >= x && xx < x + w && zz >= z && zz < z + h;
          if (inside ? (prot[zz * MW + xx] || this.grid[zz * MW + xx]) : (this.grid[zz * MW + xx] === 1 && xx > 0 && xx < MW - 1)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        this.rects.push({ x, y: z, w, h, artDeco: w >= 5 && h >= 4 });
        for (let zz = z; zz < z + h; zz++) {
          for (let xx = x; xx < x + w; xx++) this.grid[zz * MW + xx] = 1;
        }
      }
    }

    // Shikumen Overstreet Gatehouses (过街楼) spanning narrower alley necks
    this.gateways = [];
    if (this.cfg.style === 'cobble') {
      for (let z = 14; z < MH - 12 && this.gateways.length < 6; z += 18) {
        let xl = cxs[z];
        let xr = cxs[z];
        while (xl > 0 && this.T(xl, z) !== 1) xl--;
        while (xr < MW - 1 && this.T(xr, z) !== 1) xr++;
        const spanTiles = xr - xl - 1;
        if (spanTiles >= 3 && spanTiles <= 7 && xl > 0 && xr < MW - 1 && this.T(xl, z - 1) === 1 && this.T(xr, z - 1) === 1) {
          this.gateways.push({ x0: (xl + 1) * TILE, x1: xr * TILE, z: (z + 0.5) * TILE });
        }
      }
    }

    // Crates (2) and explosive barrels (3)
    for (let n = 0; n < 210; n++) {
      const x = R(1, MW - 2);
      const z = R(3, MH - 9);
      const k = Math.random() < 0.24 ? 3 : 2;
      const len = k === 2 ? R(1, 3) : 1;
      const hz = Math.random() < 0.5;
      for (let j = 0; j < len; j++) {
        const xx = x + (hz ? j : 0);
        const zz = z + (hz ? 0 : j);
        if (this.T(xx, zz) === 0 && Math.abs(xx - cxs[zz]) > 1) {
          this.grid[zz * MW + xx] = k;
          this.tileHp[zz * MW + xx] = k === 2 ? 40 : 15;
        }
      }
    }

    this.lowTiles = new Set();
    if (this.cfg.boss || this.cfg.bossCfg) {
      const c = cxs[2];
      for (let x = c - 4; x <= c + 4; x++) {
        if (x > 0 && x < MW - 1 && x !== c - 1 && x !== c + 2) {
          this.grid[5 * MW + x] = 2;
          this.tileHp[5 * MW + x] = 70;
          this.lowTiles.add(5 * MW + x);
        }
      }
    }

    this.street = cxs;
    this.startPos = { x: (cxs[MH - 3] + 0.5) * TILE, z: (MH - 3.5) * TILE };
    this.exitPos = { x: (cxs[2] + 0.5) * TILE, z: 2.5 * TILE };

    // Street lamps along main boulevard & cross-streets
    this.lamps = [];
    for (let z = 5; z < MH - 3; z += 6) {
      const side = z % 4 ? 1 : -1;
      let lx = cxs[z] + side * 3;
      if (this.T(lx, z) !== 0) lx = cxs[z] + side * 2;
      if (this.T(lx, z) === 0) {
        this.lamps.push({
          x: (lx + 0.5) * TILE + side * 0.85,
          z: (z + 0.5) * TILE,
          lx: 0,
          ly: 3.6,
          lz: 0
        });
      }
    }
    for (const cz of this.crossZs) {
      for (const sx of [-6, 6]) {
        const tx = clamp(cxs[cz] + sx, 3, MW - 4);
        if (this.T(tx, cz - 2) === 0) {
          this.lamps.push({
            x: (tx + 0.5) * TILE,
            z: (cz - 2 + 0.5) * TILE - 0.65,
            lx: 0,
            ly: 3.6,
            lz: 0
          });
        }
      }
    }

    // BFS reachability from player start
    const reach = new Uint8Array(MW * MH);
    const q = [[cxs[MH - 3], MH - 4]];
    reach[(MH - 4) * MW + cxs[MH - 3]] = 1;
    while (q.length) {
      const [x, z] = q.pop();
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox;
        const nz = z + oz;
        const k = nz * MW + nx;
        if (this.T(nx, nz) !== 1 && !reach[k]) {
          reach[k] = 1;
          q.push([nx, nz]);
        }
      }
    }

    // Street thematic props: 1930s trams, kiosks, sedans, trucks, sandbags, rickshaws, telegraph poles
    this.props = [];
    const occupiedProp = new Set();
    const markPropTile = (tx, tz) => occupiedProp.add(`${tx},${tz}`);
    const canPlaceProp = (tx, tz, radTiles = 1) => {
      if (tz < top + 2 || tz > MH - 9) return false;
      for (let dz = -radTiles; dz <= radTiles; dz++) {
        for (let dx = -radTiles; dx <= radTiles; dx++) {
          const xx = tx + dx;
          const zz = tz + dz;
          if (xx <= 1 || xx >= MW - 2 || zz <= 1 || zz >= MH - 2) return false;
          if (this.T(xx, zz) !== 0) return false;
          if (occupiedProp.has(`${xx},${zz}`)) return false;
        }
      }
      return true;
    };

    // 1930s Shanghai Tramcars (老上海有轨电车) in spacious crossroad plazas / avenue stretches
    let tramsPlaced = 0;
    if (!this.cfg.boss) {
      for (const cz of this.crossZs) {
        if (tramsPlaced >= 3) break;
        const tx = clamp(cxs[cz] + (tramsPlaced % 2 === 0 ? -3 : 3), 4, MW - 5);
        const tz = cz;
        if (canPlaceProp(tx, tz, 2) && reach[tz * MW + tx]) {
          this.props.push({ kind: 'tram', x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE, rotY: rnd(-0.05, 0.05), tx, tz });
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -1; dx <= 1; dx++) markPropTile(tx + dx, tz + dz);
          }
          tramsPlaced++;
        }
      }
    }

    // Street-corner 1930s Newspaper / Tobacco Kiosks (申报烟纸亭)
    let kiosksPlaced = 0;
    if (!this.cfg.boss) {
      for (let i = 0; i < this.crossZs.length && kiosksPlaced < 5; i++) {
        const cz = this.crossZs[i];
        const tx = clamp(cxs[cz] + (i % 2 ? 4 : -4), 3, MW - 4);
        const tz = cz + (i % 2 ? -3 : 3);
        if (canPlaceProp(tx, tz, 1) && reach[tz * MW + tx]) {
          const rotY = i % 2 ? -Math.PI / 4 : Math.PI / 4;
          this.props.push({ kind: 'kiosk', x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE, rotY, tx, tz });
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) markPropTile(tx + dx, tz + dz);
          }
          kiosksPlaced++;
        }
      }
    }

    // Place up to 10 vintage flatbed trucks & 1930s noir sedans across avenues & Shiliupu quay
    let trucksPlaced = 0;
    if (this.cfg.style === 'plank') {
      for (const z of [Math.round(MH * 0.28), Math.round(MH * 0.54), Math.round(MH * 0.78)]) {
        const tx = MW - 4;
        if (canPlaceProp(tx, z, 1) && reach[z * MW + tx]) {
          this.props.push({ kind: 'truck', x: (tx + 0.5) * TILE, z: (z + 0.5) * TILE, rotY: rnd(-0.12, 0.12), tx, tz: z });
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) markPropTile(tx + dx, z + dz);
          }
          trucksPlaced++;
        }
      }
    }
    for (let z = 14; z < MH - 10 && trucksPlaced < 10; z += 14) {
      const side = trucksPlaced % 2 === 0 ? -3 : 3;
      const tx = clamp(cxs[z] + side, 3, MW - 4);
      if (canPlaceProp(tx, z, 1) && reach[z * MW + tx]) {
        const rotY = (Math.random() < 0.5 ? 0 : Math.PI) + rnd(-0.18, 0.18);
        const kind = trucksPlaced % 2 === 1 && !this.cfg.boss ? 'sedan' : 'truck';
        this.props.push({ kind, x: (tx + 0.5) * TILE, z: (z + 0.5) * TILE, rotY, tx, tz: z });
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) markPropTile(tx + dx, z + dz);
        }
        trucksPlaced++;
      }
    }

    // Place sandbag barricades and rickshaws across enlarged street district
    for (let n = 0; n < 96; n++) {
      const z = R(top + 2, MH - 10);
      const tx = R(2, MW - 3);
      if (!canPlaceProp(tx, z, 0) || !reach[z * MW + tx]) continue;
      if (Math.abs(tx - cxs[z]) === 0) continue;
      const kind = n % 2 === 0 ? 'sandbag' : 'rickshaw';
      const rotY = kind === 'sandbag' ? (Math.random() < 0.5 ? 0 : Math.PI * 0.12) : rnd(0, Math.PI * 2);
      this.props.push({ kind, x: (tx + 0.5) * TILE, z: (z + 0.5) * TILE, rotY, tx, tz: z });
      markPropTile(tx, z);
    }

    // Wooden telegraph poles & 1930s Shanghai Plane Trees (法国梧桐)
    this.poles = [];
    this.trees = [];
    if (!this.cfg.boss) {
      for (let z = 8; z < MH - 8; z += 9) {
        const tx = clamp(cxs[z] + 3, 2, MW - 3);
        if (this.T(tx, z) === 0 && !occupiedProp.has(`${tx},${z}`) && reach[z * MW + tx]) {
          this.poles.push({ x: (tx + 0.5) * TILE + 0.7, z: (z + 0.5) * TILE });
          markPropTile(tx, z);
        }
      }
      if (this.cfg.style === 'cobble') {
        for (let z = 7; z < MH - 7; z += 7) {
          for (const side of [-1, 1]) {
            const tx = clamp(cxs[z] + side * 3, 2, MW - 3);
            if (this.T(tx, z) === 0 && !occupiedProp.has(`${tx},${z}`) && reach[z * MW + tx]) {
              this.trees.push({ x: (tx + 0.5) * TILE + side * 0.45, z: (z + 0.5) * TILE, rotY: rnd(0, Math.PI * 2), scale: rnd(0.88, 1.15) });
              markPropTile(tx, z);
              break;
            }
          }
        }
      }
    }

    this.indexStreetProps();
    this.computeFlow(this.startPos.x, this.startPos.z);
    // Spawn enemies
    this.enemies = [];
    this.corpses = [];
    this.calloutCd = 0;
    this.boss = null;
    const bag = [];
    for (const k in this.cfg.mix) {
      for (let j = 0; j < this.cfg.mix[k]; j++) bag.push(k);
    }
    let placed = 0;
    let guard = 0;
    const z0 = this.cfg.boss ? 21 : this.cfg.bossCfg ? 16 : 5;
    while (placed < this.cfg.groups && guard++ < 1400) {
      const x = R(2, MW - 3);
      const z = R(z0, MH - 13);
      if (this.flow[z * MW + x] < 0) continue;
      const band = Math.floor((placed / this.cfg.groups) * (MH - 17 - z0)) + z0;
      if (Math.abs(z - band) > 8) continue;
      const n = R(2, 3);
      for (let j = 0; j < n; j++) {
        const ex = x + R(-1, 1);
        const ez = z + R(-1, 1);
        if (this.flow[ez * MW + ex] >= 0) {
          const type = bag[R(0, bag.length - 1)];
          const wx = (ex + 0.5) * TILE + rnd(-0.5, 0.5), wz = (ez + 0.5) * TILE + rnd(-0.5, 0.5);
          if (!this.boxHit(wx, wz, ENEMY_TYPES[type].r)) this.spawnEnemy(type, wx, wz, placed);
        }
      }
      placed++;
    }

    if (this.cfg.boss || this.cfg.bossCfg) {
      const bossCfg = this.cfg.bossCfg || null;
      const bossScale = bossCfg?.scale || ENEMY_TYPES.boss.scale;
      const bossR = clamp(0.62 * bossScale, 0.92, 1.06);
      const lead = this.nearbyFloor(this.exitPos.x, 7 * TILE, bossR);
      this.boss = this.spawnEnemy('boss', lead.x, lead.z, 100, bossCfg);
      const guardTypes = bossCfg?.guards || ['soldier', 'gunner', 'soldier'];
      const nGuards = guardTypes.length;
      for (let j = 0; j < nGuards; j++) {
        const type = guardTypes[j];
        const spreadX = (j - (nGuards - 1) * 0.5) * 6.5;
        const guardPos = this.nearbyFloor(this.exitPos.x + spreadX, 11 * TILE, ENEMY_TYPES[type].r);
        this.spawnEnemy(type, guardPos.x, guardPos.z, 99);
      }
    }

    const pick = fr => {
      const zz = Math.round(MH - 9 - fr * (MH - 15));
      for (let n = 0; n < 500; n++) {
        const x = R(2, MW - 3);
        const z = clamp(zz + R(-2, 2), 4, MH - 9);
        if (this.flow[z * MW + x] >= 0 && Math.abs(x - cxs[z]) <= 16) {
          return { x: (x + 0.5) * TILE, z: (z + 0.5) * TILE };
        }
      }
      return this.nearbyFloor((cxs[zz] + 0.5) * TILE, (zz + 0.5) * TILE, 0.56);
    };

    const near = (type, p, g) => {
      for (let n = 0; n < 20; n++) {
        const x = p.x + R(-1, 1) * TILE;
        const z = p.z + R(-1, 1) * TILE;
        const cell = Math.floor(z / TILE) * MW + Math.floor(x / TILE);
        if ((x !== p.x || z !== p.z) && this.flow[cell] >= 0 && !this.boxHit(x, z, ENEMY_TYPES[type].r)) {
          this.spawnEnemy(type, x, z, g);
          return;
        }
      }
    };

    this.hostage = null;
    this.charges = [];
    if (this.cfg.mission === 'rescue') {
      const p = pick(0.68);
      this.hostage = { x: p.x, z: p.z, r: 0.5, ang: Math.PI / 2, free: false, moving: false, mesh: null };
      near('gunman', p, 50);
      near('thug', p, 50);
    }
    if (this.cfg.mission === 'demo') {
      for (const fr of [0.24, 0.50, 0.74]) {
        const p = pick(fr);
        this.charges.push({ x: p.x, z: p.z, k: 0, done: false, mesh: null, crateMesh: null });
        near('soldier', p, 51 + this.charges.length);
      }
    }
    if (lvlIndex > 0) {
      const p = pick(0.52);
      this.spawnEnemy('officer', p.x, p.z, 60);
      near('soldier', p, 60);
    }

    this._assignPatrols();
    this.totalEnemies = this.enemies.length;
  }

  _assignPatrols() {
    for (const e of this.enemies) {
      if (e.type === 'boss' || e.post || Math.random() > 0.58) continue;
      const dirs = CARDINALS.slice().sort(() => Math.random() - 0.5);
      for (const [ox, oz] of dirs) {
        let best = null;
        for (let steps = 5; steps >= 2; steps--) {
          const px = e.x + ox * steps * TILE;
          const pz = e.z + oz * steps * TILE;
          const tx = Math.floor(px / TILE);
          const tz = Math.floor(pz / TILE);
          if (tx <= 1 || tx >= MW - 2 || tz <= 1 || tz >= this.MH - 2) continue;
          if (this.flow[tz * MW + tx] < 0) continue;
          if (this.boxHit(px, pz, e.r) || !this.canWalk(e.x, e.z, px, pz, e.r)) continue;
          best = { x: px, z: pz };
          break;
        }
        if (best) {
          e.patrol = [{ x: e.x, z: e.z }, best];
          e.patrolIdx = 1;
          e.patrolWait = rnd(0.4, 2.4);
          break;
        }
      }
    }
  }

  spawnEnemy(type, x, z, group, bossCfg = null) {
    const t = ENEMY_TYPES[type];
    const scale = (type === 'boss' && bossCfg?.scale) || CHAR_STYLES[type].scale || 1;
    const hp = (type === 'boss' && bossCfg?.hp) || t.hp;
    const r = type === 'boss' ? clamp(0.62 * scale, 0.92, 1.06) : t.r;
    const e = {
      type,
      bossCfg: type === 'boss' ? bossCfg : null,
      voiceActor: t.alternateVoice && Math.random() < 1 / 3 ? t.alternateVoice : t.voice,
      x,
      z,
      r,
      hp,
      max: hp,
      ang: type === 'boss' ? Math.PI / 2 : Math.floor(Math.random() * 4) * Math.PI / 2,
      awake: false,
      group,
      cd: type === 'boss' ? 1.4 : rnd(0.4, 1.2),
      aimT: 0,
      burst: 0,
      burstT: 0,
      sees: false,
      seeT: 0,
      lastSeen: null,
      searchT: 0,
      defense: null,
      defenseCd: 0,
      windupT: 0,
      recoveryT: 0,
      handsUp: false,
      strafe: Math.random() < 0.5 ? 1 : -1,
      strafeT: rnd(1, 2.5),
      walk: rnd(0, 6),
      flash: 0,
      flinch: 0,
      stun: 0,
      staggerT: 0,
      executing: false,
      peekT: rnd(1.0, 2.2),
      spd: 0,
      scale,
      ht: 1.8 * scale,
      rb: 0.36 * scale,
      ringT: type === 'boss' ? 6.0 : 4,
      ringWindupT: 0,
      summoned: 0,
      mesh: null,
      phys: null,
      cover: null,
      coverT: rnd(0, 2),
      coverAge: 0,
      duck: false,
      brave: Math.random() < 0.3,
      nadeCd: rnd(4, 9),
      callT: 0,
      called: false,
      inv: 0,
      way: null,
      wayT: 0,
      post: null,
      patrol: null,
      patrolIdx: 0,
      patrolWait: 0,
      suspicion: 0,
      p2: false
    };
    this.enemies.push(e);
    return e;
  }

  // Enlarged 120m × 370m Handcrafted Chapter 1 Cold-Weapon District -> 3 Shrines -> Enclosed 52.5m×35m Boss Room + Fog Gate
  generateColdCampaign(cfg) {
    const MH = (this.MH = cfg.h || 148);
    this.grid = new Uint8Array(MW * MH);
    this.tileHp = new Float32Array(MW * MH);
    this.tileH = new Float32Array(MW * MH);
    this.flow = new Int16Array(MW * MH);
    this.grid.fill(1);

    const carve = (x0, x1, z0, z1) => {
      for (let tz = z0; tz <= z1; tz++) {
        for (let tx = x0; tx <= x1; tx++) {
          this.grid[tz * MW + tx] = 0;
        }
      }
    };

    // 0. Grand Enclosed Boss Courtyard (z=2..15, x=14..34 -> 52.5m × 35m) + single 3-tile Fog Gate (z=16..17, x=23..25)
    carve(14, 34, 2, 15);
    carve(23, 25, 16, 17);
    // 6. Zone 6: Boss Forecourt Plaza & Boss-Door Shrine (z=18..33, x=16..32)
    carve(16, 32, 18, 33);
    // 5. Zone 5: North Gatehouse Throat (z=34..37) + North Avenue (z=38..57) + East Merchant Courtyard
    carve(21, 27, 34, 37);
    carve(18, 30, 38, 57);
    carve(33, 40, 42, 53);
    carve(31, 32, 45, 49);
    // 4. Zone 4: Grand Tramcar Crossroads Plaza & Mid Shrine (z=58..81, x=13..35 -> 57.5m × 60m)
    carve(13, 35, 58, 81);
    // 3. Zone 3: Mid Gatehouse Throat (z=82..85) + Mid-South Street (z=86..109) + West Side Alley Courtyard
    carve(20, 28, 82, 85);
    carve(18, 30, 86, 109);
    carve(7, 15, 91, 104);
    carve(16, 17, 95, 99);
    // 2. Zone 2: South Shikumen Commercial Avenue (z=110..131, x=19..29)
    carve(19, 29, 110, 131);
    // 1. Zone 1: South Gate Entrance Plaza & Start Shrine (z=132..144, x=17..31)
    carve(17, 31, 132, 144);

    // Airtight 1937 Shikumen tenement blocks completely enclosing the entire 370m district & Boss Room
    this.rects = [
      // Enclosed Boss Room 4-sided masonry perimeter (only opening: x=23..25, z=16..17)
      { x: 10, y: 0, w: 29, h: 2, artDeco: true },    // North Boss Hall (x=10..38, z=0..1)
      { x: 10, y: 2, w: 4, h: 14, artDeco: false },   // West Boss Wall (x=10..13, z=2..15)
      { x: 35, y: 2, w: 4, h: 14, artDeco: false },   // East Boss Wall (x=35..38, z=2..15)
      { x: 10, y: 16, w: 13, h: 2, artDeco: true },   // Boss South-West Partition (x=10..22, z=16..17)
      { x: 26, y: 16, w: 13, h: 2, artDeco: true },   // Boss South-East Partition (x=26..38, z=16..17)
      // Zone 6: Boss Forecourt flanking blocks (z=18..33)
      { x: 10, y: 18, w: 6, h: 16, artDeco: true },   // x=10..15
      { x: 33, y: 18, w: 6, h: 16, artDeco: true },   // x=33..38
      // Zone 5: North Throat (z=34..37) + Avenue & East Courtyard (z=38..57)
      { x: 10, y: 34, w: 11, h: 4, artDeco: false },  // West Throat (x=10..20)
      { x: 28, y: 34, w: 11, h: 4, artDeco: false },  // East Throat (x=28..38)
      { x: 12, y: 38, w: 6, h: 20, artDeco: true },   // West Avenue Wall (x=12..17)
      { x: 31, y: 38, w: 10, h: 4, artDeco: true },   // East Courtyard North Cap (x=31..40, z=38..41)
      { x: 41, y: 38, w: 5, h: 20, artDeco: false },  // East Courtyard Back Wall (x=41..45)
      { x: 31, y: 54, w: 10, h: 4, artDeco: false },  // East Courtyard South Cap (x=31..40, z=54..57)
      { x: 31, y: 42, w: 2, h: 3, artDeco: false },   // East Courtyard Arch North Pillar (z=42..44)
      { x: 31, y: 50, w: 2, h: 4, artDeco: false },   // East Courtyard Arch South Pillar (z=50..53)
      // Zone 4: Grand Tramcar Crossroads Plaza (z=58..81)
      { x: 8, y: 58, w: 5, h: 24, artDeco: true },    // West Plaza Tenements (x=8..12)
      { x: 36, y: 58, w: 5, h: 24, artDeco: true },   // East Plaza Tenements (x=36..40)
      // Zone 3: Mid Throat (z=82..85) + Mid-South Street & West Side Courtyard (z=86..109)
      { x: 8, y: 82, w: 12, h: 4, artDeco: false },   // West Mid Throat (x=8..19)
      { x: 29, y: 82, w: 12, h: 4, artDeco: false },  // East Mid Throat (x=29..40)
      { x: 31, y: 86, w: 6, h: 24, artDeco: true },   // East Street Wall (x=31..36)
      { x: 7, y: 86, w: 11, h: 5, artDeco: true },    // West Courtyard North Cap (x=7..17, z=86..90)
      { x: 2, y: 86, w: 5, h: 24, artDeco: false },   // West Courtyard Back Wall (x=2..6)
      { x: 7, y: 105, w: 11, h: 5, artDeco: false },  // West Courtyard South Cap (x=7..17, z=105..109)
      { x: 16, y: 91, w: 2, h: 4, artDeco: false },   // West Courtyard Arch North Pillar (z=91..94)
      { x: 16, y: 100, w: 2, h: 5, artDeco: false },  // West Courtyard Arch South Pillar (z=100..104)
      // Zone 2: South Shikumen Commercial Avenue (z=110..131)
      { x: 13, y: 110, w: 6, h: 11, artDeco: false }, // West North Row (x=13..18, z=110..120)
      { x: 13, y: 121, w: 6, h: 11, artDeco: true },  // West South Row (x=13..18, z=121..131)
      { x: 30, y: 110, w: 6, h: 11, artDeco: true },  // East North Row (x=30..35, z=110..120)
      { x: 30, y: 121, w: 6, h: 11, artDeco: false }, // East South Row (x=30..35, z=121..131)
      // Zone 1: South Gate Entrance Plaza & Back Hall (z=132..147)
      { x: 11, y: 132, w: 6, h: 13, artDeco: false }, // West Entrance (x=11..16)
      { x: 32, y: 132, w: 6, h: 13, artDeco: false }, // East Entrance (x=32..37)
      { x: 11, y: 145, w: 27, h: 3, artDeco: true }   // South Back Hall (x=11..37, z=145..147)
    ];

    const cx = 24;
    this.street = new Int16Array(MH).fill(cx);
    this.crossZs = [8, 26, 47, 70, 97, 121, 138];

    // Iconic Shikumen Overstreet Gatehouses spanning throats & the Boss Fog Gate!
    this.gateways = [
      { x0: 23 * TILE, x1: 26 * TILE, z: 17.0 * TILE },
      { x0: 21 * TILE, x1: 28 * TILE, z: 35.5 * TILE },
      { x0: 20 * TILE, x1: 29 * TILE, z: 83.5 * TILE },
      { x0: 19 * TILE, x1: 30 * TILE, z: 121.5 * TILE }
    ];

    // Destructible wooden crates along curbs/corners (rare healing drops, zero points!)
    this.lowTiles = new Set();
    const crateSpots = [
      [14, 2], [34, 2], [14, 15], [34, 15],
      [16, 30], [32, 30], [39, 43], [39, 52],
      [14, 60], [34, 60], [14, 80], [34, 80],
      [8, 92], [8, 103], [19, 112], [29, 112],
      [19, 129], [29, 129], [18, 142]
    ];
    for (const [tx, tz] of crateSpots) {
      if (this.T(tx, tz) === 0) {
        this.grid[tz * MW + tx] = 2;
        this.tileHp[tz * MW + tx] = 45;
        this.lowTiles.add(tz * MW + tx);
      }
    }

    // Iconic 1930s Shanghai street props: Tramcar, Newspaper Kiosk, Sedans, Trucks, Rickshaws & Sandbags
    this.props = [
      { kind: 'tram', x: 16.5 * TILE, z: 69.0 * TILE, rotY: 0.04, tx: 16, tz: 69 },
      { kind: 'kiosk', x: 32.8 * TILE, z: 74.5 * TILE, rotY: -Math.PI / 4, tx: 32, tz: 74 },
      { kind: 'sedan', x: 32.4 * TILE, z: 63.0 * TILE, rotY: 0.14, tx: 32, tz: 63 },
      { kind: 'truck', x: 38.0 * TILE, z: 50.8 * TILE, rotY: -0.22, tx: 38, tz: 50 },
      { kind: 'truck', x: 20.6 * TILE, z: 118.5 * TILE, rotY: 0.08, tx: 20, tz: 118 },
      { kind: 'sedan', x: 28.4 * TILE, z: 103.0 * TILE, rotY: Math.PI - 0.12, tx: 28, tz: 103 },
      { kind: 'rickshaw', x: 18.8 * TILE, z: 136.5 * TILE, rotY: 0.45, tx: 18, tz: 136 },
      { kind: 'rickshaw', x: 28.2 * TILE, z: 127.0 * TILE, rotY: -0.75, tx: 28, tz: 127 },
      { kind: 'sandbag', x: 19.8 * TILE, z: 92.5 * TILE, rotY: 0.15, tx: 19, tz: 92 },
      { kind: 'rickshaw', x: 10.2 * TILE, z: 102.0 * TILE, rotY: 1.1, tx: 10, tz: 102 },
      { kind: 'sandbag', x: 28.8 * TILE, z: 54.0 * TILE, rotY: -0.12, tx: 28, tz: 54 },
      { kind: 'rickshaw', x: 30.8 * TILE, z: 29.0 * TILE, rotY: 2.35, tx: 30, tz: 29 }
    ];
    this.poles = [
      { x: 28.6 * TILE, z: 130.0 * TILE },
      { x: 20.2 * TILE, z: 112.0 * TILE },
      { x: 29.4 * TILE, z: 92.0 * TILE },
      { x: 33.8 * TILE, z: 68.0 * TILE },
      { x: 19.6 * TILE, z: 42.0 * TILE },
      { x: 30.8 * TILE, z: 23.0 * TILE }
    ];
    this.trees = [
      { x: 18.2 * TILE, z: 134.0 * TILE, rotY: 0.4, scale: 1.08 },
      { x: 30.4 * TILE, z: 134.0 * TILE, rotY: 2.1, scale: 0.96 },
      { x: 19.8 * TILE, z: 106.0 * TILE, rotY: 1.4, scale: 1.04 },
      { x: 14.8 * TILE, z: 62.0 * TILE, rotY: 0.9, scale: 1.14 },
      { x: 34.0 * TILE, z: 60.5 * TILE, rotY: 3.1, scale: 1.06 },
      { x: 19.2 * TILE, z: 54.0 * TILE, rotY: 2.4, scale: 1.02 },
      { x: 17.6 * TILE, z: 22.0 * TILE, rotY: 0.7, scale: 1.05 },
      { x: 31.2 * TILE, z: 22.0 * TILE, rotY: 1.9, scale: 1.0 }
    ];

    // Warm wet-cobble gas lamps illuminating every street stretch, courtyard & Boss arena
    this.lamps = [
      // Boss Room 4 corner lamps
      { x: 15.2 * TILE, z: 3.4 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 33.8 * TILE, z: 3.4 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 15.2 * TILE, z: 14.4 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 33.8 * TILE, z: 14.4 * TILE, lx: 0, ly: 3.6, lz: 0 },
      // Zone 6 Forecourt & Boss Fog Gate twin lamps
      { x: 21.8 * TILE, z: 18.6 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 27.2 * TILE, z: 18.6 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 17.5 * TILE, z: 29.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 31.5 * TILE, z: 29.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      // Zone 5 North Avenue & East Courtyard
      { x: 19.2 * TILE, z: 44.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 29.5 * TILE, z: 52.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 36.5 * TILE, z: 47.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      // Zone 4 Grand Tramcar Plaza
      { x: 14.6 * TILE, z: 65.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 34.4 * TILE, z: 65.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 14.6 * TILE, z: 76.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 34.4 * TILE, z: 76.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      // Zone 3 Mid-South Street & West Alley Courtyard
      { x: 19.2 * TILE, z: 91.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 29.8 * TILE, z: 99.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 10.5 * TILE, z: 97.5 * TILE, lx: 0, ly: 3.6, lz: 0 },
      // Zone 2 South Avenue & Zone 1 Start Plaza
      { x: 20.2 * TILE, z: 115.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 28.8 * TILE, z: 126.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 18.2 * TILE, z: 136.0 * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: 30.5 * TILE, z: 141.0 * TILE, lx: 0, ly: 3.6, lz: 0 }
    ];

    this.startPos = { x: (cx + 0.5) * TILE, z: 142.5 * TILE };
    this.exitPos = { x: (cx + 0.5) * TILE, z: 7.5 * TILE };
    this.bossRoom = {
      x0: 14 * TILE,
      x1: 35 * TILE,
      z0: 2 * TILE,
      z1: 16 * TILE,
      gateX: (cx + 0.5) * TILE,
      gateZ: 17.0 * TILE,
      gateHalfW: 1.5 * TILE,
      entryZ: 14.4 * TILE,
      entered: false,
      sealed: false,
      cleared: false
    };
    this.shrines = [
      { id: 'start', name: '南口赐福灯龛', x: 28.8 * TILE, z: 140.5 * TILE, lit: true },
      { id: 'midPlaza', name: '电车广场赐福灯龛', x: 15.2 * TILE, z: 78.8 * TILE, lit: false },
      { id: 'bossGate', name: '霸王殿前赐福灯龛', x: 18.2 * TILE, z: 19.8 * TILE, lit: false }
    ];
    this.soulCaches = []; // Strict Souls economy: ONLY killing enemies grants points!

    this.hostage = null;
    this.charges = [];
    this.corpses = [];
    this.calloutCd = 0;
    this.indexStreetProps();
    this.computeFlow(this.startPos.x, this.startPos.z);

    // 18 Elden-Ring Stratified Cold-Weapon Enemies across 6 Zones + 2 Side Courtyards
    // Tier 1 Grunts (4-6 hits to kill hero, low poise), Tier 2 Heavies (3.5-4 hits, medium poise), Tier 3 Elites (~3 hits, high poise)
    this.enemies = [];
    this.boss = null;
    const encounterSpecs = [
      // Zone 1 South Gate Vanguard (1v1 Tier 1 Grunt — clean warm-up duel!)
      {
        tx: 24.5, tz: 134.5, group: 1, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '南口铁枪哨兵', tier: 'grunt', poiseTier: 1, hp: 118, maxPosture: 68, scale: 1.04, aggro: 0.94,
        blockChance: 0.16, evadeChance: 0.0, normalDmg: 17, perilDmg: 38, points: 25, aggroRange: 10.8
      },
      // Zone 2 South Commercial Street (2 packs)
      {
        tx: 22.8, tz: 126.0, group: 2, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '南街铁枪卫', tier: 'grunt', poiseTier: 1, hp: 124, maxPosture: 72, scale: 1.04, aggro: 0.96,
        blockChance: 0.18, evadeChance: 0.0, normalDmg: 18, perilDmg: 40, points: 25, aggroRange: 11.2
      },
      {
        tx: 26.2, tz: 124.8, group: 2, type: 'thug', styleKey: 'thug', weaponKind: 'mace',
        name: '南街铁锤打手', tier: 'heavy', poiseTier: 2, hp: 178, maxPosture: 96, scale: 1.12, aggro: 0.96,
        blockChance: 0.28, evadeChance: 0.06, normalDmg: 24, perilDmg: 52, points: 36, aggroRange: 11.2
      },
      {
        tx: 23.0, tz: 115.0, group: 3, type: 'gunner', styleKey: 'gunner', weaponKind: 'axe',
        name: '过街重斧护院', tier: 'heavy', poiseTier: 2, hp: 185, maxPosture: 100, scale: 1.14, aggro: 0.98,
        blockChance: 0.30, evadeChance: 0.06, normalDmg: 25, perilDmg: 54, points: 32, aggroRange: 11.4
      },
      {
        tx: 26.6, tz: 114.0, group: 3, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '过街长枪哨兵', tier: 'grunt', poiseTier: 1, hp: 128, maxPosture: 74, scale: 1.04, aggro: 0.98,
        blockChance: 0.18, evadeChance: 0.0, normalDmg: 18, perilDmg: 40, points: 25, aggroRange: 11.4
      },
      // Zone 3 Mid-South Street + West Side Alley Courtyard
      {
        tx: 22.4, tz: 96.5, group: 4, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '中街巡逻枪卫', tier: 'grunt', poiseTier: 1, hp: 132, maxPosture: 76, scale: 1.06, aggro: 0.98,
        blockChance: 0.20, evadeChance: 0.0, normalDmg: 19, perilDmg: 42, points: 25, aggroRange: 11.6
      },
      {
        tx: 26.8, tz: 94.5, group: 4, type: 'gunner', styleKey: 'gunner', weaponKind: 'axe',
        name: '中街断魂斧手', tier: 'heavy', poiseTier: 2, hp: 195, maxPosture: 104, scale: 1.15, aggro: 1.00,
        blockChance: 0.32, evadeChance: 0.08, normalDmg: 26, perilDmg: 55, points: 32, aggroRange: 11.6
      },
      {
        tx: 11.2, tz: 96.5, group: 5, type: 'officer', styleKey: 'officer', weaponKind: 'spear',
        name: '西巷铁枪统领', tier: 'elite', poiseTier: 3, hp: 295, maxPosture: 134, scale: 1.18, aggro: 1.10,
        blockChance: 0.44, evadeChance: 0.24, normalDmg: 30, perilDmg: 70, points: 55, aggroRange: 11.8
      },
      {
        tx: 12.4, tz: 99.8, group: 5, type: 'thug', styleKey: 'thug', weaponKind: 'mace',
        name: '西巷狼牙棒卫', tier: 'heavy', poiseTier: 2, hp: 198, maxPosture: 106, scale: 1.14, aggro: 1.00,
        blockChance: 0.32, evadeChance: 0.08, normalDmg: 26, perilDmg: 56, points: 36, aggroRange: 11.8
      },
      // Zone 4 Grand Tramcar Crossroads Plaza (3-man squad)
      {
        tx: 21.8, tz: 67.0, group: 6, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '电车广场铁枪卫', tier: 'grunt', poiseTier: 1, hp: 138, maxPosture: 78, scale: 1.06, aggro: 1.00,
        blockChance: 0.20, evadeChance: 0.0, normalDmg: 19, perilDmg: 42, points: 25, aggroRange: 12.2
      },
      {
        tx: 25.5, tz: 65.5, group: 6, type: 'gunner', styleKey: 'gunner', weaponKind: 'axe',
        name: '电车广场重斧狂徒', tier: 'heavy', poiseTier: 2, hp: 205, maxPosture: 108, scale: 1.16, aggro: 1.02,
        blockChance: 0.34, evadeChance: 0.08, normalDmg: 27, perilDmg: 56, points: 32, aggroRange: 12.2
      },
      {
        tx: 29.0, tz: 67.8, group: 6, type: 'thug', styleKey: 'thug', weaponKind: 'mace',
        name: '电车广场铁锤武僧', tier: 'heavy', poiseTier: 2, hp: 210, maxPosture: 112, scale: 1.16, aggro: 1.02,
        blockChance: 0.34, evadeChance: 0.10, normalDmg: 28, perilDmg: 58, points: 36, aggroRange: 12.2
      },
      // Zone 5 North Avenue + East Merchant Courtyard
      {
        tx: 21.5, tz: 48.0, group: 7, type: 'soldier', styleKey: 'soldier', weaponKind: 'spear',
        name: '北街精锐枪卫', tier: 'grunt', poiseTier: 1, hp: 145, maxPosture: 82, scale: 1.08, aggro: 1.02,
        blockChance: 0.22, evadeChance: 0.0, normalDmg: 20, perilDmg: 44, points: 25, aggroRange: 12.0
      },
      {
        tx: 24.8, tz: 45.8, group: 7, type: 'gunner', styleKey: 'gunner', weaponKind: 'axe',
        name: '北街裂碑巨斧卫', tier: 'heavy', poiseTier: 2, hp: 215, maxPosture: 114, scale: 1.16, aggro: 1.04,
        blockChance: 0.35, evadeChance: 0.10, normalDmg: 28, perilDmg: 58, points: 32, aggroRange: 12.0
      },
      {
        tx: 28.0, tz: 48.2, group: 7, type: 'thug', styleKey: 'thug', weaponKind: 'mace',
        name: '北街重锤死士', tier: 'heavy', poiseTier: 2, hp: 215, maxPosture: 114, scale: 1.16, aggro: 1.04,
        blockChance: 0.35, evadeChance: 0.10, normalDmg: 28, perilDmg: 58, points: 36, aggroRange: 12.0
      },
      {
        tx: 36.2, tz: 46.8, group: 8, type: 'officer', styleKey: 'officer', weaponKind: 'mace',
        name: '东院玄铁锤王', tier: 'elite', poiseTier: 3, hp: 335, maxPosture: 144, scale: 1.24, aggro: 1.14,
        blockChance: 0.46, evadeChance: 0.22, normalDmg: 32, perilDmg: 74, points: 65, aggroRange: 12.0
      },
      // Zone 6 Boss Forecourt Gatekeepers right before Crimson Fog Gate (Tier 3 Knight Elites!)
      {
        tx: 22.0, tz: 25.5, group: 9, type: 'officer', styleKey: 'officer', weaponKind: 'spear',
        name: '殿前铁枪护法', tier: 'elite', poiseTier: 3, hp: 325, maxPosture: 142, scale: 1.18, aggro: 1.16,
        blockChance: 0.48, evadeChance: 0.30, normalDmg: 32, perilDmg: 74, points: 60, aggroRange: 12.6
      },
      {
        tx: 27.0, tz: 25.5, group: 9, type: 'gunner', styleKey: 'gunner', weaponKind: 'axe',
        name: '殿前巨斧护法', tier: 'elite', poiseTier: 3, hp: 355, maxPosture: 152, scale: 1.24, aggro: 1.14,
        blockChance: 0.50, evadeChance: 0.22, normalDmg: 34, perilDmg: 78, points: 65, aggroRange: 12.6
      }
    ];

    for (const spec of encounterSpecs) {
      const spot = this.nearbyFloor(spec.tx * TILE, spec.tz * TILE, 0.56);
      const e = this.spawnEnemy(spec.type, spot.x, spot.z, spec.group, null);
      e.hp = spec.hp;
      e.max = spec.hp;
      e.scale = spec.scale;
      e.ht = 1.8 * e.scale;
      e.rb = 0.36 * e.scale;
      e.r = 0.56;
      e.ang = Math.PI / 2; // Facing South toward the approaching hero
      e.duelStyleKey = spec.styleKey;
      e.duelSpec = spec;
      e.pointsReward = spec.points;
    }

    // Enclosed Boss inside the Grand North Courtyard (dormant until player traverses the Crimson Fog Gate!)
    const bCfg = cfg.bossCfg;
    const bossSpot = this.nearbyFloor((cx + 0.5) * TILE, 7.5 * TILE, 0.96);
    const boss = this.spawnEnemy('boss', bossSpot.x, bossSpot.z, 100, bCfg);
    boss.hp = bCfg.hp;
    boss.max = bCfg.hp;
    boss.scale = bCfg.scale || 1.72;
    boss.ht = 1.8 * boss.scale;
    boss.rb = 0.36 * boss.scale;
    boss.r = 0.96;
    boss.ang = Math.PI / 2; // Facing South toward the Fog Gate
    boss.duelStyleKey = bCfg.styleKey || 'boss';
    boss.duelSpec = { ...bCfg, type: 'boss' };
    boss.pointsReward = bCfg.points || 350;
    boss.bossDormant = true;
    this.boss = boss;
    this.totalEnemies = this.enemies.length;
  }

  // Compact atmospheric 22.5m × 22.5m 1937 Shanghai Shikumen courtyard for cold-weapon dueling tests
  generateDojo(preset) {
    this.lvlIndex = 0;
    this.bossRoom = null;
    this.shrines = [];
    this.soulCaches = [];
    this.trees = [];
    const baseCfg = LEVELS[0];
    this.cfg = {
      ...baseCfg,
      name: `雨夜演武场 · ${preset.label}`,
      mission: 'dojo',
      boss: true,
      sky: 0x101c34,
      fogDensity: 0.0086,
      intro: preset.subtitle,
      briefCue: null,
      replyCue: null,
      bossCfg: null
    };
    const MH = 18;
    this.MH = MH;
    this.grid = new Uint8Array(MW * MH);
    this.tileHp = new Float32Array(MW * MH);
    this.tileH = new Float32Array(MW * MH);
    this.flow = new Int16Array(MW * MH);
    this.grid.fill(1);

    const cx = Math.floor(MW / 2);
    const x0 = cx - 4;
    const x1 = cx + 4;
    const z0 = 4;
    const z1 = 12;
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        this.grid[tz * MW + tx] = 0;
      }
    }

    // Perimeter Shikumen tenements framing all 4 sides of the courtyard
    this.rects = [
      { x: x0 - 4, y: 1, w: 17, h: 3, artDeco: true },   // North hall
      { x: x0 - 4, y: z1 + 1, w: 17, h: 3, artDeco: false }, // South gatehouse
      { x: x0 - 4, y: z0, w: 4, h: 9, artDeco: false },  // West wing
      { x: x1 + 1, y: z0, w: 4, h: 9, artDeco: false }   // East wing
    ];

    // Two destructible wooden crate stacks tucked cleanly in the north corners
    this.lowTiles = new Set();
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      this.grid[tz * MW + tx] = 2;
      this.tileHp[tz * MW + tx] = 55;
      this.lowTiles.add(tz * MW + tx);
    }

    // Street center array + 4 warm corner gas lamps illuminating the wet cobblestones
    this.street = new Int16Array(MH).fill(cx);
    this.crossZs = [8];
    this.gateways = [];
    this.poles = [];
    this.props = [];
    this.lamps = [
      { x: (x0 + 0.85) * TILE, z: (z0 + 1.15) * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: (x1 + 0.15) * TILE, z: (z0 + 1.15) * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: (x0 + 0.85) * TILE, z: (z1 - 0.15) * TILE, lx: 0, ly: 3.6, lz: 0 },
      { x: (x1 + 0.15) * TILE, z: (z1 - 0.15) * TILE, lx: 0, ly: 3.6, lz: 0 }
    ];

    this.startPos = { x: (cx + 0.5) * TILE, z: (z1 - 1.2) * TILE };
    this.exitPos = { x: (cx + 0.5) * TILE, z: (z0 + 0.8) * TILE };
    this.hostage = null;
    this.charges = [];
    this.corpses = [];
    this.calloutCd = 0;
    this.indexStreetProps();
    this.computeFlow(this.startPos.x, this.startPos.z);

    // Spawn pure cold-weapon blade duelists facing the player across the courtyard
    this.enemies = [];
    this.boss = null;
    for (let i = 0; i < preset.enemies.length; i++) {
      const spec = preset.enemies[i];
      const ex = (cx + 0.5) * TILE + (spec.offsetX || 0);
      const ez = (z0 + 2.2) * TILE;
      const bossCfg = spec.type === 'boss'
        ? { styleKey: spec.styleKey, name: spec.name, title: spec.name, hp: spec.hp, scale: spec.scale }
        : null;
      const e = this.spawnEnemy(spec.type, ex, ez, 100 + i, bossCfg);
      e.hp = spec.hp;
      e.max = spec.hp;
      e.scale = spec.scale || 1;
      e.ht = 1.8 * e.scale;
      e.rb = 0.36 * e.scale;
      e.r = spec.type === 'boss' ? 0.96 : 0.56;
      e.ang = Math.PI / 2; // Facing south toward the player
      e.duelStyleKey = spec.styleKey || spec.type;
      e.duelSpec = spec;
      if (spec.type === 'boss') this.boss = e;
    }
    this.totalEnemies = this.enemies.length;
  }
}
