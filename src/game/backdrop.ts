import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';
import { WATER_Y, WORLD_W } from './terrain';

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível');
  return [canvas, context];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paintSky(): THREE.CanvasTexture {
  const [canvas, context] = canvas2d(256, 512);
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#45081f');
  gradient.addColorStop(0.32, '#8e1838');
  gradient.addColorStop(0.68, '#c92f47');
  gradient.addColorStop(1, '#e8535a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 512);
  const rand = createSeededRandom(17);
  for (let i = 0; i < 14; i += 1) {
    const y = 40 + rand() * 340;
    context.fillStyle = `rgba(${rand() > 0.5 ? '255, 120, 130' : '90, 10, 40'}, ${0.06 + rand() * 0.07})`;
    context.beginPath();
    context.ellipse(rand() * 256, y, 60 + rand() * 120, 6 + rand() * 10, 0, 0, Math.PI * 2);
    context.fill();
  }
  return toTexture(canvas);
}

/** Volcano, smoke plume, glow and distant ridges on a transparent canvas (64 x 32 world units). */
function paintVolcano(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [canvas, context] = canvas2d(W, H);
  const rand = createSeededRandom(99);
  const glow = context.createRadialGradient(512, 250, 20, 512, 250, 420);
  glow.addColorStop(0, 'rgba(255, 170, 110, 0.6)');
  glow.addColorStop(0.35, 'rgba(255, 100, 90, 0.3)');
  glow.addColorStop(1, 'rgba(255, 80, 90, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, W, H);

  // Smoke plume: overlapping puffs rising and leaning right.
  const puffs: Array<[number, number, number]> = [];
  for (let i = 0; i < 26; i += 1) {
    const t = i / 25;
    puffs.push([512 + Math.sin(t * 3.2) * 30 + t * t * 160, 215 - t * 225, 26 + t * 95 + rand() * 18]);
  }
  for (const [x, y, r] of puffs) {
    context.fillStyle = '#4a0f22';
    context.beginPath();
    context.arc(x + 6, y + 6, r + 4, 0, Math.PI * 2);
    context.fill();
  }
  for (const [x, y, r] of puffs) {
    context.fillStyle = '#7a1e36';
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
  for (const [x, y, r] of puffs) {
    context.fillStyle = 'rgba(176, 64, 84, 0.75)';
    context.beginPath();
    context.arc(x - r * 0.28, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
    context.fill();
  }

  // Distant ridges.
  const ridge = (base: number, amp: number, color: string, seed: number) => {
    context.fillStyle = color;
    context.strokeStyle = '#3d0b1c';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      const y = base - Math.abs(Math.sin(x * 0.006 + seed)) * amp - Math.sin(x * 0.021 + seed * 2) * amp * 0.25;
      context.lineTo(x, y);
    }
    context.lineTo(W, H);
    context.closePath();
    context.fill();
    context.stroke();
  };
  ridge(430, 70, '#8c2340', 1.2);

  // Volcano cone with concave flanks.
  context.beginPath();
  context.moveTo(150, H);
  context.bezierCurveTo(330, 420, 420, 320, 455, 222);
  context.lineTo(470, 214);
  context.quadraticCurveTo(512, 230, 556, 212);
  context.lineTo(574, 222);
  context.bezierCurveTo(610, 320, 700, 420, 880, H);
  context.closePath();
  const cone = context.createLinearGradient(0, 210, 0, H);
  cone.addColorStop(0, '#7a2232');
  cone.addColorStop(1, '#4e1024');
  context.fillStyle = cone;
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = '#2e0814';
  context.stroke();
  context.save();
  context.clip();
  context.fillStyle = 'rgba(160, 60, 70, 0.55)';
  context.beginPath();
  context.moveTo(455, 222);
  context.bezierCurveTo(430, 320, 360, 420, 220, H);
  context.lineTo(330, H);
  context.bezierCurveTo(420, 420, 470, 320, 490, 226);
  context.closePath();
  context.fill();
  // Lava streaks.
  const streaks: Array<Array<[number, number]>> = [
    [[480, 222], [470, 280], [488, 340], [462, 420], [470, 512]],
    [[520, 226], [534, 300], [516, 360], [540, 450]],
    [[552, 220], [580, 290], [600, 350], [640, 430], [660, 512]],
  ];
  for (const path of streaks) {
    context.shadowColor = 'rgba(255, 120, 40, 0.6)';
    context.shadowBlur = 12;
    context.strokeStyle = '#e8601e';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    path.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = '#ffb24a';
    context.lineWidth = 2.5;
    context.stroke();
  }
  context.restore();
  const lip = context.createRadialGradient(512, 220, 4, 512, 220, 70);
  lip.addColorStop(0, 'rgba(255, 240, 160, 1)');
  lip.addColorStop(0.4, 'rgba(255, 150, 60, 0.85)');
  lip.addColorStop(1, 'rgba(255, 90, 60, 0)');
  context.fillStyle = lip;
  context.beginPath();
  context.ellipse(512, 220, 70, 30, 0, 0, Math.PI * 2);
  context.fill();

  ridge(492, 40, '#6e1830', 3.7);
  return toTexture(canvas);
}

/** A row of carved stone tiki faces and rock spires (48 x 12 world units). */
function paintTikis(): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const [canvas, context] = canvas2d(W, H);
  const rand = createSeededRandom(321);
  const ink = '#33091a';
  context.lineJoin = 'round';

  const face = (cx: number, width: number, height: number, tone: number) => {
    const top = H - height;
    const x0 = cx - width / 2;
    context.save();
    context.beginPath();
    context.moveTo(x0, H + 4);
    context.lineTo(x0 + width * 0.04, top + width * 0.28);
    context.quadraticCurveTo(cx, top - width * 0.18, x0 + width * 0.96, top + width * 0.28);
    context.lineTo(x0 + width, H + 4);
    context.closePath();
    const body = context.createLinearGradient(x0, 0, x0 + width, 0);
    body.addColorStop(0, `hsl(${348 + tone}, 46%, 46%)`);
    body.addColorStop(0.6, `hsl(${346 + tone}, 48%, 38%)`);
    body.addColorStop(1, `hsl(${344 + tone}, 52%, 26%)`);
    context.fillStyle = body;
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = ink;
    context.stroke();
    context.clip();
    const u = width;
    const browY = top + height * 0.24;
    context.fillStyle = 'rgba(40, 4, 18, 0.35)';
    context.beginPath();
    context.ellipse(cx - u * 0.02, browY + height * 0.06, u * 0.48, height * 0.075, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(40, 4, 18, 0.22)';
    context.fillRect(x0 + width * 0.78, top, width * 0.22, height);
    context.fillStyle = `hsl(${350 + tone}, 44%, 54%)`;
    context.beginPath();
    context.ellipse(cx - u * 0.04, browY, u * 0.46, height * 0.06, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#3e0c20';
    for (const side of [-1, 1]) {
      context.beginPath();
      context.ellipse(cx + side * u * 0.22, browY + height * 0.11, u * 0.14, height * 0.075, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255, 150, 100, 0.55)';
      context.beginPath();
      context.arc(cx + side * u * 0.22, browY + height * 0.115, u * 0.035, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#3e0c20';
    }
    context.fillStyle = `hsl(${350 + tone}, 44%, 50%)`;
    context.beginPath();
    context.moveTo(cx, browY + height * 0.08);
    context.lineTo(cx - u * 0.12, browY + height * 0.36);
    context.lineTo(cx + u * 0.12, browY + height * 0.36);
    context.closePath();
    context.fill();
    context.strokeStyle = ink;
    context.lineWidth = 2.5;
    context.stroke();
    const mouthY = browY + height * 0.46;
    context.fillStyle = '#2a0614';
    context.beginPath();
    context.ellipse(cx, mouthY, u * 0.34, height * 0.1, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f0b9a8';
    const teeth = 5;
    for (let i = 0; i < teeth; i += 1) {
      const tx = cx - u * 0.26 + (i / (teeth - 1)) * u * 0.52;
      context.fillRect(tx - u * 0.035, mouthY - height * 0.07, u * 0.06, height * 0.055);
      context.fillRect(tx - u * 0.035, mouthY + height * 0.018, u * 0.06, height * 0.05);
    }
    context.restore();
  };

  const spire = (cx: number, width: number, height: number) => {
    context.beginPath();
    context.moveTo(cx - width / 2, H + 4);
    context.quadraticCurveTo(cx - width * 0.3, H - height * 0.6, cx - width * 0.05, H - height);
    context.quadraticCurveTo(cx + width * 0.35, H - height * 0.5, cx + width / 2, H + 4);
    context.closePath();
    context.fillStyle = '#6a1a34';
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = ink;
    context.stroke();
  };

  let x = 30;
  let index = 0;
  while (x < W + 60) {
    if (index % 3 === 2) {
      const width = 50 + rand() * 40;
      spire(x + width / 2, width, 140 + rand() * 90);
      x += width * 0.8;
    } else {
      const width = 96 + rand() * 50;
      face(x + width / 2, width, 150 + rand() * 90, (rand() - 0.5) * 10);
      x += width * 0.92;
    }
    index += 1;
  }
  context.fillStyle = '#4e1028';
  context.strokeStyle = ink;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, H);
  for (let px = 0; px <= W; px += 32) context.lineTo(px, H - 34 - Math.sin(px * 0.03) * 10 - (px % 64 === 0 ? 8 : 0));
  context.lineTo(W, H);
  context.closePath();
  context.fill();
  context.stroke();
  return toTexture(canvas);
}

function emberSprite(): THREE.CanvasTexture {
  const [canvas, context] = canvas2d(64, 64);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 250, 210, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 200, 90, 0.95)');
  gradient.addColorStop(0.6, 'rgba(255, 110, 40, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 80, 30, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return toTexture(canvas);
}

const waterVertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const waterFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uPhase;
  uniform float uOpacity;
  uniform vec3 uTop;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uInk;
  varying vec2 vWorld;
  void main() {
    float x = vWorld.x;
    float surface = uLevel + 0.1 * sin(x * 1.25 + uTime * 1.3 + uPhase) + 0.05 * sin(x * 3.1 - uTime * 2.0 + uPhase * 2.0);
    float d = surface - vWorld.y;
    float aa = fwidth(d);
    float a = smoothstep(-aa, aa, d);
    if (a < 0.01) discard;
    float depth = clamp(d / 3.2, 0.0, 1.0);
    vec3 color = mix(uTop, uDeep, depth);
    float band = sin(vWorld.y * 4.2 + sin(x * 0.7 + uTime * 0.5 + uPhase) * 1.4 + uTime * 0.3);
    color = mix(color, uFoam, smoothstep(0.82, 0.97, band) * 0.28 * (1.0 - depth));
    float foam = 1.0 - smoothstep(0.1, 0.2 + aa, d);
    color = mix(color, uFoam, foam);
    float line = 1.0 - smoothstep(0.0, 0.06 + aa, d);
    color = mix(color, uInk, line * 0.85);
    gl_FragColor = vec4(color, a * uOpacity);
    #include <colorspace_fragment>
  }
`;

function createWater(level: number, phase: number, opacity: number, top: string, deep: string): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: level },
      uPhase: { value: phase },
      uOpacity: { value: opacity },
      uTop: { value: new THREE.Color(top) },
      uDeep: { value: new THREE.Color(deep) },
      uFoam: { value: new THREE.Color('#ffb0d8') },
      uInk: { value: new THREE.Color('#2a0620') },
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(WORLD_W + 40, level + 10);
  geometry.translate(WORLD_W / 2, (level + 10) / 2 - 9.6, 0);
  return new THREE.Mesh(geometry, material);
}

function layer(texture: THREE.Texture, width: number, height: number, z: number, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.position.z = z;
  mesh.renderOrder = order;
  return mesh;
}

const EMBERS = 110;

/**
 * Painted background stack: camera-locked sky + embers, parallax volcano and
 * tiki layers, and two stylized water bands (behind and in front of the terrain).
 */
export class Backdrop {
  readonly frontWater: THREE.Mesh;
  private readonly sky: THREE.Mesh;
  private readonly volcano: THREE.Mesh;
  private readonly tikis: THREE.Mesh;
  private readonly backWater: THREE.Mesh;
  private readonly embers: THREE.Points;
  private readonly emberMaterial: THREE.ShaderMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    const skyTexture = paintSky();
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: skyTexture, depthWrite: false, toneMapped: false }),
    );
    this.sky.name = 'sky';
    this.sky.position.z = -70;
    this.sky.renderOrder = -10;
    camera.add(this.sky);

    this.volcano = layer(paintVolcano(), 64, 32, -14, -9);
    this.tikis = layer(paintTikis(), 48, 12, -5, -7);
    scene.add(this.volcano, this.tikis);

    const seeds = new Float32Array(EMBERS * 3);
    const rand = createSeededRandom(5);
    for (let i = 0; i < EMBERS; i += 1) {
      seeds[i * 3] = rand();
      seeds[i * 3 + 1] = rand();
      seeds[i * 3 + 2] = rand();
    }
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    emberGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    this.emberMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uView: { value: new THREE.Vector2(44, 20) },
        uPixel: { value: 1 },
        uMap: { value: emberSprite() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 seed;
        uniform float uTime;
        uniform vec2 uView;
        uniform float uPixel;
        varying float vAlpha;
        void main() {
          float speed = 0.035 + seed.z * 0.05;
          float t = fract(seed.y + uTime * speed);
          vec3 p = vec3(
            (fract(seed.x + uTime * 0.004) - 0.5) * uView.x * 1.1 + sin(uTime * 0.8 + seed.y * 30.0) * 0.5,
            (t - 0.5) * uView.y * 1.15,
            0.0);
          vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.75, 1.0, t)) * (0.55 + 0.45 * sin(uTime * 3.0 + seed.x * 40.0));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (3.0 + seed.z * 6.0) * uPixel;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(tex.rgb, tex.a * vAlpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.embers = new THREE.Points(emberGeometry, this.emberMaterial);
    this.embers.frustumCulled = false;
    this.embers.position.z = -27;
    this.embers.renderOrder = -6;
    camera.add(this.embers);

    this.backWater = createWater(WATER_Y + 0.35, 2.1, 1, '#9a2a6e', '#3a0a34');
    this.backWater.position.z = -1.2;
    this.frontWater = createWater(WATER_Y, 0, 0.9, '#c43f8c', '#40093a');
    this.frontWater.position.z = 1.4;
    scene.add(this.backWater, this.frontWater);

    this.disposables.push(
      skyTexture,
      this.sky.geometry,
      this.sky.material as THREE.Material,
      emberGeometry,
      this.emberMaterial,
    );
  }

  update(camera: THREE.OrthographicCamera, time: number, pixelRatio: number): void {
    const viewW = camera.right - camera.left;
    const viewH = camera.top - camera.bottom;
    this.sky.scale.set(viewW * 1.2, viewH * 1.2, 1);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const follow = (factor: number, baseX: number, baseY: number, mesh: THREE.Object3D) => {
      mesh.position.x = baseX + (cx - WORLD_W / 2) * factor;
      mesh.position.y = baseY + (cy - 10.5) * factor;
    };
    follow(0.82, WORLD_W / 2, 13.2, this.volcano);
    follow(0.45, WORLD_W / 2, WATER_Y + 4.6, this.tikis);
    this.emberMaterial.uniforms.uTime.value = time;
    this.emberMaterial.uniforms.uView.value.set(viewW, viewH);
    this.emberMaterial.uniforms.uPixel.value = pixelRatio;
    for (const water of [this.backWater, this.frontWater]) {
      (water.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    for (const mesh of [this.volcano, this.tikis, this.backWater, this.frontWater]) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
  }
}
