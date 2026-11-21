export const MAX_UPGRADE_LEVEL = 10;

export const ENEMY_POINT_REWARDS = {
  spear: 25,
  axe: 32,
  mace: 36,
  eliteSpear: 55,
  eliteAxe: 65,
  eliteMace: 65,
  boss: 350
};

export const WEAPON_TIERS = [
  { minLv: 1, name: '二十九军式 · 精钢大刀', auraHex: 0xffe6ba, glow: 0.0 },
  { minLv: 3, name: '百炼 · 鬼头重刃', auraHex: 0xffc864, glow: 0.25 },
  { minLv: 5, name: '玄铁 · 斩马长刀', auraHex: 0x7ceeff, glow: 0.45 },
  { minLv: 7, name: '赤霄 · 龙雀宝刀', auraHex: 0xff6840, glow: 0.68 },
  { minLv: 9, name: '无双 · 霸王孤刃', auraHex: 0xffe068, glow: 0.92 }
];

export const UPGRADE_DEFS = {
  weapon: {
    id: 'weapon',
    name: '武器锻造',
    badge: '锋 刃',
    accent: '#f0b858',
    desc: '淬火重锻大刀锋芒：每级斩击与绝技伤害 +14%，破架势能力 +8%，高阶解锁名刀冠名。',
    formatCur: p => `Lv.${p.levels.weapon} · 伤害 ×${p.weaponDmgMult.toFixed(2)}`,
    formatNext: p => `Lv.${p.levels.weapon + 1} · 伤害 ×${(1 + p.levels.weapon * 0.14).toFixed(2)}`
  },
  vigor: {
    id: 'vigor',
    name: '体魄血条',
    badge: '生 命',
    accent: '#e64838',
    desc: '强化筋骨承受致命重击：每级最大生命 +30（并立刻回满），初始 4 瓶金疮药，每 3 级再 +1 瓶。',
    formatCur: p => `Lv.${p.levels.vigor} · 上限 ${p.maxHp} HP / 药×${p.maxFlasks}`,
    formatNext: p => `Lv.${p.levels.vigor + 1} · 上限 ${p.maxHp + 30} HP`
  },
  endurance: {
    id: 'endurance',
    name: '精力耐力',
    badge: '精 力',
    accent: '#4cd682',
    desc: '拓展肺活与架刀韧性：每级精力上限 +20、精力恢复 +14%、格挡架势上限 +12（脱战奔跑/翻滚零耗精）。',
    formatCur: p => `Lv.${p.levels.endurance} · 精力 ${p.maxStamina} / 恢复 ${Math.round(p.staminaRegen)}/s`,
    formatNext: p => `Lv.${p.levels.endurance + 1} · 精力 ${p.maxStamina + 20} / 恢复 ${Math.round(45 * (1 + p.levels.endurance * 0.14))}/s`
  },
  qi: {
    id: 'qi',
    name: '刀气修为',
    badge: '绝 技',
    accent: '#64d8ff',
    desc: '精进武学内息：每级三大绝技威力 +12%、刀气积攒 +10%、绝技冷却 -0.4 秒。',
    formatCur: p => `Lv.${p.levels.qi} · 绝技 ×${p.ultDmgMult.toFixed(2)} / -${p.ultCdReduce.toFixed(1)}s`,
    formatNext: p => `Lv.${p.levels.qi + 1} · 绝技 ×${(1 + p.levels.qi * 0.12).toFixed(2)} / -${(p.levels.qi * 0.4).toFixed(1)}s`
  }
};

const STORAGE_KEY = 'hs_cold_blade_prog_v2';

export class ProgressionSystem {
  constructor({ persist = true } = {}) {
    this.persist = persist;
    this.points = 0;
    this.totalEarned = 0;
    this.bossKills = 0;
    this.levels = { weapon: 1, vigor: 1, endurance: 1, qi: 1 };
    if (this.persist) this.load();
  }

  reset() {
    this.points = 0;
    this.totalEarned = 0;
    this.bossKills = 0;
    this.levels = { weapon: 1, vigor: 1, endurance: 1, qi: 1 };
    this.save();
  }

  load() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      this.points = Math.max(0, Math.floor(Number(data.points) || 0));
      this.totalEarned = Math.max(this.points, Math.floor(Number(data.totalEarned) || 0));
      this.bossKills = Math.max(0, Math.floor(Number(data.bossKills) || 0));
      for (const k of ['weapon', 'vigor', 'endurance', 'qi']) {
        const v = Math.floor(Number(data.levels?.[k]) || 1);
        this.levels[k] = Math.max(1, Math.min(MAX_UPGRADE_LEVEL, v));
      }
    } catch {}
  }

  save() {
    if (!this.persist) return;
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          points: this.points,
          totalEarned: this.totalEarned,
          bossKills: this.bossKills,
          levels: this.levels
        })
      );
    } catch {}
  }

  addPoints(amount) {
    const gain = Math.max(0, Math.round(amount || 0));
    if (!gain) return 0;
    this.points += gain;
    this.totalEarned += gain;
    this.save();
    return gain;
  }

  recordBossKill() {
    this.bossKills++;
    this.save();
  }

  costFor(stat) {
    const lv = this.levels[stat];
    if (!lv || lv >= MAX_UPGRADE_LEVEL) return Infinity;
    return Math.round((120 * Math.pow(1.52, lv - 1)) / 10) * 10;
  }

  canAfford(stat) {
    const c = this.costFor(stat);
    return Number.isFinite(c) && this.points >= c;
  }

  hasAnyAffordable() {
    return ['weapon', 'vigor', 'endurance', 'qi'].some(k => this.canAfford(k));
  }

  upgrade(stat) {
    if (!UPGRADE_DEFS[stat]) return { ok: false, reason: 'invalid' };
    const lv = this.levels[stat];
    if (lv >= MAX_UPGRADE_LEVEL) return { ok: false, reason: 'max' };
    const cost = this.costFor(stat);
    if (this.points < cost) return { ok: false, reason: 'points', cost };
    this.points -= cost;
    this.levels[stat] = lv + 1;
    this.save();
    return { ok: true, stat, level: this.levels[stat], cost, snapshot: this.snapshot() };
  }

  get weaponTier() {
    const lv = this.levels.weapon;
    let tier = WEAPON_TIERS[0];
    for (const t of WEAPON_TIERS) {
      if (lv >= t.minLv) tier = t;
    }
    return tier;
  }

  get weaponTitle() {
    const lv = this.levels.weapon;
    return lv > 1 ? `${this.weaponTier.name} +${lv - 1}` : this.weaponTier.name;
  }

  get weaponAuraHex() {
    return this.weaponTier.auraHex;
  }

  get weaponDmgMult() {
    return 1 + (this.levels.weapon - 1) * 0.14;
  }

  get weaponPostureMult() {
    return 1 + (this.levels.weapon - 1) * 0.08;
  }

  get maxHp() {
    return 100 + (this.levels.vigor - 1) * 30;
  }

  get maxFlasks() {
    return 4 + Math.floor((this.levels.vigor - 1) / 3);
  }

  get flaskHeal() {
    return Math.round(this.maxHp * 0.65);
  }

  get maxStamina() {
    return 100 + (this.levels.endurance - 1) * 20;
  }

  get staminaRegen() {
    return 45 * (1 + (this.levels.endurance - 1) * 0.14);
  }

  get maxPosture() {
    return 100 + (this.levels.endurance - 1) * 12;
  }

  get ultDmgMult() {
    return 1 + (this.levels.qi - 1) * 0.12;
  }

  get qiGainMult() {
    return 1 + (this.levels.qi - 1) * 0.10;
  }

  get ultCdReduce() {
    return (this.levels.qi - 1) * 0.4;
  }

  get totalLevel() {
    return this.levels.weapon + this.levels.vigor + this.levels.endurance + this.levels.qi - 3;
  }

  snapshot() {
    return {
      points: this.points,
      totalEarned: this.totalEarned,
      bossKills: this.bossKills,
      totalLevel: this.totalLevel,
      levels: { ...this.levels },
      weaponTitle: this.weaponTitle,
      weaponDmgMult: this.weaponDmgMult,
      maxHp: this.maxHp,
      maxStamina: this.maxStamina,
      staminaRegen: this.staminaRegen,
      maxPosture: this.maxPosture,
      ultDmgMult: this.ultDmgMult,
      ultCdReduce: this.ultCdReduce,
      maxFlasks: this.maxFlasks
    };
  }
}
