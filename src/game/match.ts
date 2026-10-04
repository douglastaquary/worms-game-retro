import {
  buildHeights,
  carveCircle,
  findStand,
  groundNear,
  isSolid,
  rasterHeights,
  surfaceY,
  WATER_Y,
  WORLD_H,
  WORLD_W,
} from './terrain';
import type {
  Building,
  GameEvent,
  Match,
  Phase,
  Projectile,
  WeaponId,
  Worm,
} from './types';

const PLAYER_NAMES = ['Doce', 'Picante', 'Brasa', 'Calor'];
const ENEMY_NAMES = ['Cacto', 'Duna', 'Nuvem', 'Pedra'];

const LEVELS = [
  {
    name: 'Posto do Desfiladeiro',
    blurb: 'Três minhocas, água no meio e um barracão inimigo. A oficina, se você chegar nela, entrega outra Mão Sagrada.',
    worms: 3,
    windMax: 0.45,
    timer: 30,
    aiSkill: 0.32,
    playerAmmo: { holy: 2, donkey: 1, heli: 1 },
    enemyAmmo: { holy: 0, donkey: 0, heli: 0 },
    spawns: [0.1, 0.16, 0.23],
    enemySpawns: [0.74, 0.82, 0.9],
    buildings: [
      { kind: 'workshop' as const, nx: 0.2 },
      { kind: 'bunker' as const, nx: 0.8 },
    ],
    tankNx: 0.27,
  },
  {
    name: 'Fortaleza do Vento',
    blurb: 'Quatro contra quatro. Eles estão no alto, o vento sopra forte e o inimigo usa o arsenal inteiro.',
    worms: 4,
    windMax: 0.9,
    timer: 26,
    aiSkill: 0.8,
    playerAmmo: { holy: 2, donkey: 1, heli: 1 },
    enemyAmmo: { holy: 1, donkey: 1, heli: 1 },
    spawns: [0.08, 0.14, 0.19, 0.3],
    enemySpawns: [0.74, 0.81, 0.87, 0.93],
    buildings: [
      { kind: 'bunker' as const, nx: 0.15 },
      { kind: 'workshop' as const, nx: 0.46 },
      { kind: 'bunker' as const, nx: 0.84 },
    ],
    tankNx: 0.47,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function banner(match: Match, text: string, time = 1.15): void {
  match.banner = text;
  match.bannerTime = time;
  match.events.push({ type: 'banner', text });
}

const SPAWN_BUILDING_MARGIN = 0.5;
const SPAWN_WORM_GAP = 1;
const SPAWN_TANK_GAP = 1.5;

/** True when a worm standing at x would sit inside a building's footprint (plus margin). */
export function insideBuildingFootprint(buildings: Building[], x: number, margin = 0): boolean {
  return buildings.some((building) => Math.abs(x - building.x) < building.w / 2 + margin);
}

/**
 * Nearest dry standing spot to the preferred x, within [minX, maxX], that is clear
 * of buildings, the tank and already placed worms.
 */
function findSpawn(
  solids: Uint8Array,
  nx: number,
  minX: number,
  maxX: number,
  buildings: Building[],
  tankX: number,
  worms: Worm[],
): { x: number; y: number } {
  const prefer = clamp(nx * WORLD_W, minX, maxX);
  const free = (x: number) =>
    !insideBuildingFootprint(buildings, x, SPAWN_BUILDING_MARGIN) &&
    Math.abs(x - tankX) >= SPAWN_TANK_GAP &&
    worms.every((worm) => Math.abs(x - worm.x) >= SPAWN_WORM_GAP);
  for (let delta = 0; delta <= maxX - minX; delta += 0.2) {
    for (const x of [prefer + delta, prefer - delta]) {
      if (x < minX || x > maxX) continue;
      const y = surfaceY(solids, x);
      if (y !== null && y > WATER_Y + 0.4 && free(x)) return { x, y };
    }
  }
  return findStand(solids, nx);
}

export function createMatch(levelIndex: number, rng: () => number, phase: Phase = 'menu'): Match {
  const level = LEVELS[levelIndex] ?? LEVELS[0];
  const heights = buildHeights(levelIndex, rng);
  const solids = rasterHeights(heights);

  const buildings: Building[] = [];
  for (const spec of level.buildings) {
    const stand = findStand(solids, spec.nx);
    const bunker = spec.kind === 'bunker';
    buildings.push({
      id: `${spec.kind}-${buildings.length}`,
      kind: spec.kind,
      x: stand.x,
      y: stand.y,
      w: bunker ? 2.45 : 2.2,
      h: bunker ? 1.5 : 1.35,
      hp: bunker ? 160 : 120,
      maxHp: bunker ? 160 : 120,
      alive: true,
    });
  }
  const tankStand = findStand(solids, level.tankNx);

  const worms: Worm[] = [];
  let id = 0;
  const spawnRows = [level.spawns, level.enemySpawns];
  for (let team = 0; team < 2; team += 1) {
    const names = team === 0 ? PLAYER_NAMES : ENEMY_NAMES;
    const minX = team === 0 ? 0.4 : WORLD_W / 2;
    const maxX = team === 0 ? WORLD_W / 2 : WORLD_W - 0.4;
    for (let slot = 0; slot < level.worms; slot += 1) {
      const stand = findSpawn(solids, spawnRows[team][slot] ?? 0.5, minX, maxX, buildings, tankStand.x, worms);
      worms.push({
        id,
        team,
        slot,
        name: names[slot] ?? `Minhoca ${slot + 1}`,
        x: stand.x,
        y: stand.y,
        vx: 0,
        vy: 0,
        hp: 100,
        alive: true,
        inTank: false,
        fallStart: null,
        face: team === 0 ? 1 : -1,
      });
      id += 1;
    }
  }

  const first = worms[0];
  const foe = worms.find((worm) => worm.team === 1) ?? first;

  return {
    levelIndex,
    levelName: level.name,
    blurb: level.blurb,
    wormsPerTeam: level.worms,
    worms,
    buildings,
    tank: { x: tankStand.x, y: tankStand.y, hp: 100, alive: true, facing: 1, angle: 0.6 },
    projectiles: [],
    heli: null,
    blasts: [],
    solids,
    solidVersion: 1,
    phase,
    phaseBeforePause: 'aim',
    team: 0,
    slot: 0,
    timer: level.timer,
    timerMax: level.timer,
    wind: (rng() * 2 - 1) * level.windMax,
    windMax: level.windMax,
    aimAngle: Math.atan2(foe.y - first.y, foe.x - first.x),
    aimPower: 0.62,
    weapon: 'bazooka',
    ammo: [
      { ...level.playerAmmo },
      { ...level.enemyAmmo },
    ],
    targetX: foe.x,
    banner: phase === 'menu' ? 'Minhocas: Caos Tático' : level.name,
    bannerTime: phase === 'menu' ? 0 : 1.5,
    aiSkill: level.aiSkill,
    aiTimer: 0.8,
    aiStage: 'think',
    hitstop: 0,
    settleTime: 0,
    pendingEnd: null,
    occupiedBy: null,
    workshopUsed: false,
    killed: 0,
    walkLeft: 4.2,
    events: [],
    rng,
  };
}

export function activeWorm(match: Match): Worm | null {
  return match.worms.find((worm) => worm.alive && worm.team === match.team && worm.slot === match.slot) ?? null;
}

export function openBattle(match: Match): void {
  match.phase = 'aim';
  match.team = 0;
  match.slot = 0;
  match.timer = match.timerMax;
  match.weapon = 'bazooka';
  match.aimPower = 1;
  match.banner = match.levelName;
  match.bannerTime = 1.5;
  match.pendingEnd = null;
  const worm = activeWorm(match);
  const foe = worm ? nearestFoe(match, worm) : null;
  if (worm && foe) match.aimAngle = foe.x >= worm.x ? 0.68 : Math.PI - 0.68;
  if (worm) {
    worm.face = 1;
    grantWorkshop(match, worm);
  }
}

export function muzzle(match: Match): { x: number; y: number } {
  const worm = activeWorm(match);
  if (worm && match.occupiedBy === worm.id && match.tank.alive) {
    return { x: match.tank.x + Math.cos(match.tank.angle) * 0.9, y: match.tank.y + 0.72 + Math.sin(match.tank.angle) * 0.35 };
  }
  if (!worm) return { x: 4, y: 8 };
  return { x: worm.x + worm.face * 0.32, y: worm.y + 0.72 };
}

export function aimToward(match: Match, x: number, y: number, power: number | null): void {
  if (match.phase !== 'aim' || match.team !== 0) return;
  const origin = muzzle(match);
  match.aimAngle = Math.atan2(y - origin.y, x - origin.x);
  if (power !== null) match.aimPower = clamp(power, 0.18, 1);
  applyFacing(match);
}

export function nudgeAim(match: Match, dAngle: number, dPower: number): void {
  if (match.phase !== 'aim' || match.team !== 0) return;
  match.aimAngle += dAngle;
  match.aimPower = clamp(match.aimPower + dPower, 0.18, 1);
  applyFacing(match);
}

export function setTargetX(match: Match, x: number): void {
  match.targetX = clamp(x, 0.8, WORLD_W - 0.8);
}

export function walkOrDrive(match: Match, dir: number, dt: number): void {
  if (match.phase !== 'aim' || match.team !== 0 || dir === 0) return;
  const worm = activeWorm(match);
  if (!worm) return;
  if (worm.inTank && match.tank.alive) {
    driveTank(match, worm, dir, dt);
    return;
  }
  worm.face = dir > 0 ? 1 : -1;
  if (match.walkLeft <= 0 || worm.fallStart !== null || worm.vy !== 0) return;
  const next = worm.x + dir * 2.6 * dt;
  if (next < 0.4 || next > WORLD_W - 0.4) return;
  const ground = groundNear(match.solids, next, worm.y, 0.9);
  if (ground === null || ground - worm.y > 0.9) return;
  match.walkLeft = Math.max(0, match.walkLeft - Math.abs(next - worm.x));
  worm.x = next;
  // Bigger drops are left to stepWorms so the worm falls off the ledge.
  if (worm.y - ground <= 0.9) worm.y = ground;
}

export function selectWeapon(match: Match, weapon: WeaponId): boolean {
  if (match.phase !== 'aim' || match.team !== 0) return false;
  const worm = activeWorm(match);
  if (!worm) return false;
  if (weapon === 'holy' && match.ammo[0].holy <= 0) return false;
  if (weapon === 'donkey' && match.ammo[0].donkey <= 0) return false;
  if (weapon === 'heli' && match.ammo[0].heli <= 0) return false;
  if (weapon === 'tank') {
    if (!match.tank.alive) {
      banner(match, 'O tanque já era');
      return false;
    }
    if (worm.inTank) {
      match.weapon = 'tank';
      return true;
    }
    if (Math.abs(worm.x - match.tank.x) > 1.65 || Math.abs(worm.y - match.tank.y) > 1.4) {
      banner(match, 'Chegue perto do tanque');
      return false;
    }
    enterTank(match, worm);
    return true;
  }
  if (worm.inTank) {
    banner(match, 'Saia do tanque para trocar');
    return false;
  }
  match.weapon = weapon;
  return true;
}

export function exitTank(match: Match): void {
  const worm = match.worms.find((entry) => entry.id === match.occupiedBy);
  if (!worm) return;
  worm.inTank = false;
  const side = worm.face || 1;
  const next = clamp(match.tank.x + side * 1.05, 0.5, WORLD_W - 0.5);
  const ground = groundNear(match.solids, next, match.tank.y, 1.2);
  worm.x = next;
  worm.y = ground ?? match.tank.y;
  match.occupiedBy = null;
  match.weapon = 'bazooka';
  banner(match, `${worm.name} saltou do tanque`);
}

export function tryFire(match: Match): boolean {
  if (match.phase !== 'aim') return false;
  const worm = activeWorm(match);
  if (!worm) return false;
  if (match.weapon === 'heli') return startHeli(match, worm);
  if (match.weapon === 'donkey') return dropDonkey(match, worm);
  if (match.weapon === 'tank') {
    if (match.occupiedBy !== worm.id || !match.tank.alive) {
      banner(match, 'Entre no tanque para atirar');
      return false;
    }
    launch(match, worm, 'cannon');
    match.phase = 'fly';
    return true;
  }
  if (match.weapon === 'holy') {
    if (match.ammo[worm.team].holy <= 0) return false;
    match.ammo[worm.team].holy -= 1;
    launch(match, worm, 'holy');
    match.phase = 'fly';
    return true;
  }
  launch(match, worm, 'bazooka');
  match.phase = 'fly';
  return true;
}

export function playerEndTurn(match: Match): void {
  if (match.phase !== 'aim' || match.team !== 0) return;
  advanceTurn(match);
}

export function togglePause(match: Match): void {
  if (match.phase === 'pause') {
    match.phase = match.phaseBeforePause;
    return;
  }
  if (match.phase === 'menu' || match.phase === 'victory' || match.phase === 'defeat' || match.phase === 'levelclear') return;
  match.phaseBeforePause = match.phase;
  match.phase = 'pause';
}

export function previewPoints(match: Match): Array<{ x: number; y: number }> {
  if (match.phase !== 'aim') return [];
  if (match.weapon === 'donkey' || match.weapon === 'heli') return [];
  if (match.weapon === 'tank' && match.occupiedBy === null) return [];
  const kind = match.weapon === 'tank' ? 'cannon' : match.weapon === 'holy' ? 'holy' : 'bazooka';
  const origin = muzzle(match);
  return sampleArc(match, origin.x, origin.y, match.aimAngle, match.aimPower, kind);
}

export function stepMatch(match: Match, dt: number): void {
  if (match.phase === 'menu' || match.phase === 'pause' || match.phase === 'levelclear' || match.phase === 'victory' || match.phase === 'defeat') {
    return;
  }
  if (match.bannerTime > 0) match.bannerTime = Math.max(0, match.bannerTime - dt);
  ageBlasts(match, dt);
  if (match.hitstop > 0) {
    match.hitstop = Math.max(0, match.hitstop - dt);
    return;
  }

  if (match.phase === 'aim') {
    if (match.bannerTime <= 0) match.timer -= dt;
    if (match.team !== 0) stepAi(match, dt);
    stepWorms(match, dt);
    if (match.phase === 'aim' && match.timer <= 0) {
      banner(match, 'Tempo esgotado');
      advanceTurn(match);
    }
    return;
  }

  if (match.phase === 'helicopter') {
    stepHeli(match, dt);
    stepWorms(match, dt);
    return;
  }

  if (match.phase === 'fly') {
    const flying = stepProjectiles(match, dt);
    stepWorms(match, dt);
    if (!flying && match.phase === 'fly') beginSettle(match);
    return;
  }

  if (match.phase === 'settle') {
    match.settleTime -= dt;
    const moving = stepWorms(match, dt);
    if (!moving && match.settleTime <= 0) finishSettle(match);
  }
}

export function drainEvents(match: Match): GameEvent[] {
  const events = match.events;
  match.events = [];
  return events;
}

function applyFacing(match: Match): void {
  const worm = activeWorm(match);
  if (!worm) return;
  const face = Math.cos(match.aimAngle) >= 0 ? 1 : -1;
  if (worm.inTank && match.tank.alive) {
    match.tank.facing = face;
    match.tank.angle = match.aimAngle;
    return;
  }
  worm.face = face;
}

function enterTank(match: Match, worm: Worm): boolean {
  if (!match.tank.alive) return false;
  if (match.occupiedBy !== null && match.occupiedBy !== worm.id) return false;
  match.occupiedBy = worm.id;
  worm.inTank = true;
  worm.x = match.tank.x;
  worm.y = match.tank.y + 0.4;
  match.weapon = 'tank';
  match.tank.angle = match.aimAngle;
  banner(match, `${worm.name} entrou no tanque`);
  return true;
}

function driveTank(match: Match, worm: Worm, dir: number, dt: number): void {
  const next = match.tank.x + dir * 4.4 * dt;
  if (next < 1 || next > WORLD_W - 1) return;
  const ground = groundNear(match.solids, next, match.tank.y, 1.25);
  if (ground === null || ground < WATER_Y + 0.25) return;
  if (Math.abs(ground - match.tank.y) > 1.25) return;
  match.tank.x = next;
  match.tank.y = ground;
  match.tank.facing = dir > 0 ? 1 : -1;
  worm.x = next;
  worm.y = ground + 0.4;
  worm.face = match.tank.facing;
}

function startHeli(match: Match, worm: Worm): boolean {
  if (match.ammo[worm.team].heli <= 0) return false;
  match.ammo[worm.team].heli -= 1;
  const fromLeft = match.targetX > WORLD_W * 0.5;
  match.heli = {
    x: fromLeft ? -2.5 : WORLD_W + 2.5,
    targetX: match.targetX,
    dropsLeft: 3,
    cooldown: 0.15,
    team: worm.team,
  };
  match.phase = 'helicopter';
  match.events.push({ type: 'rotor' });
  match.events.push({ type: 'fire', kind: 'heli' });
  return true;
}

function dropDonkey(match: Match, worm: Worm): boolean {
  if (match.ammo[worm.team].donkey <= 0) return false;
  match.ammo[worm.team].donkey -= 1;
  match.projectiles.push({
    kind: 'donkey',
    x: clamp(match.targetX, 1.2, WORLD_W - 1.2),
    y: WORLD_H - 0.3,
    vx: match.wind * 1.3,
    vy: 0,
    fuse: 7,
    blast: 3.45,
    damage: 90,
    team: worm.team,
    bounce: false,
    radius: 0.55,
    age: 1,
  });
  match.phase = 'fly';
  match.events.push({ type: 'fire', kind: 'donkey' });
  return true;
}

function launch(match: Match, worm: Worm, kind: 'bazooka' | 'holy' | 'cannon'): void {
  const origin = muzzle(match);
  const velocity = speedFor(kind, match.aimPower);
  match.projectiles.push({
    kind,
    x: origin.x,
    y: origin.y,
    vx: Math.cos(match.aimAngle) * velocity,
    vy: Math.sin(match.aimAngle) * velocity,
    fuse: kind === 'holy' ? 2.65 : 8,
    blast: kind === 'holy' ? 3.15 : kind === 'cannon' ? 1.9 : 1.75,
    damage: kind === 'holy' ? 76 : kind === 'cannon' ? 54 : 45,
    team: worm.team,
    bounce: kind === 'holy',
    radius: kind === 'holy' ? 0.2 : 0.14,
    age: 0,
  });
  match.events.push({ type: 'fire', kind });
}

function speedFor(kind: string, power: number): number {
  if (kind === 'holy') return 6.4 + power * 10;
  if (kind === 'cannon') return 9.5 + power * 11;
  return 7.6 + power * 13.5;
}

function sampleArc(
  match: Match,
  x: number,
  y: number,
  angle: number,
  power: number,
  kind: 'bazooka' | 'holy' | 'cannon',
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let px = x;
  let py = y;
  const velocity = speedFor(kind, power);
  let vx = Math.cos(angle) * velocity;
  let vy = Math.sin(angle) * velocity;
  let fuse = kind === 'holy' ? 2.65 : 8;
  const step = 1 / 30;
  for (let i = 0; i < 78; i += 1) {
    vy -= 16.5 * step;
    vx += match.wind * 3.1 * step;
    px += vx * step;
    py += vy * step;
    fuse -= step;
    if (i % 2 === 0) points.push({ x: px, y: py });
    if (fuse <= 0 || px < -1 || px > WORLD_W + 1 || py < 0 || py > WORLD_H + 1) break;
    if (py < WATER_Y && surfaceY(match.solids, px) === null) break;
    if (isSolid(match.solids, px, py)) break;
  }
  return points;
}

function stepAi(match: Match, dt: number): void {
  if (match.aiStage === 'done') return;
  match.aiTimer -= dt;
  if (match.aiTimer > 0) return;
  const worm = activeWorm(match);
  const foe = worm ? nearestFoe(match, worm) : null;
  if (!worm || !foe) {
    advanceTurn(match);
    return;
  }
  if (match.aiStage === 'think') {
    aiApproachTank(match, worm);
    chooseAiShot(match, worm, foe);
    match.aiStage = 'show';
    match.aiTimer = 0.42;
    return;
  }
  tryFire(match);
  match.aiStage = 'done';
}

function aiApproachTank(match: Match, worm: Worm): void {
  if (match.aiSkill < 0.55 || !match.tank.alive || match.occupiedBy !== null || worm.inTank) return;
  if (Math.abs(worm.x - match.tank.x) > 3.2 || Math.abs(worm.y - match.tank.y) > 2) return;
  const dir = Math.sign(match.tank.x - worm.x) || 1;
  for (let i = 0; i < 14 && match.walkLeft > 0; i += 1) {
    const next = worm.x + dir * 0.22;
    const ground = groundNear(match.solids, next, worm.y, 0.9);
    if (ground === null || Math.abs(ground - worm.y) > 0.9) break;
    match.walkLeft -= 0.22;
    worm.x = next;
    worm.y = ground;
  }
}

function chooseAiShot(match: Match, worm: Worm, foe: Worm): void {
  const ammo = match.ammo[worm.team];
  const roll = match.rng();
  const distance = Math.abs(foe.x - worm.x);
  if (match.tank.alive && match.occupiedBy === null && Math.abs(worm.x - match.tank.x) < 1.65 && roll < 0.25 + match.aiSkill * 0.55) {
    enterTank(match, worm);
  }
  if (worm.inTank) {
    match.weapon = 'tank';
    solveAim(match, worm, foe, 'cannon');
    return;
  }
  if (ammo.donkey > 0 && roll < 0.08 + match.aiSkill * 0.28) {
    match.weapon = 'donkey';
    match.targetX = foe.x + (match.rng() - 0.5) * 2.4 * (1 - match.aiSkill);
    return;
  }
  if (ammo.heli > 0 && distance > 6 && match.rng() < 0.2 + match.aiSkill * 0.45) {
    match.weapon = 'heli';
    match.targetX = foe.x + (match.rng() - 0.5) * 2 * (1 - match.aiSkill);
    return;
  }
  if (ammo.holy > 0 && distance < 14 && match.rng() < 0.25 + match.aiSkill * 0.4) {
    match.weapon = 'holy';
    solveAim(match, worm, foe, 'holy');
    return;
  }
  match.weapon = 'bazooka';
  solveAim(match, worm, foe, 'bazooka');
}

function solveAim(match: Match, worm: Worm, foe: Worm, kind: 'bazooka' | 'holy' | 'cannon'): void {
  const inTank = worm.inTank && match.tank.alive;
  const originX = inTank ? match.tank.x : worm.x;
  const originY = inTank ? match.tank.y + 0.72 : worm.y + 0.72;
  const facing = foe.x >= originX ? 1 : -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAngle = facing > 0 ? 0.85 : Math.PI - 0.85;
  let bestPower = 0.66;
  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    const angle = facing > 0 ? 0.2 + t * 1.25 : Math.PI - (0.2 + t * 1.25);
    for (const power of [0.48, 0.66, 0.84, 1]) {
      const arc = sampleArc(match, originX, originY, angle, power, kind);
      const end = arc[arc.length - 1];
      if (!end) continue;
      const score = Math.hypot(end.x - foe.x, end.y - (foe.y + 0.35));
      if (score < bestScore) {
        bestScore = score;
        bestAngle = angle;
        bestPower = power;
      }
    }
  }
  const error = (1 - match.aiSkill) * 0.34;
  match.aimAngle = bestAngle + (match.rng() - 0.5) * error;
  match.aimPower = clamp(bestPower + (match.rng() - 0.5) * error, 0.3, 1);
  applyFacing(match);
}

function stepHeli(match: Match, dt: number): void {
  const heli = match.heli;
  if (!heli) {
    match.phase = 'fly';
    return;
  }
  if (heli.dropsLeft > 0) {
    const delta = heli.targetX - heli.x;
    if (Math.abs(delta) > 0.3) heli.x += Math.sign(delta) * 11 * dt;
    else {
      heli.cooldown -= dt;
      if (heli.cooldown <= 0) {
        const index = 3 - heli.dropsLeft;
        heli.dropsLeft -= 1;
        heli.cooldown = 0.22;
        match.projectiles.push({
          kind: 'bomb',
          x: heli.targetX + (index - 1) * 0.8,
          y: 16.5,
          vx: match.wind * 0.7,
          vy: -0.6,
          fuse: 6,
          blast: 1.55,
          damage: 34,
          team: heli.team,
          bounce: false,
          radius: 0.16,
          age: 0.4,
        });
        match.events.push({ type: 'fire', kind: 'bomb' });
      }
    }
  } else {
    const leave = heli.targetX > WORLD_W * 0.5 ? 1 : -1;
    heli.x += leave * 12 * dt;
    if (heli.x < -3.5 || heli.x > WORLD_W + 3.5) match.heli = null;
  }
  const flying = stepProjectiles(match, dt);
  if (!match.heli && !flying) beginSettle(match);
  else if (!match.heli) match.phase = 'fly';
}

function beginSettle(match: Match): void {
  match.phase = 'settle';
  match.settleTime = 0.7;
}

function finishSettle(match: Match): void {
  if (match.pendingEnd) {
    conclude(match, match.pendingEnd);
    return;
  }
  advanceTurn(match);
}

function advanceTurn(match: Match): void {
  if (match.pendingEnd) {
    conclude(match, match.pendingEnd);
    return;
  }
  let guard = 0;
  do {
    if (match.team === 0) match.team = 1;
    else {
      match.team = 0;
      match.slot = (match.slot + 1) % match.wormsPerTeam;
    }
    guard += 1;
  } while (guard < 12 && !activeWorm(match));

  const worm = activeWorm(match);
  if (!worm) {
    checkWipe(match);
    conclude(match, match.pendingEnd ?? 'defeat');
    return;
  }

  match.phase = 'aim';
  match.projectiles = [];
  match.heli = null;
  match.timerMax = match.levelIndex === 0 ? 30 : 26;
  match.timer = match.timerMax;
  match.wind = (match.rng() * 2 - 1) * match.windMax;
  match.walkLeft = 4.2;
  match.aiStage = 'think';
  match.aiTimer = 0.5 + match.rng() * 0.4;
  match.aimPower = 0.62;
  match.weapon = worm.inTank ? 'tank' : 'bazooka';
  const foe = nearestFoe(match, worm);
  if (foe) {
    match.targetX = foe.x;
    match.aimAngle = foe.x >= worm.x ? 0.68 : Math.PI - 0.68;
    match.aimPower = 1;
  }
  applyFacing(match);
  match.banner = `${worm.name} joga`;
  match.bannerTime = 0.85;
  grantWorkshop(match, worm);
}

function conclude(match: Match, phase: Phase): void {
  match.phase = phase;
  match.pendingEnd = phase;
  if (phase === 'defeat') match.events.push({ type: 'lose' });
  else match.events.push({ type: 'win', text: phase });
}

function grantWorkshop(match: Match, worm: Worm): void {
  if (match.workshopUsed || worm.team !== 0 || worm.inTank) return;
  const shop = match.buildings.find((building) => building.alive && building.kind === 'workshop');
  if (!shop || Math.abs(worm.x - shop.x) > 1.55) return;
  match.workshopUsed = true;
  match.ammo[0].holy += 1;
  banner(match, 'Oficina: +1 Mão Sagrada', 1.4);
}

function nearestFoe(match: Match, worm: Worm): Worm | null {
  let best: Worm | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const other of match.worms) {
    if (!other.alive || other.team === worm.team) continue;
    const dist = Math.hypot(other.x - worm.x, other.y - worm.y);
    if (dist < bestDist) {
      best = other;
      bestDist = dist;
    }
  }
  return best;
}

function stepProjectiles(match: Match, dt: number): boolean {
  const kept: Projectile[] = [];
  for (const projectile of match.projectiles) {
    let alive = true;
    const slices = 4;
    const slice = dt / slices;
    for (let step = 0; step < slices && alive; step += 1) {
      projectile.vy -= 16.5 * slice;
      projectile.vx += match.wind * 3.1 * slice;
      projectile.x += projectile.vx * slice;
      projectile.y += projectile.vy * slice;
      projectile.fuse -= slice;
      projectile.age += slice;
      if (projectile.fuse <= 0) {
        explode(match, projectile);
        alive = false;
        break;
      }
      if (projectile.x < -2 || projectile.x > WORLD_W + 2 || projectile.y > WORLD_H + 3 || projectile.y < -2) {
        alive = false;
        break;
      }
      if (projectile.y <= WATER_Y && projectile.vy < 0 && surfaceY(match.solids, projectile.x) === null) {
        match.events.push({ type: 'splash', x: projectile.x, y: WATER_Y });
        alive = false;
        break;
      }
      if (hitSomething(match, projectile)) {
        if (projectile.bounce && projectile.fuse > 0.2 && Math.hypot(projectile.vx, projectile.vy) > 1.4) {
          projectile.x -= projectile.vx * slice;
          projectile.y -= projectile.vy * slice;
          projectile.vy = Math.abs(projectile.vy) * 0.46;
          projectile.vx *= 0.7;
          projectile.y += 0.12;
        } else {
          explode(match, projectile);
          alive = false;
        }
      }
    }
    if (alive) kept.push(projectile);
  }
  match.projectiles = kept;
  return kept.length > 0;
}

function hitSomething(match: Match, projectile: Projectile): boolean {
  if (isSolid(match.solids, projectile.x, projectile.y)) return true;
  for (const building of match.buildings) {
    if (!building.alive) continue;
    if (pointInRect(projectile.x, projectile.y, building)) return true;
  }
  if (match.tank.alive && Math.hypot(projectile.x - match.tank.x, projectile.y - (match.tank.y + 0.35)) < 0.7 + projectile.radius) {
    if (!(projectile.age < 0.18 && projectile.team === activeTeamOfTank(match))) return true;
  }
  if (projectile.age < 0.16) return false;
  for (const worm of match.worms) {
    if (!worm.alive || worm.inTank) continue;
    if (Math.hypot(projectile.x - worm.x, projectile.y - (worm.y + 0.4)) < 0.38 + projectile.radius) return true;
  }
  return false;
}

function activeTeamOfTank(match: Match): number {
  const rider = match.worms.find((worm) => worm.id === match.occupiedBy);
  return rider?.team ?? -1;
}

function pointInRect(x: number, y: number, building: Building): boolean {
  return x > building.x - building.w / 2 && x < building.x + building.w / 2 && y > building.y && y < building.y + building.h;
}

function explode(match: Match, projectile: Projectile): void {
  const craterScale = projectile.kind === 'donkey' ? 0.95 : projectile.kind === 'holy' ? 0.75 : 0.88;
  const crater = projectile.blast * craterScale;
  carveCircle(match.solids, projectile.x, projectile.y, crater);
  match.solidVersion += 1;
  match.blasts.push({ x: projectile.x, y: projectile.y, r: projectile.blast, age: 0, kind: projectile.kind });
  match.hitstop = projectile.kind === 'holy' || projectile.kind === 'donkey' ? 0.07 : 0.035;
  match.events.push({ type: 'explode', x: projectile.x, y: projectile.y, r: projectile.blast, kind: projectile.kind });

  for (const worm of match.worms) {
    if (!worm.alive || worm.inTank) continue;
    const dx = worm.x - projectile.x;
    const dy = worm.y + 0.4 - projectile.y;
    const distance = Math.hypot(dx, dy);
    if (distance > projectile.blast) continue;
    let damage = projectile.damage * (1 - distance / projectile.blast);
    if (inCover(match, worm)) damage *= 0.38;
    const push = (1 - distance / projectile.blast) * (projectile.kind === 'donkey' ? 8.5 : 5.5);
    worm.vx += (Math.abs(dx) < 0.05 ? (match.rng() > 0.5 ? 1 : -1) : Math.sign(dx)) * push;
    worm.vy += push * 0.8;
    hurt(match, worm, damage);
  }

  for (const building of match.buildings) {
    if (!building.alive) continue;
    const nearestX = clamp(projectile.x, building.x - building.w / 2, building.x + building.w / 2);
    const nearestY = clamp(projectile.y, building.y, building.y + building.h);
    if (Math.hypot(projectile.x - nearestX, projectile.y - nearestY) > projectile.blast) continue;
    building.hp -= projectile.damage * 0.9;
    if (building.hp <= 0) {
      building.alive = false;
      banner(match, building.kind === 'workshop' ? 'Oficina destruída' : 'Barracão destruído');
    }
  }

  if (match.tank.alive) {
    const distance = Math.hypot(match.tank.x - projectile.x, match.tank.y + 0.35 - projectile.y);
    if (distance < projectile.blast + 0.4) {
      match.tank.hp -= projectile.damage * (1 - Math.min(1, distance / projectile.blast));
      if (match.tank.hp <= 0) destroyTank(match);
    }
  }
}

function inCover(match: Match, worm: Worm): boolean {
  return match.buildings.some(
    (building) =>
      building.alive &&
      building.kind === 'bunker' &&
      worm.x > building.x - building.w * 0.42 &&
      worm.x < building.x + building.w * 0.42 &&
      worm.y < building.y + building.h * 0.85 &&
      worm.y >= building.y - 0.15,
  );
}

function destroyTank(match: Match): void {
  match.tank.alive = false;
  match.events.push({ type: 'explode', x: match.tank.x, y: match.tank.y + 0.4, r: 1.4, kind: 'tank' });
  const rider = match.worms.find((worm) => worm.id === match.occupiedBy);
  if (rider) {
    rider.inTank = false;
    rider.vy += 4;
    hurt(match, rider, 40);
  }
  match.occupiedBy = null;
}

function hurt(match: Match, worm: Worm, damage: number): void {
  if (!worm.alive || damage <= 0) return;
  worm.hp -= damage;
  match.events.push({ type: 'hurt', team: worm.team });
  if (worm.hp > 0) return;
  worm.hp = 0;
  worm.alive = false;
  worm.inTank = false;
  if (match.occupiedBy === worm.id) match.occupiedBy = null;
  if (worm.team === 1) match.killed += 1;
  match.events.push({ type: 'die', team: worm.team, text: worm.name });
  checkWipe(match);
}

function drown(match: Match, worm: Worm): void {
  if (!worm.alive) return;
  worm.alive = false;
  worm.hp = 0;
  worm.inTank = false;
  if (match.occupiedBy === worm.id) match.occupiedBy = null;
  if (worm.team === 1) match.killed += 1;
  match.events.push({ type: 'splash', x: worm.x, y: WATER_Y });
  match.events.push({ type: 'die', team: worm.team, text: worm.name });
  checkWipe(match);
}

function checkWipe(match: Match): void {
  const players = match.worms.some((worm) => worm.alive && worm.team === 0);
  const enemies = match.worms.some((worm) => worm.alive && worm.team === 1);
  if (!players) match.pendingEnd = 'defeat';
  else if (!enemies) match.pendingEnd = match.levelIndex >= 1 ? 'victory' : 'levelclear';
}

function stepWorms(match: Match, dt: number): boolean {
  let moving = false;
  for (const worm of match.worms) {
    if (!worm.alive || worm.inTank) continue;
    const ground = groundNear(match.solids, worm.x, worm.y, 0.3);
    const supported = ground !== null && worm.y <= ground + 0.08 && worm.vy <= 0;
    if (!supported) {
      if (worm.fallStart === null) worm.fallStart = worm.y;
      worm.vy -= 22 * dt;
      worm.x += worm.vx * dt;
      worm.y += worm.vy * dt;
      worm.vx *= Math.exp(-2.4 * dt);
      const landed = groundNear(match.solids, worm.x, worm.y, 0.3);
      if (landed !== null && worm.vy <= 0 && worm.y <= landed) {
        const drop = (worm.fallStart ?? worm.y) - landed;
        worm.y = landed;
        worm.vy = 0;
        worm.vx *= 0.45;
        worm.fallStart = null;
        if (drop > 2.5) hurt(match, worm, (drop - 2.5) * 15);
      } else if (worm.y < WATER_Y - 0.05 && landed === null) {
        drown(match, worm);
      }
      moving = true;
    } else if (ground !== null) {
      worm.y = ground;
      worm.vy = 0;
      worm.fallStart = null;
      if (Math.abs(worm.vx) > 0.25) {
        const slideTo = worm.x + worm.vx * dt;
        const slideGround = groundNear(match.solids, slideTo, worm.y, 0.6);
        if (slideGround !== null && slideGround - worm.y > 0.6) {
          worm.vx = 0;
          continue;
        }
        worm.x = slideTo;
        worm.vx *= Math.exp(-6 * dt);
        moving = true;
      } else {
        worm.vx = 0;
      }
    }
    worm.x = clamp(worm.x, 0.3, WORLD_W - 0.3);
  }

  if (match.tank.alive) {
    const ground = groundNear(match.solids, match.tank.x, match.tank.y, 0.3);
    if (ground === null || ground < match.tank.y - 0.05) {
      match.tank.y = Math.max(ground ?? Number.NEGATIVE_INFINITY, match.tank.y - 7 * dt);
      moving = true;
      if (ground === null && match.tank.y < WATER_Y) destroyTank(match);
    } else {
      match.tank.y = ground;
    }
    const rider = match.worms.find((worm) => worm.id === match.occupiedBy && worm.inTank);
    if (rider) {
      rider.x = match.tank.x;
      rider.y = match.tank.y + 0.4;
    }
  }
  return moving;
}

function ageBlasts(match: Match, dt: number): void {
  for (const blast of match.blasts) blast.age += dt;
  match.blasts = match.blasts.filter((blast) => blast.age < 0.48);
}
