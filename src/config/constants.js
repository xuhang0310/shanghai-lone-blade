import dialogue from './dialogue.json' with { type: 'json' };

export const TILE = 2.5; // 1 map tile = 2.5 meters
export const MW = 48;    // Map width in tiles (120m)
export const TAU = Math.PI * 2;

export const GRAVITY = 19.0;
export const PLAYER_RADIUS = 0.42;
export const PLAYER_CONTACT_OFFSET = 0.03;
export const PLAYER_HEIGHT = 1.75;
export const PLAYER_SNEAK_HEIGHT = 1.66;
export const PLAYER_SNEAK_SPEED = 1.90;
export const PLAYER_SNEAK_FAST_SPEED = 3.75;
export const PLAYER_CROUCH_HEIGHT = 1.15;
export const PLAYER_CROUCH_SPEED = 1.85;
export const PLAYER_CROUCH_FAST_SPEED = 2.35;
export function crouchStride(sideAmount, sideStride = 0.64) {
  return Math.min(1.22, sideStride / Math.max(0.01, sideAmount));
}
export function sneakStride(sideAmount, fast = 0) {
  const maxStride = 0.94 + 0.14 * fast;
  const sideCap = 0.49 + 0.08 * fast;
  return Math.min(maxStride, sideCap / Math.max(0.01, sideAmount));
}
export function playerStanceHeight(sneak, crouch) {
  return PLAYER_HEIGHT + (PLAYER_SNEAK_HEIGHT - PLAYER_HEIGHT) * sneak + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;
}
export const PLAYER_ROLL_HEIGHT = 0.9;
export const PLAYER_WALK_SPEED = 4.55;
export const PLAYER_SPEED = 8.1;
export const PLAYER_ROLL_SPEED = 9.4;
export const PLAYER_JUMP_VEL = 6.8;
export const MELEE_WINDUP = 0.46;
export const MELEE_RECOVERY = 0.55;

export function enemyStanceHeight(e) {
  return e.ht * (e.react?.kind === 'kneel' ? 0.52 : 1 - 0.32 * (e.crouchK || 0));
}

// Rapier 16-bit collision groups
export const GROUP_WORLD      = 1 << 0;
export const GROUP_PROP       = 1 << 1;
export const GROUP_PLAYER     = 1 << 2;
export const GROUP_ENEMY      = 1 << 3;
export const GROUP_DEBRIS     = 1 << 4;
export const GROUP_PROJECTILE = 1 << 5;
export const GROUP_HANGING    = 1 << 6;

// Render layer for small props: drawn by the main camera (and its shadow/GTAO passes) but skipped
// by the planar puddle-reflection camera, which only needs buildings, lights and characters
export const LAYER_NO_REFLECT = 1;

export const makeCollisionGroups = (membership, filter) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const LEVELS = [
  {
    name: '第一关 · 闸北石库门 · 雨夜孤刃',
    h: 148,
    groups: 6,
    mix: { spear: 6, axe: 6, mace: 6 },
    style: 'cobble',
    ground: 'cobblestone_05',
    walls: ['red_bricks_04', 'brick_wall_006'],
    music: 'noire-crime-time',
    mission: 'campaign',
    coldOnly: true,
    boss: true,
    sky: 0x101c34,
    fogDensity: 0.0076,
    intro: '370米雨夜石库门大长街 · 唯斩杀敌寇可得积分 · 推至北口穿越雾门挑战「霸王 · 黑龙」！',
    briefCue: null,
    replyCue: null,
    bossCfg: {
      styleKey: 'boss',
      name: '霸王 · 黑 龙',
      title: '封闭死斗场魁首 · 霸王黑龙',
      weaponKind: 'guandao',
      hp: 2000,
      maxPosture: 280,
      deathblows: 3,
      scale: 1.72,
      aggro: 1.32,
      blockChance: 0.68,
      evadeChance: 0.48,
      normalDmg: 32,
      perilDmg: 64,
      ultDmgMult: 1.0,
      poiseTier: 4,
      tier: 'boss',
      points: 350
    }
  }
];

export const ENEMY_TYPES = {
  thug:    { hp: 30,  sp: 6.25, r: 0.56, score: 50,   gun: 0, voice: 'thug', alternateVoice: 'gang' },
  gunman:  { hp: 40,  sp: 4.38, r: 0.56, score: 100,  pref: 14.4, gun: 0.3, voice: 'gunman' },
  soldier: { hp: 55,  sp: 3.88, r: 0.56, score: 150,  pref: 18.75, gun: 0.9, voice: 'guard', alternateVoice: 'enemy' },
  gunner:  { hp: 85,  sp: 3.44, r: 0.62, score: 200,  pref: 15.0, gun: 0.65, voice: 'gunner' },
  officer: { hp: 60,  sp: 4.12, r: 0.56, score: 300,  pref: 16.25, voice: 'officer' },
  boss:    { hp: 460, sp: 3.68, r: 1.02, score: 2000, pref: 14.2, gun: 0.65, scale: 1.68, voice: 'boss' }
};

export const HERO_PRESETS = [
  { id: 'ranger', name: '沈孤鸿', role: '黑衣游侠', model: 'hero-ranger-tripo' },
  { id: 'xia', name: '陆青梧', role: '江湖女侠' }
];

export const CHAR_STYLES = {
  hero:    { model: 'man',     shirt: '#3a3d44', pants: '#212328', vest: '#272930', tie: '#8a1e1a', coat: '#363840', scarf: '#8e241f', hat: 'fedora', hatCol: '#382d23', band: '#16110e', gun: 'pistol', trench: true },
  thug:    { model: 'man',     shirt: '#2e4166', pants: '#1e222b', vest: '#1b263d', belt: '#9a2a24', hat: 'cap',    hatCol: '#2d323d', gun: 'knife' },
  gunman:  { model: 'man',     shirt: '#1d1e24', pants: '#101014', vest: '#15151a', tie: '#8c1a16', coat: '#181920', hat: 'fedora', hatCol: '#17171c', band: '#8c1a16', gun: 'pistol', longcoat: true },
  soldier: { model: 'soldier', shirt: '#6a633d', pants: '#585132', helmet: true,  gun: 'shotgun', pouches: true },
  gunner:  { model: 'man',     shirt: '#7a2d28', pants: '#232328', vest: '#4d1e1b', hat: 'band',   hatCol: '#c9b060', gun: 'smg', bandolier: true },
  officer: { model: 'soldier', shirt: '#545134', pants: '#444128', helmet: false, hat: 'officer', hatCol: '#4c4a2e', gun: 'pistol', sash: true },
  hostage: { model: 'man',     shirt: '#7c8a94', pants: '#343946', vest: '#5e6a73', gun: 'knife', glasses: true, longcoat: true },
  boss1:   { model: 'man',     shirt: '#4a2224', pants: '#1a1416', vest: '#2e1618', tie: '#d48d3a', coat: '#241416', hat: 'fedora', hatCol: '#1a1312', band: '#c83428', gun: 'shotgun', scale: 1.56, longcoat: true, cigar: true },
  boss2:   { model: 'man',     shirt: '#213a4c', pants: '#121922', vest: '#182834', tie: '#d99a3c', coat: '#131d28', hat: 'fedora', hatCol: '#141a22', band: '#d99a3c', gun: 'mp18',    scale: 1.60, cloak: true, cigar: true },
  boss3:   { model: 'man',     shirt: '#1d3038', pants: '#11181c', vest: '#142228', tie: '#e8c45a', coat: '#0f181e', hat: 'fedora', hatCol: '#0d1418', band: '#e8c45a', gun: 'sniper',  scale: 1.64, cloak: true },
  boss4:   { model: 'man',     shirt: '#544226', pants: '#1e1a12', vest: '#382c1a', tie: '#cc3b28', coat: '#2c2316', hat: 'fedora', hatCol: '#201b14', band: '#e0aa42', gun: 'zb26',    scale: 1.68, cloak: true, cigar: true },
  boss:    { model: 'man',     shirt: '#4c2060', pants: '#17121c', vest: '#2a1236', tie: '#d9a441', coat: '#2a1236', hat: 'fedora', hatCol: '#121216', band: '#d9a441', gun: 'smg',     scale: 1.74, cloak: true, cigar: true }
};

export const WEAPONS = [
  { id: 'c96',      name: '驳壳枪',   fullName: '毛瑟 C96 二十响驳壳枪',     modelKey: 'pistol',   snd: 'pistol',   caliber: '7.63×25mm 毛瑟弹',     desc: '经典全钢盒子炮，射速轻快、备弹无限',               kick: 0.020, bloom: 0.28, mag: 10, initRes: Infinity, rate: 0.21,  dmg: 21,  spread: 0.010,  speed: 410, reload: 1.0,  pellets: 1, push: 2.4,  len: 0.34, camShake: 0.08,  fovKick: 0.70 },
  { id: 'browning', name: '勃朗宁',   fullName: '勃朗宁 M1911 手枪',         modelKey: 'browning', snd: 'browning', caliber: '.45 ACP 大口径手枪弹',   desc: '美式大口径半自动手枪，近战重创、备弹无限',         kick: 0.028, bloom: 0.34, mag: 7,  initRes: Infinity, rate: 0.29,  dmg: 32,  spread: 0.008,  speed: 370, reload: 0.95, pellets: 1, push: 3.8,  len: 0.30, camShake: 0.12,  fovKick: 1.15 },
  { id: 'revolver', name: '左轮枪',   fullName: '史密斯威森 M1917 左轮',     modelKey: 'revolver', snd: 'revolver', caliber: '.45 巡捕房转轮重弹',    desc: '公共租界探长配枪，极高精度与爆头致死率',           kick: 0.042, bloom: 0.44, mag: 6,  initRes: 36,       rate: 0.42,  dmg: 48,  spread: 0.005,  speed: 430, reload: 1.6,  pellets: 1, push: 5.4,  len: 0.33, camShake: 0.21,  fovKick: 1.95 },
  { id: 'mp18',     name: '花机关',   fullName: '伯格曼 MP18 冲锋枪',        modelKey: 'mp18',     snd: 'mp18',     caliber: '9×19mm 横插弹鼓',       desc: '三十年代沪上最经典横插弹匣冲锋枪，连射极稳',       kick: 0.010, bloom: 0.13, mag: 32, initRes: 96,       rate: 0.105, dmg: 15,  spread: 0.020,  speed: 330, reload: 1.4,  pellets: 1, push: 2.0,  len: 0.62, camShake: 0.065, fovKick: 0.55 },
  { id: 'thompson', name: '汤姆逊',   fullName: '汤姆逊 M1928 冲锋枪',       modelKey: 'smg',      snd: 'smg',      caliber: '.45 ACP 50发弹鼓',      desc: '五十发圆盘大弹鼓，近距倾泻密集弹雨',               kick: 0.012, bloom: 0.16, mag: 50, initRes: 100,      rate: 0.080, dmg: 13,  spread: 0.027,  speed: 310, reload: 1.75, pellets: 1, push: 2.4,  len: 0.65, camShake: 0.075, fovKick: 0.65 },
  { id: 'shotgun',  name: '霰弹枪',   fullName: '温彻斯特 M1897 战壕枪',     modelKey: 'shotgun',  snd: 'shotgun',  caliber: '12号 鹿弹（8颗弹丸）',   desc: '泵动战壕霰弹枪，近身一枪轰飞敌寇与掩体',           kick: 0.052, bloom: 0.55, mag: 6,  initRes: 24,       rate: 0.78,  dmg: 10,  spread: 0.076,  speed: 380, reload: 1.7,  pellets: 8, push: 8.8,  len: 0.84, camShake: 0.28,  fovKick: 3.40 },
  { id: 'rifle',    name: '中正式',   fullName: '中正式 7.92mm 步枪',        modelKey: 'rifle',    snd: 'rifle',    caliber: '7.92×57mm 毛瑟尖弹',    desc: '高精度栓动步枪，远距点名一枪毙命',                 kick: 0.058, bloom: 0.78, mag: 5,  initRes: 25,       rate: 1.15,  dmg: 98,  spread: 0.003,  speed: 780, reload: 2.15, pellets: 1, push: 9.2,  len: 0.94, camShake: 0.24,  fovKick: 2.45 },
  { id: 'zb26',     name: '捷克式',   fullName: '捷克式 ZB-26 轻机枪',       modelKey: 'zb26',     snd: 'zb26',     caliber: '7.92×57mm 20发顶置弹匣', desc: '淞沪会战传奇主力轻机枪，重火力撕裂防线',           kick: 0.022, bloom: 0.22, mag: 20, initRes: 60,       rate: 0.135, dmg: 29,  spread: 0.014,  speed: 640, reload: 1.95, pellets: 1, push: 5.8,  len: 0.92, camShake: 0.14,  fovKick: 1.25 },
  { id: 'sniper',   name: '狙击步枪', fullName: '毛瑟 Kar98k 光学狙击步枪',  modelKey: 'sniper',   snd: 'sniper',   caliber: '7.92×57mm 4×/8×蔡司倍镜', desc: '装配德制光学狙击倍镜；按住右键开镜狙杀、滚轮切换 4×/8× 倍率，无远距衰减', kick: 0.064, bloom: 0.85, mag: 5, initRes: 25, rate: 1.22, dmg: 125, spread: 0.001, speed: 960, reload: 2.2, pellets: 1, push: 11.5, len: 1.04, camShake: 0.30, fovKick: 2.90, scoped: true, zoomLabels: ['4×', '8×'], zoomFovs: [16.5, 9.2] }
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
