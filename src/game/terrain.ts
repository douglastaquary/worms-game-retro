export const COLS = 200;
export const ROWS = 100;
export const CELL = 0.2;
export const WORLD_W = COLS * CELL;
export const WORLD_H = ROWS * CELL;
export const WATER_Y = 3.15;
export const DEPTH = 1.2;

export function index(x: number, y: number): number {
  return y * COLS + x;
}

export function columnAt(x: number): number {
  return Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
}

export function rowAt(y: number): number {
  return Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
}

export function isSolid(solids: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
  return solids[index(columnAt(x), rowAt(y))] === 1;
}

export function surfaceY(solids: Uint8Array, x: number): number | null {
  const col = columnAt(x);
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (solids[index(col, row)] === 1) return (row + 1) * CELL;
  }
  return null;
}

/**
 * Top of the ground that supports something standing at (x, y), looking at
 * most `reach` above the feet. Unlike surfaceY it ignores overhangs, so worms
 * inside craters and tunnels stand on the floor instead of the ceiling.
 */
export function groundNear(solids: Uint8Array, x: number, y: number, reach: number): number | null {
  if (x < 0 || x >= WORLD_W || y + reach < 0) return null;
  const col = columnAt(x);
  let row = rowAt(y + reach);
  if (solids[index(col, row)] === 1) {
    while (row < ROWS - 1 && solids[index(col, row + 1)] === 1) row += 1;
    return (row + 1) * CELL;
  }
  for (; row >= 0; row -= 1) {
    if (solids[index(col, row)] === 1) return (row + 1) * CELL;
  }
  return null;
}

export function carveCircle(solids: Uint8Array, cx: number, cy: number, radius: number): void {
  const r2 = radius * radius;
  const minC = columnAt(cx - radius);
  const maxC = columnAt(cx + radius);
  const minR = rowAt(cy - radius);
  const maxR = rowAt(cy + radius);
  for (let row = minR; row <= maxR; row += 1) {
    for (let col = minC; col <= maxC; col += 1) {
      const x = (col + 0.5) * CELL;
      const y = (row + 0.5) * CELL;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) solids[index(col, row)] = 0;
    }
  }
}

function smooth(heights: Float32Array): void {
  const copy = heights.slice();
  for (let i = 1; i < heights.length - 1; i += 1) {
    heights[i] = copy[i - 1] * 0.25 + copy[i] * 0.5 + copy[i + 1] * 0.25;
  }
}

function fillColumn(solids: Uint8Array, col: number, top: number): void {
  const waterRow = rowAt(WATER_Y);
  if (top <= waterRow) return;
  for (let row = 0; row <= top; row += 1) solids[index(col, row)] = 1;
}

export function rasterHeights(heights: Float32Array): Uint8Array {
  const solids = new Uint8Array(COLS * ROWS);
  for (let col = 0; col < COLS; col += 1) {
    const top = Math.max(0, Math.min(ROWS - 2, Math.floor(heights[col] * (ROWS - 1))));
    fillColumn(solids, col, top);
  }
  return solids;
}

export function plateau(heights: Float32Array, fromNx: number, toNx: number, height: number): void {
  const a = Math.floor(fromNx * (COLS - 1));
  const b = Math.floor(toNx * (COLS - 1));
  for (let i = a; i <= b; i += 1) heights[i] = height;
}

export function buildHeights(levelIndex: number, rng: () => number): Float32Array {
  const heights = new Float32Array(COLS);
  for (let col = 0; col < COLS; col += 1) {
    const nx = col / (COLS - 1);
    if (levelIndex === 0) {
      let h = 0.34 + Math.sin(nx * Math.PI) * 0.08;
      h += Math.exp(-((nx - 0.16) ** 2) / 0.012) * 0.16;
      h += Math.exp(-((nx - 0.82) ** 2) / 0.01) * 0.2;
      h -= Math.exp(-((nx - 0.5) ** 2) / 0.008) * 0.28;
      heights[col] = h;
    } else {
      let h = 0.3 + nx * 0.18;
      h += Math.exp(-((nx - 0.46) ** 2) / 0.004) * 0.28;
      h -= Math.exp(-((nx - 0.6) ** 2) / 0.003) * 0.34;
      h += Math.sin(nx * 14) * 0.015;
      heights[col] = h;
    }
  }
  if (levelIndex === 0) {
    plateau(heights, 0.05, 0.28, 0.5);
    plateau(heights, 0.44, 0.56, 0.1);
    plateau(heights, 0.68, 0.94, 0.56);
  } else {
    plateau(heights, 0.04, 0.2, 0.36);
    plateau(heights, 0.26, 0.34, 0.5);
    plateau(heights, 0.4, 0.52, 0.66);
    plateau(heights, 0.56, 0.64, 0.08);
    plateau(heights, 0.7, 0.96, 0.74);
    const rampA = Math.floor(0.33 * (COLS - 1));
    const rampB = Math.floor(0.42 * (COLS - 1));
    for (let col = rampA; col <= rampB; col += 1) {
      const t = (col - rampA) / Math.max(1, rampB - rampA);
      heights[col] = 0.36 + t * 0.3;
    }
  }
  smooth(heights);
  for (let n = 0; n < 6; n += 1) {
    const col = 8 + Math.floor(rng() * (COLS - 16));
    heights[col] = Math.max(0.08, heights[col] - 0.03);
  }
  return heights;
}

export function findStand(solids: Uint8Array, nx: number): { x: number; y: number } {
  const prefer = nx * WORLD_W;
  for (let delta = 0; delta < WORLD_W; delta += CELL) {
    for (const x of [prefer + delta, prefer - delta]) {
      if (x < CELL || x > WORLD_W - CELL) continue;
      const y = surfaceY(solids, x);
      if (y !== null && y > WATER_Y + 0.4) return { x, y };
    }
  }
  return { x: prefer, y: WATER_Y + 1 };
}
