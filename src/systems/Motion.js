export const motionNames = {
  Crawl: '向前爬行', DeathHead: '受击倒地', DeathForward: '向前倒地', DeathBack: '向后倒地',
  HitHead: '头部受击', HitStomach: '腹部受击', HitBody: '身体受击', KneelHit: '跪地',
  InjuredWalk: '受伤跛行', Surrender: '举手投降', TurnLeft: '原地左转', TurnRight: '原地右转',
  ProneRightTurn: '趴姿右转', ProneLeftTurn: '趴姿左转',
  LocoWalk: '正常行走', LocoRun: '奔跑', LocoIdle: '站立待机'
};

export function motionVariant(clips, family, previous, stance) {
  let choices = Object.keys(clips).filter(key => (clips[key].userData?.family || key) === family);
  if (stance) {
    const sameStance = choices.filter(key => clips[key].userData?.stance === stance);
    if (sameStance.length || stance === 'crouch') choices = sameStance;
  }
  if (choices.length < 2) return choices[0] || null;
  const others = choices.filter(key => key !== previous);
  return others[Math.floor(Math.random() * others.length)];
}

export function driveTurn(cf, mesh, heading, stance, dt) {
  if (dt <= 0) return;
  const u = mesh.userData;
  const current = u.ov;
  if (!stance || u.turnStance !== stance) {
    if (current?.turn && current.turn !== stance && !current.stopping) cf.stopClip(mesh, 0.1);
    u.turnStance = stance;
    u.turnAnchor = heading;
    return;
  }
  if (current && !current.stopping && (current.turn || !current.loop || current.key !== 'Crawl')) {
    u.turnAnchor = heading;
    return;
  }
  const delta = Math.atan2(Math.sin(heading - u.turnAnchor), Math.cos(heading - u.turnAnchor));
  if (Math.abs(delta) < (stance === 'prone' ? 0.35 : 0.48)) return;
  u.turnAnchor = heading;
  const family = stance === 'prone'
    ? (delta > 0 ? 'ProneRightTurn' : 'ProneLeftTurn')
    : (delta > 0 ? 'TurnRight' : 'TurnLeft');
  const key = motionVariant(u.clips, family, u.lastTurn, stance);
  if (key && cf.playClip(mesh, key, { turn: stance, fadeIn: 0.12, fadeOut: 0.16 })) u.lastTurn = key;
}
