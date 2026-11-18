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
    groups: 6,
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
    groups: 7,
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
    groups: 6,
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
  boss:    { hp: 420, sp: 3.62, r: 0.88, score: 2000, pref: 13.1, gun: 0.65, scale: 1.45 }
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
  { id: 'c96',      name: '驳壳枪', fullName: '毛瑟 C96 二十响驳壳枪', modelKey: 'pistol',   snd: 'pistol',   caliber: '7.63×25mm 毛瑟弹',   desc: '经典全钢盒子炮，射速轻快、备弹无限',             kick: 0.020, bloom: 0.28, mag: 10, initRes: Infinity, rate: 0.21,  dmg: 21, spread: 0.010, speed: 410, reload: 1.0,  pellets: 1, push: 2.2, len: 0.34 },
  { id: 'browning', name: '勃朗宁', fullName: '勃朗宁 M1911 手枪',     modelKey: 'browning', snd: 'browning', caliber: '.45 ACP 大口径手枪弹', desc: '美式大口径半自动手枪，近战重创、备弹无限',       kick: 0.028, bloom: 0.34, mag: 7,  initRes: Infinity, rate: 0.29,  dmg: 32, spread: 0.008, speed: 370, reload: 0.95, pellets: 1, push: 3.5, len: 0.30 },
  { id: 'revolver', name: '左轮枪', fullName: '史密斯威森 M1917 左轮', modelKey: 'revolver', snd: 'revolver', caliber: '.45 巡捕房转轮重弹',  desc: '公共租界探长配枪，极高精度与爆头致死率',         kick: 0.042, bloom: 0.44, mag: 6,  initRes: 36,       rate: 0.42,  dmg: 48, spread: 0.005, speed: 430, reload: 1.6,  pellets: 1, push: 5.0, len: 0.33 },
  { id: 'mp18',     name: '花机关', fullName: '伯格曼 MP18 冲锋枪',    modelKey: 'mp18',     snd: 'mp18',     caliber: '9×19mm 横插弹鼓',     desc: '三十年代沪上最经典横插弹匣冲锋枪，连射极稳',     kick: 0.010, bloom: 0.13, mag: 32, initRes: 96,       rate: 0.105, dmg: 15, spread: 0.020, speed: 330, reload: 1.4,  pellets: 1, push: 1.8, len: 0.62 },
  { id: 'thompson', name: '汤姆逊', fullName: '汤姆逊 M1928 冲锋枪',   modelKey: 'smg',      snd: 'smg',      caliber: '.45 ACP 50发弹鼓',    desc: '五十发圆盘大弹鼓，近距倾泻密集弹雨',             kick: 0.012, bloom: 0.16, mag: 50, initRes: 100,      rate: 0.080, dmg: 13, spread: 0.027, speed: 310, reload: 1.75, pellets: 1, push: 2.2, len: 0.65 },
  { id: 'shotgun',  name: '霰弹枪', fullName: '温彻斯特 M1897 战壕枪', modelKey: 'shotgun',  snd: 'shotgun',  caliber: '12号 鹿弹（8颗弹丸）', desc: '泵动战壕霰弹枪，近身一枪轰飞敌寇与掩体',         kick: 0.052, bloom: 0.55, mag: 6,  initRes: 24,       rate: 0.78,  dmg: 10, spread: 0.076, speed: 380, reload: 1.7,  pellets: 8, push: 7.5, len: 0.84 },
  { id: 'rifle',    name: '中正式', fullName: '中正式 7.92mm 步枪',    modelKey: 'rifle',    snd: 'rifle',    caliber: '7.92×57mm 毛瑟尖弹',  desc: '高精度栓动步枪，远距点名一枪毙命',               kick: 0.058, bloom: 0.78, mag: 5,  initRes: 25,       rate: 1.15,  dmg: 98, spread: 0.003, speed: 780, reload: 2.15, pellets: 1, push: 8.5, len: 0.94 },
  { id: 'zb26',     name: '捷克式', fullName: '捷克式 ZB-26 轻机枪',   modelKey: 'zb26',     snd: 'zb26',     caliber: '7.92×57mm 20发顶置弹匣', desc: '淞沪会战传奇主力轻机枪，重火力撕裂防线',       kick: 0.022, bloom: 0.22, mag: 20, initRes: 60,       rate: 0.135, dmg: 29, spread: 0.014, speed: 640, reload: 1.95, pellets: 1, push: 5.5, len: 0.92 }
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
