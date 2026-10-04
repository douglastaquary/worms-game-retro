import * as THREE from 'three';

function spriteTexture(paint: (context: CanvasRenderingContext2D, size: number) => void, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível');
  paint(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Spiky cartoon "POW" flash: white-hot core, yellow star burst, orange rim. */
function paintFlash(context: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  const star = (outer: number, inner: number, points: number, color: string) => {
    context.beginPath();
    for (let i = 0; i <= points * 2; i += 1) {
      const angle = (i / (points * 2)) * Math.PI * 2 + 0.2;
      const r = (i % 2 === 0 ? outer : inner) * (0.92 + 0.08 * Math.sin(i * 2.7));
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = color;
    context.fill();
  };
  context.lineJoin = 'round';
  star(c * 0.98, c * 0.62, 11, '#3a0d0a');
  star(c * 0.9, c * 0.56, 11, '#ff7a1f');
  star(c * 0.72, c * 0.44, 11, '#ffd23a');
  const core = context.createRadialGradient(c, c, 0, c, c, c * 0.5);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.6, '#fff6c4');
  core.addColorStop(1, 'rgba(255, 240, 160, 0)');
  context.fillStyle = core;
  context.beginPath();
  context.arc(c, c, c * 0.5, 0, Math.PI * 2);
  context.fill();
}

/** Cel-shaded smoke puff with a dark ink rim and a soft highlight. */
function paintPuff(context: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  context.fillStyle = '#2a0f14';
  context.beginPath();
  context.arc(c, c, c * 0.96, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(c, c, c * 0.86, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(0, 0, 0, 0.22)';
  context.beginPath();
  context.arc(c + c * 0.12, c + c * 0.14, c * 0.7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(c - c * 0.06, c - c * 0.08, c * 0.66, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.beginPath();
  context.ellipse(c - c * 0.3, c - c * 0.34, c * 0.2, c * 0.13, -0.6, 0, Math.PI * 2);
  context.fill();
}

interface Sprite {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  duration: number;
  vx: number;
  vy: number;
  gravity: number;
  from: number;
  to: number;
  fadeIn: number;
}

const PUFFS = 30;
const SPARKS = 40;
const FLASHES = 3;

/**
 * Pooled cartoon explosion VFX: a spiky flash, an expanding shock ring, ink-rimmed
 * smoke puffs that billow outward and rise, and gravity sparks.
 */
export class Effects {
  private readonly group = new THREE.Group();
  private readonly flashes: Sprite[] = [];
  private readonly rings: Sprite[] = [];
  private readonly puffs: Sprite[] = [];
  private readonly sparks: Sprite[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene) {
    const flashTexture = spriteTexture(paintFlash, 256);
    const puffTexture = spriteTexture(paintPuff);
    const plane = new THREE.PlaneGeometry(1, 1);
    const ring = new THREE.RingGeometry(0.82, 1, 40);
    const spark = new THREE.CircleGeometry(0.5, 8);
    this.textures.push(flashTexture, puffTexture);
    this.geometries.push(plane, ring, spark);

    const make = (geometry: THREE.BufferGeometry, options: THREE.MeshBasicMaterialParameters, z: number, order: number): Sprite => {
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, ...options });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.position.z = z;
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, material, life: 0, duration: 1, vx: 0, vy: 0, gravity: 0, from: 1, to: 1, fadeIn: 0 };
    };
    for (let i = 0; i < FLASHES; i += 1) {
      this.flashes.push(make(plane, { map: flashTexture }, 1.6, 12));
      this.rings.push(make(ring, { color: '#fff1c2' }, 1.55, 11));
    }
    for (let i = 0; i < PUFFS; i += 1) this.puffs.push(make(plane, { map: puffTexture }, 1.45, 10));
    for (let i = 0; i < SPARKS; i += 1) this.sparks.push(make(spark, { color: '#ffe1a8' }, 1.62, 13));
    scene.add(this.group);
  }

  explode(x: number, y: number, radius: number, kind: string, reducedMotion: boolean): void {
    const big = kind === 'holy' || kind === 'donkey';
    const r = Math.max(1.2, radius);
    const holy = kind === 'holy';

    const flash = this.take(this.flashes);
    this.launch(flash, x, y, reducedMotion ? 0.22 : 0.26, r * 1.2, r * (reducedMotion ? 1.2 : 2.3));
    flash.mesh.rotation.z = Math.random() * Math.PI;
    flash.material.color.set(holy ? '#fffbe0' : '#ffffff');

    if (!reducedMotion) {
      const ring = this.take(this.rings);
      this.launch(ring, x, y, 0.38, r * 0.4, r * 1.55);
      ring.material.color.set(holy ? '#fff6b0' : '#ffe2a6');
    }

    const puffCount = reducedMotion ? 5 : big ? 12 : 9;
    const tone = holy ? ['#fff1d6', '#e8d2b8'] : ['#6b4a4f', '#8b6a66', '#4e3438'];
    for (let i = 0; i < puffCount; i += 1) {
      const puff = this.take(this.puffs);
      const angle = (i / puffCount) * Math.PI * 2 + Math.random() * 0.5;
      const reach = r * (0.35 + Math.random() * 0.4);
      const size = r * (0.55 + Math.random() * 0.35);
      const px = x + Math.cos(angle) * reach * 0.6;
      const py = y + Math.sin(angle) * reach * 0.45 + r * 0.1;
      this.launch(puff, px, py, 0.9 + Math.random() * 0.5, size * 0.5, size * (reducedMotion ? 1 : 1.45));
      puff.fadeIn = 0.06;
      if (!reducedMotion) {
        puff.vx = Math.cos(angle) * reach * 1.6;
        puff.vy = Math.sin(angle) * reach * 0.9 + 1.4;
        puff.gravity = -1.2;
      }
      puff.material.color.set(tone[i % tone.length]);
      puff.mesh.position.z = 1.4 + i * 0.002;
    }

    if (reducedMotion) return;
    const sparkCount = big ? 22 : 14;
    for (let i = 0; i < sparkCount; i += 1) {
      const spark = this.take(this.sparks);
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      this.launch(spark, x, y, 0.35 + Math.random() * 0.35, 0.28, 0.06);
      spark.vx = Math.cos(angle) * speed;
      spark.vy = Math.abs(Math.sin(angle)) * speed + 2;
      spark.gravity = 14;
      spark.material.color.set(i % 3 === 0 ? '#ffffff' : holy ? '#fff2bf' : i % 2 ? '#ffb15a' : '#ffd84a');
    }
  }

  update(dt: number): void {
    for (const list of [this.flashes, this.rings, this.puffs, this.sparks]) {
      for (const sprite of list) {
        if (sprite.life <= 0) continue;
        sprite.life -= dt;
        if (sprite.life <= 0) {
          sprite.mesh.visible = false;
          continue;
        }
        const t = 1 - sprite.life / sprite.duration;
        const ease = 1 - (1 - t) ** 3;
        sprite.vy -= sprite.gravity * dt;
        sprite.vx *= 1 - Math.min(1, dt * 2.2);
        if (sprite.gravity < 0) sprite.vy *= 1 - Math.min(1, dt * 1.5);
        sprite.mesh.position.x += sprite.vx * dt;
        sprite.mesh.position.y += sprite.vy * dt;
        sprite.mesh.scale.setScalar(sprite.from + (sprite.to - sprite.from) * ease);
        const fadeIn = sprite.fadeIn > 0 ? Math.min(1, (t * sprite.duration) / sprite.fadeIn) : 1;
        const fadeOut = list === this.puffs ? 1 - Math.max(0, (t - 0.55) / 0.45) : 1 - t * t;
        sprite.material.opacity = Math.max(0, fadeIn * fadeOut);
      }
    }
  }

  clear(): void {
    for (const list of [this.flashes, this.rings, this.puffs, this.sparks]) {
      for (const sprite of list) {
        sprite.life = 0;
        sprite.mesh.visible = false;
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const list of [this.flashes, this.rings, this.puffs, this.sparks]) for (const sprite of list) sprite.material.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const geometry of this.geometries) geometry.dispose();
  }

  private take(list: Sprite[]): Sprite {
    let best = list[0];
    for (const sprite of list) {
      if (sprite.life <= 0) return sprite;
      if (sprite.life < best.life) best = sprite;
    }
    return best;
  }

  private launch(sprite: Sprite, x: number, y: number, duration: number, from: number, to: number): void {
    sprite.life = duration;
    sprite.duration = duration;
    sprite.from = from;
    sprite.to = to;
    sprite.vx = 0;
    sprite.vy = 0;
    sprite.gravity = 0;
    sprite.fadeIn = 0;
    sprite.mesh.position.x = x;
    sprite.mesh.position.y = y;
    sprite.mesh.scale.setScalar(from);
    sprite.mesh.visible = true;
    sprite.material.opacity = 1;
  }
}
