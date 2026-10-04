import { expect, test } from '@playwright/test';
import {
  activeWorm,
  createMatch,
  exitTank,
  openBattle,
  playerEndTurn,
  selectWeapon,
  stepMatch,
  tryFire,
  walkOrDrive,
} from '../src/game/match';
import { carveCircle, surfaceY, WATER_Y, WORLD_W } from '../src/game/terrain';
import type { Match } from '../src/game/types';
import { createSeededRandom } from '../src/utils/random';

const DT = 1 / 60;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'pure simulation, one project is enough');
});

function battle(level: number, seed = 1): Match {
  const match = createMatch(level, createSeededRandom(seed), 'aim');
  openBattle(match);
  match.bannerTime = 0;
  return match;
}

function walk(match: Match, dir: number, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    walkOrDrive(match, dir, DT);
    stepMatch(match, DT);
  }
}

function run(match: Match, seconds: number, until?: (m: Match) => boolean): void {
  for (let t = 0; t < seconds; t += DT) {
    stepMatch(match, DT);
    if (until?.(match)) return;
  }
}

for (const level of [0, 1]) {
  test(`nível ${level + 1}: a primeira minhoca anda para os dois lados`, () => {
    const match = battle(level);
    const worm = activeWorm(match)!;
    const start = worm.x;
    walk(match, 1, 0.6);
    expect(worm.x).toBeGreaterThan(start + 0.8);
    const mid = worm.x;
    walk(match, -1, 0.6);
    expect(worm.x).toBeLessThan(mid - 0.8);
    expect(match.walkLeft).toBeLessThan(4.2);
    expect(worm.alive).toBe(true);
  });
}

for (const level of [0, 1]) {
  test(`nível ${level + 1}: nenhuma minhoca nasce dentro de prédio, no tanque ou em outra minhoca`, () => {
    for (const seed of [1, 2, 7, 42, 998]) {
      const match = createMatch(level, createSeededRandom(seed), 'aim');
      for (const worm of match.worms) {
        for (const building of match.buildings) {
          expect(Math.abs(worm.x - building.x), `${worm.name} × ${building.id} (seed ${seed})`).toBeGreaterThanOrEqual(building.w / 2);
        }
        expect(Math.abs(worm.x - match.tank.x), `${worm.name} × tanque (seed ${seed})`).toBeGreaterThan(1);
        for (const other of match.worms) {
          if (other !== worm) expect(Math.abs(worm.x - other.x), `${worm.name} × ${other.name}`).toBeGreaterThan(0.8);
        }
        const ownSide = worm.team === 0 ? worm.x < WORLD_W / 2 : worm.x > WORLD_W / 2;
        expect(ownSide, `${worm.name} no próprio lado`).toBe(true);
        expect(worm.y).toBeGreaterThan(WATER_Y);
      }
    }
  });
}

test('andar gasta o fôlego do turno e para quando acaba', () => {
  const match = battle(0);
  const worm = activeWorm(match)!;
  walk(match, 1, 0.3);
  walk(match, -1, 0.3);
  walk(match, 1, 0.3);
  walk(match, -1, 0.3);
  match.walkLeft = 0;
  const x = worm.x;
  walk(match, 1, 0.5);
  expect(worm.x).toBe(x);
  expect(worm.face).toBe(1);
});

test('dentro de um túnel a minhoca pisa no chão, não no teto', () => {
  const match = battle(0);
  const worm = activeWorm(match)!;
  const top = surfaceY(match.solids, worm.x)!;
  for (let dx = -1.6; dx <= 1.6; dx += 0.2) carveCircle(match.solids, worm.x + dx, top - 1.4, 0.55);
  match.solidVersion += 1;
  worm.y = top - 1.7;
  run(match, 1.2);
  expect(worm.y).toBeLessThan(top - 1);
  const floor = worm.y;
  const start = worm.x;
  walk(match, 1, 0.4);
  expect(worm.x).toBeGreaterThan(start + 0.5);
  expect(Math.abs(worm.y - floor)).toBeLessThan(0.5);
  expect(worm.y).toBeLessThan(top - 1);
});

test('andar para dentro de uma cratera funda faz a minhoca cair', () => {
  const match = battle(0);
  const worm = activeWorm(match)!;
  const top = worm.y;
  carveCircle(match.solids, worm.x + 1.4, top, 1.3);
  match.solidVersion += 1;
  walk(match, 1, 0.9);
  run(match, 1.5);
  expect(worm.alive).toBe(true);
  expect(worm.y).toBeLessThan(top - 0.9);
  expect(worm.fallStart).toBeNull();
});

test('passar o turno roda a IA e devolve a vez ao jogador', () => {
  const match = battle(0, 7);
  playerEndTurn(match);
  expect(match.team).toBe(1);
  run(match, 25, (m) => m.phase === 'aim' && m.team === 0);
  const backToPlayer = match.phase === 'aim' && match.team === 0;
  expect(backToPlayer || match.pendingEnd !== null).toBe(true);
});

test('bazuca acerta o inimigo, abre cratera e tira vida', () => {
  const match = battle(0);
  const enemy = match.worms.find((worm) => worm.team === 1)!;
  const version = match.solidVersion;
  expect(tryFire(match)).toBe(true);
  match.projectiles[0].x = enemy.x;
  match.projectiles[0].y = enemy.y + 1.2;
  match.projectiles[0].vx = 0;
  match.projectiles[0].vy = -4;
  match.projectiles[0].age = 1;
  run(match, 4, (m) => m.phase === 'aim');
  expect(enemy.hp).toBeLessThan(100);
  expect(match.solidVersion).toBeGreaterThan(version);
});

test('tanque: entra perto, anda e sai', () => {
  const match = battle(0);
  const worm = activeWorm(match)!;
  worm.x = match.tank.x - 0.6;
  worm.y = surfaceY(match.solids, worm.x)!;
  expect(selectWeapon(match, 'tank')).toBe(true);
  expect(worm.inTank).toBe(true);
  const tankX = match.tank.x;
  walk(match, -1, 0.3);
  expect(match.tank.x).toBeLessThan(tankX - 0.5);
  expect(worm.x).toBeCloseTo(match.tank.x);
  exitTank(match);
  expect(worm.inTank).toBe(false);
  expect(match.weapon).toBe('bazooka');
  expect(Math.abs(worm.x - match.tank.x)).toBeGreaterThan(0.9);
});

test('campanha: limpar o nível 1 leva ao nível 2 e limpar o 2 vence', () => {
  for (const level of [0, 1]) {
    const match = battle(level);
    for (const worm of match.worms) if (worm.team === 1) worm.hp = 1;
    const enemy = match.worms.find((worm) => worm.team === 1)!;
    expect(tryFire(match)).toBe(true);
    match.projectiles[0].x = enemy.x;
    match.projectiles[0].y = enemy.y + 1;
    match.projectiles[0].vx = 0;
    match.projectiles[0].vy = -4;
    match.projectiles[0].age = 1;
    for (const worm of match.worms) if (worm.team === 1 && worm !== enemy) worm.alive = false;
    run(match, 12, (m) => m.phase === 'levelclear' || m.phase === 'victory');
    expect(match.phase).toBe(level === 0 ? 'levelclear' : 'victory');
  }
});
