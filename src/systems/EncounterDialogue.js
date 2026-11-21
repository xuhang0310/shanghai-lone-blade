import lines from '../config/dialogue.json' with { type: 'json' };
import { ENEMY_TYPES, enemyStanceHeight } from '../config/constants.js';

export function canFinishCloseLine(group, e, player) {
  if (!e || e.hp <= 0 || e.downed || e.disarmed || e.handsUp || e.executing ||
      player.hp <= 0 || player.execT > 0 || Math.hypot(e.x - player.x, e.z - player.z) > 13) return false;
  if (group === 'near-idle') return !e.awake;
  return e.awake && (group !== 'near-hero' || !player.sneaking);
}

function canHear(level, e, player) {
  return level.los3(e.x, enemyStanceHeight(e) - 0.12, e.z, player.x, player.y + player.currentHeight() - 0.1, player.z);
}

export class EncounterDialogue {
  constructor(catalog = lines, random = Math.random) {
    this.catalog = catalog;
    this.random = random;
    this.groups = new Map();
    for (const [cue, row] of Object.entries(catalog)) {
      if (!row.group) continue;
      if (!this.groups.has(row.group)) this.groups.set(row.group, []);
      this.groups.get(row.group).push(cue);
    }
    this.bags = new Map();
    this.reset();
  }

  reset() {
    this.clock = 0;
    this.nextScan = 0;
    this.nextLine = 0.9;
    this.reply = null;
    this.visits = new WeakMap();
  }

  interrupt(duration) {
    this.reply = null;
    this.nextLine = Math.max(this.nextLine, this.clock + duration + 1.5);
  }

  choose(event, type, voiceActor) {
    const group = this.catalog[event]?.group || event;
    let choices = this.groups.get(group);
    if (!choices) return Object.hasOwn(this.catalog, event) ? event : null;
    const actor = group === 'near-hero' ? 'hero' : voiceActor || ENEMY_TYPES[type]?.voice || 'enemy';
    const bagKey = group + '/' + actor;
    let bag = this.bags.get(bagKey);
    if (!bag) {
      if (Object.hasOwn(this.catalog, group) && !choices.includes(group)) choices = [group, ...choices];
      const matching = choices.filter(cue => (this.catalog[cue].actor || this.catalog[cue].speaker) === actor);
      const pool = matching.length ? matching : choices.filter(cue => ['enemy', 'gang'].includes(this.catalog[cue].actor));
      if (!pool.length) return null;
      bag = { pool, remaining: [], last: null };
      this.bags.set(bagKey, bag);
    }
    if (!bag.remaining.length) {
      const deck = [...bag.pool];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      if (deck.length > 1 && deck.at(-1) === bag.last) [deck[0], deck[deck.length - 1]] = [deck.at(-1), deck[0]];
      bag.remaining = deck;
    }
    return (bag.last = bag.remaining.pop());
  }

  update(dt, level, player, free, speak) {
    this.clock += dt;
    if (this.clock < this.nextScan) return;
    this.nextScan = this.clock + 0.3;
    if (this.reply) {
      const { source, ready, expires } = this.reply;
      if (this.clock > expires || !source.sees || !canFinishCloseLine('near-hero', source, player) ||
          !level.enemies.includes(source) || !canHear(level, source, player)) this.reply = null;
      else if (free && this.clock >= ready) {
        this.reply = null;
        if (speak('near-hero', 2.7, source)) return;
      }
    }

    let closest = null;
    let best = 9.5;
    const maySpeak = free && this.clock >= this.nextLine && player.hp > 0 && !(player.execT > 0);
    for (const e of level.enemies) {
      const distance = Math.hypot(e.x - player.x, e.z - player.z);
      const visit = this.visits.get(e);
      if (distance > 13) {
        if (visit) visit.phase = null;
        continue;
      }
      if (!maySpeak || distance >= best || e.react || e.stun > 0 || (e.awake && !e.sees)) continue;
      const phase = e.awake ? 'near-alert' : 'near-idle';
      if (!canFinishCloseLine(phase, e, player) || visit?.phase === phase) continue;
      const justSpotted = visit?.phase === 'near-idle' && phase === 'near-alert';
      if (!justSpotted && visit?.ready > this.clock) continue;
      if (!canHear(level, e, player)) continue;
      best = distance;
      closest = e;
    }
    if (!closest) return;
    const phase = closest.awake ? 'near-alert' : 'near-idle';
    if (!speak(phase, 3.0, closest)) return;
    this.visits.set(closest, { phase, ready: this.clock + 16 + this.random() * 7 });
    this.nextLine = this.clock + 9 + this.random() * 5;
    if (phase === 'near-alert' && !player.sneaking && this.random() < 0.45) {
      this.reply = { source: closest, ready: this.clock + 2.6, expires: this.clock + 9 };
    }
  }
}
