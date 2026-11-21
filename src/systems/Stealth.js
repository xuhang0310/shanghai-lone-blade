import { PLAYER_RADIUS, enemyStanceHeight } from '../config/constants.js';

const INTERACT_REACH = 1.65;
const COMBAT_FINISHER_REACH = 2.45;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function guardNoticesPlayer(level, guard, player) {
  const dx = player.x - guard.x, dz = player.z - guard.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= 34) return false;
  if (!guard.awake && (player.sneaking || distance >= 8)) {
    const facing = dx * Math.cos(guard.ang) + dz * Math.sin(guard.ang);
    if (facing < distance * 0.25) return false;
  }
  return level.los3(guard.x, enemyStanceHeight(guard) - 0.2, guard.z,
    player.x, player.y + player.currentHeight() - 0.1, player.z);
}

// Gradual suspicion accumulation (MGS / TLOU style): instant at point-blank, buffered at range so
// crouching/ducking behind cover lets the player escape detection before waking the whole squad.
export function stepGuardSuspicion(level, guard, player, dt) {
  if (!guardNoticesPlayer(level, guard, player)) {
    guard.suspicion = Math.max(0, (guard.suspicion || 0) - dt * 0.65);
    return false;
  }
  const dx = player.x - guard.x, dz = player.z - guard.z;
  const distance = Math.hypot(dx, dz);
  const facing = (dx * Math.cos(guard.ang) + dz * Math.sin(guard.ang)) / (distance || 1);
  if ((distance < 3.6 && facing > 0.25) || (distance < 4.0 && !player.sneaking)) {
    guard.suspicion = 1;
    return true;
  }
  const distRate = clamp(1.65 - distance * 0.045, 0.42, 1.55);
  const stanceMul = player.crouch ? 0.56 : player.sneaking ? (player.briskLow ? 0.88 : 0.66) : 1.35;
  const moveMul = player.moving ? 1.18 : 0.72;
  const angleMul = facing > 0.75 ? 1.15 : 0.78;
  guard.suspicion = Math.min(1, (guard.suspicion || 0) + dt * distRate * stanceMul * moveMul * angleMul);
  return guard.suspicion >= 1;
}

function inPosition(level, player, target) {
  if (target.hp <= 0 || target.type === 'boss' || target.awake || target.sees ||
      target.downed || target.disarmed || target.inv > 0 || target.staggerT > 0 || target.stun > 0) return false;
  const dx = target.x - player.x, dz = target.z - player.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.01 || distance > INTERACT_REACH || Math.abs(player.y) > 0.45) return false;
  const playerFacing = dx * Math.cos(player.ang) + dz * Math.sin(player.ang);
  const targetFacing = dx * Math.cos(target.ang) + dz * Math.sin(target.ang);
  if (playerFacing < distance * 0.55 || targetFacing < distance * 0.65) return false;
  return level.canWalk(player.x, player.z, target.x, target.z, PLAYER_RADIUS);
}

function isSpotted(level, player, target) {
  return level.enemies.some(other => {
    if (other === target || other.hp <= 0 || other.downed || other.disarmed) return false;
    if (other.awake && other.searchT > 0 && Math.hypot(other.x - player.x, other.z - player.z) < 16) return true;
    return guardNoticesPlayer(level, other, player);
  });
}

export function findStealthTarget(level, player, clearPath) {
  if (!player.sneaking || player.execT > 0) return null;
  let best = null;
  let nearest = Infinity;
  for (const e of level.enemies) {
    if (e.executing || !inPosition(level, player, e) || (clearPath && !clearPath(e))) continue;
    const distance = Math.hypot(e.x - player.x, e.z - player.z);
    if (distance < nearest) {
      best = e;
      nearest = distance;
    }
  }
  return best && !isSpotted(level, player, best) ? best : null;
}

// The target is reserved during the animation. Recheck the world before committing the result.
export function canFinishStealth(level, player, target, clearPath) {
  return target.executing && level.enemies.includes(target) && player.sneaking &&
    inPosition(level, player, target) && (!clearPath || clearPath(target)) && !isSpotted(level, player, target);
}

// Vulnerable combat finisher: allows [E] close-up execution on kneeling, downed, or staggered low-HP foes.
export function findCombatFinisher(level, player, clearPath) {
  if (player.hp <= 0 || player.execT > 0 || player.air || player.rollT > 0 || player.diveT > 0 ||
      player.stepT > 0 || Math.abs(player.y) > 0.45) return null;
  let best = null;
  let nearest = Infinity;
  const lx = Math.cos(player.ang), lz = Math.sin(player.ang);
  for (const e of level.enemies) {
    if (e.hp <= 0 || e.executing || e.type === 'boss' || e.disarmed || e.inv > 0) continue;
    const vulnerable =
      e.react?.kind === 'kneel' ||
      e.downed ||
      (e.hp <= e.max * 0.32 && ((e.staggerT || 0) > 0 || (e.limpT || 0) > 0));
    if (!vulnerable) continue;
    const dx = e.x - player.x, dz = e.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.01 || distance > COMBAT_FINISHER_REACH) continue;
    if (dx * lx + dz * lz < distance * 0.35) continue;
    if (!level.canWalk(player.x, player.z, e.x, e.z, PLAYER_RADIUS)) continue;
    if (clearPath && !clearPath(e)) continue;
    if (distance < nearest) {
      best = e;
      nearest = distance;
    }
  }
  return best;
}
