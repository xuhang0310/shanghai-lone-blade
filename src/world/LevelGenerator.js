import { MW, TILE, LEVELS, ENEMY_TYPES, CHAR_STYLES } from '../config/constants.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
    this.lowTiles = new Set();
    this.startPos = { x: 0, z: 0 };
    this.exitPos = { x: 0, z: 0 };
    this.enemies = [];
    this.boss = null;
    this.hostage = null;
    this.charges = [];
    this.props = []; // { kind: 'rickshaw'|'sandbag'|'truck', x, z, rotY }
    this.totalEnemies = 0;
  }

  T(tx, tz) {
    if (tx < 0 || tz < 0 || tx >= MW || tz >= this.MH) return 1;
    return this.grid[tz * MW + tx];
  }

  solidAt(x, z) {
    return this.T(Math.floor(x / TILE), Math.floor(z / TILE)) !== 0;
  }

  hAt(x, z) {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    if (tx < 0 || tz < 0 || tx >= MW || tz >= this.MH) return 99;
    return this.tileH[tz * MW + tx];
  }

  boxHit(x, z, r) {
    return (
      this.solidAt(x - r, z - r) ||
      this.solidAt(x + r, z - r) ||
      this.solidAt(x - r, z + r) ||
      this.solidAt(x + r, z + r)
    );
  }

  moveEnt(e, dx, dz) {
    const r = e.r * 0.9;
    if (!this.boxHit(e.x + dx, e.z, r)) e.x += dx;
    if (!this.boxHit(e.x, e.z + dz, r)) e.z += dz;
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
      if (x > 0 && !this.grid[k - 1] && this.flow[k - 1] < 0) { this.flow[k - 1] = d; q[t++] = k - 1; }
      if (x < MW - 1 && !this.grid[k + 1] && this.flow[k + 1] < 0) { this.flow[k + 1] = d; q[t++] = k + 1; }
      if (z > 0 && !this.grid[k - MW] && this.flow[k - MW] < 0) { this.flow[k - MW] = d; q[t++] = k - MW; }
      if (z < this.MH - 1 && !this.grid[k + MW] && this.flow[k + MW] < 0) { this.flow[k + MW] = d; q[t++] = k + MW; }
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
      if (ox && oz && (this.grid[tz * MW + nx] || this.grid[nz * MW + tx])) continue;
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

  generate(lvlIndex) {
    this.lvlIndex = lvlIndex;
    this.cfg = LEVELS[lvlIndex];
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

    // Winding main street
    const cxs = [];
    let cx = 13;
    for (let z = MH - 1; z >= 0; z--) {
      if (z % 3 === 0) cx = clamp(cx + R(-2, 2), 4, MW - 5);
      cxs[z] = cx;
      for (let x = cx - 2; x <= cx + 2; x++) prot[z * MW + x] = 1;
    }
    for (let z = MH - 7; z < MH - 1; z++) {
      for (let x = cxs[MH - 3] - 3; x <= cxs[MH - 3] + 3; x++) {
        if (x > 0 && x < MW - 1) prot[z * MW + x] = 1;
      }
    }
    const top = this.cfg.boss ? 16 : 5;
    for (let z = 1; z < top; z++) {
      for (let x = 1; x < MW - 1; x++) prot[z * MW + x] = 1;
    }

    // Place buildings
    for (let n = 0; n < 140; n++) {
      const w = R(2, 6);
      const h = R(2, 5);
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
        this.rects.push({ x, y: z, w, h });
        for (let zz = z; zz < z + h; zz++) {
          for (let xx = x; xx < x + w; xx++) this.grid[zz * MW + xx] = 1;
        }
      }
    }

    // Crates (2) and explosive barrels (3)
    for (let n = 0; n < 68; n++) {
      const x = R(1, MW - 2);
      const z = R(3, MH - 9);
      const k = Math.random() < 0.24 ? 3 : 2;
      const len = k === 2 ? R(1, 3) : 1;
      const hz = Math.random() < 0.5;
      for (let j = 0; j < len; j++) {
        const xx = x + (hz ? j : 0);
        const zz = z + (hz ? 0 : j);
        if (this.T(xx, zz) === 0 && xx !== cxs[zz] && Math.abs(xx - cxs[zz]) !== 1) {
          this.grid[zz * MW + xx] = k;
          this.tileHp[zz * MW + xx] = k === 2 ? 40 : 15;
        }
      }
    }

    this.lowTiles = new Set();
    if (this.cfg.boss) {
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

    // Street lamps along the main lane
    this.lamps = [];
    for (let z = 4; z < MH - 2; z += 6) {
      const lx = cxs[z] + (z % 4 ? 2 : -2);
      if (this.T(lx, z) === 0) {
        this.lamps.push({
          x: (lx + 0.5) * TILE + (z % 4 ? 0.85 : -0.85),
          z: (z + 0.5) * TILE,
          lx: 0,
          ly: 3.6,
          lz: 0
        });
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

    // Street thematic props (rickshaws, sandbags, 1930s trucks) placed carefully in wide spots
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

    // Place 2-3 vintage flatbed trucks & 1930s noir sedans in spacious street squares / docks / warehouse
    let trucksPlaced = 0;
    for (let z = 10; z < MH - 10 && trucksPlaced < 3; z += 14) {
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

    // Place sandbag barricades and rickshaws
    for (let n = 0; n < 36; n++) {
      const z = R(top + 2, MH - 10);
      const tx = clamp(cxs[z] + R(-5, 5), 2, MW - 3);
      if (!canPlaceProp(tx, z, 0) || !reach[z * MW + tx]) continue;
      if (Math.abs(tx - cxs[z]) === 0) continue;
      const kind = n % 2 === 0 ? 'sandbag' : 'rickshaw';
      const rotY = kind === 'sandbag' ? (Math.random() < 0.5 ? 0 : Math.PI * 0.12) : rnd(0, Math.PI * 2);
      this.props.push({ kind, x: (tx + 0.5) * TILE, z: (z + 0.5) * TILE, rotY, tx, tz: z });
      markPropTile(tx, z);
    }

    // Spawn enemies
    this.enemies = [];
    this.boss = null;
    const bag = [];
    for (const k in this.cfg.mix) {
      for (let j = 0; j < this.cfg.mix[k]; j++) bag.push(k);
    }
    let placed = 0;
    let guard = 0;
    const z0 = this.cfg.boss ? 17 : 4;
    while (placed < this.cfg.groups && guard++ < 800) {
      const x = R(2, MW - 3);
      const z = R(z0, MH - 13);
      if (this.T(x, z) !== 0 || !reach[z * MW + x]) continue;
      const band = Math.floor((placed / this.cfg.groups) * (MH - 17 - z0)) + z0;
      if (Math.abs(z - band) > 7) continue;
      const n = R(2, 4);
      for (let j = 0; j < n; j++) {
        const ex = x + R(-1, 1);
        const ez = z + R(-1, 1);
        if (this.T(ex, ez) === 0 && reach[ez * MW + ex]) {
          this.spawnEnemy(
            bag[R(0, bag.length - 1)],
            (ex + 0.5) * TILE + rnd(-0.5, 0.5),
            (ez + 0.5) * TILE + rnd(-0.5, 0.5),
            placed
          );
        }
      }
      placed++;
    }

    if (this.cfg.boss) {
      this.boss = this.spawnEnemy('boss', this.exitPos.x, 7 * TILE, 99);
      for (let j = 0; j < 4; j++) {
        this.spawnEnemy(j % 2 ? 'gunner' : 'soldier', this.exitPos.x + (j - 1.5) * 6.8, 11 * TILE, 99);
      }
    }

    const pick = fr => {
      const zz = Math.round(MH - 9 - fr * (MH - 15));
      for (let n = 0; n < 400; n++) {
        const x = R(2, MW - 3);
        const z = clamp(zz + R(-2, 2), 4, MH - 9);
        if (this.T(x, z) === 0 && reach[z * MW + x] && Math.abs(x - cxs[z]) <= 6) {
          return { x: (x + 0.5) * TILE, z: (z + 0.5) * TILE };
        }
      }
      return { x: (cxs[zz] + 0.5) * TILE, z: (zz + 0.5) * TILE };
    };

    const near = (type, p, g) => {
      for (let n = 0; n < 20; n++) {
        const x = p.x + R(-1, 1) * TILE;
        const z = p.z + R(-1, 1) * TILE;
        if ((x !== p.x || z !== p.z) && !this.solidAt(x, z)) {
          this.spawnEnemy(type, x, z, g);
          return;
        }
      }
    };

    this.hostage = null;
    this.charges = [];
    if (this.cfg.mission === 'rescue') {
      const p = pick(0.74);
      this.hostage = { x: p.x, z: p.z, r: 0.5, ang: Math.PI / 2, free: false, moving: false, mesh: null };
      near('gunman', p, 50);
      near('thug', p, 50);
      near('thug', p, 50);
    }
    if (this.cfg.mission === 'demo') {
      for (const fr of [0.28, 0.52, 0.78]) {
        const p = pick(fr);
        this.charges.push({ x: p.x, z: p.z, k: 0, done: false, mesh: null, crateMesh: null });
        near('soldier', p, 51 + this.charges.length);
      }
    }
    if (lvlIndex > 0) {
      const p = pick(0.5);
      this.spawnEnemy('officer', p.x, p.z, 60);
      near('soldier', p, 60);
    }

    this.totalEnemies = this.enemies.length;
  }

  spawnEnemy(type, x, z, group) {
    const t = ENEMY_TYPES[type];
    const scale = CHAR_STYLES[type].scale || 1;
    const e = {
      type,
      x,
      z,
      r: t.r,
      hp: t.hp,
      max: t.hp,
      ang: Math.PI / 2,
      awake: false,
      group,
      cd: rnd(0.4, 1.2),
      aimT: 0,
      burst: 0,
      burstT: 0,
      sees: false,
      seeT: 0,
      strafe: Math.random() < 0.5 ? 1 : -1,
      strafeT: rnd(1, 2.5),
      walk: rnd(0, 6),
      flash: 0,
      flinch: 0,
      stun: 0,
      spd: 0,
      ht: 1.8 * scale,
      rb: 0.36 * scale,
      ringT: 4,
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
      p2: false
    };
    this.enemies.push(e);
    return e;
  }
}
