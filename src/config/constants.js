export const TILE = 2.5; // 1 map tile = 2.5 meters
export const MW = 38;    // Map width in tiles (95m)
export const TAU = Math.PI * 2;

export const GRAVITY = 19.0;
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.75;
export const PLAYER_CROUCH_HEIGHT = 1.15;
export const PLAYER_ROLL_HEIGHT = 0.9;
export const PLAYER_SPEED = 7.8;
export const PLAYER_ROLL_SPEED = 9.4;
export const PLAYER_JUMP_VEL = 6.8;

// Rapier 16-bit collision groups
export const GROUP_WORLD      = 1 << 0;
export const GROUP_PROP       = 1 << 1;
export const GROUP_PLAYER     = 1 << 2;
export const GROUP_ENEMY      = 1 << 3;
export const GROUP_DEBRIS     = 1 << 4;
export const GROUP_PROJECTILE = 1 << 5;
export const GROUP_HANGING    = 1 << 6;

export const makeCollisionGroups = (membership, filter) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const LEVELS = [
  {
    name: '第一关 · 闸北石库门里弄',
    h: 82,
    groups: 13,
    mix: { thug: 5, gunman: 3 },
    style: 'cobble',
    ground: 'cobblestone_05',
    walls: ['red_bricks_04', 'brick_wall_006'],
    music: 'noire-crime-time',
    mission: 'rescue',
    sky: 0x0a1122,
    fogDensity: 0.0115,
    intro: '一九三七年冬，上海。黑龙帮抓走了我们的联络人，关在弄堂深处。找到他，把他活着带出去。'
  },
  {
    name: '第二关 · 十六铺外滩码头',
    h: 92,
    groups: 15,
    mix: { thug: 3, gunman: 3, soldier: 3 },
    style: 'plank',
    ground: 'worn_planks',
    walls: ['dark_brick_wall', 'grey_plaster_02'],
    music: 'night-on-the-docks',
    mission: 'demo',
    demoTime: 360,
    sky: 0x07131a,
    fogDensity: 0.0095,
    intro: '军火今夜从十六铺码头上岸。六分钟内在三处军火箱上安放炸药，然后撤到北面出口。'
  },
  {
    name: '第三关 · 苏州河大货栈',
    h: 80,
    groups: 14,
    mix: { thug: 3, gunman: 2, soldier: 3, gunner: 3 },
    style: 'concrete',
    ground: 'concrete_floor_worn_001',
    walls: ['factory_brick', 'dark_brick_wall'],
    music: 'jazz-saxophone',
    mission: 'boss',
    boss: true,
    sky: 0x0e0a18,
    fogDensity: 0.0118,
    intro: '帮主“黑龙”就在苏州河大货栈深处。这笔账，今夜了结。'
  }
];

export const ENEMY_TYPES = {
  thug:    { hp: 30,  sp: 6.25, r: 0.56, score: 50,   gun: 0 },
  gunman:  { hp: 40,  sp: 4.38, r: 0.56, score: 100,  pref: 14.4, gun: 0.3 },
  soldier: { hp: 55,  sp: 3.88, r: 0.56, score: 150,  pref: 18.75, gun: 0.9 },
  gunner:  { hp: 85,  sp: 3.44, r: 0.62, score: 200,  pref: 15.0, gun: 0.65 },
  officer: { hp: 60,  sp: 4.12, r: 0.56, score: 300,  pref: 16.25 },
  boss:    { hp: 750, sp: 3.62, r: 0.88, score: 2000, pref: 13.1, gun: 0.65, scale: 1.45 }
};

export const CHAR_STYLES = {
  hero:    { model: 'man',     shirt: '#3b424c', pants: '#1f222a', vest: '#23262e', tie: '#8a1e1a', coat: '#2b303a', scarf: '#8f221d', hat: 'fedora', hatCol: '#382a1e', band: '#16100e', gun: 'pistol', trench: true },
  thug:    { model: 'man',     shirt: '#2e4166', pants: '#1e222b', vest: '#1b263d', belt: '#9a2a24', hat: 'cap',    hatCol: '#2d323d', gun: 'knife' },
  gunman:  { model: 'man',     shirt: '#1d1e24', pants: '#101014', vest: '#15151a', tie: '#8c1a16', coat: '#181920', hat: 'fedora', hatCol: '#17171c', band: '#8c1a16', gun: 'pistol', longcoat: true },
  soldier: { model: 'soldier', shirt: '#6a633d', pants: '#585132', helmet: true,  gun: 'shotgun', pouches: true },
  gunner:  { model: 'man',     shirt: '#7a2d28', pants: '#232328', vest: '#4d1e1b', hat: 'band',   hatCol: '#c9b060', gun: 'smg', bandolier: true },
  officer: { model: 'soldier', shirt: '#545134', pants: '#444128', helmet: false, hat: 'officer', hatCol: '#4c4a2e', gun: 'pistol', sash: true },
  hostage: { model: 'man',     shirt: '#7c8a94', pants: '#343946', vest: '#5e6a73', gun: 'knife', glasses: true, longcoat: true },
  boss:    { model: 'man',     shirt: '#4c2060', pants: '#17121c', vest: '#2a1236', tie: '#d9a441', coat: '#2a1236', hat: 'fedora', hatCol: '#121216', band: '#d9a441', gun: 'smg', scale: 1.24, cloak: true, cigar: true }
};

export const WEAPONS = [
  { name: '驳壳枪', fullName: '毛瑟 C96 驳壳枪',   kick: 0.022, bloom: 0.35, mag: 8,  rate: 0.26,  dmg: 18, spread: 0.012, speed: 380, reload: 0.9,  pellets: 1, snd: 'pistol',  len: 0.32 },
  { name: '冲锋枪', fullName: '汤姆逊 M1928 冲锋枪', kick: 0.011, bloom: 0.15, mag: 30, rate: 0.085, dmg: 12, spread: 0.028, speed: 290, reload: 1.5,  pellets: 1, snd: 'smg',     len: 0.65 },
  { name: '霰弹枪', fullName: '温彻斯特 M1897',     kick: 0.05,  bloom: 0.6,  mag: 6,  rate: 0.8,   dmg: 9,  spread: 0.085, speed: 380, reload: 1.7,  pellets: 8, snd: 'shotgun', len: 0.8 },
  { name: '步枪',   fullName: '中正式步枪',         kick: 0.06,  bloom: 0.9,  mag: 5,  rate: 1.25,  dmg: 95, spread: 0.004, speed: 760, reload: 2.4,  pellets: 1, snd: 'rifle',   len: 0.95 }
];

export const WALL_TILE_SIZE = {
  red_bricks_04: 2.5,
  brick_wall_006: 3.0,
  dark_brick_wall: 1.6,
  factory_brick: 1.8,
  grey_plaster_02: 3.0
};

export const SHANGHAI_SIGNS = [
  { text: '百乐门', color: '#ff4858' },
  { text: '大戏院', color: '#ffb84a' },
  { text: '茶楼',   color: '#4affc0' },
  { text: '当铺',   color: '#ff523a' },
  { text: '绸缎庄', color: '#ff6ad0' },
  { text: '洋行',   color: '#5cc4ff' },
  { text: '大药房', color: '#4affc0' },
  { text: '照相馆', color: '#ffd068' },
  { text: '酒家',   color: '#ff4a3a' },
  { text: '钟表行', color: '#6ac8ff' },
  { text: '米行',   color: '#ffb84a' },
  { text: '旅社',   color: '#ff6ad0' },
  { text: '烟纸店', color: '#ff9040' },
  { text: '四行栈', color: '#6ac8ff' },
  { text: '先施百货', color: '#ff5868' },
  { text: '永安公司', color: '#ffd058' },
  { text: '大光明', color: '#5ce8ff' },
  { text: '申报馆', color: '#68ffaa' }
];
