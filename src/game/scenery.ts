import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';
import { CELL, COLS, ROWS, WORLD_H, WORLD_W } from './terrain';

/** World units covered by one repeat of the painted rock tile. */
const ROCK_TILE = 12;
const MASK_W = COLS + 2;
const MASK_H = ROWS + 2;

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível');
  return [canvas, context];
}

function pillowPath(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): void {
  const steps = 44;
  context.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ex = Math.sign(c) * Math.abs(c) ** 0.72;
    const ey = Math.sign(s) * Math.abs(s) ** 0.72;
    const wobble = 1 + 0.05 * Math.sin(angle * 3 + seed) + 0.03 * Math.sin(angle * 5 + seed * 1.7);
    const x = cx + ex * rx * wobble;
    const y = cy + ey * ry * wobble;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/**
 * Seamless tile of chunky cel-shaded rock "pillows" with dark ink crevices,
 * in the hand-painted style of the reference.
 */
export function createRockTexture(size = 1024): THREE.CanvasTexture {
  const [canvas, context] = canvas2d(size, size);
  const rand = createSeededRandom(4242);
  const ppu = size / ROCK_TILE;
  context.fillStyle = '#4c1d0b';
  context.fillRect(0, 0, size, size);

  const rows = 4;
  const rowH = size / rows;
  const pillows: Array<{ x: number; y: number; rx: number; ry: number; hue: number; seed: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const count = 3 + Math.floor(rand() * 2);
    const weights = Array.from({ length: count }, () => 0.75 + rand() * 0.6);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let x = rand() * size;
    for (const weight of weights) {
      const w = (weight / total) * size;
      pillows.push({
        x: x + w / 2,
        y: row * rowH + rowH / 2 + (rand() - 0.5) * rowH * 0.16,
        rx: w * 0.53,
        ry: rowH * (0.55 + rand() * 0.06),
        hue: 24 + rand() * 12,
        seed: rand() * 10,
      });
      x += w;
    }
  }

  const ink = '#3a1306';
  for (const p of pillows) {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const cx = p.x + dx;
        const cy = p.y + dy;
        if (cx + p.rx < -20 || cx - p.rx > size + 20 || cy + p.ry < -20 || cy - p.ry > size + 20) continue;
        context.save();
        pillowPath(context, cx, cy, p.rx, p.ry, p.seed);
        context.lineJoin = 'round';
        context.lineWidth = ppu * 0.2;
        context.strokeStyle = ink;
        context.stroke();
        context.fillStyle = `hsl(${p.hue - 4}, 62%, 29%)`;
        context.fill();
        context.clip();
        pillowPath(context, cx - p.rx * 0.07, cy - p.ry * 0.1, p.rx * 0.96, p.ry * 0.92, p.seed);
        context.fillStyle = `hsl(${p.hue}, 72%, 42%)`;
        context.fill();
        pillowPath(context, cx - p.rx * 0.16, cy - p.ry * 0.2, p.rx * 0.8, p.ry * 0.72, p.seed + 1.3);
        const light = context.createLinearGradient(cx - p.rx, cy - p.ry, cx + p.rx * 0.4, cy + p.ry * 0.5);
        light.addColorStop(0, `hsl(${p.hue + 6}, 88%, 62%)`);
        light.addColorStop(1, `hsl(${p.hue + 2}, 82%, 52%)`);
        context.fillStyle = light;
        context.fill();
        context.lineCap = 'round';
        context.strokeStyle = 'rgba(255, 228, 170, 0.55)';
        context.lineWidth = ppu * 0.09;
        context.beginPath();
        context.ellipse(cx - p.rx * 0.12, cy - p.ry * 0.12, p.rx * 0.62, p.ry * 0.58, 0, Math.PI * 1.08, Math.PI * 1.42);
        context.stroke();
        context.fillStyle = 'rgba(70, 22, 6, 0.28)';
        for (let i = 0; i < 5; i += 1) {
          const a = p.seed * 3 + i * 1.9;
          const r = 0.25 + ((i * 37) % 10) / 20;
          context.beginPath();
          context.ellipse(cx + Math.cos(a) * p.rx * r, cy + Math.sin(a) * p.ry * r, ppu * 0.07, ppu * 0.05, a, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
        context.save();
        pillowPath(context, cx, cy, p.rx, p.ry, p.seed);
        context.lineWidth = ppu * 0.08;
        context.strokeStyle = ink;
        context.stroke();
        context.restore();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const terrainVertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const terrainFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform sampler2D uRock;
  uniform vec3 uSoot;
  uniform vec2 uTexel;
  uniform float uCell;
  uniform float uTile;
  uniform float uOutline;
  uniform float uCrust;
  uniform vec3 uInk;
  uniform vec3 uSand;
  uniform vec3 uSandLight;
  uniform vec3 uSandDark;
  varying vec2 vWorld;

  vec2 field(vec2 w) { return texture2D(uMask, (w / uCell + 1.0) * uTexel).rg; }
  float inside(float v, float k) { return smoothstep(0.5 - k, 0.5 + k, v); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec2 w = vWorld;
    float c = field(w).r;
    float k = max(fwidth(c) * 0.75, 0.004);
    float alpha = inside(c, k);
    if (alpha < 0.01) discard;

    float ring = 1.0;
    float ring2 = 1.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      vec2 d = vec2(cos(a), sin(a));
      ring = min(ring, field(w + d * uOutline).r);
      ring2 = min(ring2, field(w + d * uOutline * 3.2).r);
    }
    float edge = 1.0 - inside(ring, max(fwidth(ring) * 0.75, 0.004));
    float rim = 1.0 - smoothstep(0.15, 0.75, ring2);

    float wave = 0.85 + 0.15 * sin(w.x * 2.1) * sin(w.x * 0.7 + 1.7) + 0.08 * sin(w.x * 6.3);
    float crustH = uCrust * wave;
    vec2 top = field(w + vec2(0.0, crustH));
    vec2 topLine = field(w + vec2(0.0, crustH + uOutline * 0.75));
    vec2 topHi = field(w + vec2(0.0, crustH * 0.45));
    float crust = (1.0 - inside(top.r, 0.07)) * (1.0 - inside(top.g, 0.07));
    float crustOuter = (1.0 - inside(topLine.r, 0.07)) * (1.0 - inside(topLine.g, 0.07));
    float crustHi = 1.0 - inside(topHi.g, 0.07);
    float crustLine = clamp(crustOuter - crust, 0.0, 1.0);

    vec3 rock = texture2D(uRock, w / uTile).rgb;
    float n = noise(w * 0.3);
    rock *= 0.88 + 0.22 * n;
    rock *= mix(1.0, 0.6, rim * (1.0 - crustOuter));

    vec3 sand = mix(uSand, uSandLight, crustHi);
    float speck = step(0.9, hash(floor(w * 10.0)));
    sand = mix(sand, uSandDark, speck * 0.7);
    vec3 color = mix(rock, sand, crust);
    float soot = texture2D(uMask, (w / uCell + 1.0) * uTexel).b;
    soot *= 0.6 + 0.4 * noise(w * 2.2);
    color = mix(color, uSoot, smoothstep(0.0, 0.75, soot) * 0.92);
    color = mix(color, uInk, crustLine * 0.95);
    color = mix(color, uInk, edge);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Smooth painted terrain rendered on a single quad. A small RG mask texture
 * (R = current solids, G = original solids) is rebuilt only when the grid changes.
 */
export class TerrainView {
  readonly mesh: THREE.Mesh;
  private readonly data = new Uint8Array(MASK_W * MASK_H * 4);
  private readonly mask: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly padded = new Uint8Array(MASK_W * MASK_H);
  private original: Uint8Array | null = null;

  constructor(rock: THREE.Texture) {
    this.mask = new THREE.DataTexture(this.data, MASK_W, MASK_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.mask.unpackAlignment = 1;
    this.mask.magFilter = THREE.LinearFilter;
    this.mask.minFilter = THREE.LinearFilter;
    this.mask.generateMipmaps = false;
    this.mask.wrapS = THREE.ClampToEdgeWrapping;
    this.mask.wrapT = THREE.ClampToEdgeWrapping;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.mask },
        uSoot: { value: new THREE.Color('#24100a') },
        uRock: { value: rock },
        uTexel: { value: new THREE.Vector2(1 / MASK_W, 1 / MASK_H) },
        uCell: { value: CELL },
        uTile: { value: ROCK_TILE },
        uOutline: { value: 0.14 },
        uCrust: { value: 0.55 },
        uInk: { value: new THREE.Color('#2a0f06') },
        uSand: { value: new THREE.Color('#ecc98a') },
        uSandLight: { value: new THREE.Color('#fbe6b8') },
        uSandDark: { value: new THREE.Color('#c79a5a') },
      },
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      transparent: true,
      depthWrite: true,
    });
    // Extends below y = 0 so the clamped bottom row keeps the rock going under the water.
    const below = 10;
    const geometry = new THREE.PlaneGeometry(WORLD_W + CELL * 2, WORLD_H + CELL + below);
    geometry.translate(WORLD_W / 2, (WORLD_H + CELL - below) / 2, 0);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.z = 0.5;
    this.mesh.name = 'terrain';
  }

  /** Call when a new level is mounted so the crust follows only the original surface. */
  reset(solids: Uint8Array): void {
    this.original = solids.slice();
    this.update(solids, []);
  }

  update(solids: Uint8Array, scorches: ReadonlyArray<{ x: number; y: number; r: number }>): void {
    const original = this.original ?? solids;
    this.blurInto(solids, 0);
    this.blurInto(original, 1);
    this.paintScorches(scorches);
    this.mask.needsUpdate = true;
  }

  private paintScorches(scorches: ReadonlyArray<{ x: number; y: number; r: number }>): void {
    const data = this.data;
    for (let index = 2; index < data.length; index += 4) data[index] = 0;
    const band = 2.1;
    for (const s of scorches) {
      const reach = s.r + band;
      const minI = Math.max(0, Math.floor(s.x / CELL - reach / CELL) + 1);
      const maxI = Math.min(MASK_W - 1, Math.ceil(s.x / CELL + reach / CELL) + 1);
      const minJ = Math.max(0, Math.floor(s.y / CELL - reach / CELL) + 1);
      const maxJ = Math.min(MASK_H - 1, Math.ceil(s.y / CELL + reach / CELL) + 1);
      for (let j = minJ; j <= maxJ; j += 1) {
        const y = (j - 0.5) * CELL;
        for (let i = minI; i <= maxI; i += 1) {
          const x = (i - 0.5) * CELL;
          const d = Math.hypot(x - s.x, y - s.y) - s.r;
          if (d > band) continue;
          const t = d <= 0 ? 1 : 1 - d / band;
          const value = Math.round(Math.pow(t, 1.15) * 255);
          const index = (j * MASK_W + i) * 4 + 2;
          if (value > data[index]) data[index] = value;
        }
      }
    }
  }

  private blurInto(solids: Uint8Array, channel: number): void {
    const padded = this.padded;
    padded.fill(0);
    for (let row = 0; row < ROWS; row += 1) {
      const src = row * COLS;
      const dst = (row + 1) * MASK_W + 1;
      for (let col = 0; col < COLS; col += 1) padded[dst + col] = solids[src + col];
    }
    for (let col = 1; col <= COLS; col += 1) padded[col] = padded[MASK_W + col];
    const data = this.data;
    for (let j = 0; j < MASK_H; j += 1) {
      for (let i = 0; i < MASK_W; i += 1) {
        const center = padded[j * MASK_W + i] * 4;
        const left = i > 0 ? padded[j * MASK_W + i - 1] : 0;
        const right = i < MASK_W - 1 ? padded[j * MASK_W + i + 1] : 0;
        const down = j > 0 ? padded[(j - 1) * MASK_W + i] : padded[j * MASK_W + i];
        const up = j < MASK_H - 1 ? padded[(j + 1) * MASK_W + i] : 0;
        data[(j * MASK_W + i) * 4 + channel] = Math.round(((center + left + right + up + down) / 8) * 255);
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mask.dispose();
  }
}
